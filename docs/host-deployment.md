# Ubuntu 宿主机部署

本方案不使用 Docker：Node.js 由 systemd 运行，Nginx 作为唯一公网入口。它面向单域实例（单管理员或单域多用户），官网、管理工作台和 `/p/<slug>/` 托管页面共用管理域；多用户应用使用 `*.apps` 子域。`www` 入口统一 301 到裸域。

仓库中的模板位于 [`deploy/host/`](../deploy/host/)：

- `bootstrap-ubuntu.sh`：安装 Node.js 22、Nginx、Certbot 和基础工具，并创建 `hostlet` 系统用户。
- `configure-host.sh`：生成受限环境文件、随机管理员密码和可选的自签名证书。
- `hostlet.service`：单实例 systemd 服务，限制应用只能写入数据目录。
- `nginx.hostlet.conf.example`：单域名反向代理示例。
- `smoke-test.sh`：验证 HTTP 跳转、HTTPS、健康检查、登录、会话和公开目录。
- `certbot-deploy-hook.sh`：证书续期后同步证书并重载 Nginx。
- `issue-apps-wildcard.sh`：交互式申请 `*.apps` 通配符证书、安装到 `/etc/hostlet/tls/` 并重载 Nginx。

## 目录与端口

| 项目 | 路径或地址 |
| --- | --- |
| 源码 | `/opt/hostlet/app` |
| 数据 | `/var/lib/hostlet` |
| 环境与密钥 | `/etc/hostlet/hostlet.env` |
| 初次管理员密码 | `/etc/hostlet/initial-admin-password` |
| 证书副本 | `/etc/hostlet/tls/` |
| 官网与管理端 | `127.0.0.1:3000` |
| 托管页面 | `127.0.0.1:8080` |
| 公网入口 | Nginx `80/443` |

应用端口必须只绑定回环地址。单域名下，Nginx 将 `/p/` 转到 `8080`，其余路径转到 `3000`。不要把 `3000` 或 `8080` 直接暴露到公网。

## 前置条件

1. 使用 Ubuntu 22.04/24.04 ARM64 或 AMD64 主机，并具备 `sudo` 权限。
2. 防火墙与云安全组只公开所需的 SSH、HTTP 和 HTTPS 端口。
3. 根域名 A 记录指向服务器公网 IPv4。需要 `www` 时，为它单独添加 A 记录，并在申请证书时同时包含 `www`；当前 `hostlet.cn` 与 `www.hostlet.cn` 均已指向同一入口。
4. 证书签发前，确保公网可通过 `http://<域名>/.well-known/acme-challenge/` 访问 Nginx 的 `/var/www/html`。

## 安装运行时

在源码副本中执行：

```sh
sudo bash deploy/host/bootstrap-ubuntu.sh
```

脚本固定安装 Node.js `22.21.1`，校验官方 SHA-256 后解压到 `/opt/node22`。可通过 `NODE_VERSION` 覆盖版本，但必须满足项目的 Node.js 最低版本要求。

## 部署应用

将源码复制到 `/opt/hostlet/app` 后执行：

```sh
cd /opt/hostlet/app
npm ci
npm test
npm run build
npm prune --omit=dev
sudo chown -R root:root /opt/hostlet/app
sudo chmod -R a-w /opt/hostlet/app
```

只运行一个应用实例。SQLite、进程内会话和限流状态不支持多实例共享同一数据目录。升级前先备份，再在停服务或独立测试目录中完成测试。

## 配置密钥

首次配置：

```sh
sudo bash deploy/host/configure-host.sh hostlet.cn
```

脚本会以密码学安全随机值生成 `ADMIN_PASSWORD` 和 `APP_SECRET`，创建：

- `/etc/hostlet/hostlet.env`，权限 `0640 root:hostlet`
- `/etc/hostlet/initial-admin-password`，权限 `0600 root:root`

需要轮换配置时显式传入 `--replace`；脚本会保留带 UTC 时间戳的环境文件备份。不要把真实密钥、环境文件或管理员密码提交到版本库、截图或工单。

官网的 GitHub 入口由 `PUBLIC_GITHUB_URL` 控制，默认使用 `https://github.com/Revolves`。创建正式仓库后，将值改为 `https://github.com/<owner>/<repo>`，并按需设置 `PUBLIC_GITHUB_LABEL`；服务端只接受 `https://github.com/<owner>[/<repo>]`，空值会隐藏该区块。

在 DNS 与正式证书准备期间，可附加 `--self-signed` 生成 30 天临时证书。该证书只用于部署验收，浏览器会提示不受信任。

## 账户注册与 API Key

默认的单管理员部署保持：

```dotenv
MULTIUSER_ENABLED=false
REGISTRATION_ENABLED=false
USERNAME_REGISTRATION_ENABLED=false
```

该模式不提供账户注册、API Key 或 CLI/Skill 发布入口，只使用管理员密码管理页面。

启用多用户时，注册方式可以独立配置：

- 邮箱注册：配置 `SMTP_HOST` 等邮件参数，并设置 `REGISTRATION_ENABLED=true`。账户必须先打开验证邮件，才能登录。
- 用户名注册：设置 `MULTIUSER_ENABLED=true`、`REGISTRATION_ENABLED=true` 和 `USERNAME_REGISTRATION_ENABLED=true`，不需要 SMTP。用户名为 3 到 32 位小写字母、数字、下划线或短横线，注册成功后直接建立会话。
- 两种方式可以同时开启。用户名账户无法通过邮件找回密码，界面和文档必须保留这一限制提示。

登录账户后，可在账户页的 `API Key` 标签创建 30 天凭据；也可以直接运行 `hostlet register` 或 `hostlet login`，由 CLI 创建并保存凭据。凭据包含 `read`、`publish` 和 `share` 权限，只在创建时显示一次，可随时撤销。CLI 默认读取本地凭据文件，`HOSTLET_TOKEN` 仍可用于自动化并优先使用；官方实例默认使用 `https://hostlet.cn`，自建实例用 `HOSTLET_URL` 覆盖。`hostlet-skill` 安装器会自带隔离的 CLI，无需全局安装。不要把管理员密码、API Key、账户会话或完整环境文件写入仓库、截图和日志。

用户发布应用还需要完整的托管地址。默认推荐使用独立的可注册域：

```dotenv
APPS_DOMAIN=content.example.com
```

`content.example.com` 必须是与管理域不同的可注册域，并配置通配符 DNS、覆盖通配符的 HTTPS 证书、Nginx Host 路由和应用服务转发。默认模式会拒绝把 `hostlet.cn` 或它的子域作为应用域，因为管理 Cookie 与用户上传内容不能共享同一个可注册域。仅启用注册但没有有效应用域时，用户可以登录和创建 API Key，却无法完成可访问的应用发布。

### 单域兼容模式

如果演示实例只准备了一个可注册域，可以显式开启兼容模式，让管理端和应用使用同一注册域下的不同子域：

```dotenv
MULTIUSER_ENABLED=true
REGISTRATION_ENABLED=true
USERNAME_REGISTRATION_ENABLED=true
COOKIE_SECURE=true
SINGLE_DOMAIN_HOSTING=true
ADMIN_ORIGIN=https://hostlet.cn
APPS_DOMAIN=apps.hostlet.cn
```

应用地址形如 `https://<应用ID>.apps.hostlet.cn/`。DNS 只需一条 `*.apps` 的 A 记录，HTTPS 使用覆盖 `*.apps.hostlet.cn` 的通配符证书；不需要为每个应用添加 DNS 或证书。

单域模式会把管理端和应用从“跨站”降为“同站、跨 origin”。代码会使用 `__Host-` 前缀的管理和账户 Cookie、host-only Cookie、严格的 Origin 校验和既有 CSP；但 `SameSite` 不再提供跨站边界，安全隔离弱于双域模式。这个模式适合开源演示或受控使用，不建议作为面向不可信公网用户的最强隔离方案。默认 `SINGLE_DOMAIN_HOSTING=false`，未显式开启时仍拒绝同注册域应用。

截至 2026-11-09，`hostlet.cn` 已启用单域多用户模式：`MULTIUSER_ENABLED=true`、`REGISTRATION_ENABLED=true`、`USERNAME_REGISTRATION_ENABLED=true`、`SINGLE_DOMAIN_HOSTING=true`、`APPS_DOMAIN=apps.hostlet.cn`。注册方式当前只开放用户名，邮箱注册和邮件找回密码尚未启用。宣传展示页 `https://hostlet.cn/p/hostlet/` 继续作为公开应用展示。

## 启动应用

```sh
sudo install -m 0644 deploy/host/hostlet.service /etc/systemd/system/hostlet.service
sudo systemctl daemon-reload
sudo systemctl enable --now hostlet
sudo systemctl status hostlet
```

本机检查：

```sh
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:8080/health
ss -lntp | grep -E ':(3000|8080)\b'
```

两个健康接口应返回 `{"ok":true}`，应用端口应只出现在 `127.0.0.1`。

## 配置 Nginx

单管理员或双域部署复制 [`nginx.hostlet.conf.example`](../deploy/host/nginx.hostlet.conf.example)。单域兼容模式复制 [`nginx.single-domain.conf.example`](../deploy/host/nginx.single-domain.conf.example)，并确认 `apps.hostlet.cn`、证书路径和应用端口。替换示例域名后再重载：

```sh
sudo nginx -t
sudo systemctl reload nginx
```

该配置默认拒绝未知 TLS Host，关闭共享缓存、代理请求缓冲和 Nginx URI 访问日志，并覆盖客户端提供的转发头。私有页面授权 URL 可能出现在请求路径中，因此排障与安全审计使用应用写入 `/var/lib/hostlet/security-logs/` 的脱敏路由日志。`TRUSTED_PROXY_IPS=127.0.0.1` 只信任本机 Nginx。

## 正式证书

DNS 生效后：

```sh
sudo install -d -o www-data -g www-data -m 0755 /var/www/html
sudo certbot certonly --webroot --webroot-path /var/www/html \
  -d hostlet.cn -d www.hostlet.cn --non-interactive --agree-tos --register-unsafely-without-email
```

单域兼容模式还需要覆盖 `*.apps.hostlet.cn` 的通配符证书。通配符证书必须使用 DNS-01 验证；可以用 DNS 服务商 API 或支持 DNS-01 的 ACME 客户端申请，并将证书同步为：

```text
/etc/hostlet/tls/apps-fullchain.pem
/etc/hostlet/tls/apps-privkey.pem
```

不要使用 HTTP-01 申请通配符证书。部署前确认 `apps.hostlet.cn` 的 `*.apps` A 记录已生效，且 Nginx 的应用块将请求转发到 `127.0.0.1:8080`。

也可以直接运行交互式脚本，按提示在 DNS 服务商添加 TXT 记录：

```sh
sudo bash deploy/host/issue-apps-wildcard.sh apps.hostlet.cn
```

脚本会把证书安装为 `/etc/hostlet/tls/apps-fullchain.pem` 和 `apps-privkey.pem`，并在 `nginx -t` 通过后重载 Nginx。手工 DNS-01 证书不会自动续期；到期前重复执行脚本，或改为 DNS 服务商 API 插件。

如果应用域由独立证书 lineage 管理，把 [`certbot-apps-deploy-hook.sh`](../deploy/host/certbot-apps-deploy-hook.sh) 安装为 deploy hook，用于同步 `apps-fullchain.pem` 和 `apps-privkey.pem`：

```sh
sudo install -m 0755 deploy/host/certbot-apps-deploy-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/hostlet-apps-sync-certificate
```

安装续期同步钩子并立即同步一次：

```sh
sudo install -m 0755 deploy/host/certbot-deploy-hook.sh \
  /etc/letsencrypt/renewal-hooks/deploy/hostlet-sync-certificate
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/hostlet.cn \
  /etc/letsencrypt/renewal-hooks/deploy/hostlet-sync-certificate
```

验证续期流程时不执行目录钩子，避免测试证书覆盖生产证书：

```sh
sudo certbot renew --dry-run --no-directory-hooks
systemctl list-timers certbot.timer
```

2026-11-09 已将证书扩签为 `hostlet.cn` 与 `www.hostlet.cn`，并额外签发 `*.apps.hostlet.cn` 通配符证书，均有效期至 2027-02-07；`www` 按 Nginx 规则返回 301 到裸域，应用子域使用独立证书。`certbot.timer` 负责管理域证书自动续期，部署钩子会把证书同步到 `/etc/hostlet/tls/` 并重载 Nginx。`*.apps.hostlet.cn` 是手工 DNS-01 证书，不会自动续期，到期前须重新执行 `issue-apps-wildcard.sh` 或改用 DNS 服务商 API 插件。

同一日期完成新版应用部署：服务器独立目录的 373 项测试全部通过，生产构建 46 个模块；线上版本备份为 `/opt/hostlet/app.20261109T050300Z.bak`。13 项部署冒烟全部通过，`https://hostlet.cn/p/hostlet/` 作为公开宣传应用发布并进入公开目录。页面使用 CSP 沙箱，因此静态服务只对字体扩展名发送 `Access-Control-Allow-Origin: *`，避免浏览器把托管页字体请求视为无 CORS 的跨源请求。

同日晚些时候已将单域兼容服务端代码发布到 `/opt/hostlet/releases/20261109T142000Z`，旧版本备份为 `/opt/hostlet/app.20261109T142000Z.bak`。发布前在服务器独立目录完成 10 项单域关键回归；签发 `*.apps.hostlet.cn` 通配符证书后启用单域多用户，13 项部署冒烟全部通过。公网端到端验收覆盖用户名注册、自动登录、API Key、API 发布、公开访问、公开目录收录和测试数据清理；测试账号与应用均已删除。

## 部署验收

正式证书生效后：

```sh
curl -fsSI https://hostlet.cn/
sudo bash deploy/host/smoke-test.sh hostlet.cn 127.0.0.1
```

冒烟脚本默认校验证书。自签名阶段可设置 `HOSTLET_INSECURE=1`，但这只允许用于临时验收。还应从外部网络检查：

- `http://hostlet.cn/` 返回 301 到 `https://hostlet.cn/`
- HTTPS 返回 200，证书主机名和有效期正确
- `https://www.hostlet.cn/` 返回 301 到 `https://hostlet.cn/`
- 未知 TLS 主机被关闭，不会进入应用
- 管理 API 未登录返回 401，错误 Origin 返回 403
- 官网桌面与移动端、中英文切换、搜索和排序正常
- 公开宣传页 `https://hostlet.cn/p/hostlet/` 的字体、CSS、脚本和访问计数正常

自动化测试覆盖应用逻辑，但不能替代真实公网、证书、浏览器和目标数据演练。

## 备份与升级

备份前停止服务，确保 SQLite、会话和异步写入静止：

```sh
sudo systemctl stop hostlet
sudo tar -C /var/lib/hostlet -czf /secure/backup/hostlet-data-$(date -u +%Y%m%dT%H%M%SZ).tar.gz .
sudo systemctl start hostlet
```

恢复时保持数据目录绝对路径不变，并同时保留 `/etc/hostlet/hostlet.env`。升级时先备份，再替换源码、执行 `npm ci`、`npm test`、`npm run build`、`npm prune --omit=dev`，最后重启服务并重跑冒烟检查。

应用会把脱敏安全事件写入 `/var/lib/hostlet/security-logs/`。该目录也须纳入磁盘容量、备份与访问权限管理。

## 2026-11-09 双语 SEO / GEO 更新

- 发布目录：`/opt/hostlet/releases/20261109-seo-bilingual`；上一版本为 `/opt/hostlet/releases/20261109T142000Z`，通过 `/opt/hostlet/app` 符号链接切换。
- 官网提供中文 `/` 与英文 `/?lang=en`，输出对应语言的标题、描述、canonical、hreflang、社交分享信息及 WebApplication JSON-LD。正文介绍、发布流程和常见问题在原始 HTML 中可直接读取，无须执行 JavaScript；FAQ 与浏览器界面共用双语内容。
- 增加 `/robots.txt` 与双语 `/sitemap.xml`，工作台等管理路由返回 `X-Robots-Tag: noindex, follow`。顶部署名为 Revolves，并增加仓库图标入口。
- 本地及服务器 11 项相关测试通过；生产构建通过；部署后 13 项冒烟检查通过。公网确认双语 HTML、结构化数据、robots、sitemap 和工作台 noindex 响应正常。
- 搜索排名、收录与 AI 引用由各平台决定。本次未操作 Search Console 或第三方站长账号。
- 优化依据：[Google AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)，以可抓取正文、准确内容和与页面一致的结构化信息为基础。
- 浏览器复验：英文首屏正常展示 Revolves 署名、GitHub 入口和英文 FAQ；点击中文链接后，标题、正文和 FAQ 切换为中文。
- 额外全量测试运行在第 160 项后未继续输出，已停止等待；不将其记为全量通过。本次完成状态以相关 11 项测试、构建、公网响应及 13 项生产冒烟为依据。

## 2026-11-10 可见性命令发布

- 发布目录：`/opt/hostlet/releases/20261110-3d92e5c`，上一版本为 `/opt/hostlet/releases/20261109-96f234125a9f`；通过 `/opt/hostlet/app` 符号链接切换后重启 `hostlet` 服务。
- 变更内容：`hostlet-cli@0.2.1` 新增 `visibility public|private`（`/api/cli` 路由放行 PATCH，要求 `publish` 权限，团队空间需所有者角色）；安装器生成的 `hostlet.ps1` 改为转发管道输入，修复 `--password-stdin` 失效。
- 服务器端在发布目录执行 `npm test`：390 项全部通过、0 跳过、0 失败；`npm run build` 通过。切换后健康检查 200，`deploy/host/smoke-test.sh` 13 项全部通过。
- 公网验证：对应用 `w-08e11a575b619a23c7344fbfa314a974` 执行 `visibility private` 后入口返回 401，执行 `visibility public` 后返回 200。
- 回滚方式：把 `/opt/hostlet/app` 指回 `/opt/hostlet/releases/20261109-96f234125a9f` 并重启服务。
