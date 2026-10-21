package handlers

import (
	"context"
	"github.com/gin-gonic/gin"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/executor"
	"net/http/httptest"
	"testing"
)

func TestTokenFlowCredentialPin(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/responses", nil)
	c.Request.Header.Set("X-Token-Flow-Auth", "selected-credential")
	c.Request.Header.Set("X-Token-Flow-Image-Generation", "deny")
	ctx := context.WithValue(context.Background(), "gin", c)
	if got := requestExecutionMetadata(ctx)[coreexecutor.PinnedAuthMetadataKey]; got != "selected-credential" {
		t.Fatalf("credential pin missing: %v", got)
	}
	if got := requestExecutionMetadata(ctx)["token_flow_disable_image_generation"]; got != true {
		t.Fatalf("image policy missing: %v", got)
	}
	c.Request.Header.Set("X-Token-Flow-Image-Generation", "allow")
	if _, ok := requestExecutionMetadata(ctx)["token_flow_disable_image_generation"]; ok {
		t.Fatal("Codex image support unexpectedly disabled")
	}
	c.Request.Header.Del("X-Token-Flow-Auth")
	if _, ok := requestExecutionMetadata(ctx)[coreexecutor.PinnedAuthMetadataKey]; ok {
		t.Fatal("unexpected pin")
	}
}
