package executor

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"
)

// A recorded Antigravity HTTP 500 was actually net/http's pre-header EOF.
// Replay at most once on a fresh connection, with the identical request. This
// never retries an HTTP error, a partially consumed response, or cancellation.
// Inference may have reached the vendor before disconnection, so this is bounded
// recovery, not an exactly-once billing guarantee. No client tool executes here.
func antigravityDoWithReconnect(ctx context.Context, client *http.Client, req *http.Request) (*http.Response, error) {
	response, err := client.Do(req)
	if response != nil || !errors.Is(err, io.EOF) || ctx.Err() != nil || req.GetBody == nil {
		return response, err
	}
	client.CloseIdleConnections()
	timer := time.NewTimer(150 * time.Millisecond)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timer.C:
	}
	body, bodyErr := req.GetBody()
	if bodyErr != nil {
		return nil, bodyErr
	}
	retry := req.Clone(ctx)
	retry.Body = body
	return client.Do(retry)
}
