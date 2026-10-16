import {workbuddyLoginTarget} from '../../packages/core/src/workbuddy-region';

type Identity={accountId?:string|null;domain?:string;enterpriseId?:string};
/** Compare identity only; permission to switch is validated separately by the server. */
export function desktopIdentityMatches(provider:string,native:Identity,account:Identity){
 if(!native.accountId||account.accountId!==native.accountId||(account.enterpriseId??'')!==(native.enterpriseId??''))return false;
 if(provider==='workbuddy'||provider==='workbuddy-ai')return workbuddyLoginTarget(account.domain)===provider&&workbuddyLoginTarget(native.domain)===provider;
 return (account.domain??'')===(native.domain??'');
}
