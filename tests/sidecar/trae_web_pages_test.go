package executor

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	coreexec "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	sdktranslator "github.com/router-for-me/CLIProxyAPI/v7/sdk/translator"
	"github.com/tidwall/gjson"
)

func TestTraeNativeWebPaginationUnicodeAndFind(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		requests++
		if gjson.GetBytes(raw, "fetch_id").Exists() {
			t.Error("sliced fetch_id reused")
		}
		offset := gjson.GetBytes(raw, "offset").Int()
		switch offset {
		case 0:
			io.WriteString(w, `{"url":"https://example.org/page","title":"Doc","doc_id":"stable","content":[{"type":"text","text":"前🙂\r\nHead\n"}],"page_token_count":2,"total_token_count":4,"status_message":"success"}`)
		case 2:
			io.WriteString(w, `{"url":"https://example.org/page","doc_id":"stable","content":[{"type":"text","text":"Tail NEEDLE 中文"},{"type":"link","text":"Reference","url":"https://example.org/ref"}],"page_token_offset":2,"page_token_count":2,"total_token_count":4,"status_message":"success"}`)
		default:
			t.Errorf("wrong next offset %d", offset)
		}
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	policy := traeSearchPolicy{Tool: gjson.Parse(`{"external_web_access":false}`)}
	page, err := e.traeReadPage(context.Background(), a, "https://example.org/page", policy)
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || !strings.Contains(page.Text, "[Reference](https://example.org/ref)") {
		t.Fatal("pagination or links missing")
	}
	view, _, err := e.traeWebPageAction(context.Background(), a, gjson.Parse(`{"action":"open_page","url":"https://example.org/page","offset":1,"limit":1}`), policy)
	if err != nil || view["text"] != "🙂" || view["has_more"] != true {
		t.Fatalf("Unicode window incorrect: %v %v", view, err)
	}
	find, _, err := e.traeWebPageAction(context.Background(), a, gjson.Parse(`{"action":"find_in_page","url":"https://example.org/page","pattern":"needle"}`), policy)
	if err != nil || find["total_matches"] != 1 || find["matches"].([]any)[0].(map[string]any)["line"] != 3 {
		t.Fatalf("whole document find incorrect: %v %v", find, err)
	}
	missing, _, err := e.traeWebPageAction(context.Background(), a, gjson.Parse(`{"action":"find_in_page","url":"https://example.org/page","pattern":"ABSENT"}`), policy)
	if err != nil || missing["total_matches"] != 0 || missing["document_complete"] != true || requests != 2 {
		t.Fatal("find lost snapshot, claimed incomplete result or refetched")
	}
}

func TestTraeNativeWebRejectsIncompletePages(t *testing.T) {
	for _, body := range []string{`{"content":[],"status_message":"cache_miss"}`, `{"content":[{"text":"partial"}],"page_token_count":0,"total_token_count":100,"status_message":"success"}`, `{"content":[{"text":"partial"}],"page_token_offset":2,"page_token_count":2,"total_token_count":4,"status_message":"success"}`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, _ := io.ReadAll(r.Body)
			if !gjson.GetBytes(raw, "disable_crawl").Bool() {
				t.Error("cached miss escalated to live fetch")
			}
			io.WriteString(w, body)
		}))
		e := NewTraeExecutor(&config.Config{})
		a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
		_, err := e.traeReadPage(context.Background(), a, "https://example.org/page", traeSearchPolicy{Tool: gjson.Parse(`{"external_web_access":false}`)})
		server.Close()
		if err == nil {
			t.Fatal("partial/unavailable document accepted as complete")
		}
	}
}

func TestTraeNativeWebPublicURLsAcrossPlatforms(t *testing.T) {
	for raw, want := range map[string]bool{"https://example.org/a?x=1#part": true, "https://abc.de/": true, "file:///C:/Users/test/secret": false, `C:\Users\test`: false, `\\server\share`: false, "http://localhost/": false, "http://127.1/": false, "http://2130706433/": false, "http://0x7f000001/": false, "http://[::ffff:127.0.0.1]/": false, "http://[fe80::1%25en0]/": false, "http://100.100.100.200/": false, "https://user:pass@example.org/": false, "https://example.org:8443/": false} {
		_, err := traePublicPageURL(raw, traeSearchPolicy{Tool: gjson.Parse(`{}`)})
		if (err == nil) != want {
			t.Errorf("URL %q accepted=%v", raw, err == nil)
		}
	}
}

func TestTraeNativeWebPageCacheConcurrentAndAccountScoped(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"content":[{"text":"public document"}],"doc_id":"fixture","page_token_count":2,"total_token_count":2,"status_message":"success"}`)
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	var wg sync.WaitGroup
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := e.traeReadPage(context.Background(), a, "https://example.org/concurrent", traeSearchPolicy{Tool: gjson.Parse(`{}`)})
			if err != nil || p.Text != "public document" {
				t.Error("concurrent page access failed")
			}
		}()
	}
	wg.Wait()
	other := &coreauth.Auth{Metadata: map[string]any{"access_token": "other", "trae_native_base_url": server.URL}}
	if traePageKey(a, "https://example.org/concurrent") == traePageKey(other, "https://example.org/concurrent") {
		t.Fatal("page cache shared across credentials")
	}
}

func TestTraeNativeWebPageCancellation(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
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
		_, err := e.traeReadPage(ctx, a, "https://example.org/cancel", traeSearchPolicy{Tool: gjson.Parse(`{}`)})
		done <- err
	}()
	<-entered
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelled page fetch succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("page fetch did not cancel")
	}
}

func TestTraeNativeWebOpenFindResponses(t *testing.T) {
	models, fetches := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if r.URL.Path == "/api/ide/v1/web_fetch" {
			fetches++
			if !gjson.GetBytes(raw, "disable_crawl").Bool() {
				t.Error("default cached mode allowed crawling")
			}
			io.WriteString(w, `{"content":[{"type":"text","text":"First line\nTail proof NEEDLE_END"}],"title":"Doc","url":"https://example.org/doc","fetch_id":"fixture","page_token_count":8,"total_token_count":8,"status_message":"success"}`)
			return
		}
		models++
		name := gjson.GetBytes(raw, "tools.0.function.name").String()
		args := `{\"action\":\"open_page\",\"url\":\"https://example.org/doc\"}`
		if models == 2 {
			if !strings.Contains(string(raw), "NEEDLE_END") {
				t.Error("page body not returned to model")
			}
			args = `{\"action\":\"find_in_page\",\"url\":\"https://example.org/doc\",\"pattern\":\"NEEDLE_END\"}`
		}
		if models < 3 {
			io.WriteString(w, `event:output`+"\n"+`data:{"tool_calls":[{"id":"c","type":"function","function_call":{"name":"`+name+`","arguments":"`+args+`"}}]}`+"\n\nevent:done\ndata:{\"finish_reason\":\"tool_calls\"}\n\n")
		} else {
			io.WriteString(w, "event:output\ndata:{\"response\":\"PAGE_FLOW_OK https://example.org/doc\"}\n\nevent:done\ndata:{\"finish_reason\":\"stop\"}\n\n")
		}
	}))
	defer server.Close()
	e := NewTraeExecutor(&config.Config{})
	a := &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "trae_native_base_url": server.URL}}
	r, err := e.Execute(context.Background(), a, coreexec.Request{Model: "Dola-Seed-2.0-Code", Payload: []byte(`{"input":"Open page and find the tail proof","tools":[{"type":"web_search","external_web_access":false}]}`)}, coreexec.Options{SourceFormat: sdktranslator.FormatOpenAIResponse})
	if err != nil {
		t.Fatal(err)
	}
	if models != 3 || fetches < 1 || gjson.GetBytes(r.Payload, "output.0.action.type").String() != "open_page" || gjson.GetBytes(r.Payload, "output.1.action.type").String() != "find_in_page" || !strings.Contains(gjson.GetBytes(r.Payload, "output.2.content.0.text").String(), "PAGE_FLOW_OK") {
		t.Fatalf("incomplete open/find flow: %s", r.Payload)
	}
}
