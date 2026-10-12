import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

const stateNames:Record<string,string>={stopped:'已停止',starting:'启动中',running:'运行中',stopping:'停止中',failed:'启动失败'};

export function SettingsPane({local,disabled,onAction}:{local:LocalAgentSnapshot;disabled:boolean;onAction:(action:string)=>Promise<void>}){
 const switching=disabled||['starting','stopping'].includes(local.state);
 return <div className="tfPage narrow">
  <header className="tfPageHead"><h1>设置</h1></header>
  <section className="tfPanel" aria-label="网关">
   <header className="tfPanelHead"><div><h2>网关</h2><p><i className={`dot ${local.state==='running'?'ok':''}`}/> {stateNames[local.state]??local.state} · 端口 {local.port}</p></div></header>
   {local.lastError&&<p className="tfError" role="alert">{local.lastError}</p>}
   <div className="tfRow">
    <button disabled={switching||local.state==='running'} onClick={()=>void onAction('start')}>启动</button>
    <button disabled={switching||local.state!=='running'} onClick={()=>void onAction('stop')}>停止</button>
    <button disabled={switching} onClick={()=>void onAction('restart')}>重启</button>
    <button disabled={switching||local.state!=='running'||local.quotaBusy} onClick={()=>void onAction('quota')}>{local.quotaBusy?'额度更新中…':'刷新额度'}</button>
   </div>
   <details><summary>运行日志</summary><pre className="logs">{local.logs.join('\n')||'等待网关启动。'}</pre></details>
  </section>
  <section className="tfPanel" aria-label="关于">
   <header className="tfPanelHead"><div><h2>关于</h2></div></header>
   <p>token-flow · 让你的模型，流向每个 Agent。</p>
   <p className="tfHint">集中管理模型账号和 API，跨来源选择模型，接入 Codex、Claude Code、WorkBuddy 和 Qoder；为其他应用创建独立 Key，查看用量并维修接入配置。</p>
   <p className="tfHint"><a href="https://github.com/haruinia/token-flow/blob/main/docs/usage.md" target="_blank" rel="noreferrer">使用指南 ↗</a> · <a href="https://github.com/haruinia/token-flow/blob/main/docs/product.md" target="_blank" rel="noreferrer">功能与优化说明 ↗</a></p>
   <p className="tfHint"><a href="https://github.com/haruinia/token-flow/issues" target="_blank" rel="noreferrer">在 GitHub 提交反馈 ↗</a> 请勿附上账号凭据或 API Key。</p>
  </section>
 </div>;
}
