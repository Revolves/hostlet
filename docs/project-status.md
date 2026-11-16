# Hostlet 项目状态

更新时间：2026-11-10

本文是当前面向用户和贡献者的统一口径。版本、测试数量、官方实例配置与发布能力以本文为准；`docs/superpowers/` 下的设计、计划和实验记录是当时的历史材料，不代表实时状态。

## 产品定位

Hostlet 是一个 MIT 开源的静态前端应用托管平台，使用 Express、SQLite 和 React/Vite。它提供个人空间、团队空间、HTML/ZIP/目录发布、版本回滚、私有访问、公开目录、分享链接和 API Key；只托管静态文件，不执行用户服务端代码，也不提供应用数据库或 SPA fallback。

## 官方实例

- 管理端与官网：<https://hostlet.cn>
- 用户应用：`https://<应用ID>.apps.hostlet.cn/`
- 公开宣传应用：<https://hostlet.cn/p/hostlet/>（历史短地址）
- 运行模式：单域多用户、单域兼容托管
- 注册方式：当前仅开放用户名注册；邮箱注册和邮件找回密码尚未启用

## 当前版本

| 组件 | 当前版本 | 说明 |
| --- | --- | --- |
| `hostlet-cli` | `0.2.3` | 发布成功后返回 `applicationUrl` 与 `managementUrl`；支持域名和单 IP 托管地址 |
| `hostlet-skill` | `0.2.6` | 固定依赖 `hostlet-cli@0.2.3`；要求发布前确认完整发布信息，发布后返回可点击链接 |

两个包均通过 npm Trusted Publishing 发布到官方 registry。技能默认安装到 `$CODEX_HOME/skills/hostlet-publish`，并自带隔离 CLI。

## 最新验证

- Windows 完整回归：400 项，398 通过、2 项按平台条件跳过、0 失败。
- 前端生产构建：48 个模块通过。
- GitHub Actions：Node.js 22.13 与 Node.js 24 的 CI 通过；CLI 与技能发布工作流通过。
- 技能安装：默认目录安装成功，内置 `hostlet --version` 输出 `hostlet-cli 0.2.3`。
- 服务端部署：官方站点当前运行 `793d9d5` 对应的服务端版本；后续 CLI、技能和文档发布不要求重新部署网站服务端。

## 文档口径

- 中文入口：根目录 [`README.md`](../README.md)
- 英文入口：根目录 [`README.en.md`](../README.en.md)
- CLI 包说明：[`cli/README.md`](../cli/README.md)
- 技能包说明：[`skills/hostlet-publish/README.md`](../skills/hostlet-publish/README.md)
- 安全政策与漏洞报告：[`SECURITY.md`](../SECURITY.md)
- 生产宿主机部署与历史发布记录：[`host-deployment.md`](host-deployment.md)
- 功能核验与剩余边界：[`feature-verification-2026-10-30.md`](feature-verification-2026-10-30.md)

## 仍需目标环境验收

真实邮件全链路、Linux/macOS 客户端实机、生产备份恢复演练、容量与滥用治理、公开运营合规及真实移动设备验收仍需在对应环境完成。自动化测试、合成数据和本机浏览器检查不能替代这些验收。
