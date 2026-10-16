import {afterEach,expect,it,vi} from 'vitest';
import {lstat} from 'node:fs/promises';
import {cleanupDiskRoots} from '../packages/core/src/file-cleanup-discovery.js';

vi.mock('node:fs/promises',()=>({lstat:vi.fn(),opendir:vi.fn(),realpath:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
it('enumerates accessible Windows drive letters without assuming the system is installed on C',async()=>{
 vi.mocked(lstat).mockImplementation(async path=>{if(['D:\\','E:\\','Z:\\'].includes(String(path)))return {isDirectory:()=>true} as Awaited<ReturnType<typeof lstat>>;throw Object.assign(Error('unavailable'),{code:'EACCES'});});
 expect(await cleanupDiskRoots('win32')).toEqual(['D:\\','E:\\','Z:\\']);expect(lstat).toHaveBeenCalledTimes(26);
});
it('covers Linux root and desktop removable media while keeping macOS volume discovery under root',async()=>{
 vi.mocked(lstat).mockResolvedValue({isDirectory:()=>true} as Awaited<ReturnType<typeof lstat>>);
 expect(await cleanupDiskRoots('linux')).toEqual(['/','/run/media']);expect(await cleanupDiskRoots('darwin')).toEqual(['/']);
 vi.mocked(lstat).mockRejectedValue(Error('missing'));expect(await cleanupDiskRoots('linux')).toEqual(['/']);
});
