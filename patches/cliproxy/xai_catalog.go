package executor

import (
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"net/http"
)

// Reuse the inference resolver so OAuth catalogs cannot drift to paid API teams.
func TokenFlowXAICatalogRequest(auth *coreauth.Auth, token string) (string, http.Header) {
	base := xaiChatBaseURL(auth)
	req, _ := http.NewRequest(http.MethodGet, base+"/models", nil)
	if req == nil {
		return base, nil
	}
	applyXAIChatHeaders(req, auth, token, false, "")
	return base, req.Header
}
