import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';

/** Deliberately omit account identities, OAuth URLs/codes and all credentials. */
export function gatewayDiagnostics(local:LocalAgentSnapshot,version:string,platform:string){
  const accounts:Record<string,number>={};
  for(const account of local.accounts)accounts[account.provider]=(accounts[account.provider]??0)+1;
  return {version,platform,collectedAt:new Date().toISOString(),gateway:{state:local.state,port:local.port,lastError:local.lastError},
    network:local.network,networkCheck:local.networkCheck,accounts,modelCount:local.models.length,accountError:local.accountError,quotaBusy:local.quotaBusy,
    login:local.login?{provider:local.login.provider,flow:local.login.flow,status:local.login.status,message:local.login.message,diagnostic:local.login.diagnostic}:undefined,
    logs:local.logs.slice(-100)};
}
