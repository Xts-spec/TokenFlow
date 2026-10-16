// Isolated live connectivity check. No saved accounts or user profile are loaded.
import {app,session} from 'electron';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createNetworkProxy} from '../packages/core/src/network-proxy.js';
import {CLIProxyManager} from '../packages/core/src/cliproxy.js';

async function main(){
 const root=await mkdtemp(join(tmpdir(),'tokenflow-connectivity-'));app.setPath('userData',join(root,'electron'));
 await app.whenReady();app.dock?.hide();
 const outbound=session.fromPartition('network-check',{cache:false});await outbound.setProxy({mode:'system'});
 const network=await createNetworkProxy(url=>outbound.resolveProxy(url));network.installFetch();
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const manager=new CLIProxyManager(root,resolve('sidecars',`${process.platform}-${process.arch}`,process.platform==='win32'?'cliproxyapi.exe':'cliproxyapi'),'isolated-network-check',port,{outboundProxyURL:network.url,networkSnapshot:network.snapshot});
 try{await manager.start();const report=await manager.checkNetwork();console.log(JSON.stringify({report,network:network.snapshot()},null,2));}
 finally{await manager.shutdown();await network.close();await rm(root,{recursive:true,force:true});}
}
main().then(()=>app.exit(0),error=>{console.error('Connectivity check failed:',error instanceof Error?error.message:'unknown');app.exit(1);});
