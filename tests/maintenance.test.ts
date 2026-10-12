import {it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {createAssistantMessageEventStream} from '@earendil-works/pi-ai/utils/event-stream';
import type {AssistantMessage,TranscriptContext} from '@earendil-works/pi-ai';
import type {StreamFn} from '@earendil-works/pi-agent-core';
import {GatewayMaintenance} from '../packages/core/src/gateway-maintenance.js';
const transport={baseURL:'http://127.0.0.1:8317/v1',apiKey:'private-fixture-key',authID:'account.json'};
function answer(content:AssistantMessage['content'],error=false){const s=createAssistantMessageEventStream();const message:AssistantMessage={role:'assistant',content,api:'openai-responses',provider:'token-flow',model:'qoder/test',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:error?'error':content.some(c=>c.type==='toolCall')?'toolUse':'stop',timestamp:Date.now(),...(error?{errorMessage:'private-fixture-key RAW UPSTREAM ERROR'}:{})};if(error)s.push({type:'error',reason:'error',error:message});else s.push({type:'done',reason:message.stopReason as 'stop'|'toolUse',message});s.end(message);return s;}
it('uses the actual Pi loop, retains follow-up context and never carries write authorization into the next question',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-care-'));let turns=0,restores=0,inspects=0;const contexts:TranscriptContext[]=[];
 const stream:StreamFn=(_m,c)=>{contexts.push(structuredClone(c));turns++;return turns%2===1?answer([{type:'toolCall',id:`call${turns}`,name:'restore_connection',arguments:{id:randomUUID()}}]):answer([{type:'text',text:'已依据检查结果回答'}]);};
 const care=new GatewayMaintenance(root,stream);const actions={inspect:async()=>{inspects++;return {safe:true};},refresh:async()=>({}),restore:async()=>{restores++;return {restored:true};}};
 try{await care.select({sourceId:'account',model:'qoder/test'});care.start('还原指定接入',transport,actions,true);await expect.poll(()=>care.snapshot().status).toBe('completed');expect(restores).toBe(1);
 care.start('刚才还原的是哪个配置？',transport,actions);await expect.poll(()=>care.snapshot().status).toBe('completed');expect(restores).toBe(1);expect(inspects).toBe(2);expect(JSON.stringify(contexts.at(-1))).toContain('还原指定接入');expect(care.snapshot().engine).toBe('pi');expect(care.snapshot().messages.some(m=>m.text.includes('本次任务未授权修改配置'))).toBe(true);expect(JSON.stringify(care.snapshot())).not.toContain('private-fixture-key');care.reset();expect(care.snapshot().messages).toEqual([]);
 }finally{await care.close();await rm(root,{recursive:true,force:true});}
});
it('redacts provider failures and caps an endless tool loop',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-limits-'));let turns=0;
 const care=new GatewayMaintenance(root,()=>++turns===1?answer([],true):answer([{type:'toolCall',id:`call${turns}`,name:'inspect_gateway',arguments:{}}]));
 const actions={inspect:async()=>({}),refresh:async()=>({}),restore:async()=>({})};
 try{await care.select({sourceId:'account',model:'qoder/test'});care.start('检查',transport,actions);await expect.poll(()=>care.snapshot().status).toBe('failed');expect(JSON.stringify(care.snapshot())).not.toContain('private-fixture-key');care.start('循环检查',transport,actions);await expect.poll(()=>care.snapshot().status).toBe('failed');expect(turns).toBe(9);expect(care.snapshot().messages.at(-1)?.text).toContain('上限');}finally{await care.close();await rm(root,{recursive:true,force:true});}
});
it('stops during preflight without starting a late model request, and blocks overlapping runs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-stop-'));let calls=0;let release!:()=>void;const pending=new Promise<void>(r=>release=r);
 const care=new GatewayMaintenance(root,()=>{calls++;return answer([{type:'text',text:'OK'}]);});const actions={inspect:async()=>{await pending;return {};},refresh:async()=>({}),restore:async()=>({})};
 try{await care.select({sourceId:'account',model:'qoder/test'});care.start('检查',transport,actions);expect(()=>care.start('重叠请求',transport,actions)).toThrow('上一条');const closed=care.close();release();await closed;expect(calls).toBe(0);expect(care.snapshot().status).toBe('failed');care.reset();expect(care.snapshot().status).toBe('idle');}finally{release();await care.close();await rm(root,{recursive:true,force:true});}
});

it('probes Responses without repair tools, rejects empty success, and does not persist readiness across startup',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-check-'));let calls=0;
 const care=new GatewayMaintenance(root,(_m,context,options)=>{calls++;expect(JSON.stringify(context)).not.toContain('inspect_gateway');expect(options?.maxTokens).toBe(1024);return answer(calls===1?[]:[{type:'text',text:'OK'}]);});
 try{await care.select({sourceId:'account',model:'qoder/test'});expect(care.check(transport).readiness.status).toBe('checking');expect(()=>care.check(transport)).toThrow('正在');await expect.poll(()=>care.snapshot().readiness.status).toBe('failed');expect(care.snapshot().readiness.message).toContain('完整响应');care.check(transport);await expect.poll(()=>care.snapshot().readiness.status).toBe('ready');expect(calls).toBe(2);expect(care.snapshot().messages).toEqual([]);const reopened=new GatewayMaintenance(root);await reopened.load();expect(reopened.snapshot().selection?.model).toBe('qoder/test');expect(reopened.snapshot().readiness.status).toBe('unchecked');}finally{await care.close();await rm(root,{recursive:true,force:true});}
});
it('classifies upstream failures without exposing secrets and starts fresh after a failed turn',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-retry-'));let turns=0;
 const care=new GatewayMaintenance(root,(_m,context)=>{if(++turns===1)throw new Error('403 private-fixture-key provider body');expect(JSON.stringify(context)).not.toContain('first broken prompt');return answer([{type:'text',text:'OK'}]);});
 const actions={inspect:async()=>({}),refresh:async()=>({}),restore:async()=>({})};
 try{await care.select({sourceId:'account',model:'qoder/test'});care.start('first broken prompt',transport,actions);await expect.poll(()=>care.snapshot().status).toBe('failed');expect(care.snapshot().readiness.message).toContain('403');expect(JSON.stringify(care.snapshot())).not.toContain('private-fixture-key');care.start('new inspection',transport,actions);await expect.poll(()=>care.snapshot().status).toBe('completed');expect(turns).toBe(2);}finally{await care.close();await rm(root,{recursive:true,force:true});}
});

it('lets Pi recover from a failed preflight and failed tool, and clears context when switching A2A chains',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-chain-'));let turns=0,inspects=0;
 const first={target:'workbuddy' as const,sourceId:'source-one',model:'qoder/one'};const second={target:'claude' as const,sourceId:'source-two',model:'codex/two'};
 const care=new GatewayMaintenance(root,(_model,context)=>{
  turns++;const text=JSON.stringify(context);
  if(turns===1){expect(text).toContain('inspectionFailed');expect(text).toContain('qoder/one');return answer([{type:'toolCall',id:'refresh',name:'refresh_gateway',arguments:{}}]);}
  if(turns===2){expect(text).toContain('refresh failed');return answer([{type:'toolCall',id:'inspect',name:'inspect_gateway',arguments:{}}]);}
  if(turns===3){expect(text).toContain('recovered');return answer([{type:'text',text:'已重新检查链路'}]);}
  expect(text).toContain('codex/two');expect(text).not.toContain('qoder/one');return answer([{type:'text',text:'已检查新链路'}]);
 });
 const actions={inspect:async()=>{if(++inspects===1)throw new Error('offline');return {recovered:true};},refresh:async()=>{throw new Error('refresh failed');},restore:async()=>({})};
 try{await care.select({sourceId:'repair',model:'qoder/test'});care.start('自动诊断',transport,actions,false,first);await expect.poll(()=>care.snapshot().status).toBe('completed');expect(turns).toBe(3);expect(care.snapshot().chain).toEqual(first);care.start('自动诊断另一条',transport,actions,false,second);await expect.poll(()=>care.snapshot().status).toBe('completed');expect(turns).toBe(4);expect(care.snapshot().chain).toEqual(second);}finally{await care.close();await rm(root,{recursive:true,force:true});}
});

it('reviews exact proposal IDs with the selected approval model and no tools',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-approval-'));let wrong=false;const proposal={id:randomUUID(),code:'bounded repair'};
 const care=new GatewayMaintenance(root,(model,context)=>{expect(model.id).toBe('codex/approver');expect(JSON.stringify(context)).not.toContain('inspect_gateway');return answer([{type:'text',text:JSON.stringify({id:wrong?'wrong':proposal.id,decision:'approve',reason:'checked'})}]);});
 try{const result=await care.reviewProposal(proposal,{sourceId:'approver',model:'codex/approver'},transport);expect(result.reviewer).toBe('codex/approver');wrong=true;await expect(care.reviewProposal(proposal,{sourceId:'approver',model:'codex/approver'},transport)).rejects.toThrow();}finally{await care.close();await rm(root,{recursive:true,force:true});}
});
it('lets the real Pi loop compose bounded local diagnostics and prepare an upgrade without executing it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-local-care-'));let turns=0,diagnoses=0,plans=0;
 const care=new GatewayMaintenance(root,(_model,context)=>{
  if(++turns===1)return answer([{type:'toolCall',id:'local',name:'diagnose_local',arguments:{check:'processes',target:'codex'}}]);
  if(turns===2){expect(JSON.stringify(context)).toContain('local-process-evidence');return answer([{type:'toolCall',id:'upgrade',name:'prepare_upgrade',arguments:{}}]);}
  expect(JSON.stringify(context)).toContain('manual-confirmation-required');return answer([{type:'text',text:'已取得证据，升级需要人工确认'}]);
 });
 try{await care.select({sourceId:'repair',model:'qoder/test'});care.start('诊断并准备升级',transport,{inspect:async()=>({}),refresh:async()=>({}),restore:async()=>({}),diagnose:async(input,signal)=>{expect(input.target).toBe('codex');expect(signal.aborted).toBe(false);diagnoses++;return {evidence:'local-process-evidence'};},upgrade:async()=>{plans++;return {status:'manual-confirmation-required'};}});await expect.poll(()=>care.snapshot().status).toBe('completed');expect(diagnoses).toBe(1);expect(plans).toBe(1);expect(care.snapshot().messages.some(m=>m.role==='tool'&&m.text.includes('diagnose_local'))).toBe(true);
 }finally{await care.close();await rm(root,{recursive:true,force:true});}
});
it('keeps the P1 model file readable, preserves explicit channel across restart and blocks mismatched channel data',async()=>{
 const {readFile,writeFile}=await import('node:fs/promises');const root=await mkdtemp(join(tmpdir(),'pi-channel-'));const care=new GatewayMaintenance(root);
 try{await care.select({sourceId:'api-source',model:'api/model',channel:'direct'});expect(JSON.parse(await readFile(join(root,'maintenance-model.json'),'utf8'))).toEqual({sourceId:'api-source',model:'api/model'});
 const reopened=new GatewayMaintenance(root);await reopened.load();expect(reopened.snapshot().selection?.channel).toBe('direct');await reopened.close();
 await writeFile(join(root,'maintenance-model.json'),JSON.stringify({sourceId:'other',model:'other/model'}));const interrupted=new GatewayMaintenance(root);await interrupted.load();expect(interrupted.snapshot().selection).toBeUndefined();expect(interrupted.snapshot().channelWarning).toContain('未调用模型或自动切换');await interrupted.close();
 }finally{await care.close();await rm(root,{recursive:true,force:true});}
});

it('clears direct selection without losing completed dialogue and refuses to clear while checking or running',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-clear-'));let release!:()=>void;let held=false;const pending=new Promise<void>(r=>release=r);
 const care=new GatewayMaintenance(root,async()=>{if(held)await pending;return answer([{type:'text',text:'已完成检查'}]);});
 const actions={inspect:async()=>({}),refresh:async()=>({}),restore:async()=>({})};
 try{
  await care.select({sourceId:'account',model:'qoder/test',channel:'direct'});care.start('保留历史',transport,actions,false,{target:'codex',sourceId:'account',model:'qoder/test'});await care.settled();const before=care.snapshot();
  held=true;care.check(transport);await expect(care.clearSelection()).rejects.toMatchObject({statusCode:409});release();await care.settled();held=false;
  const cleared=await care.clearSelection();expect(cleared.selection).toBeUndefined();expect(cleared.messages).toEqual(before.messages);expect(cleared.chain).toEqual(before.chain);
  const reopened=new GatewayMaintenance(root);await reopened.load();expect(reopened.snapshot().selection).toBeUndefined();await reopened.close();
  await care.select({sourceId:'account',model:'qoder/test'});let finish!:()=>void;const inspect=new Promise<void>(r=>finish=r);care.start('运行中',transport,{...actions,inspect:async()=>{await inspect;return {};}});await expect(care.clearSelection()).rejects.toMatchObject({statusCode:409});finish();await care.settled();
 }finally{release();await care.close();await rm(root,{recursive:true,force:true});}
});

it('lets the repair model inspect all Agent choices and propose a concrete routing change without executing it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-agent-config-'));let turns=0;let proposal:unknown;
 const care=new GatewayMaintenance(root,(_model,context)=>{
  if(++turns===1)return answer([{type:'toolCall',id:'choices',name:'inspect_agent_configurations',arguments:{}}]);
  if(turns===2){expect(JSON.stringify(context)).toContain('saved-source');return answer([{type:'toolCall',id:'configure',name:'propose_agent_configuration',arguments:{target:'qoder',sourceId:'saved-source',model:'codex/test'}}]);}
  expect(JSON.stringify(context)).toContain('pending');return answer([{type:'text',text:'已生成 Qoder 接口、Key 和模型的修改方案，等待确认。'}]);
 });
 try{
  await care.select({sourceId:'repair',model:'codex/test'});
  care.start('请修改 Qoder 的接口、Key 和模型配置',transport,{inspect:async()=>({}),refresh:async()=>({}),restore:async()=>({}),configurations:async()=>({targets:['codex','claude','workbuddy','qoder'],sources:[{sourceId:'saved-source',models:['codex/test']}]}),configure:async input=>{proposal=input;return {status:'pending'};}});
  await care.settled();expect(care.snapshot().status).toBe('completed');expect(proposal).toEqual({target:'qoder',sourceId:'saved-source',model:'codex/test'});
 }finally{await care.close();await rm(root,{recursive:true,force:true});}
});
