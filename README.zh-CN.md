# Hostlet

## 你的网站，应该由你做主

你的网站，不仅仅属于一个产品。

Hostlet 是一个 MIT 开源的前端页面托管平台，面向个人创作者和需要分享演示的团队。多用户功能包括邮箱账号、个人和团队空间、申请审批、HTML/ZIP 上传、私有访问、分享及版本回滚；也保留原有单管理员模式。平台只托管静态文件，应用脚本在访客浏览器中运行，不提供用户服务端或应用数据库。

多用户功能已完成并在官方实例运行；自建实例在面向不受信任用户开放前，仍须在目标环境完成 HTTPS、域名、邮件、权限隔离、备份恢复和内容治理验收。官方实例为 <https://hostlet.cn>，当前采用单域多用户模式并开放用户名注册；公开宣传应用位于 <https://hostlet.cn/p/hostlet/>。

源码、Issue 与版本发布：<https://github.com/Revolves/hostlet>。

## 本机启动单管理员模式

需要 Node.js 22.13 或更高版本。在项目目录执行 `npm ci`，将 `.env.example` 复制为 `.env`，设置独立的 `ADMIN_PASSWORD` 和至少 32 字符的随机 `APP_SECRET`。示例占位值不能用于启动。可用下面的命令生成随机密钥；不要将输出提交或分享。

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

官网前台位于 `http://localhost:3000`，展示当前实例已公开的应用与累计访问数，支持中英文切换、公开目录搜索、最近更新/最多访问排序和分页加载；SEO 与分享卡片元数据由服务端按实例 origin 注入。统一工作台位于 `http://localhost:3000/workspace`，多用户模式下进入账户与团队工作台，单管理员模式下进入页面管理。实例页面管理工作区位于 `http://localhost:3000/console`，平台管理位于 `http://localhost:3000/platform-admin`，托管页面使用 `http://localhost:8080/p/<路径>/`。公开应用只在访客成功打开其入口文档时计数，静态资源请求、HEAD 请求、私有分享和预览不计入；访问计数保存在 `data/hostlet.sqlite` 的 `public_page_visits` 表中。单管理员私有页面使用管理员密码，不适合把该密码交给其他人。使用 `npm test` 执行自动化测试。

## 配置多用户与自部署

多用户模式需要将 `MULTIUSER_ENABLED` 设置为 `true`；是否开放注册由 `REGISTRATION_ENABLED` 和管理员后续保存的平台设置控制。注册支持邮箱或用户名：邮箱账户需要验证邮件，因此要配置支持 TLS 或 STARTTLS 的 SMTP；用户名账户注册后直接登录，不需要 SMTP，但暂不支持通过邮件找回密码，用户名长度为 3 到 32 位，只能使用小写字母、数字、下划线和短横线。应用访问默认还需要 `APPS_DOMAIN`、通配符 DNS 和 HTTPS：推荐管理域与应用域属于不同的可注册域，每个应用使用独立子域。演示实例如只使用一个可注册域，可显式设置 `SINGLE_DOMAIN_HOSTING=true` 并将 `APPS_DOMAIN` 指向管理域的子域，例如 `apps.hostlet.cn`；这会保留应用功能，但把隔离从跨站降为同站跨 origin，并强制使用 `__Host-` Cookie 和严格 Origin 校验。

不使用 Docker、直接在 Ubuntu 宿主机运行时，请阅读[宿主机部署说明](docs/host-deployment.md)；容器与多用户场景的部署边界见[单机部署说明](docs/deployment.md)。已验证账号可在确认当前密码后注销账户：个人应用会被删除，团队应用仍归团队所有，会话会撤销，平台仅保留作为外键锚点的匿名化账号记录；团队最后一名所有者须先转移所有权，注销中途中断时会在启动服务前恢复。现有单管理员页面不会自动分配给新账号；如需迁移，请先备份并按[旧页面迁移说明](docs/legacy-migration.md)操作。开发测试证据和局限见[本机浏览器验证记录](docs/superpowers/plans/2026-10-28-workspace-https-browser.md)。

服务默认在 `data/security-logs/` 写入脱敏接口安全事件，按 UTC 日期轮转并默认保留 180 天；可用 `SECURITY_LOG_RETENTION_DAYS` 调整。日志不会写入请求体、Cookie、查询参数、密码或含令牌的 URL。公开运营前请阅读[安全日志说明](docs/security-logging.md)，并另建外部监控、告警和访问审计。

默认单文件上传上限为 50 MiB；标准 ZIP 最多包含 4,000 个条目和 2,000 个文件，解压内容最多 100 MiB，暂不支持 ZIP64。应用默认私有，访问者下载的内容无法被平台收回；不要在前端文件中放入私密密钥。

## 命令行发布

CLI 已发布到 npm，包名为 [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli)，要求 Node.js 22.13 或更高版本；源码位于 [`cli/`](cli)。

```sh
npm install -g hostlet-cli
hostlet --help
```

本地开发可从源码安装或生成 tarball：

```sh
npm install -g ./cli
npm pack ./cli
npm install -g ./hostlet-cli-0.2.0.tgz
```

仍支持从源码运行 `node cli/hostlet.js ...`，也可用 `npm run pack:cli` 生成 tarball。

现在可以不解锁账户页，直接从 CLI 完成注册、建 Key 和发布：

```sh
hostlet register --username alice --password-stdin
hostlet workspaces
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo"
```

账户密码从标准输入读取，至少 12 个字符。`register` 和 `login` 会保存账户会话，并默认创建 30 天、包含读取、发布和分享权限的 API Key；后续命令自动使用已保存的令牌。`HOSTLET_URL` 可省略，默认 `https://hostlet.cn`，自建实例再显式覆盖。`HOSTLET_TOKEN` 仍可用于自动化，并优先于本地保存的令牌。目标实例必须提供账户凭据流程和 `/api/cli`，不能把管理员密码当作令牌使用。不要把凭据提交到仓库或写入日志。

官方 `hostlet.cn` 已开放用户名注册和账户 API Key，可直接用于 CLI 与 Skill 发布；用户名账户暂不支持邮件找回密码，请妥善保存密码。

```sh
hostlet register --username alice --password-stdin
hostlet login --identifier alice --password-stdin
hostlet whoami
hostlet keys list
hostlet keys create --key-name "CI publisher" --password-stdin
hostlet keys revoke --id KEY_ID
hostlet workspaces
hostlet pages --workspace WORKSPACE_ID
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID --json
hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID
```

`hostlet --help` 列出全部命令；`hostlet help publish` 或 `hostlet publish --help` 显示命令选项；`hostlet --version` 输出包版本。帮助和版本命令不需要凭据。安装、凭据权限、JSON 输出和错误恢复的完整说明见 [`cli/README.md`](cli/README.md)。

支持 HTML、ZIP 和目录，默认创建私有应用；使用 `--entry` 指定 ZIP 入口。更新已有应用时添加 `--page PAGE_ID --revision REVISION`，修订号可从应用接口读取。结果包含应用和版本标识及管理页地址，私有应用仍需在管理页面授权或创建分享。命令不自动公开应用。目录不能包含隐藏文件、`node_modules` 或符号链接；建议发布经过检查的构建输出。仅 HTTPS 可用于远程服务，HTTP 仅允许本机回环测试。令牌可从账户页面撤销，密码变更也会撤销令牌。

回滚使用 `rollback`，需要当前修订号；返回 `CONFLICT` 时先重新读取应用，再使用最新修订号重试。分享管理要求凭据包含 `share` 权限：`shares` 只列出元数据，`share` 创建的新链接只在本次输出中显示，`revoke-share` 立即撤销已有访问。创建分享时可用 `--expires` 指定未来的 ISO-8601 时间；密码从 `HOSTLET_SHARE_PASSWORD` 读取，或用 `--password-stdin` 从标准输入读取，避免写入命令历史。网络中断或 5xx 响应后不要直接重复创建分享，先执行 `shares` 检查，因为已创建的链接无法再次获取。

团队编辑者可将私有应用提交给团队所有者审核公开；所有者可批准、驳回或直接公开。审核绑定提交时的版本，内容更改后需要重新提交。公开的团队应用须先设为私有，才能更换或回滚版本。私有分享仍可用于预览，个人空间可直接公开。

CLI 在发送前将请求 ID 写入标准错误（使用 `--json` 时也如此），并为上传文件发送 SHA-256 和字节数。可使用 `--request-id REQUEST_ID` 复用请求 ID；ID 须为 22–128 位字母、数字、`_` 或 `-`。目录归档使用固定顺序和元数据，以便相同内容生成相同字节。请保存请求 ID，并确保重试的文件、文件名、标题、入口、目标应用和修订号不变；更改内容或选项时应使用新的请求 ID。

网络中断或响应无法确认时，不代表发布成功或失败。先用上面的 `publish-status` 查询：`succeeded` 是已提交结果，`in_progress` 应稍后再查，`interrupted` 可用相同 ID 和内容重试，`not_found` 也不能证明请求不会到达，仍应使用相同 ID 重试。示例：`hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --request-id REQUEST_ID --json`。请求 ID 不是凭据；查询仍需要有效令牌和当前空间权限。

发布前 CLI 使用相同请求 ID 查询状态接口；只有返回合法 JSON 状态的服务才会收到上传。旧服务的普通 404、鉴权失败和网络错误会中止上传。状态接口和发布接口必须由同一套正确实现幂等协议的服务提供；混合部署或错误配置仍需在部署时验证。当前成功回执不自动过期，账号注销或工作空间删除时会清除对应回执；长期存储增长和回执清理策略仍待处理。CLI 已发布到公共 npm registry，也仍可从源码或本地 tarball 安装；尚未在 Linux 和 macOS 实机验证全部命令。接口的限流为单进程限制，公开部署仍需入口限流。

Agent Skill 已发布到 npm，包名为 [`hostlet-skill`](https://www.npmjs.com/package/hostlet-skill)，源码位于 [`skills/hostlet-publish/`](skills/hostlet-publish/)。执行 `npx hostlet-skill install` 即可；安装器默认把 Skill 写入 `$CODEX_HOME/skills/hostlet-publish`，并同时安装隔离的 CLI 到 `bin/hostlet`（Windows 为 `bin/hostlet.cmd`），无需再全局安装 CLI。可用 `--target` 指定其他 skills 目录；只有在已全局安装 `hostlet` 或离线环境时才使用 `--skip-cli`。Skill 默认官方 `https://hostlet.cn`，通过 `HOSTLET_URL` 切换自建实例。它支持注册、登录、创建 API Key 和发布，但必须先获得用户确认；密码只能通过标准输入传递。使用时先确认目标实例、工作空间和待发布目录，检查目录内容及 HTML 入口后再运行命令。不要读取、打印或回传凭据值，也不要自动将应用设为公开。发布成功后返回工作台地址、应用 ID 和版本；如果响应丢失，保存请求 ID 并按上述状态查询流程处理。

## 参与贡献

提交 Pull Request 前请阅读[贡献指南](CONTRIBUTING.md)。安全漏洞请按[安全政策](SECURITY.md)私下报告，不要发到公开 Issue。
