package trae
import("testing";"time")
func TestLocalSessionKeepsUsableAccessOrRefresh(t *testing.T){
 now:=time.Now();past:=now.Add(-time.Hour).Format(time.RFC3339);future:=now.Add(time.Hour).Format(time.RFC3339)
 for _,tc:=range []struct{name string;data TraeTokenData;expired bool}{
  {"access remains usable",TraeTokenData{ExpiredAt:future,RefreshExpiredAt:past,RefreshToken:"refresh"},false},
  {"can refresh",TraeTokenData{ExpiredAt:past,RefreshExpiredAt:future,RefreshToken:"refresh"},false},
  {"both expired",TraeTokenData{ExpiredAt:past,RefreshExpiredAt:past,RefreshToken:"refresh"},true},
  {"no refresh",TraeTokenData{ExpiredAt:past},true},
 }{t.Run(tc.name,func(t *testing.T){if localSessionExpired(tc.data,now)!=tc.expired{t.Fatal("wrong native recovery eligibility")}})}
}
