import type {ReactNode} from 'react';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import type {UsageData} from './usage-data';
import {ProviderIcon} from './ProviderIcon';
import {NativeLoginStatus} from './NativeLoginStatus';
import {useNativeLogin} from './native-login';
import {UsageFold} from './UsagePanel';
import {AgentUsageDetails} from './AgentUsageDetails';
import {localDay} from './usage-model';

export function QoderIdePanel({clientSwitch,local,usage}:{clientSwitch:ReactNode;local:LocalAgentSnapshot;usage:UsageData}){
 const login=useNativeLogin('qoder-ide',local);
 const rows=usage.allRows.filter(row=>row.day===localDay(new Date())&&row.target==='qoder-ide');
 return <section className="tfPanel" aria-label="Qoder IDE">
  <header className="tfPanelHead"><ProviderIcon provider="qoder" size={40}/><div><div className="tfAgentTitle"><h2>Qoder IDE</h2>{clientSwitch}</div><UsageFold title="Qoder IDE 用量" rows={rows} range="today" loaded={usage.loaded} error={usage.error} onRetry={usage.reload}/></div></header>
  <NativeLoginStatus name="Qoder IDE" login={login}>{login.nativeLabel&&<span>本机登录 · {login.nativeLabel}</span>}</NativeLoginStatus>
  <p className="tfHint">与 Qoder 共用授权账号池；此页仅统计本机 Qoder IDE，账号授权页合并同一账号在各客户端的已采集消费。</p>
  <AgentUsageDetails target="qoder-ide" local={local} usage={usage} open/>
 </section>;
}
