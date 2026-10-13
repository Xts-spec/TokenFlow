package cliproxy

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/misc"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/runtime/executor/helps"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
)

// A catalog is scoped to the credential, provider and endpoint. Failed refreshes
// retain that account's last successful list; model tables are the final fallback.
type officialCatalogEntry struct {
	mu          sync.Mutex
	fingerprint [32]byte
	checked     time.Time
	models      []*ModelInfo
	succeeded   bool
}

func metadataText(a *coreauth.Auth, key string) string {
	if a == nil {
		return ""
	}
	if value, ok := a.Metadata[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(a.Attributes[key])
}

func (s *Service) refreshOfficialAccountCatalog(ctx context.Context, id string, force bool) {
	a, ok := s.latestAuthForModelRegistration(id)
	if !ok || a.Disabled {
		return
	}
	s.officialCatalogMu.Lock()
	entry := s.officialCatalog[id]
	s.officialCatalogMu.Unlock()
	if entry != nil {
		entry.mu.Lock()
	}
	fresh := entry != nil && time.Since(entry.checked) < 30*time.Second
	if force && entry != nil {
		entry.checked = time.Time{}
	}
	if entry != nil {
		entry.mu.Unlock()
	}
	if fresh && !force {
		return
	}
	s.refreshModelRegistrationForAuthWithContext(ctx, a, nil)
}

func (s *Service) officialAccountModels(ctx context.Context, a *coreauth.Auth, fallback []*ModelInfo) []*ModelInfo {
	if s == nil || a == nil || metadataText(a, "access_token") == "" {
		return fallback
	}
	fingerprint := sha256.Sum256([]byte(a.Provider + "\x00" + metadataText(a, "access_token") + "\x00" + metadataText(a, "base_url") + "\x00" + metadataText(a, "enterprise_id") + "\x00" + metadataText(a, "enterpriseId") + "\x00" + metadataText(a, "uid") + "\x00" + a.ProxyURL + "\x00" + codexCatalogVersion(a)))
	// Serialize refreshes so config reloads and polling do not duplicate requests.
	// No application credentials or model permissions are persisted by discovery.
	s.officialCatalogMu.Lock()
	if s.officialCatalog == nil {
		s.officialCatalog = make(map[string]*officialCatalogEntry)
	}
	entry := s.officialCatalog[a.ID]
	if entry == nil || entry.fingerprint != fingerprint {
		entry = &officialCatalogEntry{fingerprint: fingerprint}
		s.officialCatalog[a.ID] = entry
	}
	s.officialCatalogMu.Unlock()
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if time.Since(entry.checked) >= 30*time.Second {
		live, ok := s.fetchOfficialAccountModels(ctx, a, fallback)
		entry.checked = time.Now()
		if ok {
			entry.models = live
			entry.succeeded = true
		}
	}
	if entry.succeeded {
		return cloneOfficialModels(entry.models)
	}
	return fallback
}

func cloneOfficialModels(models []*ModelInfo) []*ModelInfo {
	copyModels := make([]*ModelInfo, 0, len(models))
	for _, model := range models {
		if model != nil {
			v := *model
			copyModels = append(copyModels, &v)
		}
	}
	return copyModels
}

func (s *Service) fetchOfficialAccountModels(ctx context.Context, a *coreauth.Auth, fallback []*ModelInfo) ([]*ModelInfo, bool) {
	provider := strings.ToLower(a.Provider)
	token := metadataText(a, "access_token")
	base := metadataText(a, "base_url")
	method, path := "GET", ""
	headers := map[string]string{"Authorization": "Bearer " + token, "Accept": "application/json"}
	body := ""
	switch provider {
	case "workbuddy":
		if base == "" {
			base = "https://copilot.tencent.com"
 if domain:=metadataText(a,"domain");domain=="www.workbuddy.ai"||domain=="https://www.workbuddy.ai" {base="https://www.workbuddy.ai"}
		}
		enterprise := metadataText(a, "enterprise_id")
		if enterprise == "" {
			enterprise = metadataText(a, "enterpriseId")
		}
		if enterprise == "" {
			enterprise = "personal"
		}
		path = "/console/enterprises/" + url.PathEscape(enterprise) + "/models"
		headers["X-User-Id"] = metadataText(a, "uid")
		headers["X-Product"] = "SaaS"
		headers["Origin"] = "https://www.codebuddy.cn"
 if base=="https://www.workbuddy.ai" {headers["Origin"]=base}
		headers["Referer"] = headers["Origin"]+"/"
		headers["User-Agent"] = "CLI/2.63.2 CodeBuddy/2.63.2"
		headers["X-Requested-With"] = "XMLHttpRequest"
	case "qoder":
		if base == "" {
			base = "https://api3.qoder.sh/algo"
		}
		path = "/api/v2/model/list?Encode=1"
		signed, err := helps.BuildQoderAuthHeaders(nil, strings.TrimRight(base, "/")+path, metadataText(a, "uid"), token, metadataText(a, "email"))
		if err != nil {
			return nil, false
		}
		headers = signed
		headers["Accept"] = "application/json"
	case "antigravity":
		if base == "" {
			base = antigravityModelBaseURLProd
		}
		path = antigravityModelsPath
		method = "POST"
		body = "{}"
		headers["User-Agent"] = misc.AntigravityUserAgent()
	case "codex":
		if base == "" {
			base = "https://chatgpt.com/backend-api/codex"
		}
		path = "/models?client_version=" + url.QueryEscape(codexCatalogVersion(a))
		if account := metadataText(a, "account_id"); account != "" {
			headers["ChatGPT-Account-Id"] = account
		}
	case "claude":
		if base == "" {
			base = "https://api.anthropic.com"
		}
		path = "/v1/models?limit=1000"
		headers["anthropic-version"] = "2023-06-01"
		headers["anthropic-beta"] = "oauth-2025-04-20"
	case "kimi":
		if base == "" {
			base = "https://api.kimi.com/coding"
		}
		path = "/v1/models"
	case "xai":
		if base == "" {
			base = "https://api.x.ai/v1"
		}
		path = "/models"
	case "zcode":
		if base == "" {
			if metadataText(a, "provider") == "zai" {
				base = "https://api.z.ai/api/coding/paas/v4"
			} else {
				base = "https://open.bigmodel.cn/api/paas/v4"
			}
		}
		path = "/models"
	case "doubao":
		// Ark keys expose an OpenAI model directory. MarsCode login tokens use a
		// different protocol and must not be sent to an unrelated Ark service.
		if base == "" {
			return nil, false
		}
		path = "/models"
	default:
		// Trae's chat protocol exposes no verified account-model listing endpoint.
		// Keep the fallback rather than guessing a URL or publishing invented models.
		return nil, false
	}
	requestCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, method, strings.TrimRight(base, "/")+path, strings.NewReader(body))
	if err != nil {
		return nil, false
	}
	for k, v := range headers {
		if v != "" {
			req.Header.Set(k, v)
		}
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	defer client.CloseIdleConnections()
	proxy := a.ProxyURL
	if proxy == "" && s.cfg != nil {
		proxy = s.cfg.ProxyURL
	}
	transport, _, err := proxyutil.BuildHTTPTransport(proxy)
	if err != nil {
		return nil, false
	}
	if transport != nil {
		client.Transport = transport
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, false
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024+1))
	if err != nil || len(raw) > 4*1024*1024 {
		return nil, false
	}
	if provider == "qoder" && !json.Valid(raw) {
		raw = decodeQoderCatalog(raw)
	}
	return parseOfficialCatalog(provider, raw, fallback)
}

// The server filters Codex models by runtime version. The desktop's local model
// cache records that version; only this non-secret field is read, never its list
// as an account permission source. CLI-only installs retain the pinned fallback.
func codexCatalogVersion(a *coreauth.Auth) string {
	if a == nil || a.Provider != "codex" {
		return ""
	}
	if version := metadataText(a, "codex_client_version"); validCatalogVersion(version) {
		return version
	}
	dir := os.Getenv("CODEX_HOME")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			dir = filepath.Join(home, ".codex")
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, "models_cache.json"))
	if err == nil && len(raw) < 8*1024*1024 {
		var value struct {
			Version string `json:"client_version"`
		}
		if json.Unmarshal(raw, &value) == nil && validCatalogVersion(value.Version) {
			return value.Version
		}
	}
	return "0.154.0"
}
func validCatalogVersion(value string) bool {
	if len(value) == 0 || len(value) > 40 {
		return false
	}
	for _, r := range value {
		if (r < '0' || r > '9') && r != '.' && r != '-' && r != '+' && (r < 'a' || r > 'z') {
			return false
		}
	}
	return true
}

// Qoder applies its public response alphabet/three-block permutation to model
// catalogs as well as inference payloads. A plain JSON response is also valid.
func decodeQoderCatalog(raw []byte) []byte {
	const alphabet = "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!"
	const standard = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	raw = bytes.TrimSpace(raw)
	if len(raw) > 1 && raw[0] == '"' {
		var value string
		if json.Unmarshal(raw, &value) == nil {
			raw = []byte(value)
		}
	}
	decoded := make([]byte, len(raw))
	for i, b := range raw {
		if b == '$' {
			decoded[i] = '='
		} else if p := strings.IndexByte(alphabet, b); p >= 0 {
			decoded[i] = standard[p]
		} else {
			decoded[i] = b
		}
	}
	n := len(decoded)
	third := n / 3
	restored := append(append(append([]byte{}, decoded[n-third:]...), decoded[third:n-third]...), decoded[:third]...)
	data, err := base64.StdEncoding.DecodeString(string(restored))
	if err != nil {
		return nil
	}
	return data
}

func parseOfficialCatalog(provider string, raw []byte, fallback []*ModelInfo) ([]*ModelInfo, bool) {
	var root map[string]any
	if json.Unmarshal(raw, &root) != nil {
		return nil, false
	}
	if code, ok := root["code"].(float64); ok && code != 0 && code != 200 {
		return nil, false
	}
	if success, ok := root["success"].(bool); ok && !success {
		return nil, false
	}
	data := root
	if nested, ok := root["data"].(map[string]any); ok {
		data = nested
	}
	var items []any
	recognized := false
	switch provider {
	case "qoder":
		// CLI + desktop scenes use the same signed inference gateway. Server scene
		// lists are authoritative; don't mix embedding/local/BYOK providers into OAuth.
		for _, scene := range []string{"cli", "ide", "desktop", "work", "chat"} {
			if list, ok := data[scene].([]any); ok {
				items = append(items, list...)
				recognized = true
			}
		}
		if !recognized {
			items, recognized = data["models"].([]any)
		}
	case "antigravity":
		if models, ok := data["models"].(map[string]any); ok {
			recognized = true
			keys := make([]string, 0, len(models))
			for id := range models {
				keys = append(keys, id)
			}
			sort.Strings(keys)
			for _, id := range keys {
				if item, ok := models[id].(map[string]any); ok {
					copyItem := make(map[string]any, len(item)+1)
					for k, v := range item {
						copyItem[k] = v
					}
					copyItem["id"] = id
					items = append(items, copyItem)
				}
			}
		}
	default:
		items, recognized = data["models"].([]any)
	}
	if !recognized {
		items, recognized = root["data"].([]any)
	}
	if !recognized {
		items, recognized = data["items"].([]any)
	}
	if !recognized {
		return nil, false
	}
	allowed := map[string]bool{}
	if provider == "workbuddy" {
		if agents, ok := data["agents"].([]any); ok {
			for _, v := range agents {
				agent, _ := v.(map[string]any)
				if stringField(agent, "name") == "cli" {
					if ids, ok := agent["models"].([]any); ok {
						for _, id := range ids {
							if value, ok := id.(string); ok {
								allowed[value] = true
							}
						}
					}
				}
			}
		}
	}
	known := map[string]*ModelInfo{}
	for _, m := range fallback {
		if m != nil {
			known[m.ID] = m
		}
	}
	seen := map[string]bool{}
	models := make([]*ModelInfo, 0, len(items))
	invalid := false
	for _, value := range items {
		item, ok := value.(map[string]any)
		if !ok {
			invalid = true
			continue
		}
		id := stringField(item, "id", "key", "model_key", "slug", "modelId", "name")
		if id == "" || len(id) > 280 || strings.ContainsAny(id, "\r\n\x00") {
			invalid = true
			continue
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		if enabled, ok := item["enable"].(bool); ok && !enabled {
			continue
		}
		if internal, ok := item["isInternal"].(bool); ok && internal {
			continue
		}
		if visibility := stringField(item, "visibility"); visibility == "hide" || visibility == "hidden" {
			continue
		}
		if supported, ok := item["supported_in_api"].(bool); ok && !supported {
			continue
		}
		if provider == "antigravity" && stringField(item, "displayName", "display_name", "name") == "" {
			continue
		}
		if disabled, ok := item["disabled"].(bool); ok && disabled {
			continue
		}
		if len(allowed) > 0 && !allowed[id] {
			continue
		}
		if source := stringField(item, "source"); provider == "qoder" && (source == "custom" || source == "local" || stringField(item, "outer_provider") != "") {
			continue
		}
		m := &ModelInfo{ID: id, Object: "model", OwnedBy: provider, Type: provider}
		if existing := known[id]; existing != nil {
			copyModel := *existing
			m = &copyModel
		}
		if name := stringField(item, "display_name", "displayName", "displayNameZh", "name", "title"); name != "" {
			m.DisplayName = name
		}
		// Explicit live capability declarations override the fallback catalog.
		for _, field := range []string{"supportedInputModalities", "input_modalities"} {
			if values, ok := item[field].([]any); ok {
				m.SupportedInputModalities = nil
				for _, value := range values {
					if modality, ok := value.(string); ok {
						m.SupportedInputModalities = append(m.SupportedInputModalities, strings.ToLower(modality))
					}
				}
				break
			}
		}
		if n := numberField(item, "maxInputTokens", "max_input_tokens", "inputTokenLimit", "context_length", "context_window", "maxTokens"); n > 0 {
			m.ContextLength = n
			m.InputTokenLimit = n
		}
		if n := numberField(item, "maxOutputTokens", "max_output_tokens", "outputTokenLimit", "max_completion_tokens"); n > 0 {
			m.MaxCompletionTokens = n
			m.OutputTokenLimit = n
		}
		m.SupportsWebSearch = false
		if searches, ok := data["webSearchModelIds"].([]any); ok {
			for _, v := range searches {
				if v == id {
					m.SupportsWebSearch = true
				}
			}
		}
		models = append(models, m)
	}
	if len(items) > 0 && len(models) == 0 && invalid {
		return nil, false
	}
	return models, true
}

func stringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if v, ok := m[key].(string); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}
func numberField(m map[string]any, keys ...string) int {
	for _, key := range keys {
		if v, ok := m[key].(float64); ok && v > 0 && v < 1e9 {
			return int(v)
		}
	}
	return 0
}
