# 变更记录

本文件记录用户可见的功能、兼容性和部署变化。格式参考 Keep a Changelog；项目尚未建立正式版本发布流程。

## [Unreleased]

### Added

- `hostlet-cli` 新增 `register`、`login`、`logout`、`whoami` 和 `keys list/create/revoke`，可从零完成注册、创建 API Key 和发布。
- CLI 将账户会话和 API Key 保存到用户凭据文件（`HOSTLET_CONFIG` 可覆盖），后续命令自动读取；`HOSTLET_TOKEN` 继续兼容并优先使用。
- `hostlet-skill` 安装器自带隔离 CLI 运行时和 `bin/hostlet` 包装脚本，无需全局安装 `hostlet-cli` 即可使用；新增 `--cli-version` 和 `--skip-cli`。
- 官网新增中英文 FAQ、JSON-LD 结构化数据、`robots.txt`、`sitemap.xml`、无 JavaScript 可读内容和 GitHub 入口。
- 官网新增中英文 Skill 安装指令与 AI 助手提示词的一键复制区，安装步骤仅到 Skill 就绪，不会提前要求账号授权或发布。
- `hostlet-cli@0.2.0` 与 `hostlet-skill@0.2.0` 已发布到公共 npm registry，并完成 Windows 干净安装与技能自带 CLI 验证。
- 官网中英文 AI 助手提示词已按公共 npm 包完成隔离安装演练；Windows Codex 默认技能目录安装、结构校验、随附 CLI 版本输出及新会话加载均已核验。
- 当前提交 `96f2341` 已发布到 `hostlet.cn` 宿主机，生产发布目录为 `/opt/hostlet/releases/20261109-96f234125a9f`；服务器隔离目录 386 项测试全通过，切换后健康检查、公网中英文安装区块和 13 项部署冒烟通过。
- `hostlet-cli` 发布到公共 npm registry，可直接 `npm install -g hostlet-cli`。
- `hostlet-skill` 发布到公共 npm registry，提供 `hostlet-skill install` 安装器，将发布 Skill 写入 Codex skills 目录。
- 公开官网首页，展示公开应用、搜索、最近更新/最多访问排序和累计访问数。
- 官网中英文切换、服务端分页/加载更多、搜索防抖、空状态和错误重试。
- 官网 SEO 元数据、canonical/hreflang、Open Graph/Twitter 分享卡片和中英文静态标题。
- 公开应用卡片的稳定色调、移动端适配、键盘焦点、跳转主内容和动态状态提示。
- 统一 `/workspace` 入口：多用户模式进入账户与团队工作台，单管理员模式进入页面管理工作区；`/console` 固定进入页面管理。
- 平台管理路由守卫，仅在多用户模式且托管地址有效时开放，并处理未登录和会话失效。
- 公开应用访问计数，只统计成功打开的公开入口文档，不统计静态资源、HEAD、私有分享或预览。
- 发布幂等回执、发布结果查询和 CLI 不确定结果恢复。
- 团队公开应用的轻量发布审核流程。
- CLI 版本回滚、分享列出/创建/撤销，以及 `share` API 凭据权限。
- CLI 独立 npm 包清单（`cli/package.json`）、包内 README/LICENSE 和 `npm run pack:cli`，可从本地 tarball 安装。
- `hostlet --help`、`hostlet help <command>`、`hostlet <command> --help` 和 `hostlet --version`；帮助与版本无需凭据即可运行。
- 邮箱或用户名注册；用户名账户注册后直接登录，不发送验证邮件，并明确提示无法通过邮件找回密码。
- 账户页新增独立 `API Key` 标签，可创建 30 天、包含读取/发布/分享权限的一次性凭据，并复制 CLI/Skill 配置示例。
- Hostlet 公开宣传应用，展示发布流程、能力、CLI/Skill 和 GitHub 入口。
- 单域兼容模式：显式设置 `SINGLE_DOMAIN_HOSTING=true` 后，可用 `apps.hostlet.cn` 这类管理域子域承载应用；默认仍要求独立可注册域。
- `hostlet.cn` 已启用单域多用户：`*.apps.hostlet.cn` 通配符证书、`__Host-` Cookie、用户名注册、账户 API Key 和 CLI 发布已连通。

### Changed

- 统一官网、登录页、举报页、账户门户和管理导航的返回路径与视觉入口。
- 首页顶部导航精简为品牌、语言切换和工作台入口，移除与首屏 CTA 重复的区块锚点。
- 启动日志改为 `Hostlet workspace:`，明确管理入口已统一到 `/workspace`。
- 新建 API 凭据默认包含读取、发布和分享权限，并在界面显示凭据权限范围。
- 中英文 README 区分源码运行与本地 npm 安装，并补充命令帮助、凭据作用域、JSON 输出和错误恢复说明。
- 官网公开目录按实例模式显示账户和举报入口；单管理员模式不展示不可用入口。

### Fixed

- 修正实例锁和单 IP 启动测试对旧启动日志的断言，并为子进程启动增加超时和错误输出。
- 修正发布幂等迁移测试对旧 schema 版本的硬编码，改为读取当前最新版本。
- 修正用户名注册成功后前端未立即进入工作区的问题。
- 修正公开宣传页入场动画覆盖布局变换、滚动揭示元素持续透明的问题。
- 为沙箱内托管页面所需的字体资源补充最小范围的 `Access-Control-Allow-Origin: *`。
- 修正 API Key 页面 CLI 示例被压成一行的问题。

### Verification

- 2026-11-10：使用新安装的 `hostlet-publish` 技能随附 CLI，在隔离本机实例完成注册、创建/撤销 API Key、登录/退出、工作空间查询、私有目录发布、发布回执、替换版本、版本列表、回滚、分享创建/列出/撤销和数据库状态核验，共 27 个命令步骤通过；测试账号、应用、凭据和数据目录均隔离在临时环境。
- 明确 Windows Agent 调用应使用 `hostlet.ps1`，避免 `.cmd` 经额外 shell 转发时拆分含空格参数；新增自动化与隔离实例回归。`hostlet-skill` 本地版本升级到 `0.2.1`，npm 公共包仍为 `0.2.0`，待恢复 registry 发布权限后再发布。

- Windows `npm test`：375 项，373 通过、0 失败、2 跳过（Windows 符号链接和 POSIX 权限条件）。
- Ubuntu 生产构建目录 `npm test`：373 项全部通过，0 失败、0 跳过。
- `npm run build`：通过，46 个前端模块。
- 单域兼容改动在 Ubuntu 发布目录完成 10 项关键回归，生产部署冒烟 13 项全部通过；`*.apps.hostlet.cn` 通配符证书已签发并启用。
- 公网单域端到端验收 8 项通过：用户名注册、自动登录、个人空间、API Key、API 发布、公开访问、通配符 TLS、公开目录收录；测试账号与应用已清理。
- 账户注册、API Key、账号路由、CLI 和 GitHub 配置定向回归：58 项通过。
- 新增 8 项 CLI 帮助、版本、未知命令、凭据脱敏和打包清单测试。本地 tarball 在 Windows 干净目录安装成功，`--help`、`--version` 和 `help share` 均通过。
- 官网在真实 Chromium 中完成 1440px 桌面、390px 和 320px 移动视口检查；覆盖分页加载、搜索、空状态、接口失败重试、中英文切换、SEO 元数据和横向溢出。
- 隔离多用户实例完成真实浏览器注册、自动登录、API Key 创建及 Bearer CLI 空间查询。
- `https://hostlet.cn/p/hostlet/` 已上线，公开目录已收录；桌面和 320/390px 窄屏检查通过，入口访问计数正常。
- `hostlet-cli@0.1.0` 与 `hostlet-skill@0.1.0` 已发布到公共 npm registry，并在 Windows 干净目录完成安装、版本输出和 Skill 文件写入验证；Linux/macOS 实机安装验证仍待补。
- Windows 全量回归 386 项：384 通过、2 项按平台条件跳过、0 失败；`npm run build` 通过（48 个模块）。`hostlet.cn` 与 GitHub `master` 同步到 `a7f1b2f`，生产服务对应 `96f2341` 发布目录并处于 active。
