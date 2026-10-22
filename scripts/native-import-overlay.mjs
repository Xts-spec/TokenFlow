import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';

// Read native credentials through the existing platform readers, but let the
// desktop account pool deduplicate grants before any credential file is written.
export function nativeImportOverlay(replacements,dir){
 const source=resolve('upstream/CLIProxyAPI/internal/api/handlers/management/auth_files_provider_oauth.go');
 let text=readFileSync(replacements[source]??source,'utf8');
 for(const name of ['ImportWorkBuddyLocalToken','ImportZCodeLocalToken','ImportTraeLocalToken']){
  const start=text.indexOf(`func (h *Handler) ${name}(`),end=text.indexOf('\nfunc ',start+1);
  if(start<0||end<0)throw Error('Native import handler moved: '+name);
  let section=text.slice(start,end);
  if(name==='ImportTraeLocalToken')section=section.replace('if authDir == "" {','if authDir == "" && c.Query("preview") != "1" {').replace('storage, errImport := trae.ImportLocalTraeCredentials(authDir)','if c.Query("preview") == "1" { authDir = "" }\n storage, errImport := trae.ImportLocalTraeCredentials(authDir)');
  const anchor='\n\tsavedPath, errSave := h.saveTokenRecord(ctx, record)';
  if(!section.includes(anchor))throw Error('Native import save boundary moved: '+name);
  section=section.replace(anchor,`
 if c.Query("preview") == "1" {
  credential, err := misc.MergeMetadata(record.Storage, record.Metadata)
  if err != nil { c.JSON(500,gin.H{"error":"cannot read native credentials"}); return }
  c.Header("Cache-Control","no-store")
  c.JSON(200,gin.H{"credential":credential}); return
 }
`+anchor);
  text=text.slice(0,start)+section+text.slice(end);
 }
 const routesSource=resolve('upstream/CLIProxyAPI/internal/api/server_management.go');
 let routes=readFileSync(replacements[routesSource]??routesSource,'utf8');
 for(const [provider,handler] of [['workbuddy','ImportWorkBuddyLocalToken'],['zcode','ImportZCodeLocalToken'],['trae','ImportTraeLocalToken']]){
  const anchor=`mgmt.POST("/${provider}-import-local", s.mgmt.${handler})`;
  if(!routes.includes(anchor))throw Error('Native route moved: '+provider);
  routes=routes.replace(anchor,anchor+`\n mgmt.GET("/${provider}-local-credential",func(c *gin.Context){q:=c.Request.URL.Query();q.Set("preview","1");c.Request.URL.RawQuery=q.Encode();s.mgmt.${handler}(c)})`);
 }
 const routesTarget=join(dir,'native-import-routes.go');writeFileSync(routesTarget,routes);replacements[routesSource]=routesTarget;
 const target=join(dir,'native-import-handlers.go');writeFileSync(target,text);replacements[source]=target;
 const trae=resolve('upstream/CLIProxyAPI/internal/auth/trae/trae.go');
 let native=readFileSync(replacements[trae]??trae,'utf8');
 const anchor='if errSave := storage.SaveToken(authDir); errSave != nil {\n\t\treturn nil, fmt.Errorf("failed to save imported Trae token: %w", errSave)\n\t}';
 if(!native.includes(anchor))throw Error('Trae local save boundary moved');
 native=native.replace(anchor,`// An empty destination is a read-only preview for the desktop pool.\n if authDir != "" {\n ${anchor}\n }`);
 const expiryFunction='func localSessionExpired(data TraeTokenData, now time.Time) bool {';
 if(!native.includes(expiryFunction))throw Error('Trae native expiry check moved');
 native=native.replace(expiryFunction,expiryFunction+'\n if access, ok := parseTraeTime(data.ExpiredAt); ok && access.After(now) { return false }');
 replacements[resolve('upstream/CLIProxyAPI/internal/auth/trae/native_session_test.go')]=resolve('tests/sidecar/trae_local_session_test.go');
 const nativeTarget=join(dir,'native-import-trae.go');writeFileSync(nativeTarget,native);replacements[trae]=nativeTarget;
 const workbuddy=resolve('upstream/CLIProxyAPI/internal/auth/workbuddy/workbuddy.go');
 let wb=readFileSync(replacements[workbuddy]??workbuddy,'utf8');
 const expiryAnchor='expiresAt := doc.Auth.ExpiresAt';
 if(!wb.includes(expiryAnchor))throw Error('WorkBuddy native expiry reader moved');
 wb=wb.replace(expiryAnchor,expiryAnchor+'\n if expiresAt > 1e11 { expiresAt /= 1000 }');
 const wbTarget=join(dir,'native-import-workbuddy.go');writeFileSync(wbTarget,wb);replacements[workbuddy]=wbTarget;
 const zcode=resolve('upstream/CLIProxyAPI/internal/auth/zcode/zcode.go');
 let ztext=readFileSync(replacements[zcode]??zcode,'utf8');
 const zstart=ztext.indexOf('func (a *ZCodeAuth) importSharedCLICredentials(');
 if(zstart<0)throw Error('ZCode native reader moved');
 ztext=ztext.slice(0,zstart)+ztext.slice(zstart).replace('gj := gjson.ParseBytes(data)',`data, errRead = decodeNativeZCodeCredentials(data)
 if errRead != nil { return nil, errRead }
 gj := gjson.ParseBytes(data)`);
 ztext=ztext.replace('if len(token) < 16 || len(token) > 8192 {','if strings.HasPrefix(token, "enc:") || len(token) < 16 || len(token) > 8192 {');
 const ztarget=join(dir,'native-import-zcode.go');writeFileSync(ztarget,ztext);replacements[zcode]=ztarget;
 replacements[resolve('upstream/CLIProxyAPI/internal/auth/zcode/native_crypto.go')]=resolve('scripts/native-zcode-crypto.go');
 replacements[resolve('upstream/CLIProxyAPI/internal/auth/zcode/native_cipher_test.go')]=resolve('tests/sidecar/zcode_native_cipher_test.go');
 replacements[resolve('upstream/CLIProxyAPI/internal/api/handlers/management/native_import_preview_test.go')]=resolve('tests/sidecar/native_import_preview_test.go');
}
