import {it,expect,vi,afterEach} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {guardCredentialAccess,rememberedCredentialAccess,rememberCredentialAccess} from '../apps/desktop/src/credential-access.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});

it('never touches client secure storage after skipping, including repeated background reads and writes',async()=>{
 const operation=vi.fn(async(_value?:string)=>'credential');
 const blocked=guardCredentialAccess(false,operation);
 for(const value of [undefined,undefined,'replacement'])await expect(blocked(value)).rejects.toThrow('本次启动未允许');
 expect(operation).not.toHaveBeenCalled();
});
it('passes through allowed secure storage operations without suppressing OS errors',async()=>{
 const operation=vi.fn(async(value:string)=>value);
 await expect(guardCredentialAccess(true,operation)('fixture')).resolves.toBe('fixture');
 expect(operation).toHaveBeenCalledWith('fixture');
 await expect(guardCredentialAccess(true,async()=>{throw new Error('OS denied');})()).rejects.toThrow('OS denied');
});
it('remembers only an explicit allowed choice, stores no credential, and supports resetting it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'credential-consent-'));roots.push(root);
 expect(await rememberedCredentialAccess(root)).toBe(false);
 await rememberCredentialAccess(root,true);expect(await rememberedCredentialAccess(root)).toBe(true);
 expect(JSON.parse(await readFile(join(root,'credential-access.json'),'utf8'))).toEqual({version:1,allowed:true});
 await rememberCredentialAccess(root,false);expect(await rememberedCredentialAccess(root)).toBe(false);
 for(const value of ['broken','null','{}','{"version":1,"allowed":false}','{"version":1,"allowed":"true"}','{"version":2,"allowed":true}']){
  await writeFile(join(root,'credential-access.json'),value);expect(await rememberedCredentialAccess(root)).toBe(false);
 }
});
