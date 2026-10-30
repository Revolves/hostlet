# Hostlet

## 你的网站，应该由你做主

你的网站，不仅仅属于一个产品。

Hostlet 是一个 MIT 开源的前端页面托管平台，面向个人创作者和需要分享演示的团队。多用户功能包括邮箱账号、个人和团队空间、申请审批、HTML/ZIP 上传、私有访问、分享及版本回滚；也保留原有单管理员模式。平台只托管静态文件，应用脚本在访客浏览器中运行，不提供用户服务端或应用数据库。

多用户功能仍在开发和验收中，不应直接用于公开服务。正式部署前须在目标环境完成 HTTPS、域名、邮件、权限隔离、备份恢复和内容治理验收。当前仓库没有提供已上线的官方体验地址。

## 本机启动单管理员模式

需要 Node.js 22.13 或更高版本。在项目目录执行 `npm ci`，将 `.env.example` 复制为 `.env`，设置独立的 `ADMIN_PASSWORD` 和至少 32 字符的随机 `APP_SECRET`。示例占位值不能用于启动。可用下面的命令生成随机密钥；不要将输出提交或分享。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

管理入口是 `http://localhost:3000`，托管页面使用 `http://localhost:8080/p/<路径>/`。单管理员私有页面使用管理员密码，不适合把该密码交给其他人。使用 `npm test` 执行自动化测试。

## 配置多用户与自部署

多用户模式需要将 `MULTIUSER_ENABLED` 设置为 `true`，配置支持 TLS 或 STARTTLS 的 SMTP；是否开放注册由 `REGISTRATION_ENABLED` 和管理员后续保存的平台设置控制。应用访问还需要 `APPS_DOMAIN`、通配符 DNS 和 HTTPS：管理域与应用域必须属于不同的可注册域，每个应用使用独立子域。直接使用上述本机 HTTP 地址无法完成多用户应用访问。

配置反向代理、证书、邮件、备份和恢复前，请阅读[单机部署说明](docs/deployment.md)。已验证账号可在确认当前密码后注销账户：个人应用会被删除，团队应用仍归团队所有，会话会撤销，平台仅保留作为外键锚点的匿名化账号记录；团队最后一名所有者须先转移所有权，注销中途中断时会在启动服务前恢复。现有单管理员页面不会自动分配给新账号；如需迁移，请先备份并按[旧页面迁移说明](docs/legacy-migration.md)操作。开发测试证据和局限见[本机浏览器验证记录](docs/superpowers/plans/2026-10-28-workspace-https-browser.md)。

服务默认在 `data/security-logs/` 写入脱敏接口安全事件，按 UTC 日期轮转并默认保留 180 天；可用 `SECURITY_LOG_RETENTION_DAYS` 调整。日志不会写入请求体、Cookie、查询参数、密码或含令牌的 URL。公开运营前请阅读[安全日志说明](docs/security-logging.md)，并另建外部监控、告警和访问审计。

默认单文件上传上限为 50 MiB；标准 ZIP 最多包含 4,000 个条目和 2,000 个文件，解压内容最多 100 MiB，暂不支持 ZIP64。应用默认私有，访问者下载的内容无法被平台收回；不要在前端文件中放入私密密钥。

## 命令行发布（开发中）

登录账户后，在“API 凭据”创建 30 天的读取和发布凭据，复制一次性显示的值。将管理站点 origin 设置为 `HOSTLET_URL`，并通过安全的环境变量设置 `HOSTLET_TOKEN`；不要把凭据提交到仓库或写入日志。使用本仓库源码运行：

```sh
node cli/hostlet.js workspaces
node cli/hostlet.js pages --workspace WORKSPACE_ID
node cli/hostlet.js versions --workspace WORKSPACE_ID --page PAGE_ID
node cli/hostlet.js publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
```

支持 HTML、ZIP 和目录，默认创建私有应用；使用 `--entry` 指定 ZIP 入口。更新已有应用时添加 `--page PAGE_ID --revision REVISION`，修订号可从应用接口读取。结果包含应用和版本标识及管理页地址，私有应用仍需在管理页面授权或创建分享。命令不自动公开应用。目录不能包含隐藏文件、`node_modules` 或符号链接；建议发布经过检查的构建输出。仅 HTTPS 可用于远程服务，HTTP 仅允许本机回环测试。令牌可从账户页面撤销，密码变更也会撤销令牌。

此功能尚未提供 npm 发布包、幂等重试、MCP 或 Skill；网络中断时先检查应用列表，避免重试产生重复应用。接口的限流为单进程限制，公开部署仍需入口限流。

Agent 使用时应先确认目标实例、工作空间和待发布目录；检查目录内容及 HTML 入口后再运行命令。不要读取、打印或回传凭据值，也不要自动将应用设为公开。发布成功后返回管理页地址、应用 ID 和版本；如果响应丢失，先通过管理页面核对结果再决定是否重试。
