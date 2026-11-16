# Hostlet 宣传应用

这是 Hostlet 的公开演示应用，作为平台能力和发布流程的展示样例。

宣传页地址：<https://hostlet.cn/p/hostlet/>

用户在工作空间发布的应用使用 `<应用ID>.apps.hostlet.cn`；宣传页作为历史页面保留原来的短地址。

## 本地预览

在仓库根目录执行：

```sh
npx serve showcase/hostlet
```

## 发布

当前工作空间发布使用 `hostlet publish`，入口文件为 `index.html`，标题为 `Hostlet · 把作品发布成一个地址`，发布后使用随机应用 ID 子域。`/p/hostlet/` 仅用于保留历史短地址的单管理员页面。

应用应保持公开状态，以便出现在官网公开目录中。

## 页面交互与验收

页面包含滚动入场、轨道悬浮交互、Skill 安装命令与 Agent 提示词复制，以及原生可键盘操作的 FAQ。复制失败时提供手动复制提示；系统开启减少动态效果时关闭移动动效。官网、工作台和公开目录使用完整的官方地址，兼容应用子域托管。

本地可运行 `node node_modules/vite/bin/vite.js showcase/hostlet --host 127.0.0.1 --port 4178` 预览。验收桌面和 390px、320px 宽度布局，检查复制结果、FAQ 展开及所有外部入口。更新源码不代表线上展示应用已重新发布。

## 字体许可说明

页面使用 Manrope（SIL Open Font License 1.1），字体文件来自 `@fontsource-variable/manrope`。
