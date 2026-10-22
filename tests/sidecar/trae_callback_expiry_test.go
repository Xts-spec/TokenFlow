package trae
import("testing";"context";"encoding/base64";"encoding/json";"net/http";"net/http/httptest";"strings";"time")
func TestTraeCallbackRejectsExpiredGrantAndRefreshesRecoverableGrant(t *testing.T){
 jwt:=func(exp int64)string{b,_:=json.Marshal(map[string]any{"exp":exp});return "x."+base64.RawURLEncoding.EncodeToString(b)+".x"}
 old:=jwt(time.Now().Add(-time.Hour).Unix());future:=time.Now().Add(time.Hour).Format(time.RFC3339)
 input,_:=json.Marshal(map[string]any{"Token":old,"RefreshToken":"refresh","refreshExpiredAt":"2020-01-01T00:00:00Z"})
 if _,err:=ParseCallbackData(context.Background(),string(input),`{"Email":"person@example.test"}`,"","");err==nil{t.Fatal("expired cached callback must not be reported as a new authorization")}
 calls:=0;server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){calls++;if !strings.Contains(r.URL.Path,"ExchangeToken"){t.Error("wrong refresh endpoint")};json.NewEncoder(w).Encode(map[string]any{"data":map[string]any{"token":"fresh-token","refreshToken":"fresh-refresh","expiredAt":future}})}));defer server.Close()
 input,_=json.Marshal(map[string]any{"Token":old,"RefreshToken":"refresh","refreshExpiredAt":future})
 got,err:=ParseCallbackData(context.Background(),string(input),`{"UserID":"user","Email":"person@example.test"}`,server.URL,"");if err!=nil||got==nil||got.AccessToken!="fresh-token"||got.Email!="person@example.test"||calls!=1{t.Fatal("recoverable grant was not refreshed before save")}
}
