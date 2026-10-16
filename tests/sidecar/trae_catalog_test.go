package cliproxy

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
)

func TestOfficialCatalogTraeNativeAccountDirectory(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/ide/v1/get_detail_param" || r.URL.Query().Get("function") != "chat_v3" || r.Header.Get("Authorization") != "Cloud-IDE-JWT fixture" || r.Header.Get("X-IDE-Version") == "" {
			t.Error("native catalog identity or endpoint lost")
		}
		w.Write([]byte(`{"config_info_list":[{"config_name":"deepseek-v4.1-flash","config_switch":true,"display_config":{"display_name":"DeepSeek"},"context_window_tokens":{"dev":128000}},{"config_name":"hidden","is_invisible_to_user":true,"display_config":{"display_name":"Hidden"}},{"config_name":"disabled","config_switch":false,"display_config":{"display_name":"Disabled"}},{"config_name":"summary","display_config":{}},{"config_name":"byok","display_config":{"display_name":"Mine","is_custom_model":true}}]}`))
	}))
	defer server.Close()
	s := &Service{cfg: &config.Config{}}
	models, ok := s.fetchOfficialAccountModels(context.Background(), &coreauth.Auth{Provider: "trae", Metadata: map[string]any{"access_token": "fixture", "base_url": server.URL}}, nil)
	if !ok || len(models) != 1 || models[0].ID != "deepseek-v4.1-flash" || models[0].ContextLength != 128000 {
		t.Fatalf("official conversation picker not preserved: ok=%v models=%+v", ok, models)
	}
}
