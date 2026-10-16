import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {NativeUsageCoverage,coverageText} from '../apps/console/src/NativeUsageCoverage';
it('labels missing collectors and unreadable logs as coverage gaps, separately from measured counters',()=>{
 const base={target:'cursor',files:0,indexed:0,skipped:0};
 expect(coverageText({...base,status:'unsupported'})).toBe('尚未采集');expect(coverageText({...base,status:'unavailable'})).toBe('未找到本机记录');expect(coverageText({...base,files:1,status:'unavailable'})).toBe('暂时无法读取');
 const html=renderToStaticMarkup(createElement(NativeUsageCoverage,{scanning:false,coverage:[{...base,status:'unsupported'},{...base,target:'antigravity',files:1,indexed:1,status:'ready'}]}));
 expect(html).toContain('Cursor');expect(html).toContain('尚未采集');expect(html).toContain('已接入本机记录');expect(html).not.toContain('0 Token');
});
