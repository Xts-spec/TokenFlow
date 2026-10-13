import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
export function workbuddyRegionOverlay(replacements,dir){
 replacements[resolve('upstream/CLIProxyAPI/internal/auth/workbuddy/workbuddy_region_test.go')]=resolve('tests/sidecar/workbuddy_region_test.go');
 const patch=(path,fn)=>{const source=resolve('upstream/CLIProxyAPI',path),target=join(dir,'region-'+basename(path));writeFileSync(target,fn(readFileSync(replacements[source]??source,'utf8')));replacements[source]=target;};
 const replace=(s,a,b)=>{if(!s.includes(a))throw Error('WorkBuddy region anchor changed: '+a);return s.replace(a,b);};
 patch('internal/auth/workbuddy/workbuddy.go',s=>{
  s=replace(s,'cfg    *config.Config','cfg    *config.Config\n base string');
  s=replace(s,'func (w *WorkBuddyAuth) setCommonHeaders',`// Only the two verified public regions may receive credentials.
func OfficialBase(domain string) string {
 if domain == "www.workbuddy.ai" || domain == "https://www.workbuddy.ai" { return "https://www.workbuddy.ai" }
 return WorkBuddyBaseURL
}
func (w *WorkBuddyAuth) SetDomain(domain string) { w.base = OfficialBase(domain) }
func (w *WorkBuddyAuth) setCommonHeaders`);
  s=replace(s,'req.Header.Set("User-Agent", WorkBuddyClientUA)','req.Header.Set("User-Agent", WorkBuddyClientUA)\n if w.base == "https://www.workbuddy.ai" { req.Header.Set("Origin",w.base); req.Header.Set("Referer",w.base+"/") }');
  s=replace(s,'req, err := http.NewRequestWithContext(ctx, method, fullURL, body)','if w.base != "" { fullURL = strings.Replace(fullURL,WorkBuddyBaseURL,w.base,1) }\n req, err := http.NewRequestWithContext(ctx, method, fullURL, body)');
  s=s.replaceAll('Domain:       tok.Domain,','Domain:       strings.TrimPrefix(OfficialBase(w.base), "https://"),');
  s=replace(s,'workbuddyRefreshGroup.Do(refreshToken,','workbuddyRefreshGroup.Do(OfficialBase(w.base)+refreshToken,');
  s=replace(s,'http.MethodPost, WorkBuddyRefreshURL,','http.MethodPost, OfficialBase(w.base)+"/v2/plugin/auth/token/refresh",');
  return s;
 });
 patch('internal/api/handlers/management/auth_files_provider_oauth.go',s=>{
  const start=s.indexOf('func (h *Handler) RequestWorkBuddyToken'),end=s.indexOf('func (h *Handler) ImportWorkBuddyLocalToken',start);let part=s.slice(start,end);
  part=replace(part,'wbAuth := workbuddy.NewWorkBuddyAuth(h.cfg)','wbAuth := workbuddy.NewWorkBuddyAuth(h.cfg)\n overseas := c.Query("region") == "overseas"\n if c.Query("region") != "" && !overseas { c.JSON(400,gin.H{"error":"unsupported region"}); return }\n if overseas { wbAuth.SetDomain("www.workbuddy.ai") }');
  part=replace(part,'record := &coreauth.Auth{','if overseas { fileName = "workbuddy-overseas-"+strings.TrimPrefix(fileName,"workbuddy-"); label += " · 海外" }\n record := &coreauth.Auth{');
  return s.slice(0,start)+part+s.slice(end);
 });
}
