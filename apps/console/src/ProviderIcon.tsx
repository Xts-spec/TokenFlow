import { Icon } from './Icons';

const icons:Record<string,string>={
 codex:'codex.ico',claude:'claude.ico',antigravity:'antigravity.png',kimi:'kimi.ico',xai:'xai.svg',qoder:'qoder.png',workbuddy:'workbuddy.svg',zcode:'zcode.png',doubao:'doubao.png',trae:'trae.png',cursor:'cursor.png',deepseek:'deepseek.svg',pi:'pi.svg',
};

/** Provider marks bundled locally so navigation also works offline. */
export function ProviderIcon({provider,size=22}:{provider:string;size?:number}){
 const file=icons[provider];
 return file?<img className="tfProviderIcon" src={`/provider-icons/${file}`} width={size} height={size} alt=""/>:provider==='api'?<Icon name="plug" size={size}/>:<span className="tfMark" aria-hidden="true">{provider[0]?.toUpperCase()}</span>;
}
