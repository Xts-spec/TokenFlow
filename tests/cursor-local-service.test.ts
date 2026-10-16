import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,it,vi} from 'vitest';
import {createDesktopService} from '../packages/core/src/service.js';
it('protects local Cursor detection, shows reusable accounts and never exposes or creates credentials',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'cursor-status-api-')),path=join(root,'state.vscdb');
 const db=new DatabaseSync(path);db.exec('CREATE TABLE ItemTable(key TEXT PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('cursorAuth/accessToken','private-native-token');db.close();
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{expect(String(url)).toBe('https://api2.cursor.sh/aiserver.v1.DashboardService/GetMe');return Response.json({email:'local@example.test'});});
 const service=await createDesktopService({root,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{throw Error('Detection must never write credentials');}},cursorLocalPath:path,claudeCredentialStore:null});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'},url='/api/native-accounts/cursor';
 try{
  vi.spyOn(service.proxy.cursor,'snapshot').mockReturnValue({accounts:[{id:'a'.repeat(24),provider:'cursor',label:'local@example.test',status:'active',disabled:false,unavailable:false,models:[]}],models:[],quotas:{},login:undefined});
  expect((await service.app.inject({url,headers:{host:headers.host}})).statusCode).toBe(401);expect(fetcher).not.toHaveBeenCalled();
  const result=await service.app.inject({url,headers});expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({loginState:'signed-in',email:'local@example.test',readOnly:true,accounts:[{email:'local@example.test',switchable:false}]});expect(result.body).not.toMatch(/private-native-token|apiKey|accessToken/);
  await service.app.inject({url,headers});expect(fetcher).toHaveBeenCalledOnce();await service.app.inject({url:url+'?refresh=1',headers});expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await service.app.inject({url:url+'/switch',method:'POST',headers,payload:{}})).statusCode).toBe(400);
 }finally{await service.app.close();vi.restoreAllMocks();await rm(root,{recursive:true,force:true});}
});
