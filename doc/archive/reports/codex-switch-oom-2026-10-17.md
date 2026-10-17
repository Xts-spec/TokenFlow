# Codex 切换时主进程内存溢出（2026-10-17）

安装版 TokenFlow 10.15.26.14 在切换 Codex 账号或网关模型时，主进程与 Codex 一起退出。其他客户端的重启不受影响。回退到 `1acb3fd` 仍然退出，因为同一条扫描路径那时已经存在。

## 现象

崩溃报告是主线程 `EXC_BREAKPOINT` / `SIGTRAP`。用安装版重新启动并打开 Electron 日志后，退出前的记录是 V8 `JavaScript heap out of memory`：老年代堆约 3.4GB，分配失败码为 `CALL_AND_RETRY_LAST`。这是主进程 JavaScript 堆耗尽，不是切换逻辑抛出的业务错误，也不是误杀了 TokenFlow 自己的进程。

## 原因

切换前会调用 `CodexContext.prepare`，读取 `~/.codex/sessions` 和 `archived_sessions`，判断会话要不要做兼容改写。本机这两处大约 2.5GB、472 个 jsonl。代码只打算留下文件头和字节边界，但 `split` 得到的文件头仍是原文的子字符串，V8 会把整份正文留在堆上。

用本机会话的副本复现时，这一步的结果是无需改写（`migrated: 0`），堆峰值已经到 3386MB。需要改写的会话还会把改写前、改写后的全文一起留在内存里；这次没有走到那一步。

独立对账记录器 `scripts/codex-reconciliation-record.ts` 不进桌面版，也不在这条退出路径上。它仍是单独运行的只读脚本。

## 修复与验证

文件头先脱离原文再保存，字节边界改为数字数组。改写结果先写到临时目录，内存里只留哈希；写回前再按哈希核对原文没有变化。临时目录在结束时删除。

同一份会话副本上，修复前堆峰值 3386MB；修复后完整走一遍「修复对话链 + 切回官方」为 757MB，结果仍是无需改写。`tests/codex-context.test.ts` 覆盖了原有改写、幂等，以及扫描后原文变化时停止且不留下临时目录。Windows 未在本轮实机切换。
