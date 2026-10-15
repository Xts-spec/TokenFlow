import { rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Fixed project-local generated directories only; never remove source or profiles.
export async function cleanPackage() {
  for (const name of ['release', 'artifacts', '.tmp', 'output']) {
    await rm(new URL(`../${name}`, import.meta.url), { recursive: true, force: true });
    console.log(`Cleaned ${name}/`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await cleanPackage();
}
