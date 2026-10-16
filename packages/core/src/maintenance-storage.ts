import {stat} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {AgentPaths} from './agent-connections.js';

/** Actual resolved paths, including legacy profiles and user overrides; no arbitrary file reader. */
export async function maintenanceStorage(root:string,paths:AgentPaths){
 const entries=[
  {id:'profile',path:root,purpose:'TokenFlow 当前实际资料目录；兼容旧目录名和自定义路径',tool:'read_page_data'},
  {id:'usage',path:join(root,'usage-ledger.json'),purpose:'网关逐日用量与流式计时',tool:'read_usage'},
  {id:'local-usage',path:join(root,'local-usage-index.json'),purpose:'本机历史用量索引',tool:'read_usage'},
  {id:'traces',path:join(root,'gateway-traces.json'),purpose:'网关请求耗时、状态与工具调用元数据',tool:'read_page_data'},
  {id:'account-evidence',path:join(root,'usage-account-evidence.json'),purpose:'请求账号归属证据；没有证据时保留未确认',tool:'read_usage'},
  {id:'agent-backups',path:join(root,'agent-backups'),purpose:'Agent 配置切换和备份',tool:'inspect_agent_configurations'},
  {id:'switches',path:join(root,'switch-failures.json'),purpose:'成功与失败切换日志；旧版本文件名沿用',tool:'inspect_codex_history'},
  {id:'repair-history',path:join(root,'maintenance-conversations.json'),purpose:'维修对话历史；通过界面选择继续',tool:'界面历史对话'},
  {id:'codex-migrations',path:join(root,'codex-thread-backups'),purpose:'旧对话迁移备份与路由清单',tool:'inspect_codex_history'},
  {id:'codex-sessions',path:join(dirname(paths.codex),'sessions'),purpose:'Codex 本机历史；工具仅读取路由与用量元数据',tool:'inspect_codex_history / read_usage'},
  {id:'codex-archived',path:join(dirname(paths.codex),'archived_sessions'),purpose:'Codex 已归档历史',tool:'inspect_codex_history / read_usage'},
  ...Object.entries(paths).map(([target,path])=>({id:`config-${target}`,path,purpose:`${target} 当前配置；工具仅返回脱敏摘要`,tool:'diagnose_local(configuration)'})),
 ];
 return {platform:process.platform,arch:process.arch,locations:await Promise.all(entries.map(async entry=>{try{const info=await stat(entry.path);return {...entry,exists:true,kind:info.isDirectory()?'directory':'file',bytes:info.isFile()?info.size:undefined,modifiedAt:info.mtime.toISOString()};}catch(error){return {...entry,exists:(error as NodeJS.ErrnoException).code==='ENOENT'?false:null,status:(error as NodeJS.ErrnoException).code==='ENOENT'?'尚未生成':'无法读取元数据'};}})),
  note:'路径来自当前运行配置，不按平台猜测。没有读取密钥、配置正文或旧对话正文。不存在的文件不表示功能损坏；需要内容请调用对应结构化只读工具。'};
}
