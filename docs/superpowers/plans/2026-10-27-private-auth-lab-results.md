# 阶段 0 私有应用授权实验计划与结果

**目标：** 在独立、一次性、本地 HTTP 实验中验证私有应用票据兑换和资源授权，不改动生产系统。

**范围与设计：** `auth.localhost` 是模拟可信授权域，`a.localhost` 和 `b.localhost` 是两个不同应用 origin；全部仅绑定回环。可信域使用固定演示密码签发 30 秒有效、随机、单次且绑定应用的票据，303 跳转到该应用 `/exchange`。兑换后设置无 Domain 的 HttpOnly、SameSite=Lax、Path=/、60 秒 host-only cookie，再重定向到不含票据的 `/`。每次 HTML、CSS、JS、图片请求都检查服务端内存会话的应用和有效期；可信域撤销会删除该应用所有未兑换票据及会话。固定资源为代码中的演示字符串，不访问现有 data 或上传文件。仅允许三个精确 Host，包含实际监听端口；其他 Host 返回 421。

**文件：** `test/isolation-lab/private-auth-server.mjs`（实验服务）、`test/isolation-lab/private-auth.test.mjs`（HTTP 自动测试）。保留原 `server.mjs` 和所有现有文件。

**执行步骤：**

- [x] 编写 HTTP 测试：资源未经授权拒绝，票据跨应用、重放、过期和撤销；cookie 跨应用、过期、撤销；每个资源检查；未知 Host、无效密码、重复 cookie 拒绝。
- [x] 实现内存票据与会话服务，运行自动测试；以可控时钟模拟过期，不等待实际时长。
- [x] 使用真实浏览器检查授权跳转、加载资源、cookie 脚本不可见、跨应用拒绝和撤销后的拒绝。
- [x] 记录本地实验的证据与未验证事项。不提交代码。

## 复现

在仓库根目录，Node.js 22.13+：

```powershell
node --test test/isolation-lab/private-auth.test.mjs
node test/isolation-lab/private-auth-server.mjs
```

第二个命令保持运行，打开 `http://auth.localhost:43172/`，选择 a 并输入页面上的演示密码 `lab-only`。成功后跳转到 `http://a.localhost:43172/`，页面显示 `script loaded`，开发者工具 Network 可看到 `/`、`/nested/style.css`、`/nested/app.js`、`/nested/image.svg` 均为 200，且最终地址不含票据。应用页面执行 `document.cookie` 不显示 `lab_session`；访问 `http://b.localhost:43172/nested/app.js` 返回 401。要验证撤销，在可信域控制台执行：

```js
fetch('/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'app=a&password=lab-only' }).then(r => r.status)
```

返回 204 后访问 `http://a.localhost:43172/nested/style.css` 返回 401。关闭服务使用 Ctrl+C；端口冲突可设置 `PRIVATE_LAB_PORT`。自动测试使用随机本地端口。若环境阻止回环连接，须在允许本机回环的环境执行。

## 本次证据（2026-10-27）

- Node v22.21.1：沙箱内回环连接失败 `fetch failed`；允许本机回环后，`node --test test/isolation-lab/private-auth.test.mjs`：1 个综合测试通过，0 失败。过期使用注入时钟，非真实等待。
- 真实浏览器：授权 POST 和票据兑换均为 303，最终 URL 为应用 `/`；HTML、CSS、JS、SVG 均 200，页面显示 `script loaded`；应用 `document.cookie` 为空，浏览器 cookie 元数据显示该实验 cookie 属于 `a.localhost` 且 HttpOnly。跨应用脚本读取被浏览器阻止，同时目标资源服务端返回 401；直接导航 b 的 JS 为 401。可信域撤销返回 204，随后 a 的 CSS 为 401。
- 上述浏览器检查使用本地 HTTP 和固定资源；自动测试覆盖的重放、过期及跨应用票据拒绝不等同于这些场景均已通过浏览器测试。未运行生产构建、现有系统回归或部署演练。

## 局限与待验证

- 演示密码公开，且所有状态仅在单进程内存中；没有真实身份、成员授权、分享密码、限流、持久化、多实例、审计和可靠清理，不具备生产认证能力。重启清空会话和票据。
- 本地 HTTP cookie 没有 Secure 或 `__Host-`；生产必须使用 HTTPS、Secure、HttpOnly、host-only、Path=/，并评估 `__Host-` 及反向代理的 Host/转发头。尚未验证真实 HTTPS、证书、通配 DNS、可注册域隔离和代理配置。
- 票据经过重定向 URL，虽然设有 `Referrer-Policy: no-referrer`、`Cache-Control: no-store` 且服务不记录请求，浏览器历史、代理/访问日志、监控和扩展仍可能暴露；未验证其完整泄漏路径或会话固定攻击。真实方案需设计安全交换及日志脱敏。
- 示例不实现 CSRF 防护，SameSite 不能解决同站跨 origin 请求或 cookie 投毒；生产必须验证 Origin/CSRF、授权域登录与撤销的攻击面及重复/域 cookie。实验只拒绝同名重复 cookie，未测试所有浏览器行为。
- 未测试 service worker、缓存、已交付数据、应用删除/域名回收、外部 API、真实 ZIP 或既有管理会话。撤销只能阻止未来经过服务器的请求，不能收回已下载内容，也不能据此推断已安装 worker 已被清除。
- 本实验不是阶段 0 全部验收或上线许可，不改变现有 CSP 和生产文件。
