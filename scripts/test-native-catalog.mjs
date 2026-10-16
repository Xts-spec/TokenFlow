// Offline regressions by default. Live Trae checks require TOKEN_FLOW_TRAE_LIVE_AUTH_DIR.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sidecarOverlay} from './sidecar-overlay.mjs';
const patch=sidecarOverlay(true);
try {
 const overlay=JSON.parse(readFileSync(patch.overlay,'utf8'));
 overlay.Replace[resolve('upstream/CLIProxyAPI/sdk/cliproxy/token_flow_official_catalog_test.go')]=resolve('tests/sidecar/official_catalog_test.go');
 overlay.Replace[resolve('upstream/CLIProxyAPI/sdk/cliproxy/token_flow_trae_catalog_test.go')]=resolve('tests/sidecar/trae_catalog_test.go');
 writeFileSync(patch.overlay,JSON.stringify(overlay));
 const result=spawnSync('go',['test','-overlay',patch.overlay,'./sdk/cliproxy','./internal/runtime/executor','-run','TestOfficialCatalog|TestTraeNative','-count=1'],{cwd:'upstream/CLIProxyAPI',stdio:'inherit'});
 process.exitCode=result.status??1;
} finally {patch.close();}
