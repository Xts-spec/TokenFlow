package executor

import (
	"context"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	_ "github.com/router-for-me/CLIProxyAPI/v7/internal/translator"
	auth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	execution "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	translator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestAntigravityReconnect(t *testing.T) {
	for _, stream := range []bool{false, true} {
		for _, mode := range []string{"once", "always", "after_headers", "http500", "cancel"} {
			t.Run(map[bool]string{true: "stream", false: "json"}[stream]+"/"+mode, func(t *testing.T) {
				var count atomic.Int32
				var firstBody string
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					n := count.Add(1)
					b, _ := io.ReadAll(r.Body)
					if r.Header.Get("Authorization") != "Bearer fixture-token" {
						t.Error("credential changed")
					}
					if n == 1 {
						firstBody = string(b)
					} else if string(b) != firstBody {
						t.Error("retry changed model/history or request identity")
					}
					if mode == "http500" {
						w.WriteHeader(500)
						w.Write([]byte(`{"error":{"message":"Internal"}}`))
						return
					}
					if mode == "always" || mode == "cancel" || n == 1 && mode == "once" || mode == "after_headers" {
						if mode == "after_headers" {
							w.Header().Set("Content-Length", "1000")
							w.WriteHeader(200)
							w.Write([]byte("data: {"))
							w.(http.Flusher).Flush()
						}
						if mode == "cancel" {
							cancel()
						}
						conn, _, _ := w.(http.Hijacker).Hijack()
						conn.Close()
						return
					}
					body := `{"response":{"candidates":[{"content":{"role":"model","parts":[{"text":"ok"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}}`
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						body = "data: " + body + "\n\n"
					} else {
						w.Header().Set("Content-Type", "application/json")
					}
					w.Write([]byte(body))
				}))
				defer server.Close()
				a := &auth.Auth{ID: t.Name(), Provider: "antigravity", Attributes: map[string]string{"base_url": server.URL}, Metadata: map[string]any{"access_token": "fixture-token", "project_id": "fixture-project", "expired": time.Now().Add(time.Hour).Format(time.RFC3339)}}
				e := NewAntigravityExecutor(&config.Config{RequestRetry: 0})
				defer closeAntigravityAuthIdleTransports(a)
				payload := []byte(`{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"reply ok"}]}`)
				opts := execution.Options{SourceFormat: translator.FromString("openai"), Stream: stream, OriginalRequest: payload}
				request := execution.Request{Model: "gemini-2.5-flash", Payload: payload}
				var output strings.Builder
				var err error
				if stream {
					var r *execution.StreamResult
					r, err = e.ExecuteStream(ctx, a, request, opts)
					if err == nil {
						for c := range r.Chunks {
							if c.Err != nil {
								err = c.Err
							}
							output.Write(c.Payload)
						}
					}
				} else {
					var r execution.Response
					r, err = e.Execute(ctx, a, request, opts)
					output.Write(r.Payload)
				}
				if mode == "once" {
					if err != nil || !strings.Contains(output.String(), "ok") {
						t.Fatalf("pre-header EOF did not recover: %v", err)
					}
					if count.Load() != 2 {
						t.Fatalf("attempts=%d", count.Load())
					}
				} else {
					want := int32(1)
					if mode == "always" {
						want = 2
					}
					if count.Load() != want {
						t.Fatalf("unsafe/unbounded replay: attempts=%d want=%d", count.Load(), want)
					}
					if err == nil && mode != "after_headers" {
						t.Fatal("failure hidden")
					}
				}
			})
		}
	}
}
