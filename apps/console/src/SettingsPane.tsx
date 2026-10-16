import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import packageInfo from '../../../package.json';
import {PROJECT_LINKS} from '../../shared/project-links';
import {useState} from 'react';
import {copyText} from './clipboard';
import {gatewayDiagnostics} from './gateway-diagnostics';
import {loginStageLabels} from '../../../packages/core/src/login/diagnostics';

const stateNames:Record<string,string>={stopped:'已停止',starting:'启动中',running:'运行中',stopping:'停止中',failed:'启动失败'};

export function SettingsPane({local,disabled,onAction,theme,onTheme}:{local:LocalAgentSnapshot;disabled:boolean;onAction:(action:string)=>Promise<void>;theme:'dark'|'light';onTheme:(theme:'dark'|'light')=>void}){
 const switching=disabled||['starting','stopping'].includes(local.state);
 const [copyStatus,setCopyStatus]=useState('');
 const [checking,setChecking]=useState(false);
 const checkNetwork=async()=>{setChecking(true);try{await onAction('network-check');}finally{setChecking(false);}};
 const copyDiagnostics=async()=>{try{await copyText(JSON.stringify(gatewayDiagnostics(local,packageInfo.build.buildVersion,(window as Window&{desktop?:{platform:string}}).desktop?.platform??navigator.platform),null,2));setCopyStatus('诊断信息已复制，可发给协助排查的人。');}catch{setCopyStatus('复制失败，请选中下方运行日志手动复制。');}};
 return <div className="tfPage tfSettingsPage">
  <header className="tfPageHead"><h1>设置</h1></header>
  <section className="tfPanel tfAppearance" aria-label="外观设置"><header className="tfPanelHead"><div><h2>外观</h2><p>选择适合当前环境的界面。默认使用深色。</p></div></header><div className="tfAppearanceOptions" role="group" aria-label="界面主题">{(['dark','light'] as const).map(value=><button type="button" key={value} aria-pressed={theme===value} aria-label={value==='dark'?'深色外观':'浅色外观'} onClick={()=>onTheme(value)}><span className={`tfThemePreview ${value}`} aria-hidden="true"><i/><span><b/><b/><b/></span></span><strong>{value==='dark'?'石墨深色':'清晰浅色'}</strong><small>{theme===value?'当前使用':value==='dark'?'默认外观':'适合明亮环境'}</small></button>)}</div></section>
  <section className="tfPanel" aria-label="网关">
   <header className="tfPanelHead"><div><h2>网关</h2><p><i className={`dot ${local.state==='running'?'ok':''}`}/> {stateNames[local.state]??local.state} · 端口 {local.port}</p></div></header>
   {local.lastError&&<p className="tfError" role="alert">{local.lastError}</p>}
   <p className="tfHint">“运行中”表示本机网关已启动；外部授权、模型和额度连接结果请看下方诊断。</p>
   {local.network&&<p className="tfHint">出站网络：{({system:'跟随系统代理（按网站应用代理规则）',environment:'使用启动环境中的代理设置',direct:'直接连接'} as const)[local.network.mode]}。本机界面与授权回调直连。</p>}
   <p className="tfHint">路由记录显示应用层设置；TUN／Proxifier 的接管由系统负责。</p>
   {local.login?.diagnostic&&<p className="tfWarn">最近授权诊断：{loginStageLabels[local.login.diagnostic.stage]} · {local.login.diagnostic.reason}（{local.login.diagnostic.code}）</p>}
   <div className="tfRow">
    <button disabled={switching||local.state==='running'} onClick={()=>void onAction('start')}>启动</button>
    <button disabled={switching||local.state!=='running'} onClick={()=>void onAction('stop')}>停止</button>
    <button disabled={switching} onClick={()=>void onAction('restart')}>重启</button>
    <button disabled={switching||local.state!=='running'||local.quotaBusy} onClick={()=>void onAction('quota')}>{local.quotaBusy?'额度更新中…':'刷新额度'}</button>
    <button onClick={()=>void copyDiagnostics()}>复制诊断信息</button>
    <button disabled={disabled||checking} onClick={()=>void checkNetwork()}>{checking?'正在检查网络…':'检查网络'}</button>
   </div>
   {copyStatus&&<p className="tfHint" role="status">{copyStatus}</p>}
   <p className="tfHint">诊断包含版本、系统、授权阶段、出站路由和运行日志；不包含账号邮箱、授权链接或登录凭据。</p>
   {local.networkCheck&&<div aria-label="网络检查结果"><p className="tfHint">上次检查：{new Date(local.networkCheck.checkedAt).toLocaleString()}。HTTP 401/403 表示收到服务响应，账号授权情况需另行确认。</p><ul>{local.networkCheck.results.map(result=><li key={`${result.target}-${result.via}`} className={result.reachable?'tfHint':'tfWarn'}>{result.target} · {result.via==='local'?'本机':result.via==='app'?'应用出站':'网关出站'}：{result.reachable?'已响应':'未连通'}{result.httpStatus?` HTTP ${result.httpStatus}`:''} · {result.elapsedMs}ms{!result.reachable?` · ${result.message}（${result.code}）`:''}</li>)}</ul></div>}
   {!!local.network?.routes.length&&<details><summary>最近出站尝试</summary><ul>{local.network.routes.slice(-8).map((route,index)=><li key={`${route.at}-${index}`}>{route.host} · {route.route==='direct'?'直连':route.route==='system_proxy'?'系统代理':'环境代理'}{route.protocol?` · ${route.protocol}`:''}{route.error?` · ${route.error}`:''}</li>)}</ul></details>}
   <details><summary>运行日志</summary><pre className="logs">{local.logs.join('\n')||'等待网关启动。'}</pre></details>
  </section>
  <section className="tfPanel" aria-label="关于">
   <header className="tfPanelHead"><div><h2>关于</h2></div></header>
   <p>TokenFlow · 让你的模型，流向每个 Agent。</p>
   <p className="tfHint">当前版本：v{packageInfo.build.buildVersion}</p>
   <p className="tfHint">集中管理多平台账号与 API 接口，查看模型、额度和用量。支持本地 Agent 的官方账号切换、模型配置及备份恢复；按平台通过 SDK、CLI 对接模型来源。也可通过 API 代理创建独立 Key，供其他应用按授权使用模型。</p>
   <p className="tfHint"><a href={PROJECT_LINKS.guide} target="_blank" rel="noreferrer">使用指南 ↗</a> · <a href={PROJECT_LINKS.home} target="_blank" rel="noreferrer">项目介绍 ↗</a></p>
   <p className="tfHint"><a href={PROJECT_LINKS.feedback} target="_blank" rel="noreferrer">在 GitHub 提交反馈 ↗</a> 请勿附上账号凭据或 API Key。</p>
  </section>
 </div>;
}
