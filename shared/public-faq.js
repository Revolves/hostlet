export const publicFaq = {
  "zh-CN": {
    title: "关于 Hostlet 的常见问题",
    items: [
      ["Hostlet Skill 可以做什么？", "让 AI 助手通过 CLI 发布静态项目、更新已有应用和查询版本。首次使用需要账号与凭据授权，新应用默认私有；公开访问可在工作台设置。"],
      ["应该在哪里安装 Skill？", "请查看 GitHub 仓库中的 Hostlet Skill 安装说明，按你的 AI 助手支持的技能目录进行配置，并启动新会话加载技能。"],
      ["Hostlet 是什么？", "Hostlet 是由 Revolves 开发的 MIT 开源静态应用托管平台，通过发布 Skill 帮助 AI 创作者和团队交付 HTML 页面、报告与静态应用。"],
      ["可以发布哪些文件？", "可以上传单个 HTML 文件或包含完整静态站点的 ZIP 包，保留资源目录和入口文件。"],
      ["支持后端服务和数据库吗？", "Hostlet 只托管静态文件。应用脚本在访客浏览器中运行，不提供用户后端服务或应用数据库。"],
      ["私有应用会出现在公开目录吗？", "不会。公开目录仅展示当前可公开访问的应用，不收录私有应用、分享链接和临时预览。"],
      ["发布后可以恢复旧版本吗？", "可以。Hostlet 保留发布版本，支持版本管理与回滚。"],
      ["在哪里查看源码或反馈问题？", "Hostlet 的源码、提交记录、版本发布和问题反馈入口位于 GitHub 的 Revolves/hostlet 仓库。"],
    ],
  },
  en: {
    title: "Frequently asked questions about Hostlet",
    items: [
      ["What is Hostlet?", "Hostlet is an MIT-licensed, open-source static application hosting platform developed by Revolves with a publishing Skill for AI creators and teams delivering pages, reports, and static apps."],
      ["What files can I publish?", "Upload a single HTML file or a ZIP archive containing a complete static site, keeping its resource directories and entry file."],
      ["Does Hostlet run backend services or databases?", "Hostlet hosts static files only. Application scripts run in the visitor's browser. It does not provide user backend services or application databases."],
      ["Are private applications listed publicly?", "No. The public directory lists only applications that are currently public. Private apps, share links, and temporary previews are excluded."],
      ["Can I restore an earlier release?", "Yes. Hostlet keeps published releases and supports version management and rollback."],
      ["Where can I find the source or report an issue?", "Source code, commit history, releases, and issue reporting are available in the Revolves/hostlet repository on GitHub."],
    ],
  },
};
