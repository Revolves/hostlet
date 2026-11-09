export const skillInstallCommand = "npx --yes hostlet-skill@latest install";

export const publicInstall = {
  "zh-CN": {
    title: "把安装这一步，也交给 AI。",
    description: "复制下面的对话，发给支持终端与 Skill 的 AI 助手。它会检查环境并安装最新版本。",
    commandLabel: "安装最新版本",
    promptLabel: "发给 AI 助手",
    prompt: "请帮我安装最新版 Hostlet 发布 Skill。先确认当前助手支持的技能目录，并检查 Node.js 与 npm 环境；需要 Node.js 22.13 或以上。运行 npx --yes hostlet-skill@latest install，必要时使用 --target 指定当前助手的技能目录。如果已有安装，先检查是否会覆盖本地修改。安装后验证 Skill 文件和随附 CLI 可用，并告诉我是否需要开启新会话。遇到错误请明确说明原因。安装完成后先停下，等我指定要发布的项目，再进行账号授权与发布。项目地址：https://github.com/Revolves/hostlet。",
    note: "需要 Node.js 22.13+。安装后开启新会话加载 Skill；首次发布时再授权账号与凭据。",
    copy: "复制",
    copied: "已复制",
    failed: "复制失败，请选中文字手动复制。",
  },
  en: {
    title: "Let your AI assistant handle setup, too.",
    description: "Copy this message to an AI assistant with terminal and Skill support. It will check your environment and install the latest version.",
    commandLabel: "Install the latest version",
    promptLabel: "Send this to your AI assistant",
    prompt: "Please install the latest Hostlet publishing Skill for me. First identify the skills directory supported by this assistant and check Node.js and npm; Node.js 22.13 or newer is required. Run npx --yes hostlet-skill@latest install, using --target for this assistant's skills directory if needed. If an installation exists, check for local changes before overwriting it. Verify the installed Skill files and bundled CLI, and tell me whether I need a new session. Explain any installation errors clearly. Stop after setup and wait for me to choose a project before account authorization or publishing. Project: https://github.com/Revolves/hostlet.",
    note: "Requires Node.js 22.13+. Start a new session after installation. Account and credential authorization happens when you are ready to publish.",
    copy: "Copy",
    copied: "Copied",
    failed: "Could not copy. Select the text and copy it manually.",
  },
};
