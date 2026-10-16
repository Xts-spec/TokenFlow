/** Official endpoints share domestic identity, while international accounts stay separate. */
export const workbuddyLoginDomain=(domain?:string)=>(domain||'copilot.tencent.com').replace(/^https:\/\//,'').replace(/\/$/,'');
export const workbuddyLoginTarget=(domain?:string):'workbuddy'|'workbuddy-ai'|undefined=>['copilot.tencent.com','www.codebuddy.cn','www.workbuddy.cn'].includes(workbuddyLoginDomain(domain))?'workbuddy':workbuddyLoginDomain(domain)==='www.workbuddy.ai'?'workbuddy-ai':undefined;
