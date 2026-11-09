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

将 `showcase/hostlet` 目录打包为 ZIP 后上传，入口文件为 `index.html`，标题为 `Hostlet · 把作品发布成一个地址`，访问路径建议使用 `hostlet`。

应用应保持公开状态，以便出现在官网公开目录中。

## 字体许可

页面使用 Manrope（SIL Open Font License 1.1），字体文件来自 `@fontsource-variable/manrope`。
