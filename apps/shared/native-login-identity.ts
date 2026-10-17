import {workbuddyLoginTarget} from '../../packages/core/src/workbuddy-region';

type Identity={accountId?:string|null;domain?:string;enterpriseId?:string};
/** These clients keep their official login alongside separately imported custom models. */
export function officialLoginCoexists(provider:string){return provider==='workbuddy'||provider==='workbuddy-ai'||provider==='qoder';}
/** A matching machine login stays locked only while it is the active official session, or on clients where that login coexists with gateway models. Codex and Claude can be clicked again to leave the gateway. */
export function officialLoginHeld(provider:string,local:boolean,current:boolean){return local&&(current||officialLoginCoexists(provider));}
export function officialLoginSelected(provider:string,matches:boolean,gatewayConnected:boolean){return matches&&(officialLoginCoexists(provider)||!gatewayConnected);}
/** Compare identity only; permission to switch is validated separately by the server. */
export function desktopIdentityMatches(provider:string,native:Identity,account:Identity){
 if(!native.accountId||account.accountId!==native.accountId||(account.enterpriseId??'')!==(native.enterpriseId??''))return false;
 if(provider==='workbuddy'||provider==='workbuddy-ai')return workbuddyLoginTarget(account.domain)===provider&&workbuddyLoginTarget(native.domain)===provider;
 return (account.domain??'')===(native.domain??'');
}
