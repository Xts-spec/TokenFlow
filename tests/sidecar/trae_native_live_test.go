package executor

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexec "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"github.com/tidwall/gjson"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestTraeNativeLive(t *testing.T) {
	dir := os.Getenv("TOKEN_FLOW_TRAE_LIVE_AUTH_DIR")
	if dir == "" {
		t.Skip()
	}
	files, _ := os.ReadDir(dir)
	var a *coreauth.Auth
	for _, f := range files {
		raw, _ := os.ReadFile(filepath.Join(dir, f.Name()))
		var m map[string]any
		if json.Unmarshal(raw, &m) != nil || m["type"] != "trae" || m["disabled"] == true {
			continue
		}
		expiry, _ := m["expired"].(string)
		date, _ := time.Parse(time.RFC3339, expiry)
		if date.After(time.Now()) {
			a = &coreauth.Auth{Provider: "trae", Metadata: m}
			break
		}
	}
	if a == nil {
		t.Fatal("no active Trae account")
	}
	model := os.Getenv("TOKEN_FLOW_TRAE_MODEL")
	if model == "" {
		model = "Dola-Seed-2.0-Code"
	}
	e := NewTraeExecutor(&config.Config{})
	var mu sync.Mutex
	rows := []map[string]any{}
	var wg sync.WaitGroup
	workers := 4
	if n, err := strconv.Atoi(os.Getenv("TOKEN_FLOW_TRAE_WORKERS")); err == nil && n > 0 && n <= 32 {
		workers = n
	}
	rounds := 3
	if n, err := strconv.Atoi(os.Getenv("TOKEN_FLOW_TRAE_ROUNDS")); err == nil && n >= 3 && n <= 10 {
		rounds = n
	}
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			messages := []map[string]any{}
			for i := 0; i < 100; i++ {
				messages = append(messages, map[string]any{"role": "user", "content": fmt.Sprintf("Historical task %d completed. Preserve the context.", i)}, map[string]any{"role": "assistant", "content": fmt.Sprintf("Recorded historical result %d.", i)})
			}
			for round := 0; round < rounds; round++ {
				marker := fmt.Sprintf("TRAE_%d_%d_OK", worker, round)
				prompt := fmt.Sprintf("Now call read_probe with step %d. The caller will execute it.", round)
				if round == rounds-1 {
					prompt = "Reply exactly " + marker
				}
				messages = append(messages, map[string]any{"role": "user", "content": prompt})
				body := map[string]any{"messages": messages}
				if round < rounds-1 {
					body["tools"] = []any{map[string]any{"type": "function", "function": map[string]any{"name": "read_probe", "description": "Read the requested current step", "parameters": map[string]any{"type": "object", "properties": map[string]any{"step": map[string]any{"type": "integer"}}, "required": []string{"step"}}}}}
					body["tool_choice"] = map[string]any{"type": "function", "function": map[string]any{"name": "read_probe"}}
				}
				raw, _ := json.Marshal(body)
				ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
				start := time.Now()
				result, err := e.Execute(ctx, a, coreexec.Request{Model: model, Payload: raw}, coreexec.Options{})
				cancel()
				passed := err == nil
				row := map[string]any{"worker": worker, "round": round, "ms": time.Since(start).Milliseconds()}
				if err != nil {
					row["error"] = err.Error()
				} else {
					msg := gjson.GetBytes(result.Payload, "choices.0.message")
					if round < rounds-1 {
						call := msg.Get("tool_calls.0")
						passed = call.Get("function.name").String() == "read_probe" && gjson.Get(call.Get("function.arguments").String(), "step").Int() == int64(round)
						var decoded map[string]any
						json.Unmarshal([]byte(msg.Raw), &decoded)
						messages = append(messages, decoded, map[string]any{"role": "tool", "tool_call_id": call.Get("id").String(), "content": "Read successful: " + marker})
						row["tools"] = len(msg.Get("tool_calls").Array())
						row["toolDetails"] = msg.Get("tool_calls").Raw
					} else {
						passed = strings.Contains(msg.Get("content").String(), marker)
						row["text"] = msg.Get("content").String()
						row["reasoningChars"] = len(msg.Get("reasoning_content").String())
					}
					row["usage"] = gjson.GetBytes(result.Payload, "usage.total_tokens").Int()
				}
				row["passed"] = passed
				mu.Lock()
				rows = append(rows, row)
				mu.Unlock()
				t.Logf("worker=%d round=%d passed=%v duration=%v", worker, round, passed, time.Since(start))
				if !passed {
					t.Errorf("native round failed: %v", row)
					break
				}
			}
		}(worker)
	}
	wg.Wait()
	if out := os.Getenv("TOKEN_FLOW_TRAE_REPORT"); out != "" {
		raw, _ := json.MarshalIndent(rows, "", "  ")
		os.WriteFile(out, raw, 0600)
	}
}
