import type {LocalAccount} from '../../../packages/core/src/cliproxy';

/** Only explicit terminal failures qualify; hidden sibling grants still belong to the visible account. */
export function expiredAuthorizations(accounts:LocalAccount[]){
 return accounts.filter(a=>!a.isDuplicate).flatMap(account=>{
  const expired=accounts.filter(a=>!a.credentialAlias&&a.authenticationRequired&&(a.preferredCredentialId??a.id)===(account.preferredCredentialId??account.id));
  return expired.length?[{account,count:expired.length,key:expired.map(a=>a.id).sort().join(',')}]:[];
 });
}
