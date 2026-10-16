import {it,expect,vi} from 'vitest';
import {guardCredentialAccess} from '../apps/desktop/src/credential-access.js';

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
