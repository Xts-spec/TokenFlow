package trae
import("context";"encoding/base64";"encoding/json";"errors";"strings";"time")
// Callback pages can return an old native session. Recover it once, or reject it
// before any new pool file is saved; never report expired cached data as success.
func validateTraeCallback(ctx context.Context,storage *TraeTokenStorage) error {
 parts:=strings.Split(storage.AccessToken,".")
 if len(parts)==3 {if raw,err:=base64.RawURLEncoding.DecodeString(parts[1]);err==nil{var payload struct{Exp int64 `json:"exp"`};if json.Unmarshal(raw,&payload)==nil&&payload.Exp>0{expiry:=time.Unix(payload.Exp,0);old,known:=parseTraeTime(storage.Expired);if !known||expiry.Before(old){storage.Expired=expiry.UTC().Format(time.RFC3339)}}}}
 now:=time.Now();access,known:=parseTraeTime(storage.Expired);if !known||access.After(now){return nil}
 refresh,knownRefresh:=parseTraeTime(storage.RefreshExpiredAt)
 if storage.RefreshToken==""||knownRefresh&&!refresh.After(now){return errors.New("Trae authorization returned an expired session; sign in to Trae again before authorizing")}
 if err:=RefreshToken(ctx,storage);err!=nil{return errors.New("Trae authorization returned an expired session and automatic refresh failed; sign in again")}
 access,known=parseTraeTime(storage.Expired);if !known||!access.After(time.Now()){return errors.New("Trae refresh did not return a usable new session; sign in again")}
 return nil
}
