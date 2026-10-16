package executor

import (
	"context"
	"encoding/json"
	"errors"
	_ "github.com/router-for-me/CLIProxyAPI/v7/internal/translator"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexec "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"github.com/tidwall/gjson"
)

func TestTraeNativeRequestAndEvents(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/agent/v3/llm_utils_chat" || r.Header.Get("Authorization") != "Cloud-IDE-JWT fixture" || r.Header.Get("X-IDE-Version-Code") != "20260212" {
			t.Errorf("wrong native endpoint/identity")
		}
		raw, _ := io.ReadAll(r.Body)
		if gjson.GetBytes(raw, "config_name").String() != "Dola-Seed-2.0-Code" || gjson.GetBytes(raw, "function").String() != "chat_v3" || gjson.GetBytes(raw, "messages.0.content.0.text").String() != "test" {
			t.Errorf("wrong native payload: %s", raw)
		}
		io.WriteString(w, "event:progress_notice\ndata:\"wait\"\n\nevent:output\ndata:{\"response\":\"ok\"}\n\nevent:token_usage\ndata:{\"prompt_tokens\":10,\"completion_tokens\":2,\"total_tokens\":12}\n\nevent:done\ndata:{\"finish_reason\":\"stop\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	result, err := e.Execute(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"messages":[{"role":"user","content":"test"}]}`)}, coreexec.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(result.Payload, "choices.0.message.content").String() != "ok" || gjson.GetBytes(result.Payload, "usage.total_tokens").Int() != 12 {
		t.Fatalf("native output lost: %s", result.Payload)
	}
}
func TestTraeNativeNeverCompletesAnErrorOrEOF(t *testing.T) {
	for _, tc := range []struct {
		name, stream string
		eof          bool
	}{
		{"eof", "event:output\ndata:{\"response\":\"partial\"}\n\n", true},
		{"business", "event:error\ndata:{\"code\":4001}\n\n", false},
		{"bad-json", "event:output\ndata:{broken}\n\n", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			done := false
			err := readTraeNativeStream(strings.NewReader(tc.stream), "test", func(c coreexec.StreamChunk) bool {
				done = done || strings.Contains(string(c.Payload), "[DONE]")
				return true
			})
			if err == nil || done {
				t.Fatal("incorrect successful completion")
			}
			if tc.eof && !errors.Is(err, io.ErrUnexpectedEOF) {
				t.Fatal(err)
			}
		})
	}
}
func TestTraeNativeToolsAndCancellation(t *testing.T) {
	stream := "event:output\ndata:{\"tool_calls\":[{\"id\":\"c1\",\"type\":\"function\",\"function_call\":{\"name\":\"read_probe\",\"arguments\":\"{\\\"step\\\":1}\"}}]}\n\nevent:done\ndata:{\"finish_reason\":\"tool_calls\"}\n\n"
	var output []byte
	if err := readTraeNativeStream(strings.NewReader(stream), "test", func(c coreexec.StreamChunk) bool { output = append(output, c.Payload...); return true }); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(output), `"index":0`) || !strings.Contains(string(output), `"read_probe"`) {
		t.Fatal("tool proposal lost")
	}
	if err := readTraeNativeStream(strings.NewReader(stream), "test", func(coreexec.StreamChunk) bool { return false }); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel ignored: %v", err)
	}
	body, err := traeNativeBody([]byte(`{"messages":[{"role":"assistant","tool_calls":[{"id":"c1"}]},{"role":"tool","tool_call_id":"c1","content":"result"}],"tools":[{"type":"function","function":{"name":"read_probe"}}]}`), "test")
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if json.Unmarshal(body, &decoded) != nil || gjson.GetBytes(body, "messages.1.tool_call_id").String() != "c1" || gjson.GetBytes(body, "tools.0.function.name").String() != "read_probe" {
		t.Fatal("tool context lost")
	}
}
func TestTraeNativeNonstreamToolArguments(t *testing.T) {
	calls := make(map[int]*traeNativeTool)
	accumulateTraeTools([]byte(`{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_probe","arguments":"{\"step\":"}}]}}]}`), calls)
	accumulateTraeTools([]byte(`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}`), calls)
	out := completeTraeTools(calls)
	if len(out) != 1 || out[0].ID != "c1" || out[0].Function.Arguments != `{"step":1}` {
		t.Fatalf("tool aggregation failed: %+v", out)
	}
}
func TestTraeNativeSerializesSchemaAndNamedChoice(t *testing.T) {
	raw, err := traeNativeBody([]byte(`{"messages":[{"role":"user","content":"read"}],"tools":[{"type":"function","function":{"name":"read","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}}],"tool_choice":{"type":"function","function":{"name":"read"}}}`), "Dola-Seed-2.0-Code")
	if err != nil {
		t.Fatal(err)
	}
	schema := gjson.GetBytes(raw, "tools.0.function.parameters")
	if schema.Type != gjson.String || gjson.Get(schema.String(), "required.0").String() != "path" || gjson.GetBytes(raw, "tool_choice").String() != "read" {
		t.Fatalf("invalid native tool wire: %s", raw)
	}
}

// Captures the upstream bug: stream=true ends successfully with only a prefix;
// the official v2 request with a signed catalog and stream=false returns the tail.
func TestTraeNativeDeepSeekDoesNotLoseFinalText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" && r.URL.Path == "/api/ide/v1/get_detail_param" {
			io.WriteString(w, `{"config_info_list":[{"config_name":"deepseek-v4.1-flash","config_source":1,"config_switch":true,"model_detail_list":[{"model_name":"deepseek-v4.1-flash__dev","encrypted_model_params":"{\"RequestPin\":\"fixture-pin\",\"RequestAt\":\"1792124452\",\"EncryptedStr\":\"fixture-ciphertext\"}"}]}]}`)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/api/ide/v2/llm_raw_chat" || r.Header.Get("X-Request-Pin") != "fixture-pin" || r.Header.Get("X-Requested-At") != "1792124452" || gjson.GetBytes(raw, "model_name").String() != "deepseek-v4.1-flash__dev" {
			t.Errorf("official signed route missing")
		}
		text := "TRAE_FINAL_COMPLETE_OK"
		if gjson.GetBytes(raw, "stream").Bool() {
			text = "TRAE"
		}
		io.WriteString(w, "event: output\ndata: {\"response\":\""+text+"\"}\n\nevent: done\ndata: {\"finish_reason\":\"\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.Execute(context.Background(), a, coreexec.Request{Model: "deepseek-v4.1-flash", Payload: []byte(`{"stream":true,"messages":[{"role":"user","content":"Reply TRAE_FINAL_COMPLETE_OK"}]}`)}, coreexec.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(r.Payload, "choices.0.message.content").String() != "TRAE_FINAL_COMPLETE_OK" {
		t.Fatalf("final output truncated: %s", r.Payload)
	}
}

func TestTraeNativeLeavesSSEFramingToHTTPHandler(t *testing.T) {
	frames := 0
	err := readTraeNativeStream(strings.NewReader("event:output\ndata:{\"response\":\"complete\"}\n\nevent:done\ndata:{}\n\n"), "test", func(c coreexec.StreamChunk) bool {
		// OpenAI's WriteChunk adds data: and [DONE]. Executor chunks must be JSON.
		if !json.Valid(c.Payload) {
			t.Errorf("executor supplied framed/non-JSON chunk: %s", c.Payload)
		}
		frames++
		return true
	})
	if err != nil || frames != 2 {
		t.Fatalf("invalid completion: frames=%d error=%v", frames, err)
	}
}

func TestTraeNativeDisablesToolsWhenOnlyHistoricalCallsRemain(t *testing.T) {
	raw, err := traeNativeBody([]byte(`{"messages":[{"role":"assistant","tool_calls":[{"id":"c1","type":"function","function":{"name":"read_probe","arguments":"{}"}}]},{"role":"tool","tool_call_id":"c1","content":"done"},{"role":"user","content":"Reply final text only"}]}`), "deepseek-v4.1-flash")
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(raw, "tool_choice").String() != "none" {
		t.Fatal("historical tools must not reactivate native default auto selection")
	}
}

func TestTraeNativeAcceptsResponsesClient(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if gjson.GetBytes(raw, "messages.0.content.0.text").String() != "test" {
			t.Errorf("Responses input was not converted")
		}
		io.WriteString(w, "event:output\ndata:{\"response\":\"complete\"}\n\nevent:done\ndata:{\"finish_reason\":\"stop\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.Execute(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":[{"role":"user","content":"test"}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(r.Payload, "output.0.content.0.text").String() != "complete" {
		t.Fatalf("Responses output was not converted: %s", r.Payload)
	}
}
