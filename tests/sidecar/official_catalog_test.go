package cliproxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	management "github.com/router-for-me/CLIProxyAPI/v7/internal/api/handlers/management"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/executor/helps"

	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

func TestOfficialCatalogRegistersNewAccountModel(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer fixture-only" {
			t.Error("missing account authorization")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"code":0,"data":{"models":[{"id":"new-official-model","name":"New Official Model","maxInputTokens":100000,"maxOutputTokens":8000,"supportedInputModalities":["TEXT","IMAGE"]}]}}`))
	}))
	defer server.Close()
	service := &Service{cfg: &config.Config{}}
	account := &coreauth.Auth{ID: t.Name(), Provider: "workbuddy", Metadata: map[string]any{"access_token": "fixture-only", "uid": "fixture-user", "base_url": server.URL}}
	defer GlobalModelRegistry().UnregisterClient(account.ID)
	service.registerModelsForAuth(context.Background(), account)
	models := GlobalModelRegistry().GetModelsForClient(account.ID)
	for _, m := range models {
		if m.ID == "new-official-model" {
			if len(m.SupportedInputModalities) != 2 || m.SupportedInputModalities[1] != "image" {
				t.Fatal("live image capability lost")
			}
			if calls != 1 {
				t.Errorf("expected one official discovery call, got %d", calls)
			}
			return
		}
	}
	t.Fatalf("official account model missing from registered callable catalog; official requests=%d", calls)
}

func TestOfficialCatalogManagementRefreshPreservesExclusionsAndAliases(t *testing.T) {
	current := "first-model"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"models": []map[string]any{{"id": current, "supportedInputModalities": []string{"text", "image"}}, {"id": "excluded-model"}}}})
	}))
	defer server.Close()
	manager := coreauth.NewManager(nil, nil, nil)
	cfg := &config.Config{OAuthExcludedModels: map[string][]string{"workbuddy": {"excluded-model"}}, OAuthModelAlias: map[string][]config.OAuthModelAlias{"workbuddy": {{Name: "second-model", Alias: "workbuddy/second-model", Fork: true}}}}
	s := &Service{cfg: cfg, coreManager: manager}
	a := &coreauth.Auth{ID: t.Name(), FileName: t.Name() + ".json", Provider: "workbuddy", Metadata: map[string]any{"access_token": "fixture-only", "base_url": server.URL}}
	if _, err := manager.Register(context.Background(), a); err != nil {
		t.Fatal(err)
	}
	defer GlobalModelRegistry().UnregisterClient(a.ID)
	s.registerModelsForAuth(context.Background(), a)
	current = "second-model"
	handler := management.NewHandler(cfg, "", manager)
	handler.SetAccountModelRefreshHook(s.refreshOfficialAccountCatalog)
	response := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(response)
	c.Request = httptest.NewRequest("GET", "/auth-files/models?name="+url.QueryEscape(a.FileName)+"&refresh=true", nil)
	handler.GetAuthFileModels(c)
	if response.Code != 200 {
		t.Fatalf("management refresh: %d", response.Code)
	}
	var result struct {
		Models []struct {
			ID         string   `json:"id"`
			Modalities []string `json:"supportedInputModalities"`
		} `json:"models"`
	}
	json.Unmarshal(response.Body.Bytes(), &result)
	for _, model := range result.Models {
		if len(model.Modalities) != 2 || model.Modalities[1] != "image" {
			t.Fatal("management catalog dropped image capability")
		}
	}
	found := false
	for _, model := range result.Models {
		if model.ID == "workbuddy/second-model" {
			found = true
		}
		if model.ID == "first-model" || model.ID == "excluded-model" {
			t.Fatalf("stale or excluded route advertised: %s", model.ID)
		}
	}
	if !found {
		t.Fatal("fresh official model was not registered under its callable namespaced alias")
	}
}

func TestOfficialCatalogQoderResponseCodec(t *testing.T) {
	for _, text := range []string{`{"cli":[{"key":"new","display_name":"New"}]}`, `{"cli":[]}`, `{"cli":[{"key":"测试"}]}`} {
		encoded := helps.QoderEncodeBody([]byte(text))
		if string(decodeQoderCatalog(encoded)) != text {
			t.Fatal("signed model response failed to decode")
		}
	}
}

func TestOfficialCatalogLiveRead(t *testing.T) {
	root := os.Getenv("TOKEN_FLOW_CATALOG_AUTH_DIR")
	if root == "" {
		t.Skip("explicit local account catalog probe only")
	}
	files, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	service := &Service{cfg: &config.Config{}}
	report := []map[string]any{}
	for _, f := range files {
		if !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(root, f.Name()))
		if err != nil {
			t.Fatal(err)
		}
		var meta map[string]any
		if json.Unmarshal(raw, &meta) != nil {
			continue
		}
		provider, _ := meta["type"].(string)
		if provider == "" || provider == "claude" {
			continue
		}
		if disabled, _ := meta["disabled"].(bool); disabled {
			continue
		}
		a := &coreauth.Auth{ID: f.Name(), Provider: provider, Metadata: meta}
		models, ok := service.fetchOfficialAccountModels(context.Background(), a, nil)
		safe := []map[string]any{}
		for _, m := range models {
			safe = append(safe, map[string]any{"id": m.ID, "name": m.DisplayName, "context": m.ContextLength, "output": m.MaxCompletionTokens})
		}
		report = append(report, map[string]any{"provider": provider, "accountFile": f.Name(), "official": ok, "models": safe})
		t.Logf("%s official=%v models=%d", provider, ok, len(safe))
	}
	if out := os.Getenv("TOKEN_FLOW_CATALOG_REPORT"); out != "" {
		raw, _ := json.MarshalIndent(report, "", "  ")
		if err := os.WriteFile(out, append(raw, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestOfficialCatalogAuthoritativeAndFallback(t *testing.T) {
	calls := 0
	fail := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if fail {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":{"models":[{"id":"allowed","name":"Allowed"},{"id":"other-agent"},{"id":"disabled","disabled":true}],"agents":[{"name":"cli","models":["allowed","disabled"]}]}}`))
	}))
	defer server.Close()
	s := &Service{cfg: &config.Config{}}
	a := &coreauth.Auth{ID: t.Name(), Provider: "workbuddy", Metadata: map[string]any{"access_token": "fixture-only", "base_url": server.URL}}
	fallback := []*ModelInfo{{ID: "stale-table-model"}}
	got := s.officialAccountModels(context.Background(), a, fallback)
	if len(got) != 1 || got[0].ID != "allowed" {
		t.Fatalf("account permissions should replace the table: %+v", got)
	}
	fail = true
	got = s.officialAccountModels(context.Background(), a, fallback)
	if calls != 1 {
		t.Fatal("config reload caused duplicate discovery")
	}
	s.officialCatalog[a.ID].checked = time.Time{}
	got = s.officialAccountModels(context.Background(), a, fallback)
	if len(got) != 1 || got[0].ID != "allowed" {
		t.Fatal("failed refresh discarded last successful account catalog")
	}
	a.Metadata["access_token"] = "different-account-token"
	got = s.officialAccountModels(context.Background(), a, fallback)
	if len(got) != 1 || got[0].ID != "stale-table-model" {
		t.Fatal("credential change reused previous account permission cache")
	}
}

func TestOfficialCatalogParsers(t *testing.T) {
	for _, test := range []struct {
		provider, body string
		count          int
		valid          bool
	}{
		{"qoder", `{"cli":[{"key":"smodel","display_name":"Step-5-Preview"},{"key":"removed","enable":false}],"ide":[{"key":"smodel"},{"key":"ide-new"}]}`, 2, true},
		{"antigravity", `{"models":{"new-model":{"displayName":"New"}},"webSearchModelIds":["new-model"]}`, 1, true},
		{"codex", `{"models":[{"slug":"gpt-next","display_name":"GPT Next","context_window":100000},{"slug":"internal-review","visibility":"hide"}]}`, 1, true},
		{"claude", `{"data":[{"id":"claude-next","display_name":"Claude Next"}]}`, 1, true},
		{"kimi", `{"data":[{"id":"kimi-next"}]}`, 1, true},
		{"xai", `{"data":[]}`, 0, true},
		{"workbuddy", `{"code":401,"data":{"models":[]}}`, 0, false},
		{"workbuddy", `{"error":{"message":"unavailable"}}`, 0, false},
		{"workbuddy", `{"data":{"models":[{}]}}`, 0, false},
	} {
		t.Run(test.provider+test.body[:8], func(t *testing.T) {
			models, ok := parseOfficialCatalog(test.provider, []byte(test.body), nil)
			if ok != test.valid || len(models) != test.count {
				t.Fatalf("got ok=%v count=%d", ok, len(models))
			}
		})
	}
}
