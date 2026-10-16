import {useState} from 'react';
import {FlowDialog} from './FlowDialog';
import {requestJSON} from './request';
import type {ClaudeTerminalSession} from '../../../packages/core/src/claude-terminal-lifecycle';
import type {Notify} from './notify';
export function ClaudeRestartControls({notify,disabled=false}:{notify:Notify;disabled?:boolean}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [sessions,setSessions]=useState<ClaudeTerminalSession[]>([]),[selected,setSelected]=useState(''),[vscode,setVscode]=useState(false),[canIDE,setCanIDE]=useState(false);
 const load=async()=>{setOpen(true);setBusy(true);setError('');try{const data=await requestJSON<{sessions:ClaudeTerminalSession[];canRestartIDE:boolean}>('/api/a2a/terminal-sessions?target=claude');setSessions(data.sessions);setSelected(data.sessions.length===1?String(data.sessions[0].pid):'');setCanIDE(data.canRestartIDE);}catch(e){setError(e instanceof Error?e.message:'无法读取终端');}finally{setBusy(false);}};
 const restart=async()=>{setBusy(true);setError('');try{const session=sessions.find(s=>String(s.pid)===selected);const result=await requestJSON<{message:string}>('/api/a2a/restart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target:'claude',client:vscode?'vscode':'terminal',...(!vscode&&session?{session}:{})})},90000);notify({kind:'ok',text:result.message});setOpen(false);}catch(e){setError(e instanceof Error?e.message:'重启未完成');}finally{setBusy(false);}};
 return <><button disabled={disabled||busy} onClick={()=>void load()}>打开 / 重启 Claude Code</button><FlowDialog open={open} title="加载 Claude Code 新配置" busy={busy} onClose={()=>setOpen(false)}>
  <p>请先保存工作并结束正在运行的任务。只处理所选 Claude Code 会话；打开后可从续聊列表选择原对话。</p>
  {canIDE&&<label><input type="checkbox" checked={vscode} onChange={e=>setVscode(e.target.checked)}/>重新打开 VS Code（会关闭它的所有窗口）</label>}
  {!vscode&&sessions.length>0&&<label>终端会话<select aria-label="Claude Code 终端会话" value={selected} onChange={e=>setSelected(e.target.value)}><option value="">选择要重新打开的会话</option>{sessions.map(s=><option key={s.pid} value={s.pid}>{s.cwd} · {s.tty}</option>)}</select></label>}
  {!vscode&&!sessions.length&&<p className="tfHint">未找到可安全自动关闭的终端。请先在原窗口退出 Claude Code，再点“打开终端”。Windows 终端和 IDE 任务需要手动退出。</p>}
  {error&&<p className="tfError" role="alert">{error}</p>}
  <footer><button disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="primary" disabled={busy||!vscode&&sessions.length>0&&!selected} onClick={()=>void restart()}>{vscode||sessions.length?'重新打开':'打开终端'}</button></footer>
 </FlowDialog></>;
}
