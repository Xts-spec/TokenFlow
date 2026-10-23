import {Thinking} from './LoadingState';
import { useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import {createPortal} from 'react-dom';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import { modelGroups, type Choice, type ModelSourceGroup } from './flow-model';
import { qualifiedModelLabel as modelLabel } from './model-label';
import {DragHandle,dropOrder,compareNames,ModelOrderControl,orderModels,useModelOrder} from './display-order';
import { Icon } from './Icons';
import { ProviderIcon } from './ProviderIcon';
import { QuotaDetails } from './QuotaDetails';
import {useDialogDismiss} from './dialog-dismiss';

const same=(a:Choice|undefined,b:Choice)=>!!a&&a.sourceId===b.sourceId&&a.model===b.model;
const quotaText=(group:ModelSourceGroup)=>group.quota?.status==='error'?'额度查询失败':group.remaining===null?'额度暂未提供':`剩余 ${Math.round(group.remaining)}%`;

export function ModelPicker({open,title,local,current,recent=[],isDisabled,onPick,onClose,selected,onConfirm,allowEmpty=false,confirmLabel='应用所选模型',embedded=false,busy=false,error='',closeOnConfirm=true,inlineSelection=false,onSelectionChange,beforeSearch,afterModels}:{afterModels?:ReactNode;beforeSearch?:ReactNode;inlineSelection?:boolean;onSelectionChange?:(choices:Choice[])=>void;open:boolean;title:string;local:LocalAgentSnapshot;current?:Choice;recent?:Choice[];isDisabled?:(choice:Choice)=>boolean;onPick?:(choice:Choice)=>void;onClose:()=>void;selected?:Choice[];onConfirm?:(choices:Choice[])=>void;allowEmpty?:boolean;confirmLabel?:string;embedded?:boolean;busy?:boolean;error?:string;closeOnConfirm?:boolean}){
 const dismiss=useDialogDismiss(onClose,busy);
 const [modelOrder,setModelOrder,modelRanks,moveModel]=useModelOrder();
 const dialog=useRef<HTMLDialogElement>(null);const [query,setQuery]=useState('');
 const [draft,setDraft]=useState<Choice[]>([]);const multiple=!!onConfirm||!!onSelectionChange;
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const pickerId=useId();
 useLayoutEffect(()=>{if(!open)return;setQuery('');setExpanded({});setDraft(selected??[]);if(embedded)return;const node=dialog.current;if(!node)return;const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;node.showModal();return()=>{if(node.open)node.close();if(opener?.isConnected)opener.focus({preventScroll:true});};},[open,embedded]);
 const q=query.trim().toLowerCase();
 const allGroups=modelGroups(local).sort((a,b)=>Number(b.provider==='api')-Number(a.provider==='api')||compareNames(a.label,b.label));
 const available=(choice:Choice)=>allGroups.some(group=>group.id===choice.sourceId&&group.models.some(model=>model.id===choice.model));
 const matches=(group:ModelSourceGroup,id:string)=>!q||`${group.label} ${group.providerLabel} ${id} ${modelLabel(local,id)}`.toLowerCase().includes(q);
 const groups=allGroups.map(group=>({...group,models:orderModels(group.models.filter(model=>matches(group,model.id)),model=>model.label,modelOrder,modelRanks)})).filter(group=>group.models.length);
 const visibleByGroup=new Map(groups.map(group=>[group.id,group.models.map(model=>model.id)]));
 const shownRecent=orderModels(recent.flatMap(choice=>{const group=allGroups.find(g=>g.id===choice.sourceId&&g.models.some(m=>m.id===choice.model));return group&&matches(group,choice.model)?[{choice,group}]:[];}).slice(0,6),item=>modelLabel(local,item.choice.model),modelOrder,modelRanks,item=>item.choice.model);
 const row=(choice:Choice,label:string,group:ModelSourceGroup,recent=false)=>{
  const on=multiple?draft.some(item=>same(item,choice)):same(current,choice);
  const duplicate=multiple&&draft.some(item=>item.model===choice.model&&!same(item,choice));
  const displayLabel=!recent&&label.startsWith(`${group.provider}/`)?label.slice(group.provider.length+1):label;
  const description=`${pickerId}-${recent?'recent':'source'}-${encodeURIComponent(`${choice.sourceId}/${choice.model}`)}`;
  const visible=recent?shownRecent.map(item=>item.choice.model):visibleByGroup.get(group.id)??[];
  return <div key={`${choice.sourceId}/${choice.model}`} className="tfPickDraggableRow tfDragRow" {...dropOrder('models',choice.model,visible,moveModel)}>{<DragHandle kind="models" id={choice.model} label={label} items={visible} move={moveModel}/>}<button type="button" className={`tfPickRow ${recent?'':'tfPickModel'} ${on?'on':''}`} aria-label={label} aria-describedby={description} aria-pressed={on} disabled={busy||duplicate||isDisabled?.(choice)} title={duplicate?'此模型已选择其他来源账号，请先取消原选择':undefined} onClick={()=>{if(multiple){const next=on?draft.filter(item=>!same(item,choice)):[...draft,choice];setDraft(next);onSelectionChange?.(next);}else{onPick?.(choice);onClose();}}}>
   {recent&&<ProviderIcon provider={group.provider} size={24}/>}
   <span className="tfPickRowText"><strong title={choice.model}>{displayLabel}</strong>{recent&&<small title={`${group.providerLabel} · ${group.accountLabel}`}>{group.providerLabel} · {group.accountLabel}</small>}</span>
   {recent&&<span className={`tfPickQuota ${group.remaining!==null?'known':''} ${group.remaining!==null&&group.remaining<=10?'low':''} ${group.quota?.status==='error'?'failed':''}`}><b>{quotaText(group)}</b><small>{on?(multiple?'已选择':'使用中'):'账号额度'}</small></span>}
   <span id={description} className="srOnly">{group.providerLabel}，{group.accountLabel}，{quotaText(group)}{on?(multiple?'，已选择':'，使用中'):''}{duplicate?'，已选择其他来源账号':''}</span>
   {multiple?<span className={`tfPickCheck ${on?'on':''}`} aria-hidden="true">{on?'✓':''}</span>:<Icon name="arrow" size={14}/>}
  </button></div>;
 };
 const nativeMac=(window as Window&{desktop?:{platform:string}}).desktop?.platform==='darwin';
 const content=<>
  {!inlineSelection&&<header>{embedded?<><button type="button" className="textButton tfPickerBack" disabled={busy} onClick={onClose}><Icon name="arrow" size={14}/>返回接入信息</button><h3>{title}</h3></>:<><h2>{title}</h2><button type="button" className="iconButton" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" size={16}/></button></>}</header>}
  {beforeSearch}
  <label className="tfSearch"><Icon name="search" size={15}/><input type="search" disabled={busy} autoFocus placeholder="搜索厂商、账号或模型" aria-label="搜索厂商、账号或模型" value={query} onChange={event=>{setQuery(event.target.value);setExpanded({});}}/></label>
  <div className="tfPickerOrder" inert={busy}><ModelOrderControl value={modelOrder} onChange={setModelOrder}/></div>
  <div className="tfPickBody" inert={busy}>
   {multiple&&draft.some(choice=>!available(choice))&&<section className="tfPickUnavailable"><h3>不可用的已选模型</h3><p className="tfHint">暂未确认这些模型的可用性，可保留并保存，也可选择移除。</p>{draft.filter(choice=>!available(choice)).map(choice=><button type="button" key={`${choice.sourceId}/${choice.model}`} onClick={()=>{const next=draft.filter(item=>!same(item,choice));setDraft(next);onSelectionChange?.(next);}}>移除 {modelLabel(local,choice.model)}</button>)}</section>}
   {shownRecent.length>0&&<section className="tfPickRecent"><h3>最近使用</h3><div className="tfPickOptions">{shownRecent.map(({choice,group})=>row(choice,modelLabel(local,choice.model),group,true))}</div></section>}
   {groups.map(group=>{
    const isOpen=expanded[group.id]??!!q;
    const count=multiple?draft.filter(choice=>choice.sourceId===group.id).length:current?.sourceId===group.id?1:0;
    const total=allGroups.find(item=>item.id===group.id)?.models.length??group.models.length;
    return <details key={group.id} className={`tfPickSource ${count?'hasSelection':''}`} aria-label={group.label} open={isOpen}>
     <summary aria-expanded={isOpen} onClick={event=>{event.preventDefault();setExpanded(items=>({...items,[group.id]:!isOpen}));}}>
      <ProviderIcon provider={group.provider} size={32}/>
      <span className="tfPickSourceText"><strong>{embedded&&group.provider==='api'?group.accountLabel:group.providerLabel}</strong><span title={group.accountLabel}>{embedded&&group.provider==='api'?'API 接口':group.accountLabel}</span><small>支持 {total} 个模型{count>0&&<b> · 已选 {count} 个</b>}</small></span>
      {(!embedded||group.provider!=='api')&&<span className={`tfPickQuota ${group.remaining!==null?'known':''} ${group.remaining!==null&&group.remaining<=10?'low':''} ${group.quota?.status==='error'?'failed':''}`}><b>{quotaText(group)}</b><small>账号共享额度</small></span>}
      <Icon name="chevron" size={16}/>
     </summary>
     <div className="tfPickSourceBody" id={`${pickerId}-models-${group.id}`}>
      <p className="tfPickModelHint">{q?`匹配 ${group.models.length} / ${total} 个模型`:'支持的模型'}<span>{inlineSelection?'随 Key 一起保存':multiple?'勾选后统一应用':'点击模型使用'}</span></p>
      <div className="tfPickOptions">{group.models.map(model=>row({sourceId:group.id,model:model.id},model.label,group))}</div>
      {group.quota&&<details className="tfPickQuotaDetails"><summary>账号额度详情</summary><QuotaDetails quota={group.quota} label={group.accountLabel} compact/></details>}
     </div>
    </details>;
   })}
   {!groups.length&&<p className="tfHint">{q?'没有匹配的模型。':'还没有可用模型，先在「账号授权」或「API 接口」添加。'}</p>}
  </div>
  {afterModels}
  {error&&<p className="tfError tfPickerError" role="alert">{error}</p>}
  {multiple&&!inlineSelection&&<footer className="tfPickerFooter"><span aria-live="polite">{allowEmpty&&!draft.length?'未选择模型，保存后此 Key 将无法调用模型':`已选择 ${draft.length} 个模型`}</span><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy||!allowEmpty&&!draft.length} onClick={()=>{onConfirm?.(draft);if(closeOnConfirm)onClose();}}>{open&&busy&&<Thinking label="正在保存模型权限"/>}{busy?'正在保存…':confirmLabel}</button></footer>}
 </>;
 if(embedded)return open?<section className="tfPicker tfInlinePicker" aria-label={title} aria-busy={busy}>{content}</section>:null;
 return createPortal(<dialog ref={dialog} className={`tfPicker ${nativeMac?'tfNativeMacDialog':''}`} aria-label={title} aria-busy={busy} onClose={event=>{if(event.target===dialog.current&&!busy)onClose();}} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} {...dismiss}>{content}</dialog>,document.body);
}
