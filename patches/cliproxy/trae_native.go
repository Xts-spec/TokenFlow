package executor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/executor/helps"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexec "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
)

func traeNativeBody(raw []byte, model string) ([]byte, error) {
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		return nil, err
	}
	messages, ok := body["messages"].([]any)
	if !ok || len(messages) == 0 {
		return nil, fmt.Errorf("trae: messages are required")
	}
	for _, value := range messages {
		message, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("trae: invalid message")
		}
		if content, ok := message["content"].(string); ok {
			message["content"] = []any{map[string]any{"type": "text", "text": content}}
		}
		if calls, ok := message["tool_calls"].([]any); ok {
			for _, value := range calls {
				if call, ok := value.(map[string]any); ok {
					if fn, exists := call["function"]; exists {
						call["function_call"] = fn
						delete(call, "function")
					}
				}
			}
		}
	}
	// Native tool parameters are a JSON string; OpenAI sends an object.
	if tools, ok := body["tools"].([]any); ok {
		for _, value := range tools {
			tool, ok := value.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("trae: invalid tool")
			}
			fn, ok := tool["function"].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("trae: only function tools are supported")
			}
			if params, ok := fn["parameters"].(map[string]any); ok {
				encoded, err := json.Marshal(params)
				if err != nil {
					return nil, err
				}
				fn["parameters"] = string(encoded)
			}
		}
	}
	if choice, ok := body["tool_choice"].(map[string]any); ok {
		if choice["type"] == "function" {
			fn, _ := choice["function"].(map[string]any)
			name, _ := fn["name"].(string)
			if name == "" {
				return nil, fmt.Errorf("trae: named tool choice requires a name")
			}
			body["tool_choice"] = name
		} else {
			return nil, fmt.Errorf("trae: unsupported tool choice")
		}
	}
	// Native auto mode can repeat historical tool calls even when the current
	// OpenAI request has no tools. Make the unavailable-tool constraint explicit.
	if tools, ok := body["tools"].([]any); !ok || len(tools) == 0 {
		body["tool_choice"] = "none"
	}
	// Preserve the caller's output budget; otherwise use a bounded gateway default.
	if _, exists := body["max_tokens"]; !exists {
		if limit, exists := body["max_completion_tokens"]; exists {
			body["max_tokens"] = limit
		} else {
			body["max_tokens"] = 8192
		}
	}
	delete(body, "max_completion_tokens")
	// config_name is authoritative. model/model_name alone silently selects the default.
	body["config_name"] = model
	body["model"] = model
	body["function"] = "chat_v3"
	body["stream"] = true
	body["session_id"] = uuid.NewString()
	body["conversation_id"] = uuid.NewString()
	return json.Marshal(body)
}

// The shared bridge preserves Responses/Claude tools and maps native Chat chunks.
func (e *TraeExecutor) tokenFlowTraeNativeAgentStream(ctx context.Context, auth *coreauth.Auth, req coreexec.Request, _ coreexec.Options) (*coreexec.StreamResult, error) {
	return e.tokenFlowTraeNativeStream(ctx, auth, req)
}

func (e *TraeExecutor) tokenFlowTraeNativeStream(ctx context.Context, auth *coreauth.Auth, req coreexec.Request) (*coreexec.StreamResult, error) {
	raw, err := traeNativeBody(req.Payload, req.Model)
	if err != nil {
		return nil, err
	}
	base := "https://trae-api-us.mchost.guru"
	if override, ok := auth.Metadata["trae_native_base_url"].(string); ok && override != "" {
		base = override
	}
	client := helps.NewProxyAwareHTTPClient(ctx, e.cfg, auth, 0)
	endpoint := "/api/agent/v3/llm_utils_chat"
	var signed map[string]string
	// The DeepSeek streaming route drops its final output fragment but still sends
	// done/stop. The official v2 API honors stream=false while keeping SSE transport.
	// Other models retain their verified incremental route.
	if strings.EqualFold(req.Model, "deepseek-v4.1-flash") {
		var modelName, params string
		modelName, params, signed, err = traeSignedModel(ctx, client, base, auth, req.Model)
		if err != nil {
			return nil, err
		}
		var body map[string]any
		if err = json.Unmarshal(raw, &body); err != nil {
			return nil, err
		}
		delete(body, "function")
		body["model_name"] = modelName
		body["config_source"] = 1
		body["encrypted_model_params"] = params
		body["stream"] = false
		raw, err = json.Marshal(body)
		if err != nil {
			return nil, err
		}
		endpoint = "/api/ide/v2/llm_raw_chat"
	}
	request, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(base, "/")+endpoint, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	traeNativeHeaders(request, auth)
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Content-Type", "application/json")
	if signed != nil {
		request.Header.Set("X-Request-Pin", signed["RequestPin"])
		request.Header.Set("X-Requested-At", signed["RequestAt"])
		request.Header.Set("X-App-Function", "chat_v3")
		request.Header.Set("X-Ide-Function", "chat_v3")
	}
	resp, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, statusErr{code: resp.StatusCode, msg: fmt.Sprintf("trae: upstream HTTP %d", resp.StatusCode)}
	}
	chunks := make(chan coreexec.StreamChunk, 16)
	go func() {
		defer close(chunks)
		defer resp.Body.Close()
		send := func(c coreexec.StreamChunk) bool {
			select {
			case chunks <- c:
				return true
			case <-ctx.Done():
				return false
			}
		}
		err := readTraeNativeStream(resp.Body, req.Model, send)
		if err != nil && ctx.Err() == nil {
			send(coreexec.StreamChunk{Err: err})
		}
	}()
	return &coreexec.StreamResult{Headers: resp.Header, Chunks: chunks}, nil
}

func traeNativeHeaders(request *http.Request, auth *coreauth.Auth) {
	token, _ := auth.Metadata["access_token"].(string)
	request.Header.Set("Authorization", "Cloud-IDE-JWT "+token)
	request.Header.Set("X-App-Id", helps.TraeAppID)
	request.Header.Set("X-App-Version", "default")
	request.Header.Set("X-IDE-Version", "3.6.2")
	request.Header.Set("X-IDE-Version-Code", "20260212")
	request.Header.Set("X-App-Version-Code", "20260212")
	request.Header.Set("X-IDE-Version-Type", "stable")
	request.Header.Set("Request-Traffic-Type", "prod")
}

func traeSignedModel(ctx context.Context, client *http.Client, base string, auth *coreauth.Auth, model string) (string, string, map[string]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(base, "/")+"/api/ide/v1/get_detail_param?function=chat_v3&need_prompt=false", nil)
	if err != nil {
		return "", "", nil, err
	}
	traeNativeHeaders(req, auth)
	resp, err := client.Do(req)
	if err != nil {
		return "", "", nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "", nil, fmt.Errorf("trae: official model configuration HTTP %d", resp.StatusCode)
	}
	var catalog struct {
		Configs []struct {
			Name    string `json:"config_name"`
			Enabled bool   `json:"config_switch"`
			Source  int    `json:"config_source"`
			Hidden  bool   `json:"is_invisible_to_user"`
			Details []struct {
				Name   string `json:"model_name"`
				Params string `json:"encrypted_model_params"`
			} `json:"model_detail_list"`
		} `json:"config_info_list"`
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 8*1024*1024)).Decode(&catalog); err != nil {
		return "", "", nil, fmt.Errorf("trae: invalid official model configuration")
	}
	for _, cfg := range catalog.Configs {
		if cfg.Name != model || !cfg.Enabled || cfg.Hidden || cfg.Source != 1 {
			continue
		}
		for _, detail := range cfg.Details {
			if detail.Name != model+"__dev" && detail.Name != model {
				continue
			}
			var signed map[string]string
			if json.Unmarshal([]byte(detail.Params), &signed) != nil || signed["RequestPin"] == "" || signed["RequestAt"] == "" || signed["EncryptedStr"] == "" {
				return "", "", nil, fmt.Errorf("trae: invalid official model signature")
			}
			return detail.Name, detail.Params, signed, nil
		}
	}
	return "", "", nil, fmt.Errorf("trae: selected model is not available in official account configuration")
}

// Native progress/metadata are not model output. Completion requires an explicit
// done event; an EOF or a business error must never become a successful empty turn.
func readTraeNativeStream(body io.Reader, model string, send func(coreexec.StreamChunk) bool) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	event := ""
	data := []string{}
	done := false
	toolSeen := false
	visible := false
	id := "chatcmpl-" + uuid.NewString()
	created := time.Now().Unix()
	emit := func(delta map[string]any, finish any, usage any) bool {
		value := map[string]any{"id": id, "object": "chat.completion.chunk", "model": model, "created": created, "choices": []any{map[string]any{"index": 0, "delta": delta, "finish_reason": finish}}}
		if usage != nil {
			value["usage"] = usage
		}
		raw, _ := json.Marshal(value)
		return send(coreexec.StreamChunk{Payload: raw})
	}
	dispatch := func() error {
		if len(data) == 0 {
			return nil
		}
		raw := strings.Join(data, "\n")
		data = nil
		switch event {
		case "output", "token_usage", "done", "error":
		default:
			return nil
		}
		var value map[string]any
		if json.Unmarshal([]byte(raw), &value) != nil {
			return fmt.Errorf("trae: malformed %s event", event)
		}
		switch event {
		case "error":
			code, _ := value["code"].(float64)
			status := http.StatusBadGateway
			switch int(code) {
			case 1001:
				status = 401
			case 4001, 4023:
				status = 400
			case 4008, 4011:
				status = 429
			}
			return statusErr{code: status, msg: fmt.Sprintf("trae: upstream business error %d", int(code))}
		case "output":
			delta := map[string]any{}
			if text, ok := value["response"].(string); ok && text != "" {
				delta["content"] = text
				visible = true
			}
			if text, ok := value["reasoning_content"].(string); ok && text != "" {
				delta["reasoning_content"] = text
			}
			if calls, ok := value["tool_calls"].([]any); ok && len(calls) > 0 {
				for index, call := range calls {
					if c, ok := call.(map[string]any); ok {
						if fn, exists := c["function_call"]; exists {
							c["function"] = fn
							delete(c, "function_call")
						}
						if _, exists := c["index"]; !exists {
							c["index"] = index
						}
					}
				}
				delta["tool_calls"] = calls
				toolSeen = true
				visible = true
			}
			if len(delta) > 0 && !emit(delta, nil, nil) {
				return context.Canceled
			}
		case "token_usage":
			usage := map[string]any{"prompt_tokens": value["prompt_tokens"], "completion_tokens": value["completion_tokens"], "total_tokens": value["total_tokens"], "prompt_tokens_details": map[string]any{"cached_tokens": value["cache_read_input_tokens"]}, "completion_tokens_details": map[string]any{"reasoning_tokens": value["reasoning_tokens"]}}
			if !emit(map[string]any{}, nil, usage) {
				return context.Canceled
			}
		case "done":
			if !visible {
				return fmt.Errorf("trae: upstream completed without text or tool output")
			}
			finish, _ := value["finish_reason"].(string)
			if toolSeen {
				finish = "tool_calls"
			}
			if finish == "" {
				finish = "stop"
			}
			if !emit(map[string]any{}, finish, nil) {
				return context.Canceled
			}
			done = true
		}
		return nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			event = ""
			if done {
				return nil
			}
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if err := dispatch(); err != nil {
		return err
	}
	if !done {
		return io.ErrUnexpectedEOF
	}
	return nil
}

type traeNativeTool struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func accumulateTraeTools(raw []byte, calls map[int]*traeNativeTool) {
	var chunk struct {
		Choices []struct {
			Delta struct {
				Tools []struct {
					Index    int    `json:"index"`
					ID       string `json:"id"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &chunk) != nil {
		return
	}
	for _, choice := range chunk.Choices {
		for _, delta := range choice.Delta.Tools {
			if delta.Index < 0 || delta.Index > 1023 {
				continue
			}
			call := calls[delta.Index]
			if call == nil {
				call = &traeNativeTool{Type: "function"}
				calls[delta.Index] = call
			}
			if delta.ID != "" {
				call.ID = delta.ID
			}
			if delta.Function.Name != "" {
				call.Function.Name = delta.Function.Name
			}
			call.Function.Arguments += delta.Function.Arguments
		}
	}
}
func completeTraeTools(calls map[int]*traeNativeTool) []*traeNativeTool {
	out := make([]*traeNativeTool, 0, len(calls))
	for i := 0; i <= 1023; i++ {
		if call := calls[i]; call != nil {
			out = append(out, call)
		}
	}
	return out
}
