type Identity={email?:unknown;label?:unknown;nickname?:unknown;username?:unknown;user_name?:unknown;uid?:unknown;user_id?:unknown};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim().slice(0,200):undefined;
/** Labels are identity metadata only; credentials are never exposed in account snapshots. */
export function accountLabel(provider:string,summary:Identity,stored:Identity={}):string{
 const email=text(summary.email)??text(stored.email);if(email)return email;
 const label=text(summary.label);
 const generic=new Set(['qoder','qoder ide','workbuddy','codebuddy','已保存的账号']);
 if(label&&!generic.has(label.toLowerCase()))return label;
 const nickname=text(summary.nickname)??text(stored.nickname)??text(stored.username)??text(stored.user_name);if(nickname)return nickname;
 const uid=text(summary.uid)??text(stored.uid)??text(summary.user_id)??text(stored.user_id);
 if(uid)return `账号 ${uid.length>20?`${uid.slice(0,8)}…${uid.slice(-8)}`:uid}`;
 return label&&provider!=='qoder'&&provider!=='workbuddy'?label:'已保存的账号';
}
