import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import packageInfo from '../../../package.json';

const stateNames:Record<string,string>={stopped:'已停止',starting:'启动中',running:'运行中',stopping:'停止中',failed:'启动失败'};

export function SettingsPane({local,disabled,onAction,theme,onTheme}:{local:LocalAgentSnapshot;disabled:boolean;onAction:(action:string)=>Promise<void>;theme:'dark'|'light';onTheme:(theme:'dark'|'light')=>void}){
 const switching=disabled||['starting','stopping'].includes(local.state);
 return <div className="tfPage tfSettingsPage">
  <header className="tfPageHead"><h1>设置</h1></header>
  <section className="tfPanel tfAppearance" aria-label="外观设置"><header className="tfPanelHead"><div><h2>外观</h2><p>选择适合当前环境的界面。默认使用深色。</p></div></header><div className="tfAppearanceOptions" role="group" aria-label="界面主题">{(['dark','light'] as const).map(value=><button type="button" key={value} aria-pressed={theme===value} aria-label={value==='dark'?'深色外观':'浅色外观'} onClick={()=>onTheme(value)}><span className={`tfThemePreview ${value}`} aria-hidden="true"><i/><span><b/><b/><b/></span></span><strong>{value==='dark'?'石墨深色':'清晰浅色'}</strong><small>{theme===value?'当前使用':value==='dark'?'默认外观':'适合明亮环境'}</small></button>)}</div></section>
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
   <p>TokenFlow · 让你的模型，流向每个 Agent。</p>
   <p className="tfHint">当前版本：v{packageInfo.build.buildVersion}</p>
   <p className="tfHint">管理 GPT / Codex 等多个账号与官方登录，查看 WorkBuddy、Qoder 等来源的模型和额度，再通过 CLI 代理接入日常 Agent；支持独立 Key、用量记录和配置恢复。</p>
   <p className="tfHint"><a href="https://github.com/haruinia/token-flow/blob/main/docs/usage.md" target="_blank" rel="noreferrer">使用指南 ↗</a> · <a href="https://github.com/haruinia/token-flow/blob/main/README.md" target="_blank" rel="noreferrer">项目介绍 ↗</a></p>
   <p className="tfHint"><a href="https://github.com/haruinia/token-flow/issues" target="_blank" rel="noreferrer">在 GitHub 提交反馈 ↗</a> 请勿附上账号凭据或 API Key。</p>
  </section>
 </div>;
}
