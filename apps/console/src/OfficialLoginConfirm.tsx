import {useEffect,useRef,useState} from 'react';
import {FlowDialog} from './FlowDialog';

/** Shared by account authorization and local Agent pages. */
export function useOfficialLoginConfirm(){
 const [pending,setPending]=useState<{name:string;restore:boolean}>();
 const resolver=useRef<((answer:boolean)=>void)|undefined>(undefined);
 const finish=(answer:boolean)=>{resolver.current?.(answer);resolver.current=undefined;setPending(undefined);};
 useEffect(()=>()=>resolver.current?.(false),[]);
 return {confirm:(name:string,restore=false)=>new Promise<boolean>(resolve=>{resolver.current?.(false);resolver.current=resolve;setPending({name,restore});}),dialog:<FlowDialog className="tfRestartDialog" open={!!pending} title={pending?.restore?'恢复切换前登录':'切换官方登录'} onClose={()=>finish(false)}>
  <p className="tfDialogLead">{pending?.restore?'将恢复切换前保存的原登录。':'将备份当前登录，并切换到所选官方账号。'}TokenFlow 会正常退出并重新打开 {pending?.name}。</p>
  <p className="tfHint">请先保存工作。确认退出客户端后才应用更改；若无法退出，请按提示手动处理。</p>
  <footer><button onClick={()=>finish(false)}>取消</button><button className="primary" onClick={()=>finish(true)}>{pending?.restore?'恢复并重新打开':'切换并重新打开'}</button></footer>
 </FlowDialog>};
}
