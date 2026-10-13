package workbuddy
import("context";"net/http";"io";"strings";"testing")
type regionTransport func(*http.Request)(*http.Response,error)
func(f regionTransport)RoundTrip(r *http.Request)(*http.Response,error){return f(r)}
func TestWorkBuddyOverseasCredentialIsolation(t *testing.T){
 w:=NewWorkBuddyAuth(nil);w.SetDomain("www.workbuddy.ai");calls:=0
 w.client=&http.Client{Transport:regionTransport(func(r *http.Request)(*http.Response,error){
  calls++;if r.URL.Host!="www.workbuddy.ai"||r.Header.Get("Origin")!="https://www.workbuddy.ai"{t.Fatalf("wrong region: %s",r.URL.Host)}
  data:=`{"accessToken":"synthetic-access","refreshToken":"synthetic-refresh","expiresIn":3600,"domain":"copilot.tencent.com"}`
  if strings.Contains(r.URL.Path,"auth/state"){data=`{"state":"test","authUrl":"https://www.workbuddy.ai/login?state=test"}`}
  if strings.Contains(r.URL.Path,"login/account"){data=`{"uid":"fixture-user"}`}
  return &http.Response{StatusCode:200,Body:io.NopCloser(strings.NewReader(`{"code":0,"data":`+data+`}`)),Header:http.Header{}},nil
 })}
 if _,e:=w.RequestState(context.Background());e!=nil{t.Fatal(e)}
 token,e:=w.PollForToken(context.Background(),"test");if e!=nil||token.Domain!="www.workbuddy.ai"{t.Fatalf("poll domain: %v",e)}
 token,e=w.RefreshToken(context.Background(),"synthetic-refresh");if e!=nil||token.Domain!="www.workbuddy.ai"{t.Fatalf("refresh domain: %v",e)}
 if calls!=4{t.Fatalf("calls: %d",calls)}
 if OfficialBase("www.workbuddy.ai.evil.test")!=WorkBuddyBaseURL{t.Fatal("untrusted domain accepted")}
}
