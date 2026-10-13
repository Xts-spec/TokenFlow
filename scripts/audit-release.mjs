import {listPackage,extractFile} from '@electron/asar';
import {readFile,readdir,stat,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {homedir} from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const release=resolve(process.argv[2]??'release/v10.13.26.1');
const pkg=JSON.parse(await readFile('package.json','utf8'));
const known=new Set();
const collect=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(typeof item==='string'&&item.length>=16&&/^(?:access_token|refresh_token|id_token|token|secret|password|api[_-]?key|email|OPENAI_API_KEY)$/i.test(key))known.add(item);
    else if(item&&typeof item==='object')collect(item);
  }
};
const profiles=['token-flow','token-flowb','desktop-browser-agent','Browser Agent'].map(name=>join(homedir(),'Library/Application Support',name));
const credentialFiles=[join(homedir(),'.codex/auth.json'),join(homedir(),'.claude/.credentials.json')];
for(const profile of profiles){
  const auth=join(profile,'cliproxy/auth');
  for(const name of await readdir(auth).catch(()=>[]))if(name.endsWith('.json'))credentialFiles.push(join(auth,name));
}
for(const file of credentialFiles)try{collect(JSON.parse(await readFile(file,'utf8')));}catch{}
const forbiddenName=/^(?:\.env(?:\..*)?|auth\.json|\.credentials\.json|gateway-keys\.json|local-maintenance\.json|api-token|cliproxy-api-key|.*\.(?:sqlite(?:-.*)?|db(?:-.*)?|pem|p12|pfx|har))$/i;
const forbiddenDir=/^(?:agent-backups|browser-profile|\.data|\.cache|Cache|Code Cache|GPUCache|Session Storage|Local Storage|\.codex|\.claude|\.workbuddy)$/;
const suspicious=[];
const reviewedVendorSettings='node_modules/thread-stream/.claude/settings.local.json';
const scanned=new Map();
function scan(path,bytes){
  if(forbiddenName.test(basename(path)))suspicious.push({path,reason:'runtime data or credential filename'});
  const hash=createHash('sha256').update(bytes).digest('hex');
  if(path===reviewedVendorSettings)assert.equal(hash,'92f79c208758204df0f10ba55f918efda99e7e8f733f1f52e898bb3f4f08719f','Vendor test permissions changed; review again');
  if(scanned.has(hash)){for(const reason of scanned.get(hash))suspicious.push({path,reason});return;}
  const before=suspicious.length;
  if(bytes.includes(Buffer.from(homedir()+'/')))suspicious.push({path,reason:'developer home path'});
  for(const secret of known)if(bytes.includes(Buffer.from(secret))){suspicious.push({path,reason:'matches local credential'});break;}
  // Report only the filename and category; never print a matching secret.
  if(/(?:\bsk-(?:proj-|ant-)?(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{32,}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bAIza[A-Za-z0-9_-]{30,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=]{40,})/.test(bytes.toString('utf8')))
    suspicious.push({path,reason:'credential pattern'});
  scanned.set(hash,suspicious.slice(before).map(item=>item.reason));
}
async function walk(root,relative=''){
  for(const name of await readdir(join(root,relative))){
    const path=join(relative,name),full=join(root,path),info=await stat(full);
    if(info.isDirectory()){
      if(forbiddenDir.test(name))suspicious.push({path,reason:'runtime/cache directory'});
      await walk(root,path);
    }else if(name!=='app.asar')scan(path,await readFile(full));
  }
}
const results=[];
for(const spec of process.argv[3]?[process.argv[3]]:['darwin-arm64','darwin-x64','win32-x64']){
  const root=join(release,spec,spec.startsWith('darwin')?`mac${spec.endsWith('arm64')?'-arm64':''}/token-flow.app/Contents/Resources`:'win-unpacked/resources');
  const archive=join(root,'app.asar');
  const entries=listPackage(archive);
  assert.ok(!entries.some(path=>/^\/(?:auth|secrets|\.env)(?:\/|$)/.test(path)),'Unexpected top-level credential data');
  for(const entry of entries){
    const path=entry.replace(/^\//,'');
    const reviewed=path===reviewedVendorSettings||path==='node_modules/thread-stream/.claude';
    if(!reviewed&&path.split('/').some(part=>forbiddenDir.test(part)))suspicious.push({path,reason:'runtime/cache directory in asar'});
    try{scan(path,extractFile(archive,path));}catch(error){if(forbiddenName.test(basename(path)))suspicious.push({path,reason:'credential filename in asar'});}
  }
  await walk(root);
  const packaged=JSON.parse(extractFile(archive,'package.json'));
  assert.equal(packaged.version,pkg.version);
  const sidecars=await readdir(join(root,'sidecars'));
  assert.deepEqual(sidecars,[spec]);
  const consoleBundle=entries.find(path=>/dist\/console\/assets\/index-.*\.js$/.test(path));
  assert.ok(extractFile(archive,consoleBundle.replace(/^\//,'')).includes(Buffer.from(pkg.build.buildVersion)));
  results.push({spec,version:pkg.build.buildVersion,entries:entries.length,onlyTargetSidecar:true});
}
await writeFile(join(release,'privacy-audit.json'),JSON.stringify({results,localCredentialsChecked:known.size,reviewedVendorSettings:{path:reviewedVendorSettings,reason:'Third-party package test command permissions only; no credentials or user data; exact content hash verified'},findings:suspicious},null,2)+'\n');
assert.equal(suspicious.length,0,'Release privacy audit found suspicious files; review the report (values are redacted)');
console.log(JSON.stringify({privacyAudit:'passed',results,localCredentialsChecked:known.size}));
