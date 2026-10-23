package cliproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"runtime"
 "sort"
	"strings"
	"time"

	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/proxyutil"
)

func zcodeCodingPicker(raw []byte, provider string) (map[string]bool, bool) {
	var release struct {
		Config struct {
			Rules struct {
				Providers []struct {
					ID     string `json:"providerId"`
					Config struct {
						IDs []string `json:"builtinModelIds"`
					} `json:"config"`
				} `json:"providerRules"`
			} `json:"providerConfigRules"`
		} `json:"config"`
	}
	if json.Unmarshal(raw, &release) != nil {
		return nil, false
	}
	family := "bigmodel"
	if provider == "zai" {
		family = "zai"
	}
	ids := map[string]bool{}
	found := false
	// The existing executor uses the Coding Plan API, not the separate Start Plan endpoint.
	for _, p := range release.Config.Rules.Providers {
		if p.ID == "account:"+family+"-individual-coding-plan" || p.ID == "account:"+family+"-team-coding-plan" {
			found = true
			for _, id := range p.Config.IDs {
				if id != "" {
					ids[strings.ToLower(id)] = true
				}
			}
		}
	}
	return ids, found
}
// An enabled official project token supplies the Coding Plan authorization;
// model IDs come from the freshly downloaded native picker, never a static list.
func zcodeProjectCatalog(allowed map[string]bool,fallback []*ModelInfo)([]*ModelInfo,bool){
 if allowed==nil{return nil,false}
 ids:=make([]string,0,len(allowed));for id:=range allowed{ids=append(ids,id)};sort.Strings(ids)
 entries:=make([]map[string]string,0,len(ids));for _,id:=range ids{entries=append(entries,map[string]string{"id":id})}
 raw,_:=json.Marshal(map[string]any{"data":entries});return parseOfficialCatalog("zcode",raw,fallback)
}
func readZCodeCatalogJSON(ctx context.Context, client *http.Client, target, token string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", target, nil)
	if err != nil {
		return nil, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("catalog HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024+1))
	if err != nil || len(raw) > 8*1024*1024 {
		return nil, fmt.Errorf("invalid catalog body")
	}
	return raw, nil
}
func (s *Service) fetchZCodeConversationCatalog(ctx context.Context, a *coreauth.Auth, fallback []*ModelInfo) ([]*ModelInfo, bool) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	proxy := a.ProxyURL
	if proxy == "" && s.cfg != nil {
		proxy = s.cfg.ProxyURL
	}
	transport, _, err := proxyutil.BuildHTTPTransport(proxy)
	if err != nil {
		return nil, false
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if transport != nil {
		client.Transport = transport
	}
	defer client.CloseIdleConnections()
	platform := runtime.GOOS
	arch := runtime.GOARCH
	if arch == "arm64" {
		arch = "aarch64"
	}
	if arch == "amd64" {
		arch = "x86_64"
	}
	version := "3.15.3"
	if value := metadataText(a, "zcode_client_version"); validCatalogVersion(value) {
		version = value
	}
	raw, err := readZCodeCatalogJSON(ctx, client, "https://zcode.z.ai/api/v1/client/configs?app_version="+url.QueryEscape(version)+"&platform="+platform+"-"+arch, metadataText(a, "jwt"))
	if err != nil {
		return nil, false
	}
	var response struct {
		Code int `json:"code"`
		Data struct {
			Configs struct {
				URL string `json:"builtin_provider_config_json"`
			} `json:"configs"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &response) != nil || response.Code != 0 {
		return nil, false
	}
	target, err := url.Parse(response.Data.Configs.URL)
	if err != nil || target.Scheme != "https" || target.Host != "cdn-zcode.z.ai" || target.User != nil {
		return nil, false
	}
	// The CDN receives no account token and redirects are rejected.
	raw, err = readZCodeCatalogJSON(ctx, client, target.String(), "")
	if err != nil {
		return nil, false
	}
	allowed, ok := zcodeCodingPicker(raw, metadataText(a, "provider"))
	if !ok {
		return nil, false
	}
	if metadataText(a,"auth_kind")=="project_access" { return zcodeProjectCatalog(allowed,fallback) }
 apiAuth := *a
	apiAuth.Metadata = make(map[string]any, len(a.Metadata))
	for k, v := range a.Metadata {
		apiAuth.Metadata[k] = v
	}
	delete(apiAuth.Metadata, "jwt")
	apiAuth.Attributes = make(map[string]string, len(a.Attributes))
	for k, v := range a.Attributes {
		apiAuth.Attributes[k] = v
	}
	delete(apiAuth.Attributes, "jwt")
	models, ok := s.fetchOfficialAccountModels(ctx, &apiAuth, fallback)
	if !ok {
		return nil, false
	}
	result := make([]*ModelInfo, 0, len(models))
	for _, m := range models {
		if allowed[strings.ToLower(m.ID)] {
			result = append(result, m)
		}
	}
	return result, true
}
