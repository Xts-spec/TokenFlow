import {it,expect} from 'vitest';
import {repairSuggestions,repairScopeLabel,repairContextForAgent,repairSuggestionPrompt} from '../apps/console/src/repair-context';
import {maintenanceContext} from '../packages/core/src/maintenance-conversations';
it('matches troubleshooting prompts and labels to the selected page and Agent',()=>{
 expect(repairSuggestions({page:'agents',target:'pi'})[0]).toContain('Pi Agent');
 expect(repairSuggestions({page:'agents',target:'codex'})[0]).toBe('反复自动重连');
 expect(repairSuggestions({page:'proxy'})).toContain('Key 调用失败');
 expect(repairSuggestions({page:'accounts',provider:'qoder'})).toContain('授权后没有添加成功');
 expect(repairScopeLabel({page:'accounts',provider:'qoder'},'Qoder IDE')).toBe('Qoder IDE 账号授权');
 for(const page of ['proxy','accounts','apis','usage','activity','cleanup','settings'] as const)expect(repairSuggestions({page}).join(' ')).not.toContain('Codex');
});
it('does not default native-only client editions to Codex repair',()=>{
 expect(repairContextForAgent('qoder-ide','today')).toEqual({page:'accounts',provider:'qoder',range:'today'});
 expect(repairContextForAgent('workbuddy-ai','all')).toEqual({page:'accounts',provider:'workbuddy',range:'all'});
 expect(repairContextForAgent('qoder','today')).toEqual({page:'agents',target:'qoder',range:'today'});
});
it('routes the independent cleanup page to its read-only repair prompts',()=>{
 const context=maintenanceContext.parse({page:'cleanup'});
 expect(repairSuggestions(context)).toContain('分析本机缓存占用');
 const prompt=repairSuggestionPrompt(context,'分析本机缓存占用');
 expect(prompt).toContain('inspect_file_cleanup');expect(prompt).toContain('scan_file_cleanup');expect(prompt).toContain('不执行删除');
 expect(repairScopeLabel(context)).toBe('文件清理');
 expect(repairSuggestionPrompt({page:'agents',target:'codex'},'分析本机缓存占用')).toBe('分析本机缓存占用');
 expect(repairSuggestions({page:'settings'})).not.toContain('分析本机缓存占用');
 const legacyContext={page:'settings' as const,intent:'file-cleanup' as const};
 expect(repairSuggestions(legacyContext)).toEqual(repairSuggestions(context));
 expect(repairSuggestionPrompt(legacyContext,'分析本机缓存占用')).toBe(prompt);
 expect(repairScopeLabel(legacyContext)).toBe('文件清理');
});
