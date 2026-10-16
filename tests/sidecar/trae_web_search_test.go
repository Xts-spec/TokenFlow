package executor

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexec "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	"github.com/tidwall/gjson"
)

func TestTraeNativeSearchPolicyAndHistory(t *testing.T) {
	raw := []byte(`{"input":[{"type":"web_search_call","id":"ws_old","status":"completed","action":{"type":"search","query":"old","sources":[{"type":"url","url":"https://example.com/old"}]}},{"role":"user","content":"Continue"}],"tools":[{"type":"function","name":"tokenflow_trae_web_search","parameters":{"type":"object"}},{"type":"web_search","external_web_access":false,"filters":{"allowed_domains":["example.com"],"blocked_domains":["ads.example.com"]}}],"tool_choice":{"type":"web_search"}}`)
	canonical, p, err := traePrepareWeb(coreexec.Request{Model: "fixture", Payload: raw}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	if p.Name == "tokenflow_trae_web_search" || gjson.GetBytes(canonical, "tools.0.name").String() != "tokenflow_trae_web_search" || gjson.GetBytes(canonical, "tool_choice.name").String() != p.Name || !strings.Contains(gjson.GetBytes(canonical, "input.1.output").String(), "https://example.com/old") {
		t.Fatal("client tool collision, forced search or history lost")
	}
	for raw, want := range map[string]bool{"https://docs.example.com/ok": true, "https://ads.example.com/no": false, "https://example.com.evil/no": false, "javascript:alert(1)": false, "https://user:password@example.com/no": false} {
		if traeSearchURLAllowed(raw, p.Tool) != want {
			t.Errorf("domain policy: %s", raw)
		}
	}
}

func TestTraeNativeSearchKeepsNewUserSeparateFromToolResult(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		messages := gjson.GetBytes(raw, "messages").Array()
		last := messages[len(messages)-1]
		previous := messages[len(messages)-2]
		if last.Get("role").String() != "user" || last.Get("content.0.text").String() != "USER_FINAL_MARKER" || previous.Get("role").String() != "tool" || previous.Get("content.0.text").String() != "READ_DONE" {
			t.Error("new user instruction merged into tool output")
		}
		io.WriteString(w, "event:output\ndata:{\"response\":\"USER_FINAL_MARKER\"}\n\nevent:done\ndata:{\"finish_reason\":\"stop\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	_, err := e.Execute(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":[{"type":"web_search_call","id":"ws_old","status":"completed","action":{"type":"search","query":"old","sources":[]}},{"type":"function_call","call_id":"read1","name":"read_probe","arguments":"{}"},{"type":"function_call_output","call_id":"read1","output":"READ_DONE"},{"role":"user","content":"USER_FINAL_MARKER"}],"tools":[{"type":"web_search"}],"tool_choice":"none"}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
}

func TestTraeNativeSearchFailuresAndEmptyResults(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
		fail       bool
	}{{"empty", `{"references":[]}`, 200, false}, {"bad-json", `{`, 200, true}, {"missing", `{}`, 200, true}, {"business", `{"code":401,"references":[]}`, 200, true}, {"http", `{}`, 503, true}} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status); io.WriteString(w, tc.body) }))
			defer server.Close()
			e := NewTraeExecutor(&config.Config{})
			a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
			refs, err := e.traeIndexedSearch(context.Background(), a, "fixture", "test", traeSearchPolicy{Tool: gjson.Parse(`{}`)})
			if (err != nil) != tc.fail || len(refs) != 0 {
				t.Fatalf("failure masked: refs=%d err=%v", len(refs), err)
			}
		})
	}
}

func TestTraeNativeSearchCancellation(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := e.traeIndexedSearch(ctx, a, "fixture", "test", traeSearchPolicy{Tool: gjson.Parse(`{}`)})
		done <- err
	}()
	<-entered
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled search succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("search did not cancel")
	}
}

func TestTraeNativeSearchStreamKeepsClientTools(t *testing.T) {
	searches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.URL.Path == "/api/ide/v1/web_search" {
			searches++
			io.WriteString(w, `{"references":[]}`)
			return
		}
		name := gjson.GetBytes(raw, "tools.1.function.name").String()
		io.WriteString(w, `event:output`+"\n"+`data:{"tool_calls":[{"id":"search-1","type":"function","function_call":{"name":"`+name+`","arguments":"{\"query\":\"test\"}"}},{"id":"client-1","type":"function","function_call":{"name":"read_probe","arguments":"{\"step\":9}"}}]}`+"\n\nevent:done\ndata:{\"finish_reason\":\"tool_calls\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.ExecuteStream(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":"Search and read","tools":[{"type":"function","name":"read_probe","parameters":{"type":"object"}},{"type":"web_search"}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	lastSeq := -1
	items := map[int64]string{}
	terminal := false
	for c := range r.Chunks {
		if c.Err != nil {
			t.Fatal(c.Err)
		}
		for _, data := range agentResponseData(c.Payload) {
			event := gjson.ParseBytes(data)
			seq := int(event.Get("sequence_number").Int())
			if seq <= lastSeq {
				t.Fatal("event order reused")
			}
			lastSeq = seq
			if event.Get("type").String() == "response.output_item.done" {
				item := event.Get("item")
				if item.Get("name").String() == "tokenflow_trae_web_search" {
					t.Fatal("internal function leaked")
				}
				items[event.Get("output_index").Int()] = item.Get("type").String()
				if item.Get("type").String() == "function_call" && (item.Get("call_id").String() != "client-1" || item.Get("arguments").String() != `{"step":9}`) {
					t.Fatal("client tool changed")
				}
			}
			if event.Get("type").String() == "response.completed" {
				terminal = true
			}
		}
	}
	if !terminal || searches != 1 || len(items) != 2 || items[0] != "function_call" || items[1] != "web_search_call" {
		t.Fatalf("mixed search/client turn broken: %v searches=%d terminal=%v", items, searches, terminal)
	}
}

func TestTraeNativeSearchLimitDoesNotFakeCompletion(t *testing.T) {
	searches := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.URL.Path == "/api/ide/v1/web_search" {
			searches++
			io.WriteString(w, `{"references":[]}`)
			return
		}
		name := gjson.GetBytes(raw, "tools.0.function.name").String()
		io.WriteString(w, `event:output`+"\n"+`data:{"tool_calls":[{"id":"search-loop","type":"function","function_call":{"name":"`+name+`","arguments":"{\"query\":\"repeat\"}"}}]}`+"\n\nevent:done\ndata:{\"finish_reason\":\"tool_calls\"}\n\n")
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.ExecuteStream(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":"search","max_tool_calls":2,"tools":[{"type":"web_search"}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	failed := false
	for c := range r.Chunks {
		if c.Err != nil {
			failed = true
		}
		for _, data := range agentResponseData(c.Payload) {
			if gjson.GetBytes(data, "type").String() == "response.completed" {
				t.Fatal("search loop reported success")
			}
		}
	}
	if !failed || searches != 2 {
		t.Fatalf("loop unbounded or masked: %d %v", searches, failed)
	}
}

func TestTraeNativeSearchResponses(t *testing.T) {
	modelCalls, searches := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.Header.Get("Authorization") != "Cloud-IDE-JWT fixture" {
			t.Error("native credential missing")
		}
		if r.URL.Path == "/api/ide/v1/web_search" {
			searches++
			if gjson.GetBytes(raw, "user_input").String() != "Codex CLI" {
				t.Error("query lost")
			}
			io.WriteString(w, `{"references":[{"title":"Codex CLI","uri":"https://developers.openai.com/codex/cli","snippets":["Run locally"]}]}`)
			return
		}
		modelCalls++
		if modelCalls%2 == 1 {
			name := gjson.GetBytes(raw, "tools.0.function.name").String()
			io.WriteString(w, `event:output`+"\n"+`data:{"tool_calls":[{"id":"search-1","type":"function","function_call":{"name":"`+name+`","arguments":"{\"query\":\"Codex CLI\"}"}}]}`+"\n\nevent:done\ndata:{\"finish_reason\":\"tool_calls\"}\n\n")
		} else {
			if !strings.Contains(string(raw), "Run locally") {
				t.Error("real search result missing in model continuation")
			}
			io.WriteString(w, "event:output\ndata:{\"response\":\"See https://developers.openai.com/codex/cli\"}\n\nevent:done\ndata:{\"finish_reason\":\"stop\"}\n\n")
		}
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.Execute(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":"Search Codex CLI","tools":[{"type":"web_search","external_web_access":false}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	if searches != 1 || modelCalls != 2 {
		t.Fatalf("search=%d inference=%d", searches, modelCalls)
	}
	if gjson.GetBytes(r.Payload, "output.0.type").String() != "web_search_call" || gjson.GetBytes(r.Payload, "output.0.action.sources.0.url").String() != "https://developers.openai.com/codex/cli" || gjson.GetBytes(r.Payload, "output.1.content.0.annotations.0.type").String() != "url_citation" {
		t.Fatalf("missing actual search item or citations: %s", r.Payload)
	}
	stream, err := e.ExecuteStream(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":"Search Codex CLI","tools":[{"type":"web_search"}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	cited, completed := false, false
	for c := range stream.Chunks {
		if c.Err != nil {
			t.Fatal(c.Err)
		}
		for _, data := range agentResponseData(c.Payload) {
			event := gjson.ParseBytes(data)
			switch event.Get("type").String() {
			case "response.content_part.added":
				if len(event.Get("part.annotations").Array()) != 0 {
					t.Fatal("citation preceded its text")
				}
			case "response.output_text.annotation.added":
				cited = event.Get("annotation.url").String() == "https://developers.openai.com/codex/cli"
			case "response.completed":
				completed = true
			}
		}
	}
	if !cited || !completed || searches != 2 || modelCalls != 4 {
		t.Fatal("stream search/citation events incomplete")
	}
}
