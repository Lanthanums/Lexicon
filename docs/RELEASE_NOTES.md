# Lexicon v2.0

正式版 / Stable release · 应用版本 / Application version: `2.0.0` · Tag: `v2.0`.

## 中文

- 统一词库管理：形近组、近义组、自定义组和独立单词，支持批量查义、集中确认、整卡合并、成员移动、统一编辑与撤销。
- 综合抽查支持选择、拼写、渐进提示和近义回忆；到期词优先，自适应间隔保留原有学习记录，错题可以继续巩固。
- 教学保留四个功能分块的总体介绍，只练四项隐蔽操作：拖动单词、拖动整卡、长按排序和五点熟练度滑条。练习词库临时隔离，退出后丢弃。
- 修复引导定位期间的居中闪窗与窗口缩放定位，改善对话框、浮层、页面和滑条的动画，支持减少动态效果。
- 本地 JSON 导入、导出和每日快照，导入前保留恢复副本；Windows 遇到 EXDEV 时回退复制暂存文件，复制失败保留暂存。
- 程序、安装包、侧栏和设置“帮助与关于”统一为 v2.0 / 2.0.0，界面版本来自 package.json。
- 仓库文档归入 docs/，构建与数据脚本归入 scripts/；分发包不含个人词库、凭据、备份和工程记录。

下载附件：Windows x64 安装包、便携包、源码包、RELEASE_MANIFEST.json 和 SHA256SUMS.txt。便携包需完整解压。建议升级前导出 JSON 备份；旧版不能完整理解 v2 的自定义分组等字段。安装包尚未签名。

## English

- Unified management for spelling, synonym and custom groups, plus isolated words. Batch lookup, combined confirmation, whole-card merges, member moves, editing and undo share one workspace.
- Multiple choice, spelling, progressive hints and synonym recall, with due-first adaptive review and continued mistake consolidation while preserving existing learning history.
- A four-module overview and four hidden-interaction exercises: word drag, card drag, long-press reorder and the five-dot mastery slider. Practice uses an isolated temporary library.
- Stable guide positioning during transitions and resizing; refined dialogs, popovers, page motion and sliders, including reduced-motion support.
- Local JSON backups, import recovery copies and daily snapshots. EXDEV falls back to copying the staged snapshot, retaining it if the copy fails.
- Application, installer, sidebar and About now agree on v2.0 / 2.0.0; UI version labels derive from package.json.
- Documentation lives in docs/ and build/data scripts in scripts/. Distribution packages contain no personal libraries, credentials, backups or private engineering records.

Assets include a Windows x64 installer, portable archive, source archive, RELEASE_MANIFEST.json and SHA256SUMS.txt. Extract the portable archive completely. Export a JSON backup before upgrading; older versions do not fully understand v2 custom groups and related fields. The installer is unsigned.

MIT application licence. Bundled lexical data and dependencies retain their own attribution and licences; see [third-party notices](THIRD_PARTY_NOTICES.md).
