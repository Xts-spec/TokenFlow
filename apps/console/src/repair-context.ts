import {cleanupPresets} from '../../shared/file-cleanup';
import type {MaintenanceContext} from '../../../packages/core/src/maintenance-conversations';
export type RepairPage=MaintenanceContext['page'];
export const repairPages:Record<RepairPage,string>={agents:'本地 Agent',accounts:'账号授权',apis:'API 接口',proxy:'API 代理',usage:'用量总览',activity:'活动',cleanup:'文件清理',settings:'设置'};
export const repairAgents:Record<string,string>={codex:'Codex',claude:'Claude Code',workbuddy:'WorkBuddy','workbuddy-ai':'WorkBuddyAI',qoder:'Qoder',deepseek:'DeepSeek Harness',pi:'Pi Agent'};
export function repairContextForAgent(id:string|undefined,range:MaintenanceContext['range']):MaintenanceContext{
 if(id==='qoder-ide'||id==='workbuddy-ai')return {page:'accounts',provider:id==='qoder-ide'?'qoder':'workbuddy',range};
 return {page:'agents',range,target:id&&Object.hasOwn(repairAgents,id)?id as MaintenanceContext['target']:'codex'};
}
export function repairScopeLabel(context:MaintenanceContext,providerLabel?:string){if(context.page==='settings'&&context.intent==='file-cleanup')return '文件清理';return context.page==='agents'?repairAgents[context.target??'codex']:context.page==='accounts'&&providerLabel?`${providerLabel} 账号授权`:repairPages[context.page];}
export function repairSuggestions(context:MaintenanceContext){
 const agent=repairAgents[context.target??'codex'];
 const texts:Record<RepairPage,string[]>={
  agents:[context.target==='codex'?'反复自动重连':`${agent} 模型调用失败`,'配置了模型但没有显示','切换账号后无法使用','检查网络和代理设置'],
  accounts:['授权后没有添加成功','账号额度刷新失败','模型列表没有显示','账号无法正常使用'],
  apis:['接口连接超时','API Key 验证失败','模型列表不完整','请求返回 401 或 403'],
  proxy:['Key 调用失败','应用里应该填哪个地址','检查模型和账号权限','调用成功但没有用量'],
  usage:['今天各模型的生成速度','缓存用量是怎么算的','用量没有对应到账号','最近的请求没有记录'],
  activity:['查看最近失败的原因','请求耗时异常','工具调用没有记录','找不到刚才的请求'],
  cleanup:cleanupPresets.map(preset=>preset.label),
  settings:['数据和备份存在哪里','检查网络和代理设置','网关无法启动','如何更新应用'],
 };
 if(context.page==='settings'&&context.intent==='file-cleanup')return texts.cleanup;
 return texts[context.page];
}

export function repairSuggestionPrompt(context:MaintenanceContext,label:string){return context.page==='cleanup'||context.page==='settings'&&context.intent==='file-cleanup'?cleanupPresets.find(preset=>preset.label===label)?.prompt??label:label;}
