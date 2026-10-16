import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {parse} from 'smol-toml';
import {AgentConnections} from '../packages/core/src/agent-connections.js';
import {agentConfig} from '../apps/console/src/agent-config.js';

it('keeps Codex default search on TRAE and restores it automatically after an unsupported source',async()=>{
 for(const original of ['model = "native"\n','model = "native"\nweb_search = "live"\n']){
  const root=await mkdtemp(join(await realpath(tmpdir()),'trae-codex-config-'));
  try{
   const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')};
   await mkdir(join(root,'codex'));await writeFile(paths.codex,original);
   const connections=new AgentConnections(root,paths,async()=>[]);
   for(const model of ['qoder/test','trae/deepseek-v4.1-flash']){
    const preview=await connections.preview('codex','http://127.0.0.1:9527',model);
    await connections.apply({target:'codex',revision:preview.revision,replaceId:preview.replaceId,origin:'http://127.0.0.1:9527',model,sourceId:'fixture',keyId:randomUUID(),key:'fixture-key'});
   }
   const config=parse(await readFile(paths.codex,'utf8'));
   expect(config.model).toBe('trae/deepseek-v4.1-flash');
   expect(config.web_search).toBe(parse(original).web_search);
   expect(agentConfig('codex','http://127.0.0.1:9527','trae/deepseek-v4.1-flash')).not.toContain('web_search="disabled"');
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
