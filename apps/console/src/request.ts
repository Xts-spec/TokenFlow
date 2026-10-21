function waitForConfiguration(signal:AbortSignal){
  return new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},300);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}
// Only an explicit pre-handler busy refusal can be retried. A timeout or lost
// response never retries a write: the server may already have accepted it.
export async function requestJSON<T>(path:string, init:RequestInit={}, timeoutMs=20000):Promise<T> {
  const timeout=AbortSignal.timeout(timeoutMs);
  const signal=init.signal?AbortSignal.any([init.signal,timeout]):timeout;
  const busyDeadline=Date.now()+Math.min(timeoutMs,120000);
  let busyError:Error|undefined;
  try {
    for(;;){
      signal.throwIfAborted();busyError=undefined;
      const response=await fetch(path,{...init,signal});
      const data=await response.json();
      if(!response.ok){
        const error=Object.assign(new Error(data.error?.message??data.error??data.message??`HTTP ${response.status}`),{code:data.code as string|undefined,status:response.status});
        if(response.status===409&&data.code==='configuration_busy'&&init.method&&init.method!=='GET'&&Date.now()<busyDeadline){busyError=error;await waitForConfiguration(signal);continue;}
        throw error;
      }
      return data;
    }
  } catch(error) {
    if(busyError)throw busyError;
    if(init.signal?.aborted)throw new Error('已取消验证等待。服务端可能仍在处理，已发送请求可能产生少量额度。请先核对活动记录。');
    if(timeout.aborted)throw new Error(init.method&&init.method!=='GET'
      ?'请求超时，操作结果尚未确认。请先刷新状态，确认完成情况后再重试。'
      :'读取超时。请检查本机网关是否运行、网络或代理设置，然后刷新重试。');
    throw error;
  }
}
