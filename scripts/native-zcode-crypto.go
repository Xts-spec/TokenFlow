package zcode

import (
 "crypto/aes"
 "crypto/cipher"
 "crypto/sha256"
 "encoding/base64"
 "encoding/json"
 "errors"
 "os"
 "os/user"
 "net/url"
 "runtime"
 "strings"
)

// Matches the native app/CLI credential store. Never treat an unknown or
// unauthenticated encrypted value as a usable token; never rewrite the store.
func decodeNativeZCodeCredentials(data []byte) ([]byte,error) {
 var values map[string]any
 if err:=json.Unmarshal(data,&values);err!=nil{return nil,errors.New("unreadable ZCode credential store")}
 var aead cipher.AEAD
 for name,value:=range values {
  if name!="zcodejwttoken"&&!strings.HasPrefix(name,"oauth:")&&!strings.HasPrefix(name,"project-key-location:v1:"){continue}
  text,ok:=value.(string);if !ok||!strings.HasPrefix(text,"enc:"){continue}
  fail:=errors.New("ZCode local credential encryption cannot be read on this device; authorize the account in TokenFlow")
  if !strings.HasPrefix(text,"enc:v1:"){return nil,fail}
  if aead==nil {
   secret:=os.Getenv("ZCODE_CREDENTIAL_SECRET")
   if secret=="" {home,err:=os.UserHomeDir();if err!=nil{return nil,fail};u,err:=user.Current();if err!=nil{return nil,fail};platform:=runtime.GOOS;if platform=="windows"{platform="win32"};username:=u.Username;if platform=="win32"{if i:=strings.LastIndex(username,`\`);i>=0{username=username[i+1:]}}
    secret="zcode-credential-fallback:"+platform+":"+home+":"+username
   }
   key:=sha256.Sum256([]byte(secret));block,err:=aes.NewCipher(key[:]);if err!=nil{return nil,fail};aead,err=cipher.NewGCM(block);if err!=nil{return nil,fail}
  }
  parts:=strings.Split(strings.TrimPrefix(text,"enc:v1:"),".");if len(parts)!=3{return nil,fail}
  nonce,e1:=base64.RawURLEncoding.DecodeString(parts[0]);tag,e2:=base64.RawURLEncoding.DecodeString(parts[1]);body,e3:=base64.RawURLEncoding.DecodeString(parts[2]);if e1!=nil||e2!=nil||e3!=nil||len(nonce)!=aead.NonceSize()||len(tag)!=aead.Overhead(){return nil,fail}
  plain,err:=aead.Open(nil,nonce,append(body,tag...),nil);if err!=nil{return nil,fail};values[name]=string(plain)
 }
 return json.Marshal(values)
}

// Scope pointers contain no inference key. Match the native account and family
// before exposing a location for the official project-token exchange.
func nativeZCodeProject(data []byte,provider,uid string) map[string]string {
 var values map[string]any;if json.Unmarshal(data,&values)!=nil{return nil}
 origin:="https://bigmodel.cn";if provider=="zai"{origin="https://api.z.ai"}
 for name,value:=range values {
  if !strings.HasPrefix(name,"project-key-location:v1:"){continue}
  decoded,err:=url.PathUnescape(strings.TrimPrefix(name,"project-key-location:v1:"));if err!=nil{continue}
  var scope []any;if json.Unmarshal([]byte(decoded),&scope)!=nil||len(scope)!=6||scope[0]!=origin||scope[1]!=provider||scope[2]!=uid||scope[3]!=nil||scope[4]!=float64(1)||scope[5]!="non-team"{continue}
  text,ok:=value.(string);if !ok{continue};var project map[string]string;if json.Unmarshal([]byte(text),&project)!=nil{continue}
  if project["organizationId"]!=""&&project["projectId"]!=""&&project["apiKeyId"]!=""{return project}
 }
 return nil
}
