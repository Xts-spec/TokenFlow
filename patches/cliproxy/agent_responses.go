package executor

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	log "github.com/sirupsen/logrus"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

type nativeAgentStream func(context.Context, *cliproxyauth.Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error)

// Supplement the upstream codecs only for request controls they omit. Tool
// schemas, calls/results, thinking and response events stay in the SDK registry.
// An empty responses field means the option has no Responses wire equivalent;
// retain it from the original request when building the native Chat payload.
var agentParameterFields = []struct {
	aliases         []string
	responses, chat string
}{
	{[]string{"max_output_tokens", "max_completion_tokens", "max_tokens"}, "max_output_tokens", "max_tokens"},
	{[]string{"temperature"}, "temperature", "temperature"},
	{[]string{"top_p"}, "top_p", "top_p"},
	{[]string{"parallel_tool_calls"}, "parallel_tool_calls", "parallel_tool_calls"},
	{[]string{"stop", "stop_sequences"}, "", "stop"},
}

func preserveAgentParameters(original, converted []byte, toChat bool) []byte {
	for _, field := range agentParameterFields {
		target := field.responses
		if toChat {
			target = field.chat
		}
		if target == "" {
			continue
		}
		for _, alias := range field.aliases {
			if value := gjson.GetBytes(original, alias); value.Exists() {
				converted, _ = sjson.SetBytes(converted, target, value.Value())
				break
			}
		}
	}
	// Anthropic expresses sequential tools inside tool_choice, unlike Chat /
	// Responses. Losing this flag can cause independent proposals in one turn.
	if gjson.GetBytes(original, "tool_choice.disable_parallel_tool_use").Bool() {
		converted, _ = sjson.SetBytes(converted, "parallel_tool_calls", false)
	}
	return converted
}

func agentOriginal(req cliproxyexecutor.Request, opts cliproxyexecutor.Options) []byte {
	if len(opts.OriginalRequest) > 0 {
		return opts.OriginalRequest
	}
	return req.Payload
}

// Codex's codecs implement the Responses wire schema. Using those codecs does
// not select Codex credentials, alter the model, or make another HTTP request.
func agentCanonicalRequest(req cliproxyexecutor.Request, opts cliproxyexecutor.Options) ([]byte, error) {
	var body []byte
	if opts.SourceFormat == "" {
		opts.SourceFormat = sdktranslator.FormatOpenAI
	}
	switch opts.SourceFormat {
	case sdktranslator.FormatOpenAIResponse, sdktranslator.FormatCodex:
		body = req.Payload
	case sdktranslator.FormatClaude, sdktranslator.FormatOpenAI:
		payload := req.Payload
		if opts.SourceFormat == sdktranslator.FormatClaude {
			// Chat-backed agents must not inherit Codex's default reasoning
			// effort when the Messages client did not request thinking.
			if !gjson.GetBytes(payload, "thinking").Exists() {
				payload, _ = sjson.SetBytes(payload, "thinking.type", "disabled")
			}
			// Responses/Chat have no is_error flag. Keep that information in the
			// result content; otherwise an empty failed execution looks successful.
			for i, message := range gjson.GetBytes(payload, "messages").Array() {
				for j, part := range message.Get("content").Array() {
					if part.Get("type").String() != "tool_result" || !part.Get("is_error").Bool() {
						continue
					}
					path := "messages." + strconv.Itoa(i) + ".content." + strconv.Itoa(j) + ".content"
					content := part.Get("content")
					if content.IsArray() {
						parts := []any{map[string]string{"type": "text", "text": "Tool execution failed (is_error=true)."}}
						for _, value := range content.Array() {
							parts = append(parts, value.Value())
						}
						payload, _ = sjson.SetBytes(payload, path, parts)
					} else {
						payload, _ = sjson.SetBytes(payload, path, "Tool execution failed (is_error=true).\n"+content.String())
					}
				}
			}
		}
		body = sdktranslator.TranslateRequest(opts.SourceFormat, sdktranslator.FormatCodex, req.Model, payload, true)
	default:
		return nil, statusErr{code: 400, msg: "unsupported agent request protocol"}
	}
	body = preserveAgentParameters(req.Payload, body, false)
	body, _ = sjson.SetBytes(body, "stream", true)
	return body, nil
}

// Both provider transports supply native Chat chunks. Normalize them once to
// Responses events; all client-facing protocols consume this same stream.
func startAgentResponses(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options, native nativeAgentStream) (*cliproxyexecutor.StreamResult, []byte, error) {
	// Native Chat transports cannot produce a Responses compaction artifact.
	if opts.Alt == "responses/compact" {
		return nil, nil, statusErr{code: 400, msg: "responses/compact is not supported by this source agent"}
	}
	canonical, err := agentCanonicalRequest(req, opts)
	if err != nil {
		return nil, nil, err
	}
	if err = agentToolsSupported(gjson.GetBytes(canonical, "tools")); err != nil {
		return nil, nil, err
	}
	if format := gjson.GetBytes(canonical, "text.format.type").String(); format != "" && format != "text" {
		// Native Chat sources can ignore response_format and still return 200.
		// Do not claim schema enforcement when this transport cannot provide it.
		return nil, nil, statusErr{code: 400, msg: `{"error":{"type":"invalid_request_error","code":"a2a_structured_output_unsupported","message":"Structured output is not supported by this source adapter."}}`}
	}
	translated := req
	providerRequest := canonical
	// The generic upstream converter downgrades developer to user. These
	// sources support system instructions, so retain their original authority.
	for i, item := range gjson.GetBytes(canonical, "input").Array() {
		if item.Get("role").String() == "developer" {
			providerRequest, _ = sjson.SetBytes(providerRequest, "input."+strconv.Itoa(i)+".role", "system")
		}
	}
	translated.Payload = sdktranslator.TranslateRequest(sdktranslator.FormatOpenAIResponse, sdktranslator.FormatOpenAI, req.Model, providerRequest, true)
	translated.Payload, err = agentToolChoice(canonical, translated.Payload)
	if err != nil {
		return nil, nil, err
	}
	translated.Payload = preserveAgentParameters(req.Payload, translated.Payload, true)
	var restoreNames func([]byte) []byte
	translated.Payload, restoreNames = agentChatToolNames(translated.Payload)
	upstream, err := native(ctx, auth, translated, opts)
	if err != nil {
		return nil, nil, err
	}
	out := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(out)
		var param any
		send := func(chunk cliproxyexecutor.StreamChunk) bool {
			select {
			case out <- chunk:
				return true
			case <-ctx.Done():
				return false
			}
		}
		translate := func(payload []byte) bool {
			for _, event := range sdktranslator.TranslateStream(ctx, sdktranslator.FormatOpenAI, sdktranslator.FormatOpenAIResponse, req.Model, canonical, translated.Payload, append([]byte("data: "), payload...), &param) {
				if len(event) > 0 && !send(cliproxyexecutor.StreamChunk{Payload: event}) {
					return false
				}
			}
			return true
		}
		toolIndices := map[int64]bool{}
		sequential := gjson.GetBytes(canonical, "parallel_tool_calls")
		for chunk := range upstream.Chunks {
			if chunk.Err != nil {
				send(chunk)
				return
			}
			if sequential.Exists() && !sequential.Bool() {
				for _, call := range gjson.GetBytes(chunk.Payload, "choices.0.delta.tool_calls").Array() {
					toolIndices[call.Get("index").Int()] = true
				}
				if len(toolIndices) > 1 {
					send(cliproxyexecutor.StreamChunk{Err: statusErr{code: 502, msg: `{"error":{"type":"upstream_protocol_error","code":"a2a_parallel_tools_violated","message":"The source proposed multiple tools despite the caller's sequential-tool requirement."}}`}})
					return
				}
			}
			if !translate(restoreNames(chunk.Payload)) {
				return
			}
		}
		if ctx.Err() == nil {
			translate([]byte("[DONE]"))
		}
	}()
	headers := upstream.Headers.Clone()
	headers.Set("Content-Type", "text/event-stream")
	headers.Del("Content-Length")
	return &cliproxyexecutor.StreamResult{Headers: headers, Chunks: out}, canonical, nil
}

// Chat function names have a 64-byte limit. Namespace flattening can exceed it.
// Alias only names, including history and forced choices; never alter arguments,
// IDs, tool results or instructions. Restore names before the Responses codec.
func agentChatToolNames(payload []byte) ([]byte, func([]byte) []byte) {
	paths := map[string]string{}
	for i, tool := range gjson.GetBytes(payload, "tools").Array() {
		paths[fmt.Sprintf("tools.%d.function.name", i)] = tool.Get("function.name").String()
	}
	for i, message := range gjson.GetBytes(payload, "messages").Array() {
		for j, call := range message.Get("tool_calls").Array() {
			paths[fmt.Sprintf("messages.%d.tool_calls.%d.function.name", i, j)] = call.Get("function.name").String()
		}
	}
	if name := gjson.GetBytes(payload, "tool_choice.function.name").String(); name != "" {
		paths["tool_choice.function.name"] = name
	}
	aliases, reverse, reserved := map[string]string{}, map[string]string{}, map[string]bool{}
	for _, name := range paths {
		reserved[name] = true
	}
	for path, name := range paths {
		if len(name) <= 64 {
			continue
		}
		alias := aliases[name]
		if alias == "" {
			for nonce := 0; ; nonce++ {
				sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%d", name, nonce)))
				alias = fmt.Sprintf("tf_%x", sum)[:63]
				if !reserved[alias] {
					break
				}
			}
			reserved[alias] = true
			aliases[name] = alias
			reverse[alias] = name
		}
		payload, _ = sjson.SetBytes(payload, path, alias)
	}
	return payload, func(chunk []byte) []byte {
		for i, choice := range gjson.GetBytes(chunk, "choices").Array() {
			for j, call := range choice.Get("delta.tool_calls").Array() {
				if name, ok := reverse[call.Get("function.name").String()]; ok {
					chunk, _ = sjson.SetBytes(chunk, fmt.Sprintf("choices.%d.delta.tool_calls.%d.function.name", i, j), name)
				}
			}
		}
		return chunk
	}
}

// Chat-backed sources can execute client function/custom tools, but have no
// Responses server-side tool runtime. Never silently drop those declarations.
func agentToolsSupported(tools gjson.Result) error {
	for _, tool := range tools.Array() {
		switch tool.Get("type").String() {
		case "function", "custom":
		case "namespace":
			if err := agentToolsSupported(tool.Get("tools")); err != nil {
				return err
			}
		default:
			return statusErr{code: 400, msg: `{"error":{"type":"invalid_request_error","code":"a2a_server_tool_unsupported","message":"This source supports client function/custom tools only; server-side or unknown tool types are not supported."}}`}
		}
	}
	return nil
}

// Responses names the tool directly; Chat requires a nested function selector,
// including custom tools represented by the codec's {input:string} wrapper.
func agentToolChoice(canonical, chat []byte) ([]byte, error) {
	choice := gjson.GetBytes(canonical, "tool_choice")
	if !choice.Exists() {
		return chat, nil
	}
	if choice.Type == gjson.String {
		switch choice.String() {
		case "auto", "none", "required":
			return sjson.SetBytes(chat, "tool_choice", choice.String())
		}
		return nil, statusErr{code: 400, msg: "unsupported tool_choice"}
	}
	name := strings.TrimSpace(choice.Get("name").String())
	namespace := choice.Get("namespace").String()
	if namespace != "" && !strings.HasPrefix(name, namespace) && !strings.HasPrefix(name, "mcp__") {
		if !strings.HasSuffix(namespace, "__") {
			namespace += "__"
		}
		name = namespace + name
	}
	if choice.Get("type").String() != "function" && choice.Get("type").String() != "custom" {
		return nil, statusErr{code: 400, msg: "tool_choice is not supported by this source; use auto, none, required or a named function/custom tool"}
	}
	for _, tool := range gjson.GetBytes(chat, "tools").Array() {
		if name != "" && tool.Get("function.name").String() == name {
			return sjson.SetBytes(chat, "tool_choice", map[string]any{"type": "function", "function": map[string]string{"name": name}})
		}
	}
	return nil, statusErr{code: 400, msg: "tool_choice names an unavailable tool"}
}

// Translator output contains complete SSE records, never arbitrary socket
// fragments. Extract only data lines before feeding the target's event codec.
func agentResponseData(payload []byte) [][]byte {
	var events [][]byte
	for _, line := range bytes.Split(payload, []byte("\n")) {
		if bytes.HasPrefix(line, []byte("data:")) {
			events = append(events, bytes.TrimSpace(line[5:]))
		}
	}
	return events
}

func executeAgentResponse(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options, native nativeAgentStream) (cliproxyexecutor.Response, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stream, canonical, err := startAgentResponses(ctx, auth, req, opts, native)
	if err != nil {
		return cliproxyexecutor.Response{}, err
	}
	var terminal []byte
	for chunk := range stream.Chunks {
		if chunk.Err != nil {
			return cliproxyexecutor.Response{}, chunk.Err
		}
		for _, data := range agentResponseData(chunk.Payload) {
			switch gjson.GetBytes(data, "type").String() {
			case "response.completed", "response.incomplete":
				terminal = bytes.Clone(data)
			}
		}
	}
	if ctx.Err() != nil {
		return cliproxyexecutor.Response{}, ctx.Err()
	}
	if len(terminal) == 0 {
		return cliproxyexecutor.Response{}, statusErr{code: 502, msg: "source returned no terminal Responses event"}
	}
	target := cliproxyexecutor.ResponseFormatOrSource(opts)
	if target == "" {
		target = sdktranslator.FormatOpenAI
	}
	var output []byte
	if target == sdktranslator.FormatOpenAIResponse || target == sdktranslator.FormatCodex {
		output = []byte(gjson.GetBytes(terminal, "response").Raw)
	} else {
		var param any
		output = sdktranslator.TranslateNonStream(ctx, sdktranslator.FormatCodex, target, req.Model, agentOriginal(req, opts), canonical, terminal, &param)
	}
	if !gjson.ValidBytes(output) {
		return cliproxyexecutor.Response{}, statusErr{code: 502, msg: "invalid translated agent response"}
	}
	headers := stream.Headers.Clone()
	headers.Set("Content-Type", "application/json")
	return cliproxyexecutor.Response{Payload: output, Headers: headers}, nil
}

func executeAgentResponseStream(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options, native nativeAgentStream) (*cliproxyexecutor.StreamResult, error) {
	ctx, cancel := context.WithCancel(ctx)
	stream, canonical, err := startAgentResponses(ctx, auth, req, opts, native)
	if err != nil {
		cancel()
		return nil, err
	}
	out := make(chan cliproxyexecutor.StreamChunk)
	go func() {
		defer close(out)
		defer cancel()
		var param any
		target := cliproxyexecutor.ResponseFormatOrSource(opts)
		if target == "" {
			target = sdktranslator.FormatOpenAI
		}
		send := func(chunk cliproxyexecutor.StreamChunk) bool {
			select {
			case out <- chunk:
				return true
			case <-ctx.Done():
				return false
			}
		}
		for chunk := range stream.Chunks {
			if chunk.Err != nil {
				send(chunk)
				return
			}
			if target == sdktranslator.FormatOpenAIResponse || target == sdktranslator.FormatCodex {
				if !send(chunk) {
					return
				}
				continue
			}
			for _, data := range agentResponseData(chunk.Payload) {
				for _, event := range sdktranslator.TranslateStream(ctx, sdktranslator.FormatCodex, target, req.Model, agentOriginal(req, opts), canonical, append([]byte("data: "), data...), &param) {
					if len(event) > 0 && !send(cliproxyexecutor.StreamChunk{Payload: event}) {
						return
					}
				}
			}
		}
	}()
	return &cliproxyexecutor.StreamResult{Headers: stream.Headers, Chunks: out}, nil
}

func readAgentChatStream(ctx context.Context, resp *http.Response, provider string) *cliproxyexecutor.StreamResult {
	chunks := make(chan cliproxyexecutor.StreamChunk, 64)
	go func() {
		defer close(chunks)
		defer resp.Body.Close()
		// Closing the body interrupts a blocked Scan even if the transport does
		// not itself bind reads to this consumer's cancellation context.
		stopCancellation := context.AfterFunc(ctx, func() { _ = resp.Body.Close() })
		defer stopCancellation()
		send := func(chunk cliproxyexecutor.StreamChunk) bool {
			select {
			case chunks <- chunk:
				return true
			case <-ctx.Done():
				return false
			}
		}
		fail := func(message string) {
			send(cliproxyexecutor.StreamChunk{Err: statusErr{code: 502, msg: provider + ": " + message}})
		}
		scanner := bufio.NewScanner(resp.Body)
		scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
		seen, finished, toolCalls := false, false, false
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" {
				continue
			}
			if data == "[DONE]" {
				if !seen {
					fail("upstream returned no model events")
				} else if toolCalls && !finished {
					fail("upstream stream ended before completion")
				}
				return
			}
			if !gjson.Valid(data) {
				fail("invalid upstream event")
				return
			}
			envelope := gjson.Parse(data)
			if envelope.Get("error").Exists() {
				fail("upstream reported an error")
				return
			}
			body := envelope.Get("body")
			if body.Type == gjson.String {
				data = body.String()
			} else if body.IsObject() {
				data = body.Raw
			} else if !envelope.Get("choices").Exists() && !envelope.Get("usage").IsObject() {
				continue
			}
			if data == "[DONE]" {
				if !seen {
					fail("upstream returned no model events")
				} else if toolCalls && !finished {
					fail("upstream stream ended before completion")
				}
				return
			}
			if !gjson.Valid(data) {
				fail("invalid model response")
				return
			}
			chunk := gjson.Parse(data)
			if provider == "qoder" {
				logQoderAccounting(chunk)
			}
			if chunk.Get("error").Exists() {
				if chunk.Get("error.code").String() == "invalid_parameter_error" || chunk.Get("error.type").String() == "invalid_request_error" {
					send(cliproxyexecutor.StreamChunk{Err: statusErr{code: 400, msg: `{"error":{"type":"invalid_request_error","code":"a2a_invalid_request","message":"The source rejected request parameters."}}`}})
				} else {
					fail("model response reported an error")
				}
				return
			}
			if !chunk.Get("choices").IsArray() {
				if !chunk.Get("usage").IsObject() {
					continue
				}
				// Some sources send accounting in a standalone final SSE event.
				// The Chat codec expects choices:[] for these usage-only chunks.
				dataBytes, err := sjson.SetBytes([]byte(data), "choices", []any{})
				if err != nil {
					fail("invalid usage event")
					return
				}
				data = string(dataBytes)
				chunk = gjson.Parse(data)
			}
			if len(chunk.Get("choices").Array()) > 0 {
				seen = true
			}
			// Some native text streams use DONE alone. Tool calls require an
			// explicit finish reason so partial arguments cannot become success.
			if len(chunk.Get("choices.0.delta.tool_calls").Array()) > 0 {
				toolCalls = true
			}
			if reason := chunk.Get("choices.0.finish_reason"); reason.Exists() && reason.Type != gjson.Null && reason.String() != "" {
				finished = true
			}
			if !send(cliproxyexecutor.StreamChunk{Payload: []byte(data)}) {
				return
			}
		}
		if ctx.Err() != nil {
			return
		}
		if scanner.Err() != nil {
			fail("upstream stream read failed")
		} else if !seen {
			fail("upstream returned no model events")
		} else if !finished {
			fail("upstream stream ended before completion")
		}
	}()
	return &cliproxyexecutor.StreamResult{Headers: resp.Header, Chunks: chunks}
}

// Keep upstream billing observable without logging prompts, account identifiers,
// credentials, or inventing a Credits-to-token conversion for client protocols.
func logQoderAccounting(chunk gjson.Result) {
	fields := log.Fields{"provider": "qoder"}
	if billable := chunk.Get("usage.billable"); billable.Type == gjson.True || billable.Type == gjson.False {
		fields["billable"] = billable.Bool()
	}
	if credits := chunk.Get("usage.credits"); credits.Type == gjson.Number {
		fields["credits"] = credits.Float()
	}
	if len(fields) > 1 {
		// The sidecar formatter intentionally omits arbitrary structured fields.
		// Repeat only these validated scalars in the message for the host reader.
		parts := []string{"qoder upstream accounting"}
		for _, key := range []string{"billable", "credits"} {
			if value, ok := fields[key]; ok {
				parts = append(parts, fmt.Sprintf("%s=%v", key, value))
			}
		}
		log.WithFields(fields).Info(strings.Join(parts, " "))
	}
}
