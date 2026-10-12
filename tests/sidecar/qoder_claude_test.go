package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	_ "github.com/router-for-me/CLIProxyAPI/v7/internal/translator"
	cliproxyauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	"github.com/tidwall/gjson"
)

func TestQoderClaudeWireFormat(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, chunk := range []string{`{"id":"fixture","model":"kmodel_latest","choices":[{"index":0,"delta":{"role":"assistant","content":"OK"},"finish_reason":null}]}`, `{"id":"fixture","model":"kmodel_latest","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`} {
			envelope, _ := json.Marshal(map[string]string{"body": chunk})
			fmt.Fprintf(w, "data: %s\n\n", envelope)
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	exec := NewQoderExecutor(&config.Config{})
	auth := &cliproxyauth.Auth{ID: "fixture", Provider: "qoder", Attributes: map[string]string{"chat_url": server.URL}, Metadata: map[string]any{"access_token": "synthetic"}}
	req := cliproxyexecutor.Request{Model: "kmodel_latest", Payload: []byte(`{"model":"kmodel_latest","messages":[{"role":"user","content":"Reply OK"}],"max_tokens":16}`)}
	opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatClaude, OriginalRequest: req.Payload}
	t.Run("stream", func(t *testing.T) {
		result, err := exec.ExecuteStream(context.Background(), auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		var wire strings.Builder
		for chunk := range result.Chunks {
			if chunk.Err != nil {
				t.Fatal(chunk.Err)
			}
			wire.Write(chunk.Payload)
		}
		for _, expected := range []string{"event: message_start", "event: content_block_delta", "event: message_stop"} {
			if !strings.Contains(wire.String(), expected) {
				t.Errorf("missing %s in Claude stream: %s", expected, wire.String())
			}
		}
	})
	t.Run("nonstream", func(t *testing.T) {
		result, err := exec.Execute(context.Background(), auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		if gjson.GetBytes(result.Payload, "type").String() != "message" {
			t.Fatalf("not an Anthropic Message: %s", result.Payload)
		}
		if gjson.GetBytes(result.Payload, "content.0.text").String() != "OK" {
			t.Fatalf("missing text: %s", result.Payload)
		}
	})
	t.Run("responses", func(t *testing.T) {
		req.Payload = []byte(`{"model":"kmodel_latest","input":"Reply OK","max_output_tokens":16}`)
		opts = cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatOpenAIResponse, OriginalRequest: req.Payload}
		result, err := exec.Execute(context.Background(), auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		if gjson.GetBytes(result.Payload, "object").String() != "response" || gjson.GetBytes(result.Payload, "output.0.content.0.text").String() != "OK" {
			t.Fatalf("invalid Responses output: %s", result.Payload)
		}
		stream, err := exec.ExecuteStream(context.Background(), auth, req, opts)
		if err != nil {
			t.Fatal(err)
		}
		var wire strings.Builder
		for chunk := range stream.Chunks {
			if chunk.Err != nil {
				t.Fatal(chunk.Err)
			}
			wire.Write(chunk.Payload)
		}
		for _, expected := range []string{"response.created", "response.output_text.delta", "response.completed"} {
			if !strings.Contains(wire.String(), expected) {
				t.Errorf("missing %s in Responses stream: %s", expected, wire.String())
			}
		}
	})
}

func TestQoderToolCallAndInvalidStream(t *testing.T) {
	for _, mode := range []string{"tool", "empty", "truncated", "premature-done", "wrapped-done", "json-error"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				if mode == "json-error" {
					fmt.Fprint(w, `{"error":{"message":"private upstream diagnostic"}}`)
					return
				}
				if mode == "empty" {
					fmt.Fprint(w, "data: [DONE]\n\n")
					return
				}
				chunks := []string{`{"id":"fixture-tool","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_new","type":"function","function":{"name":"lookup","arguments":"{\"path\":"}}]},"finish_reason":null}]}`}
				if mode == "tool" {
					chunks = append(chunks, `{"id":"fixture-tool","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"README.md\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}`)
				}
				for _, chunk := range chunks {
					envelope, _ := json.Marshal(map[string]string{"body": chunk})
					fmt.Fprintf(w, "data: %s\n\n", envelope)
				}
				if mode == "wrapped-done" {
					fmt.Fprint(w, "data: {\"body\":\"[DONE]\"}\n\n")
				}
				if mode == "tool" || mode == "premature-done" {
					fmt.Fprint(w, "data: [DONE]\n\n")
				}
			}))
			defer server.Close()
			exec := NewQoderExecutor(&config.Config{})
			auth := &cliproxyauth.Auth{ID: "fixture", Provider: "qoder", Attributes: map[string]string{"chat_url": server.URL}, Metadata: map[string]any{"access_token": "synthetic"}}
			req := cliproxyexecutor.Request{Model: "kmodel_latest", Payload: []byte(`{"model":"kmodel_latest","stream":true,"system":"fixture-system","messages":[{"role":"user","content":"use lookup"}],"tools":[{"name":"lookup","description":"fixture","input_schema":{"type":"object","properties":{"path":{"type":"string"}}}}],"max_tokens":64}`)}
			opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatClaude, OriginalRequest: req.Payload, Stream: true}
			result, err := exec.Execute(context.Background(), auth, req, opts)
			if mode != "tool" {
				if err == nil {
					t.Fatalf("invalid %s stream accepted: %s", mode, result.Payload)
				}
				stream, streamErr := exec.ExecuteStream(context.Background(), auth, req, opts)
				if streamErr != nil {
					t.Fatal(streamErr)
				}
				failed := false
				for chunk := range stream.Chunks {
					if chunk.Err != nil {
						failed = true
					}
					if strings.Contains(string(chunk.Payload), "event: message_stop") {
						t.Fatal("invalid stream fabricated completion")
					}
				}
				if !failed {
					t.Fatal("invalid streaming response accepted")
				}
				if strings.Contains(err.Error(), "private upstream") {
					t.Fatal("upstream diagnostic exposed")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			for path, want := range map[string]string{"type": "message", "stop_reason": "tool_use", "content.0.type": "tool_use", "content.0.id": "call_new", "content.0.name": "lookup", "content.0.input.path": "README.md", "usage.input_tokens": "11", "usage.output_tokens": "3"} {
				if got := gjson.GetBytes(result.Payload, path).String(); got != want {
					t.Errorf("%s = %q, want %q", path, got, want)
				}
			}
			stream, err := exec.ExecuteStream(context.Background(), auth, req, opts)
			if err != nil {
				t.Fatal(err)
			}
			var wire strings.Builder
			for chunk := range stream.Chunks {
				if chunk.Err != nil {
					t.Fatal(chunk.Err)
				}
				wire.Write(chunk.Payload)
			}
			for _, want := range []string{"event: message_start", `"type":"tool_use"`, `"type":"input_json_delta"`, `"stop_reason":"tool_use"`, "event: message_stop"} {
				if !strings.Contains(wire.String(), want) {
					t.Errorf("missing %s in tool stream", want)
				}
			}
		})
	}
}

func TestQoderLongToolNamesRoundTrip(t *testing.T) {
	name := "mcp__fixture__" + strings.Repeat("long_tool_", 9)
	payload, _ := json.Marshal(map[string]any{"model": "kmodel_latest", "input": []any{
		map[string]any{"type": "function_call", "call_id": "old", "name": name, "arguments": "{}"},
		map[string]any{"type": "function_call_output", "call_id": "old", "output": "previous result"},
	}, "tools": []any{map[string]any{"type": "function", "name": name, "parameters": map[string]any{"type": "object"}}}, "tool_choice": map[string]any{"type": "function", "name": name}})
	native := func(ctx context.Context, auth *cliproxyauth.Auth, req cliproxyexecutor.Request, opts cliproxyexecutor.Options) (*cliproxyexecutor.StreamResult, error) {
		short := gjson.GetBytes(req.Payload, "tools.0.function.name").String()
		if len(short) > 64 {
			t.Fatalf("Qoder rejects tool name length %d", len(short))
		}
		if gjson.GetBytes(req.Payload, "tool_choice.function.name").String() != short || gjson.GetBytes(req.Payload, "messages.0.tool_calls.0.function.name").String() != short {
			t.Fatal("tool selection/history did not use the same alias")
		}
		chunks := make(chan cliproxyexecutor.StreamChunk, 2)
		first, _ := json.Marshal(map[string]any{"id": "fixture", "choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "new", "type": "function", "function": map[string]any{"name": short, "arguments": "{}"}}}}, "finish_reason": "tool_calls"}}})
		chunks <- cliproxyexecutor.StreamChunk{Payload: first}
		close(chunks)
		return &cliproxyexecutor.StreamResult{Headers: http.Header{}, Chunks: chunks}, nil
	}
	opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatOpenAIResponse, OriginalRequest: payload}
	result, err := executeAgentResponse(context.Background(), nil, cliproxyexecutor.Request{Model: "kmodel_latest", Payload: payload}, opts, native)
	if err != nil {
		t.Fatal(err)
	}
	if gjson.GetBytes(result.Payload, "output.0.name").String() != name {
		t.Fatal("tool name was not restored")
	}
}

func TestQoderInvalidParameterIsRequestFault(t *testing.T) {
	body := `data: {"body":"{\"error\":{\"code\":\"invalid_parameter_error\",\"type\":\"invalid_request_error\",\"message\":\"The length of the tool name cannot exceed 64. private-payload\"}}"}` + "\n\n"
	resp := &http.Response{Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body))}
	stream := readAgentChatStream(context.Background(), resp, "qoder")
	var failure error
	for chunk := range stream.Chunks {
		if chunk.Err != nil {
			failure = chunk.Err
		}
	}
	typed, ok := failure.(interface{ StatusCode() int })
	if !ok || typed.StatusCode() != 400 {
		t.Fatalf("parameter error poisoned source health: %v", failure)
	}
	if !strings.Contains(failure.Error(), "a2a_invalid_request") || strings.Contains(failure.Error(), "private-payload") {
		t.Fatal("missing safe request category or exposed diagnostic")
	}
}
