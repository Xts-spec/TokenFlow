package management

import (
 "encoding/json"
 "net/http/httptest"
 "os"
 "path/filepath"
 "testing"

 "github.com/gin-gonic/gin"
 "github.com/router-for-me/CLIProxyAPI/v7/internal/config"
)

func TestNativeImportPreviewDoesNotWritePool(t *testing.T) {
 home:=t.TempDir()
 t.Setenv("HOME",home); t.Setenv("USERPROFILE",home)
 t.Setenv("APPDATA",filepath.Join(home,"roaming")); t.Setenv("LOCALAPPDATA",filepath.Join(home,"local"))
 t.Setenv("XDG_CONFIG_HOME",filepath.Join(home,"config")); t.Setenv("XDG_DATA_HOME",filepath.Join(home,"data"))
 write:=func(path,body string){t.Helper();if err:=os.MkdirAll(filepath.Dir(path),0700);err!=nil{t.Fatal(err)};if err:=os.WriteFile(path,[]byte(body),0600);err!=nil{t.Fatal(err)}}
 for _,base:=range []string{filepath.Join(home,"Library","Application Support"),filepath.Join(home,"local"),filepath.Join(home,"data")} {
  for _,name:=range []string{"workbuddy-desktop.info","workbuddy-desktop-ai.info"}{write(filepath.Join(base,"CodeBuddyExtension","Data","Public","auth",name),`{"auth":{"accessToken":"fixture-native","refreshToken":"fixture-refresh"},"account":{"uid":"fixture-user"}}`)}
 }
 write(filepath.Join(home,".zcode","cli","config.json"),`{"access_token":"fixture-native","uid":"fixture-user","provider":"zai"}`)
 for _,base:=range []string{filepath.Join(home,"Library","Application Support"),filepath.Join(home,"roaming"),filepath.Join(home,"config")} {
  write(filepath.Join(base,"Trae","User","globalStorage","storage.json"),`{"iCubeAuthInfo://icube.cloudide":"{\"token\":\"fixture-native\",\"refreshToken\":\"fixture-refresh\",\"userId\":\"fixture-user\",\"host\":\"https://api-sg-central.trae.ai\",\"expiredAt\":\"2035-01-01T00:00:00Z\"}"}`)
 }
 pool:=filepath.Join(home,"pool")
 h:=&Handler{cfg:&config.Config{AuthDir:pool}}
 for _,tc:=range []struct{name,query string; handler gin.HandlerFunc}{
  {"workbuddy","",h.ImportWorkBuddyLocalToken}, {"workbuddy-ai","&region=overseas",h.ImportWorkBuddyLocalToken},
  {"trae","",h.ImportTraeLocalToken},
 }{
  t.Run(tc.name,func(t *testing.T){
   w:=httptest.NewRecorder();c,_:=gin.CreateTestContext(w);c.Request=httptest.NewRequest("POST","/?preview=1"+tc.query,nil)
   tc.handler(c)
   if w.Code!=200{t.Fatalf("preview status %d",w.Code)}
   var result struct{Credential map[string]any `json:"credential"`};if err:=json.Unmarshal(w.Body.Bytes(),&result);err!=nil{t.Fatal(err)}
   if result.Credential["access_token"]!="fixture-native"{t.Fatal("native credential missing")}
   if tc.name=="trae"&&result.Credential["refresh_token"]!="fixture-refresh"{t.Fatal("refresh token lost")}
   if tc.name=="workbuddy-ai"&&result.Credential["domain"]!="www.workbuddy.ai"{t.Fatal("region lost")}
   if w.Header().Get("Cache-Control")!="no-store"{t.Fatal("preview must not be cached")}
   if _,err:=os.Stat(pool);!os.IsNotExist(err){t.Fatal("preview wrote the pool")}
  })
 }
}

func TestZcodeLocalImportDisabledEvenWithReadableNativeCredentials(t *testing.T) {
 home:=t.TempDir();t.Setenv("HOME",home);t.Setenv("USERPROFILE",home)
 path:=filepath.Join(home,".zcode","cli","config.json");os.MkdirAll(filepath.Dir(path),0700);os.WriteFile(path,[]byte(`{"access_token":"fixture-native","uid":"fixture-user","provider":"zai"}`),0600)
 pool:=filepath.Join(home,"pool");h:=&Handler{cfg:&config.Config{AuthDir:pool}}
 for _,query:=range []string{"","?preview=1"}{w:=httptest.NewRecorder();c,_:=gin.CreateTestContext(w);c.Request=httptest.NewRequest("POST","/"+query,nil);h.ImportZCodeLocalToken(c);if w.Code!=410{t.Fatalf("disabled native import returned %d",w.Code)};if _,err:=os.Stat(pool);!os.IsNotExist(err){t.Fatal("disabled import wrote the pool")}}
}
