import { apiModelRoute, isLocalHttpHost, type RoutedApiSource } from '../../shared/api-endpoint';
// An API source needs three things from the user. The protocol is found by the server.
export const protocolNames={responses:'Responses',chat:'Chat Completions',messages:'Anthropic Messages'} as const;
export type SourceDraft={name:string;baseURL:string;apiKey:string;model:string};
export type DraftErrors=Partial<Record<keyof SourceDraft,string>>;

export const parseModels=(value:string)=>[...new Set(value.split(/[\n,，]/).map(s=>s.trim()).filter(Boolean))];

/** Format checks only; nothing is sent until these pass. Mirrors the server's validateQuickSource. */
export function validateDraft(draft:SourceDraft,editing:boolean):DraftErrors{
 const errors:DraftErrors={};
 const name=draft.name.trim();
 if(!name)errors.name='请填写便于识别的名称。';
 else if(name.length>80||/[\x00-\x1f\x7f]/.test(name))errors.name='名称不能超过 80 个字符或包含控制字符。';
 try{
  const url=new URL(draft.baseURL.trim());
  if(url.username||url.password||url.search||url.hash)errors.baseURL='地址中不能包含账号、密码、参数或 #。';
  else if(url.protocol!=='https:'&&!(url.protocol==='http:'&&isLocalHttpHost(url.hostname)))errors.baseURL='请使用 HTTPS 地址（本机或局域网地址可用 HTTP）。';
 }catch{errors.baseURL='请输入完整地址，例如 https://api.example.com/v1';}
 const key=draft.apiKey.trim();
 if(!key){if(!editing)errors.apiKey='请填写 API Key。';}
 else if(key.length>4096||/\s/.test(key))errors.apiKey='API Key 不能包含空格或换行。';
 const models=parseModels(draft.model);
 if(!models.length)errors.model='请填写模型名称。';
 else if(models.length>50||models.some(m=>m.length>200||/[\x00-\x1f\x7f]/.test(m)))errors.model='模型名称格式不正确。';
 return errors;
}

export function sourceProtocolLabel(source:RoutedApiSource&{models:string[]}){
 const protocols=new Set(source.models.map(model=>apiModelRoute(source,model).protocol));
 return protocols.size>1?'按模型路由':protocolNames[protocols.values().next().value??source.protocol];
}
