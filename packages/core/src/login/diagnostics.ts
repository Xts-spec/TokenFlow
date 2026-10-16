export type LoginStage='starting'|'waiting_browser'|'callback'|'token_exchange'|'device_poll'|'saving_credentials'|'loading_accounts'|'local_gateway';
export const loginStageLabels:Record<LoginStage,string>={starting:'生成授权链接',waiting_browser:'等待网页授权',callback:'接收浏览器回调',token_exchange:'交换登录凭据',device_poll:'确认网页授权结果',saving_credentials:'保存账号凭据',loading_accounts:'读取账号和模型',local_gateway:'读取本机网关状态'};

/** Classify privately; only fixed labels/codes and an HTTP status leave this module. */
export function safeFailure(value:unknown){
  const text=(value instanceof Error?`${value.message} ${String(value.cause??'')}`:String(value??'')).slice(0,16000);
  const http=text.match(/(?:HTTP(?:\/\d(?:\.\d)?)?\s*|status(?:\s+code)?[\s:=]*|returned\s+)([45]\d{2})\b/i);
  const status=http?Number(http[1]):undefined;
  const [code,reason]=status===407||/proxy authentication required|proxy auth(?:entication)? failed/i.test(text)?['proxy_auth','代理要求认证']
    :/certificate|\bx509\b|\bTLS\b|\bSSL\b|CERT_/i.test(text)?['tls','TLS 握手或证书验证失败']
    :/ENOTFOUND|EAI_AGAIN|no such host|\bdns\b|name resolution/i.test(text)?['dns','域名解析失败']
    :/timeout|timed out|ETIMEDOUT|deadline exceeded|超时/i.test(text)?['timeout','连接或等待超时']
    :/ECONNREFUSED|connection refused|actively refused/i.test(text)?['connection_refused','目标服务或代理端口拒绝连接']
    :/ECONNRESET|connection reset|\bEOF\b|socket hang up|connection closed/i.test(text)?['connection_closed','连接被中断']
    :/proxy|SOCKS|tunnel/i.test(text)?['proxy','代理连接失败']
    :/invalid_grant|access_denied|authorization_denied|consent_required/i.test(text)?['authorization_rejected','授权码已失效或授权被拒绝']
    :/unknown or expired state|invalid state|state code error|state mismatch/i.test(text)?['session_invalid','授权会话已失效或不匹配']
    :/未知密钥类型/i.test(text)?['credential_store_key','本机安全存储不支持该凭据类型']
    :/安全.*存储|钥匙串|无法解密|keychain/i.test(text)?['credential_store','本机安全存储不可用或凭据无法解密']
    :/permission denied|access is denied|read-only|disk full|no space|EACCES|EPERM/i.test(text)?['storage','凭据目录权限或磁盘写入失败']
    :status?['http',`服务返回 HTTP ${status}`]
    :['unknown','上游返回失败，未提供可识别的错误类别'];
  return {code,reason,...(status?{httpStatus:status}:{})};
}

export function loginFailure(raw:unknown,fallback:LoginStage){
  const text=String(raw??'').slice(0,16000);
  const stage:LoginStage=/save.*(?:token|auth|credential)|write.*(?:token|auth|credential)/i.test(text)?'saving_credentials'
    :/exchange|token endpoint/i.test(text)?'token_exchange'
    :/waiting for.*callback/i.test(text)?'callback':fallback;
  return {stage,...safeFailure(raw)};
}
