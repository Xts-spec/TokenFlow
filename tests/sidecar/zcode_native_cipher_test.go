package zcode
import("testing";"os";"path/filepath";"encoding/json";"encoding/base64";"crypto/aes";"crypto/cipher";"crypto/sha256")
func TestNativeZCodeEncryptedCredential(t *testing.T){
 t.Setenv("ZCODE_CREDENTIAL_SECRET","fixture-secret")
 key:=sha256.Sum256([]byte("fixture-secret"));block,_:=aes.NewCipher(key[:]);gcm,_:=cipher.NewGCM(block)
 enc:=func(s string)string{nonce:=make([]byte,12);sealed:=gcm.Seal(nil,nonce,[]byte(s),nil);n:=len(sealed)-16;return "enc:v1:"+base64.RawURLEncoding.EncodeToString(nonce)+"."+base64.RawURLEncoding.EncodeToString(sealed[n:])+"."+base64.RawURLEncoding.EncodeToString(sealed[:n])}
 path:=filepath.Join(t.TempDir(),"credentials.json");raw,_:=json.Marshal(map[string]string{"oauth:active_provider":enc("bigmodel"),"oauth:bigmodel:access_token":enc("fixture-native-access-token"),"zcodejwttoken":enc("a.b.c"),"oauth:bigmodel:user_info":enc(`{"id":"fixture-user","email":"fixture@example.test"}`)})
 os.WriteFile(path,raw,0600);auth:=NewZCodeAuth(nil)
 got,err:=auth.importSharedCLICredentials(path);if err!=nil||got==nil||got.AccessToken!="fixture-native-access-token"||got.UID!="fixture-user"||got.JWT!="a.b.c"{t.Fatal("encrypted native identity was not decoded")}
 after,_:=os.ReadFile(path);if string(after)!=string(raw){t.Fatal("native file changed")}
 t.Setenv("ZCODE_CREDENTIAL_SECRET","wrong-key");if _,err:=auth.importSharedCLICredentials(path);err==nil{t.Fatal("ciphertext must never become a token")}
}
