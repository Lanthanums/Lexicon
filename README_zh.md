# Lexicon

[English](README.md) · [下载 v1.0](https://github.com/Lanthanums/Lexicon/releases/tag/v1.0)

用于**形近辨析、近义词成群记忆、普通单词背诵**的本地 Windows 应用。暖纸色界面、主动回忆闪卡、可编辑笔记和本地备份，让不同类型的单词各得其所。

## 功能

- **形近辨析**：自动匹配形近词与同音词，调整阈值，手动整理分组。
- **近义词群**：选词建群，对照词义和用法，编辑例句与辨析笔记，再逐词背诵。
- **普通背词**：英文与中文释义即可离线录入；支持英→中、中→英、自评与重练。
- **复习抽查**：优先未学和到期的词，巩固模糊词；保留拼写、选择题与混合抽查。
- **桌面体验**：独立窗口、键盘操作、本地保存、每日快照、JSON 导入导出。使用发布版不需要额外运行 Node.js 控制台。

当前界面为中文。近义词群由用户选词和维护，暂不自动联网生成近义词群。

## 下载与使用

在 [Releases](https://github.com/Lanthanums/Lexicon/releases/tag/v1.0) 下载 Windows x64 发布文件：

| 文件 | 用途 |
| --- | --- |
| `Lexicon-Setup-v1.0-x64.exe` | 当前用户安装器。 |
| `Lexicon-v1.0-win-x64.zip` | 完整解压后运行 `Lexicon.exe`，保留同目录配套文件。 |
| `Lexicon-v1.0-source.zip` | 脱敏后的干净源码，不含 Git 历史和本地构建记录。 |
| `SHA256SUMS.txt` | 发布文件的 SHA256 校验值。 |

发布包**不含个人词库、学习记录、API 密钥、浏览器配置或本机日志**。全新配置启动时词库为空；内置示例仅在主动点击后载入。下载或启动空白包不会删除当前设备已有的数据。

安装器暂未进行代码签名。目前验证和提供的是 Windows x64 版本。

## 学习流程

1. 在「**单词记忆**」录入英文与中文释义；查词为可选操作，离线也可保存。
2. 在「**近义词群**」选择至少两个词，填写辨析笔记；编辑词条用法和例句，先看群内对照，再开始回忆。
3. 在「**形近辨析**」整理字形与读音相近的词；在「**综合抽查**」练习拼写和选择题。
4. 按 **Space** 翻面，按 **1 / 2 / 3** 自评认识、模糊、不认识；隐藏的学习页面不会响应评分快捷键。

普通背词每轮最多 20 词。认识按当前等级安排 1、3、7、14、30 或 60 天后复习；模糊或不认识安排 5 分钟后复习。这是固定调度规则，不代表测得了个人的真实记忆保持率。

## 本地数据与迁移

在「**设置与备份 → 打开数据与自动备份**」查看实际数据目录，通常为 `%APPDATA%/lexicon-desktop/`。备份包括 `backups/latest.json`、每日首份快照和导入前副本。

从早期浏览器版迁移：

1. 关闭旧版 Node.js 控制台，释放 3000 端口。
2. 在新版选择「**设置与备份 → 从旧版浏览器迁移**」。
3. 如果打开的不是原先使用的浏览器，将迁移助手网址复制到原浏览器。
4. 回到桌面版确认导入。源浏览器数据不会删除。也可从旧版导出 JSON，再导入新版。

导入会在确认后替换当前桌面词库，并保留导入前恢复副本。备份可能包含自行配置的词典 API 凭据，请妥善保存，不要公开上传。应用不提供云同步；在线查词会将查询词发送至所选服务，每日一词也需要网络。

## 开发与构建

需要 Node.js **22.12+ 或 24 LTS**、npm；桌面发布打包使用 Windows。

```sh
npm ci
npm run setup:electron
npm run dev
```

生产构建、运行桌面版与生成安装器：

```sh
npm run build
npm run desktop
npm run desktop:dist
```

安装器输出到 `release/`，免安装目录在 `release/win-unpacked/`。最终使用者无需安装 Node.js。如需 Electron 镜像，请在自己的环境设置 `ELECTRON_MIRROR` 后运行 `npm run setup:electron`；仓库不绑定本机镜像或凭据。

验证命令：

```sh
npm test
npm run build
npm run test:e2e
node tests/migration.e2e.cjs
```

迁移测试默认使用已安装的 Microsoft Edge，可通过 `LEXICON_BROWSER_CHANNEL` 或 `LEXICON_BROWSER_PATH` 指定其他支持的浏览器。测试使用合成词条和独立配置目录；可用 `LEXICON_ARTIFACT_DIR` 将报告保存到工程目录之外，用 `LEXICON_EXE` 指定打包程序进行回归。

当前全量 `npm run lint` 仍会报告已有的 React/代码风格问题；生产类型检查、构建和数据/桌面/迁移测试通过，不将 lint 声称为全部通过。

## 许可证

[MIT License](LICENSE)，作者 **Lanthanums**。第三方组件保留各自版权与许可证，见[第三方声明](THIRD_PARTY_NOTICES.md)。
