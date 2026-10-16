import {expect,it} from 'vitest';
import {posix,win32} from 'node:path';
import {deepseekConfigPath,deepseekHome} from '../packages/core/src/deepseek-config.js';

it.each([
 {name:'macOS default',paths:posix,home:'/Users/tester',override:undefined,expected:'/Users/tester/.dsh/profiles/desktop/cordis.patch.yml'},
 {name:'Linux default',paths:posix,home:'/home/tester',override:undefined,expected:'/home/tester/.dsh/profiles/desktop/cordis.patch.yml'},
 {name:'Windows default',paths:win32,home:'C:\\Users\\Tester',override:undefined,expected:'C:\\Users\\Tester\\.dsh\\profiles\\desktop\\cordis.patch.yml'},
 {name:'Windows custom drive with spaces and Unicode',paths:win32,home:'C:\\Users\\Tester',override:'D:\\模型配置\\DSH Home',expected:'D:\\模型配置\\DSH Home\\profiles\\desktop\\cordis.patch.yml'},
 {name:'Windows network home',paths:win32,home:'C:\\Users\\Tester',override:'\\\\server\\share\\DSH Home',expected:'\\\\server\\share\\DSH Home\\profiles\\desktop\\cordis.patch.yml'},
 {name:'POSIX tilde override',paths:posix,home:'/Users/tester',override:'~/DSH Home',expected:'/Users/tester/DSH Home/profiles/desktop/cordis.patch.yml'},
 {name:'Windows tilde override',paths:win32,home:'C:\\Users\\Tester',override:'~\\DSH Home',expected:'C:\\Users\\Tester\\DSH Home\\profiles\\desktop\\cordis.patch.yml'},
 {name:'blank override',paths:win32,home:'C:\\Users\\Tester',override:'   ',expected:'C:\\Users\\Tester\\.dsh\\profiles\\desktop\\cordis.patch.yml'},
])('resolves DeepSeek configuration for $name',({paths,home,override,expected})=>{
 expect(deepseekConfigPath(home,override,paths)).toBe(expected);
 const resolvedHome=paths.dirname(paths.dirname(paths.dirname(expected)));
 expect(deepseekHome(expected,paths)).toBe(resolvedHome);
 expect(deepseekHome(paths.join(resolvedHome,'cordis.patch.yml'),paths)).toBe(resolvedHome);
});
