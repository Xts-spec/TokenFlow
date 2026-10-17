import {useEffect,useLayoutEffect,useRef,useState,useId} from 'react';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import {modelGroups,type Choice} from './flow-model';
import {qualifiedModelLabel as modelLabel} from './model-label';
import {compareNames,DragHandle,dropOrder,orderModels,useModelOrder} from './display-order';
import {modelManufacturer} from './UsagePanel';
import {ProviderIcon} from './ProviderIcon';
import {QuotaDetails} from './QuotaDetails';
import {FlowDialog} from './FlowDialog';
import {Icon} from './Icons';

const same=(a:Choice,b:Choice)=>a.sourceId===b.sourceId&&a.model===b.model;
export function AgentModelPicker({open,title,local,current,selected,onConfirm,onClose,embedded=false,busy=false,onSelectionChange}:{embedded?:boolean;busy?:boolean;onSelectionChange?:(choices:Choice[])=>void;open:boolean;title:string;local:LocalAgentSnapshot;current?:Choice;selected:Choice[];onConfirm:(choices:Choice[])=>void;onClose:()=>void}){
 const catalogId=useId();
 const [query,setQuery]=useState(''),[draft,setDraft]=useState<Choice[]>([]),[source,setSource]=useState('');
 const [order,,ranks,moveModel]=useModelOrder();const displayOrder=order==='manual'?'manual':'name';
 const search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null);
 const positions=useRef(new Map<string,number>());
 const all=modelGroups(local).sort((a,b)=>Number(b.provider==='api')-Number(a.provider==='api')||compareNames(a.label,b.label));
 useLayoutEffect(()=>{if(!open)return;setQuery('');setDraft(selected);setSource(current?.sourceId??selected[0]?.sourceId??all[0]?.id??'');positions.current.clear();},[open]);
 useEffect(()=>{if(open)search.current?.focus({preventScroll:true});},[open]);
 const updateDraft=(next:Choice[]|((items:Choice[])=>Choice[]))=>{const value=typeof next==='function'?next(draft):next;setDraft(value);onSelectionChange?.(value);};
 const q=query.trim().toLowerCase();
 const groups=all.map(group=>({...group,models:orderModels(group.models.filter(model=>!q||`${group.label} ${group.providerLabel} ${model.id} ${model.label}`.toLowerCase().includes(q)),model=>model.label,displayOrder,ranks)})).filter(group=>group.models.length);
 const active=groups.find(group=>group.id===source)??groups[0];
 const key=`${active?.id??''}\n${q}`;
 useLayoutEffect(()=>{if(list.current)list.current.scrollTop=positions.current.get(key)??0;},[key]);
 const chooseSource=(id:string)=>{if(list.current)positions.current.set(key,list.current.scrollTop);setSource(id);};
 const available=(choice:Choice)=>all.some(group=>group.id===choice.sourceId&&group.models.some(model=>model.id===choice.model));
 const unavailableCount=draft.filter(choice=>!available(choice)).length;
 const removeUnavailable=()=>updateDraft(items=>items.filter(available));
 const toggle=(choice:Choice)=>updateDraft(items=>items.some(item=>same(item,choice))?items.filter(item=>!same(item,choice)):[...items,choice]);
 const chosen=orderModels(draft,item=>modelLabel(local,item.model),displayOrder,ranks);
 const chosenIds=chosen.map(item=>item.model),visibleIds=active?.models.map(model=>model.id)??[];
 const move=(from:string,to:string,items:readonly string[],after=false)=>{moveModel(from,to,items,after);};
 const count=(id:string)=>draft.filter(item=>item.sourceId===id).length;
 const sourceChoices=active?.models.map(model=>({sourceId:active.id,model:model.id})).filter(choice=>!draft.some(item=>item.model===choice.model&&!same(item,choice)))??[];
 const sourceSelected=sourceChoices.length>0&&sourceChoices.every(choice=>draft.some(item=>same(item,choice)));
 const content=<>
  <label className="tfSearch tfAgentPickerSearch"><Icon name="search" size={16}/><input ref={search} type="search" placeholder="搜索模型、来源或账号" aria-label="搜索厂商、账号或模型" value={query} onChange={event=>{if(list.current)positions.current.set(key,list.current.scrollTop);setQuery(event.target.value);}}/></label>
  <section className="tfAgentPicked" aria-label="已选模型">
   <header><span>已选模型 <b aria-live="polite">{draft.length}</b></span><div className="tfRow">{embedded&&unavailableCount>0&&<button type="button" className="textButton" onClick={removeUnavailable}>移除不可用模型（{unavailableCount}）</button>}<button type="button" className="textButton" disabled={!draft.length} onClick={()=>updateDraft([])}>清空选择</button></div></header>
   <ul>{chosen.map(choice=>{const group=all.find(group=>group.id===choice.sourceId);const label=modelLabel(local,choice.model);const ok=available(choice);return <li className={`tfAgentPickedTag tfDragRow ${ok?'':'unavailable'}`} key={`${choice.sourceId}/${choice.model}`} {...dropOrder('models',choice.model,chosenIds,move)} title={`${label} · ${group?.accountLabel??'来源不可用'}`}>
    <DragHandle kind="models" id={choice.model} label={label} items={chosenIds} move={move}/><ProviderIcon provider={modelManufacturer(choice.model,local)} size={20}/><strong>{label}</strong><button type="button" className="iconButton" aria-label={`移除 ${label}`} onClick={()=>toggle(choice)}><Icon name="close" size={12}/></button>
   </li>;})}</ul>{!chosen.length&&<p>从下方选择模型</p>}
  </section>
  <div className="tfAgentPickerBrowser">
   <div className="tfAgentPickerSources" role="tablist" aria-label="模型来源" aria-orientation="vertical">
    <span className="tfAgentPickerCaption">来源与账号</span>
    {groups.map(group=><button type="button" role="tab" aria-selected={active?.id===group.id} aria-controls={catalogId} tabIndex={active?.id===group.id?0:-1} onKeyDown={event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const index=groups.findIndex(item=>item.id===group.id),next=event.key==='Home'?0:event.key==='End'?groups.length-1:(index+(event.key==='ArrowDown'?1:-1)+groups.length)%groups.length;chooseSource(groups[next].id);event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus({preventScroll:true});}} aria-label={group.label} key={group.id} onClick={()=>chooseSource(group.id)}>
     <ProviderIcon provider={group.provider} size={20}/><span><strong>{group.provider==='api'?group.accountLabel:group.providerLabel}</strong><small title={group.accountLabel}>{group.provider==='api'?'API 接口':group.accountLabel}</small></span><b className={count(group.id)?'chosen':''}>{count(group.id)||group.models.length}</b>
    </button>)}
    {!groups.length&&<p className="tfHint">没有匹配的来源</p>}
   </div>
   <section className="tfAgentPickerCatalog tfPickSource" id={catalogId} role="tabpanel" aria-label={active?.label??'模型列表'}>
    {active?<>
     <header><div className="tfAgentCatalogIdentity"><strong>{active.provider==='api'?active.accountLabel:active.providerLabel}</strong><small title={active.accountLabel}>{active.provider==='api'?`${active.models.length} 个模型`:active.accountLabel}</small></div>
      {active.quota&&active.remaining!==null&&<details key={active.id} className="tfAgentPickerQuota"><summary><span className={active.remaining<=10?'low':''}>剩余 {Math.round(active.remaining)}%</span></summary><div><QuotaDetails quota={active.quota} label={active.accountLabel} compact/></div></details>}
      <button type="button" className="textButton" disabled={!sourceChoices.length} onClick={()=>updateDraft(items=>sourceSelected?items.filter(item=>!sourceChoices.some(choice=>same(item,choice))):[...items,...sourceChoices.filter(choice=>!items.some(item=>same(item,choice)))])}>{sourceSelected?'取消全选':'全选'}</button>
     </header>
     <div ref={list} className="tfPickBody tfAgentPickerModelList" onScroll={event=>positions.current.set(key,event.currentTarget.scrollTop)}><div className="tfPickOptions">
      {active.models.map(model=>{const choice={sourceId:active.id,model:model.id};const on=draft.some(item=>same(item,choice));const duplicate=draft.some(item=>item.model===model.id&&!same(item,choice));return <div key={model.id} className="tfPickDraggableRow tfDragRow" {...dropOrder('models',model.id,visibleIds,move)}>
       <DragHandle kind="models" id={model.id} label={model.label} items={visibleIds} move={move}/>
       <button type="button" className={`tfPickModel ${on?'on':''}`} aria-label={model.label} aria-pressed={on} disabled={duplicate} title={duplicate?'已从其他账号选择此模型，请先移除原选择':model.id} onClick={()=>toggle(choice)}>
        <ProviderIcon provider={modelManufacturer(model.id,local)} size={22}/><span><strong>{model.label}</strong><small className="tfModelIdentity">{model.id}</small>{duplicate&&<small>已从其他账号选择</small>}</span><span className={`tfAgentPickCheck ${on?'on':''}`} aria-hidden="true">{on?'✓':<Icon name="plus" size={12}/>}</span>
       </button>
      </div>;})}
     </div></div>
    </>:<div className="tfAgentPickerEmpty"><Icon name="search" size={24}/><strong>{q?'没有匹配的模型':'还没有可用模型'}</strong><p>{q?'试试其他模型名或账号':'在账号授权或 API 接口添加来源'}</p></div>}
   </section>
  </div>
  {!embedded&&<footer><span aria-live="polite">已选择 {draft.length} 个模型{unavailableCount>0&&<button type="button" className="textButton tfRemoveUnavailable" onClick={removeUnavailable}>移除不可用模型（{unavailableCount}）</button>}</span><button type="button" onClick={onClose}>取消</button><button type="button" className="primary" disabled={busy||!draft.length} onClick={()=>{onConfirm(draft);onClose();}}>应用所选模型</button></footer>}
 </>;
 if(embedded)return open?<section className="tfAgentPicker tfInlineAgentPicker" aria-label={title} inert={busy} aria-busy={busy}>{content}</section>:null;
 return <FlowDialog open={open} title={title} className="tfAgentPicker" onClose={onClose}>{content}</FlowDialog>;
}
