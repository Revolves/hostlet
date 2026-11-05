# 变更记录

本文件记录用户可见的功能、兼容性和部署变化。格式参考 Keep a Changelog；项目尚未建立正式版本发布流程。

## [Unreleased]

### Added

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

### Changed

- 统一官网、登录页、举报页、账户门户和管理导航的返回路径与视觉入口。
- 首页顶部导航精简为品牌、语言切换和工作台入口，移除与首屏 CTA 重复的区块锚点。
- 启动日志改为 `Hostlet workspace:`，明确管理入口已统一到 `/workspace`。
- 新建 API 凭据默认包含读取、发布和分享权限，并在界面显示凭据权限范围。
- 中英文 README 区分源码运行与本地 npm 安装，并补充命令帮助、凭据作用域、JSON 输出和错误恢复说明。

### Fixed

- 修正实例锁和单 IP 启动测试对旧启动日志的断言，并为子进程启动增加超时和错误输出。
- 修正发布幂等迁移测试对旧 schema 版本的硬编码，改为读取当前最新版本。

### Verification

- `npm test`：365 项，363 通过、0 失败、2 跳过（Windows 符号链接和 POSIX 权限条件）。
- `npm run build`：通过，46 个前端模块。
- 新增 8 项 CLI 帮助、版本、未知命令、凭据脱敏和打包清单测试。本地 tarball 在 Windows 干净目录安装成功，`--help`、`--version` 和 `help share` 均通过。
- 官网在真实 Chromium 中完成 1440px 桌面、390px 和 320px 移动视口检查；覆盖分页加载、搜索、空状态、接口失败重试、中英文切换、SEO 元数据和横向溢出。
- 尚未发布到公共 npm registry，也未完成 Linux/macOS 安装验证、目标域名、HTTPS、真实邮件和真实移动设备验收。
