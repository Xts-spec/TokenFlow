package executor

import (
	"context"
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

// A Messages client can execute its own Write tool, but the Claude codec cannot
// deliver native Responses image_generation_call output. Advertising that extra
// tool lets an otherwise successful response become an empty end_turn.
func TestTokenFlowCodexClaudeDoesNotAdvertiseInvisibleImageTool(t *testing.T) {
	for _, scenario := range []struct {
		name                        string
		nativeResponses, chat, deny bool
	}{
		{name: "claude"},
		{name: "workbuddy-chat", chat: true},
		{name: "codex-responses", nativeResponses: true},
		{name: "other-client-responses", nativeResponses: true, deny: true},
	} {
		for _, stream := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/stream=%t", scenario.name, stream), func(t *testing.T) {
				var advertisedImage bool
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					body, err := io.ReadAll(r.Body)
					if err != nil {
						t.Error(err)
						return
					}
					for _, tool := range gjson.GetBytes(body, "tools").Array() {
						advertisedImage = advertisedImage || tool.Get("type").String() == "image_generation"
					}
					item := `{"id":"fc_svg","type":"function_call","call_id":"call_svg","name":"Write","arguments":"{\"file_path\":\"diagram.svg\",\"content\":\"<svg/>\"}","status":"completed"}`
					if advertisedImage {
						item = `{"id":"ig_fixture","type":"image_generation_call","status":"completed","result":"cG5nLWZpeHR1cmU="}`
					}
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_fixture\",\"model\":\"gpt-6.1-sol\"}}\n\n")
					fmt.Fprintf(w, "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":%s}\n\n", item)
					fmt.Fprintf(w, "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_fixture\",\"model\":\"gpt-6.1-sol\",\"status\":\"completed\",\"output\":[%s],\"usage\":{\"input_tokens\":10,\"output_tokens\":20}}}\n\n", item)
				}))
				defer server.Close()
				executor := NewCodexExecutor(&config.Config{})
				auth := &cliproxyauth.Auth{Provider: "codex", Attributes: map[string]string{
					"api_key": "fixture", "base_url": server.URL, "plan_type": "pro",
				}}
				request := cliproxyexecutor.Request{Model: "gpt-6.1-sol", Payload: []byte(`{"model":"gpt-6.1-sol","max_tokens":1024,"messages":[{"role":"user","content":"Draw a simple diagram"}],"tools":[{"name":"Write","description":"Write a file","input_schema":{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}},"required":["file_path","content"]}}]}`)}
				opts := cliproxyexecutor.Options{SourceFormat: sdktranslator.FormatClaude}
				if scenario.nativeResponses {
					request.Payload = []byte(`{"model":"gpt-6.1-sol","input":[{"role":"user","content":"Draw a simple diagram"}],"tools":[{"type":"function","name":"Write","parameters":{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}}}}]}`)
					opts.SourceFormat = sdktranslator.FormatOpenAIResponse
				}
				if scenario.chat {
					request.Payload = []byte(`{"model":"gpt-6.1-sol","messages":[{"role":"user","content":"Draw a simple diagram"}],"tools":[{"type":"function","function":{"name":"Write","parameters":{"type":"object","properties":{"file_path":{"type":"string"},"content":{"type":"string"}}}}}]}`)
					opts.SourceFormat = sdktranslator.FormatOpenAI
				}
				if scenario.deny {
					opts.Metadata = map[string]any{"token_flow_disable_image_generation": true}
				}
				var output strings.Builder
				if stream {
					response, err := executor.ExecuteStream(context.Background(), auth, request, opts)
					if err != nil {
						t.Fatal(err)
					}
					for chunk := range response.Chunks {
						if chunk.Err != nil {
							t.Fatal(chunk.Err)
						}
						output.Write(chunk.Payload)
					}
				} else {
					response, err := executor.Execute(context.Background(), auth, request, opts)
					if err != nil {
						t.Fatal(err)
					}
					output.Write(response.Payload)
				}
				if scenario.nativeResponses && !scenario.deny {
					if !advertisedImage || !strings.Contains(output.String(), `"image_generation_call"`) || !strings.Contains(output.String(), "cG5nLWZpeHR1cmU=") {
						t.Fatalf("native Responses image support lost: %s", output.String())
					}
				} else if advertisedImage || !strings.Contains(output.String(), `"name":"Write"`) || (!scenario.chat && !scenario.nativeResponses && !strings.Contains(output.String(), `"stop_reason":"tool_use"`)) {
					t.Fatalf("invisible native tool advertised=%t; expected an executable SVG tool call, got: %s", advertisedImage, output.String())
				}
			})
		}
	}
}
