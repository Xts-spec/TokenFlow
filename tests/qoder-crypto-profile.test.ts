import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {qoderCryptoProfile} from '../apps/desktop/src/qoder-crypto-profile.js';
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(join(tmpdir(),'qoder-profile-test-'));roots.push(root);mkdirSync(join(root,'com.qoder.app.stable'));return root;}
it('preserves the native Windows encrypted key without opening or copying Qoder profile data',()=>{
 const root=fixture(),file=join(root,'com.qoder.app.stable','Local State'),key=Buffer.from('DPAPI-fixture-wrapped-key').toString('base64'),original=JSON.stringify({os_crypt:{encrypted_key:key},profile:{private:'never-copy'},other:'unrelated'});writeFileSync(file,original);
 const profile=qoderCryptoProfile('win32',root,root);expect(profile).not.toBe(join(root,'com.qoder.app.stable'));expect(JSON.parse(readFileSync(join(profile,'Local State'),'utf8'))).toEqual({os_crypt:{encrypted_key:key,audit_enabled:true}});expect(readFileSync(file,'utf8')).toBe(original);
});
it('fails without staging a new key if the native Windows key is missing or invalid',()=>{
 const root=fixture();for(const value of [null,{}, {os_crypt:{encrypted_key:'invalid'}}, {os_crypt:{encrypted_key:Buffer.from('OTHER-key').toString('base64')}}]){
  if(value!==null)writeFileSync(join(root,'com.qoder.app.stable','Local State'),JSON.stringify(value));expect(()=>qoderCryptoProfile('win32',root,root)).toThrow('先在此 Windows 用户下打开一次 Qoder');expect(readdirSync(root)).toEqual(['com.qoder.app.stable']);
 }
});
it('uses a private empty profile on macOS; its identity comes from the system keychain',()=>{
 const root=fixture(),profile=qoderCryptoProfile('darwin',root,root);expect(readdirSync(profile)).toEqual([]);expect(readdirSync(join(root,'com.qoder.app.stable'))).toEqual([]);
});
it('uses a separate Windows key for Qoder IDE instead of the standalone application',()=>{
 const root=fixture(),ide=join(root,'Qoder');mkdirSync(ide);const appKey=Buffer.from('DPAPI-standalone-key').toString('base64'),ideKey=Buffer.from('DPAPI-ide-key').toString('base64');
 writeFileSync(join(root,'com.qoder.app.stable','Local State'),JSON.stringify({os_crypt:{encrypted_key:appKey}}));writeFileSync(join(ide,'Local State'),JSON.stringify({os_crypt:{encrypted_key:ideKey}}));
 const profile=qoderCryptoProfile('win32',root,root,'qoder-ide');expect(JSON.parse(readFileSync(join(profile,'Local State'),'utf8')).os_crypt.encrypted_key).toBe(ideKey);
});
