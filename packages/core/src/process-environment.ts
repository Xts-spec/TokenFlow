export function safeEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(['PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','TEMP','TMP','TMPDIR','LANG','DISPLAY','XAUTHORITY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
}
