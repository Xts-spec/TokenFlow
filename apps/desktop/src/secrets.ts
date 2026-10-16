import { constants } from 'node:fs';
import { copyFile, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

type Storage = {
  decryptString(data:Buffer):string;
  encryptString(value:string):Buffer;
  isEncryptionAvailable():boolean;
  getSelectedStorageBackend?():string;
};
/** Keep unreadable ciphertext for recovery; missing credentials must not prevent the workspace opening. */
export function createSecrets(root:string, storage:Storage, platform=process.platform,allowAccess=true) {
  const unreadable=new Set<string>();
  const warnings=new Map<string,string>();
  const decrypted=new Map<string,{ciphertext:Buffer;value:string}>();
  const label=(name:string)=>name.startsWith('gateway-key-')?'导出 Key':name.startsWith('source-')?'API 来源':({cliproxy:'内部网关',openai:'OpenAI',custom:'自定义接口','cursor-account':'Cursor 账号'}[name]??name);
  const path=(name:string)=>{
    // Accept new credential types without a registry; names must remain portable filenames.
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(name)||/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name))throw new Error('密钥存储名称无效');
    return join(root,'secrets',`${name}.bin`);
  };
  // Even probing availability can open an OS permission prompt. A skipped startup must never call storage.
  const canEncrypt=()=>allowAccess&&storage.isEncryptionAvailable()&&!(platform==='linux'&&storage.getSelectedStorageBackend?.()==='basic_text');
  return {
    canEncrypt,
    warnings:()=>[...warnings.values()],
    async remove(name:string) {await rm(path(name),{force:true});warnings.delete(name);decrypted.delete(name);},
    temporaryGateway:()=>warnings.set('cliproxy','系统安全密钥存储不可用，内部网关本次使用临时密钥；重启后会变化。原有登录账号和客户端 Key 不受影响。'),
    async get(name:string) {
      let data:Buffer;
      try {data=await readFile(path(name));}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){decrypted.delete(name);return '';}throw error;}
      if(!canEncrypt()) {
        if(name.startsWith('native-login-'))throw new Error('系统安全存储暂不可用，原登录备份已保留。');
        warnings.set(name,allowAccess?`${label(name)}密钥暂时无法读取，请解锁系统钥匙串后重启应用。原加密文件已保留。`:`本次启动已跳过 ${label(name)} 安全存储，原加密文件已保留。`);
        return '';
      }
      const cached=decrypted.get(name);
      if(cached?.ciphertext.equals(data))return cached.value;
      try{const value=storage.decryptString(data);decrypted.set(name,{ciphertext:data,value});return value;}
      catch {
        decrypted.delete(name);
        unreadable.add(name);
        if(name.startsWith('native-login-'))throw new Error('无法解密原登录备份，未覆盖现有文件。');
        warnings.set(name,`${label(name)}密钥无法解密，原加密文件已保留。${name==='cliproxy'?'已重新生成内部网关密钥，旧的内部直连客户端需更新密钥；账号登录和受限客户端 Key 不受影响。':'请解锁系统钥匙串后重启，或在模型来源重新填写 API Key。'}`);
        return '';
      }
    },
    async set(name:string,value:string) {
      if(!canEncrypt())throw new Error(allowAccess?'系统安全密钥存储不可用，请解锁系统钥匙串后重试。':'本次启动已跳过安全存储，请重启后选择“允许读取”。');
      const file=path(name);
      const encrypted=storage.encryptString(value);
      // Back up even if get() was not called before replacing the credential.
      let existing:Buffer|undefined;
      try{existing=await readFile(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      if(existing&&!unreadable.has(name)){try{storage.decryptString(existing);}catch{unreadable.add(name);}}
      if(existing&&unreadable.has(name))await copyFile(file,`${file}.unreadable-${randomUUID()}`,constants.COPYFILE_EXCL);
      await writeFile(`${file}.tmp`,encrypted,{mode:0o600});
      await rename(`${file}.tmp`,file);
      decrypted.set(name,{ciphertext:encrypted,value});
      unreadable.delete(name);
      if(name!=='cliproxy')warnings.delete(name);
    },
  };
}
