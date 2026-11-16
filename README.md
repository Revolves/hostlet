# Hostlet

**语言：** 简体中文 | [English](README.en.md)

## 你的网站，应该由你做主

你的网站，不仅仅属于一个产品。

Hostlet 是一个 MIT 开源的静态前端应用托管平台，面向个人创作者和需要分享演示的团队，基于 Express、SQLite 和 React/Vite 构建。多用户模式支持账号注册、个人与团队空间、申请审批、HTML/ZIP/目录发布、私有访问、可撤销分享链接、版本历史与回滚及 API Key；同时保留原有的单管理员模式。平台只托管静态文件，应用脚本在访客浏览器中运行，不执行用户服务端代码，也不提供应用数据库或 SPA fallback 路由。

多用户功能已完成并在官方实例运行；自建实例在面向不受信任用户开放前，仍须在目标环境完成 HTTPS、域名、邮件、权限隔离、备份恢复和内容治理验收，参见[部署说明](docs/deployment.md)和[安全政策](SECURITY.md)。

官方实例：<https://hostlet.cn>（当前采用单域多用户模式并开放用户名注册，应用地址为 `https://<应用ID>.apps.hostlet.cn/`）。公开宣传应用：<https://hostlet.cn/p/hostlet/>。

当前版本状态（2026-11-10）：`hostlet-cli@0.2.3`、`hostlet-skill@0.2.6`；最新完整回归 400 项、2 项平台条件跳过，生产构建 48 个模块通过。产品、版本和部署的统一口径见[项目当前状态](docs/project-status.md)。

源码、Issue 与版本发布：<https://github.com/Revolves/hostlet>；变更历史见 [CHANGELOG.md](CHANGELOG.md)；开源协议见 [MIT License](LICENSE)。

## 本地运行

需要 Node.js 22.13 或更高版本。

```sh
npm ci
```

将 `.env.example` 复制为 `.env`（Windows PowerShell 使用 `Copy-Item .env.example .env`，Linux/macOS 使用 `cp .env.example .env`），设置独立的 `ADMIN_PASSWORD` 和至少 32 个字符的随机 `APP_SECRET`。示例占位值在启动时会被拒绝。可用下面的命令生成随机密钥（切勿提交或分享输出）：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run build
npm start
```

- 公开官网：`http://localhost:3000`（支持中英文切换、公开目录搜索、最近更新/最多访问排序和分页加载；由服务端按实例 origin 注入 SEO、Open Graph 与 JSON-LD 元数据。公开应用仅在访客成功打开其入口 HTML 时计入访问量，静态资源、`HEAD` 请求、私有分享和预览不计入，计数保存在 `data/hostlet.sqlite` 的 `public_page_visits` 表中）
- 统一工作台：`http://localhost:3000/workspace`（多用户模式下进入账户与团队工作台，单管理员模式下进入页面管理）
- 页面管理控制台：`http://localhost:3000/console`
- 平台管理：`http://localhost:3000/platform-admin`（仅多用户托管可用）
- 托管页面（单管理员/本地默认地址）：`http://localhost:8080/p/<路径>/`
- GitHub 源码入口：通过 `PUBLIC_GITHUB_URL` 和 `PUBLIC_GITHUB_LABEL` 配置（默认指向本仓库，设为空字符串可隐藏）
- 开发模式：`npm run dev`，随后访问 `http://localhost:5173`
- 验证：`npm test`、`npm run build` 或 `npm run check`

## 页面发布与管理

平台界面支持简体中文和英文，首次访问跟随浏览器语言，登录页与管理页顶栏的语言切换会记住你的选择；平台自带的私有访问验证页与 404 页面同样支持双语。平台绝不会翻译或改写用户上传的 HTML 内容。

在单管理员模式下，使用配置好的 `ADMIN_PASSWORD` 登录控制台，选择上传页面并提交 HTML 文件或 ZIP 压缩包，设置标题、挂载路径（slug）、HTML 入口文件和公开/私有访问状态即可发布。

ZIP 压缩包中的入口文件可以位于根目录，或位于唯一一层顶层文件夹内。页面中的资源引用和页面间跳转请使用相对路径（例如 `assets/style.css`），不要使用根相对路径（例如 `/assets/style.css`），否则无法正确指向已挂载的站点目录。平台仅托管静态文件，不执行服务端代码，也不提供 SPA fallback 路由。

页面设置支持编辑信息、替换发布版本、查看版本历史、回滚、生成预览链接、复制访问链接和删除。替换发布不会改变已有挂载路径；修改路径则会使旧 URL 失效。预览链接有效期为 15 分钟；切换当前生效版本（包括回滚到历史版本）会使之前签发的访问授权失效。所有保留版本均计入存储统计；单管理员旧版页面不会自动清理历史版本，需关注磁盘空间，工作空间应用则最多保留 20 个历史版本，并支持手动删除旧版本。

## 命令行发布（CLI）

CLI 已发布到 npm，包名为 [`hostlet-cli`](https://www.npmjs.com/package/hostlet-cli)，要求 Node.js 22.13 或更高版本；源码位于 [`cli/`](cli)。

```sh
npm install -g hostlet-cli
hostlet --help
```

本地开发或离线环境可从源码安装、构建本地 tarball 或直接从源码运行：

```sh
npm install -g ./cli
npm pack ./cli
npm install -g ./hostlet-cli-0.2.3.tgz
```

也可直接运行 `node cli/hostlet.js ...`，或使用 `npm run pack:cli` 生成 tarball。

无需先打开网页门户，即可直接从 CLI 完成注册、查看空间、发布、调整可见性、改名、删版本和删除应用：

```sh
hostlet register --username alice --password-stdin
hostlet workspaces
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo"
hostlet visibility public --workspace WORKSPACE_ID --page PAGE_ID
hostlet rename --workspace WORKSPACE_ID --page PAGE_ID --title "New title"
hostlet delete-release --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet delete-app --workspace WORKSPACE_ID --page PAGE_ID --confirm
```

账户密码从标准输入读取，至少 12 个字符（不提供命令行密码参数）。`register` 和 `login` 会保存账户会话，并默认创建有效期 30 天、包含 `read`、`publish` 和 `share` 权限的 API Key（可用 `--no-key` 仅保存会话）；后续命令自动读取已保存的令牌。`HOSTLET_URL` 可省略，默认 `https://hostlet.cn`，自建实例再显式设置。`HOSTLET_TOKEN` 仍可用于自动化场景，并优先于本地凭据文件（可用 `HOSTLET_CONFIG` 覆盖凭据文件路径）。目标实例必须提供账户凭据流程与 `/api/cli`，切勿将管理员密码当作 `HOSTLET_TOKEN` 使用，也不要把凭据提交到仓库或写入日志。

官方 `hostlet.cn` 已开放用户名注册和账户 API Key，可直接用于 CLI 与 Skill 发布；用户名账户暂不支持邮件找回密码，请妥善保存密码。

完整常用命令示例：

```sh
hostlet register --username alice --password-stdin
hostlet login --identifier alice --password-stdin
hostlet whoami
hostlet logout
hostlet keys list
hostlet keys create --key-name "CI publisher" --password-stdin
hostlet keys revoke --id KEY_ID
hostlet workspaces
hostlet pages --workspace WORKSPACE_ID
hostlet versions --workspace WORKSPACE_ID --page PAGE_ID
hostlet publish ./dist --workspace WORKSPACE_ID --title "Demo" --json
hostlet publish-status --workspace WORKSPACE_ID --request-id REQUEST_ID --json
hostlet rollback --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet visibility public --workspace WORKSPACE_ID --page PAGE_ID
hostlet rename --workspace WORKSPACE_ID --page PAGE_ID --title "New title"
hostlet delete-release --workspace WORKSPACE_ID --page PAGE_ID --release RELEASE_ID --revision REVISION
hostlet delete-app --workspace WORKSPACE_ID --page PAGE_ID --confirm
hostlet shares --workspace WORKSPACE_ID --page PAGE_ID
hostlet share --workspace WORKSPACE_ID --page PAGE_ID --expires 2027-01-01T00:00:00Z --password-stdin
hostlet revoke-share --workspace WORKSPACE_ID --page PAGE_ID --share SHARE_ID
```

`hostlet --help` 列出全部命令，`hostlet help <command>` 或 `hostlet <command> --help` 显示命令选项，`hostlet --version` 输出包版本；帮助与版本命令无需凭据。安装、凭据权限、JSON 输出和错误恢复的完整说明见 [`cli/README.md`](cli/README.md)。

### 发布、管理与幂等恢复说明

- **发布与替换：** `publish` 支持单个 HTML 文件、ZIP 压缩包或本地目录，默认创建私有应用；可用 `--entry` 指定 ZIP 或目录中的 HTML 入口。更新已有应用时传入 `--page PAGE_ID --revision REVISION`（替换时忽略 `--title`，如需改名请使用 `rename`）。发布成功后返回 `managementUrl` 以及（当实例开放应用托管地址时的）`applicationUrl`；私有应用链接需要登录访问，CLI 不会自动公开应用。目录不能包含隐藏文件、`node_modules` 或符号链接；建议仅发布构建后的干净产物。远程实例仅允许 HTTPS，HTTP 仅限本机回环测试。令牌可在账户页面或 `keys revoke` 撤销，修改账户密码也会撤销已有令牌。
- **回滚、删除与团队审核：** `rollback` 和 `delete-release` 需要传入应用当前的 `--revision`；若返回 `CONFLICT`，先重新读取应用信息再以最新修订号重试。正在生效的版本不能被 `delete-release` 删除，需先切换活动版本。`delete-app` 会永久删除应用及所有保留版本和公开地址，必须显式传入 `--confirm` 且仅限个人空间或团队所有者。团队编辑者可将私有应用提交给团队所有者审核公开；所有者可批准、驳回或直接公开。审核绑定提交时的版本，更改内容后需重新提交；公开的团队应用须先设为私有，才能替换或回滚版本。
- **分享管理：** 需要凭据包含 `share` 权限。`shares` 只列出元数据；`share` 创建的新链接只在本次输出中显示一次，无法找回；`revoke-share` 立即撤销访问权限。可用 `--expires` 指定未来的 ISO-8601 过期时间；分享密码可通过 `--password-stdin` 或 `HOSTLET_SHARE_PASSWORD` 提供。若 `share` 遇到网络中断或 5xx 响应，重试前请先执行 `shares` 检查是否已创建成功。
- **幂等与不确定结果恢复：** CLI 在发送请求前会将请求 ID 输出到标准错误（使用 `--json` 时同样如此），并为上传文件附带 SHA-256 摘要和字节数；目录打包采用固定顺序和元数据，相同内容会生成相同字节。可用 `--request-id REQUEST_ID` 显式指定 22–128 位字母、数字、`_` 或 `-`。上传前 CLI 会先用该请求 ID 查询状态接口，只有服务端返回合法 JSON 状态时才会继续上传。若网络中断或响应无法确认，先运行 `publish-status` 查询：`succeeded` 表示该历史请求已提交，请检查应用当前状态；`in_progress` 应稍后再查；`interrupted` 与 `not_found` 都不能证明请求未到达，应使用**相同的请求 ID、文件、文件名、标题、入口、目标应用和修订号**重试（参数或内容变化时必须换用新的请求 ID）。查询状态仍需有效令牌和空间权限。当前成功回执不自动过期，会在账号注销或工作空间删除时清理；接口限流为单进程限制，公开部署仍需在入口代理配置限流。

## Agent Skill

发布技能已发布到 npm，包名为 [`hostlet-skill`](https://www.npmjs.com/package/hostlet-skill)，源码位于 [`skills/hostlet-publish/`](skills/hostlet-publish/)。

```sh
npx --yes hostlet-skill@latest install
```

官网首页提供一键复制的安装命令和面向 AI 助手的安装提示词（仅完成安装检查，不会提前触发账号授权或发布）。安装器默认将 Skill 复制到 `$CODEX_HOME/skills/hostlet-publish`，并自带隔离的 CLI 运行时到 `bin/hostlet`（Windows 优先使用 `bin/hostlet.ps1`；保留 `bin/hostlet.cmd` 兼容，但后者经额外 shell 转发时可能拆分含空格的参数），因此无需全局安装 CLI。可用 `--target` 指定其他技能目录；仅在已全局安装 `hostlet` 或离线环境中才使用 `--skip-cli`。

每个 `hostlet-skill` 版本都会固定依赖对应版本的 CLI 以保证安装可复现；如需显式追随 npm 最新版 CLI，可运行：

```sh
npx --yes hostlet-skill@latest install --cli-version latest
```

Skill 默认连接官方 `https://hostlet.cn`（可通过 `HOSTLET_URL` 切换自建实例），并在约束中要求：

- 注册账号、创建 API Key 或执行发布前必须先征得用户明确确认；发布前确认内容需包含目标实例、工作空间名称与 ID、来源路径、标题、入口文件、新建或替换模式（替换时含 page ID 与 revision）及访问状态。
- 默认保持新应用为私有，不读取、打印或写入密码和令牌。
- 发布成功后必须向用户返回可点击的 `applicationUrl` 或 `managementUrl`（私有应用需注明访问前需登录）。
- 遇到不确定网络结果时先用 `publish-status` 查询再决定是否用原请求 ID 重试。

### 发布 CLI 与 Skill 包

修改 [`cli/package.json`](cli/package.json) 或 [`skills/hostlet-publish/package.json`](skills/hostlet-publish/package.json) 中的版本号并推送对应标签后，`.github/workflows/publish-cli.yml`（匹配 `hostlet-cli-v*`）与 `.github/workflows/publish-skill.yml`（匹配 `hostlet-skill-v*`）会校验标签与清单版本一致，并通过 npm Trusted Publishing（OIDC）自动发布，仓库内无需保存长期 npm token 或 OTP：

```sh
git tag -a hostlet-cli-v0.2.3 -m "hostlet-cli 0.2.3"
git push origin hostlet-cli-v0.2.3

git tag -a hostlet-skill-v0.2.6 -m "hostlet-skill 0.2.6"
git push origin hostlet-skill-v0.2.6
```

## 多用户模式

多用户功能默认关闭。设置 `MULTIUSER_ENABLED=true` 和 `REGISTRATION_ENABLED=true` 可开启账号注册（运行后也可在平台管理设置中调整注册开关）。

- **注册方式：** 邮箱注册需要配置支持 TLS 或 STARTTLS 的 SMTP；用户名注册可通过 `USERNAME_REGISTRATION_ENABLED=true` 开启，无需 SMTP，支持 3–32 位小写字母、数字、下划线或短横线，注册后直接登录，但暂不支持通过邮件找回密码。
- **域名与隔离：** 设置 `ADMIN_ORIGIN` 为外部可见的精确管理端 origin，并在 HTTPS 下设置 `COOKIE_SECURE=true`。工作空间应用托管需配置 `APPS_DOMAIN` 与通配符 DNS/HTTPS，并将原始 `Host` 头转发给页面服务。管理域与应用域分属不同可注册域时隔离最强；若演示环境只有一个可注册域，可显式设置 `SINGLE_DOMAIN_HOSTING=true` 并将 `APPS_DOMAIN` 指向子域（如 `apps.hostlet.cn`），功能保持不变，但浏览器隔离由跨站降为同站跨 origin，系统会强制启用 `__Host-` Cookie 和严格 Origin 校验。面向受信任小团队的受控单 IP 模式说明见[单 IP 部署说明](docs/single-ip-deployment.md)。
- **账号、空间与保留：** 用户账号与工作空间独立于原有单管理员页面，旧页面不会自动归属给新账号；如需将旧页面迁移至已验证账号，请使用[旧页面离线迁移](docs/legacy-migration.md)流程。应用默认私有，编辑器或管理员可将其公开或创建可撤销、可选密码保护的分享链接；工作空间支持配额与停用管理。每个应用最多保留 20 个版本（含当前生效版本），版本删除若中途中断会在启动时恢复清理，待清理文件仍计入空间配额。管理员可配置长期保留或按不活跃期限清理并提前邮件提醒（默认长期保留），详见[保留策略说明](docs/retention.md)。已验证账号可在确认当前密码后注销账号：个人应用会被删除，团队应用继续归团队所有（团队最后一名所有者须先转移所有权），会话撤销并保留匿名化外键锚点；注销中断时会在启动服务前恢复。
- **应用托管限制：** 工作空间 ZIP 上传时若留空入口路径，系统会自动识别单个 HTML 入口；发现多个候选入口时会提示选择（最多返回 200 个候选路径且总路径不超过 64 KiB，超出需显式指定入口）。工作空间应用拥有独立根路径，子目录下的 `index.html` 可通过以 `/` 结尾的路径访问，不提供 SPA fallback 路由。应用在访客浏览器中执行，切勿在上传文件中包含私密密钥。
- **单管理员私有页面：** 旧版单管理员私有页面共用配置的 `ADMIN_PASSWORD`（分享密码即等同分享管理员权限）。私有资源链接包含有效期 7 天的签名票据，持有该 URL 的用户在过期前均可访问对应版本；上传页面运行在不含 `allow-same-origin` 的 CSP 沙箱中，浏览器存储及部分依赖同源的脚本不可用。

## 存储、日志与限制

- **数据与备份：** SQLite 元数据、会话与审计记录保存在 `data/hostlet.sqlite`，发布文件保存在 `data/storage/sites/<id>/releases/`。备份时需先停止服务，将整个 `data/` 目录与 `.env` 一并备份；恢复时须保持相同的绝对存储路径，因为数据库记录了历史发布路径。
- **安全事件日志：** 服务默认将脱敏后的 HTTP 安全事件写入 `data/security-logs/`，按 UTC 日期轮转并默认保留 180 天（可通过 `SECURITY_LOG_RETENTION_DAYS` 调整）。日志绝不记录请求体、Cookie、查询参数、密码或含令牌的 URL。公开运营前请阅读[安全日志说明](docs/security-logging.md)。
- **上传与归档限制：** 默认单次上传上限为 50 MiB（`MAX_UPLOAD_BYTES`）。标准 ZIP 压缩包最多包含 4,000 个条目（含目录）、2,000 个文件，单文件解压不超过 25 MiB，解压总大小不超过 100 MiB；不支持 ZIP64，压缩包必须包含配置或识别到的入口文件，不安全路径将被拒绝。

## 部署

- 不使用 Docker、直接在 Ubuntu 宿主机运行 systemd 与 Nginx 的单域部署方案见[宿主机部署说明](docs/host-deployment.md)。
- 单机容器部署示例、中断恢复边界与历史验收说明见[单机部署说明](docs/deployment.md)。
- 受控单 IP 试用配置与隔离边界见[单 IP 部署说明](docs/single-ip-deployment.md)。

生产部署注意事项：

- 为管理端与托管内容使用独立的 HTTPS 主机名（推荐分属不同可注册域），将管理域名转发到 `3000` 端口、内容域名转发到 `8080` 端口，切勿在内容域名暴露管理 API。
- 将 `PUBLIC_BASE_URL`、`ADMIN_ORIGIN` 与 `ADMIN_ORIGINS` 设置为真实外部地址，HTTPS 下设置 `COOKIE_SECURE=true`。
- 保留平台输出的内容 CSP 与 MIME 响应头；确保含授权票据的 URL 不写入代理访问日志，并为私有内容禁用共享缓存。
- 默认不信任转发头；使用反向代理时须将 `TRUSTED_PROXY_IPS` 配置为代理的具体 IP 或 CIDR，并阻止外部直连后端端口。
- 仅运行单个应用实例（标准入口通过 `data/.hostlet-instance-lock` 防止多实例并发写入同一 SQLite 与存储目录）。`.env`、`data/` 与构建产物均已排除在版本控制之外。

## 参与贡献与安全

提交 Pull Request 前请阅读[贡献指南](CONTRIBUTING.md)。安全漏洞请按[安全政策](SECURITY.md)通过 GitHub 私密安全公告报告，不要发到公开 Issue。
