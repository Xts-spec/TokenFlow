/** Display-only suggestions. No command here is evaluated or executed by the chat. */
export const cleanupCheckTools=[
 {name:'npm',check:'npm config get cache',detail:'查询实际缓存位置；npm cache ls 可查看缓存条目。',cleanup:'npm cache clean --force',impact:'清理前停止安装任务，下次可能重新下载。'},
 {name:'pnpm',check:'pnpm store path',detail:'查询当前共享存储；pnpm store status 检查包是否被修改。',cleanup:'pnpm store prune',impact:'仅清理未引用包，不整体移走共享存储。'},
 {name:'pip',check:'python -m pip cache info',detail:'查询缓存统计；python -m pip cache dir 查询路径。Windows 也可使用 py -m pip。',cleanup:'python -m pip cache purge',impact:'下次安装可能重新下载或重新构建。'},
 {name:'uv',check:'uv cache dir',detail:'查询实际缓存目录。',cleanup:'uv cache prune',impact:'先使用官方的未使用缓存整理；如需 cache clean 应另外确认。'},
 {name:'Go',check:'go env GOCACHE GOMODCACHE',detail:'查询构建缓存与共享模块存储；扫描覆盖系统默认构建缓存与 GOCACHE 环境覆盖，Go 配置文件中的自定义位置需另行核对。',cleanup:'go clean -cache',impact:'仅清构建缓存；不默认清共享模块，下一次编译会变慢。'},
] as const;
