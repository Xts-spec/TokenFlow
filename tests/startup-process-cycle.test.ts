import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

it('restores encrypted accounts across independent launches, resets consent through the menu and skips OS storage',async()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/startup-cycle-check.cjs'],{cwd,timeout:20000,encoding:'utf8'});
 expect(stdout.split('\n').filter(line=>line.startsWith('PASS '))).toHaveLength(4);
 expect(stdout).toContain('PASS remembered-reset: choices=0, restored accounts=2, API key loaded=true');
 expect(stdout).toContain('PASS skip: choices=1, restored accounts=0, API key loaded=false, OS-storage fixture calls=0');
});
