# Lexicon

[中文说明](README_zh.md) · [Download v1.0](https://github.com/Lanthanums/Lexicon/releases/tag/v1.0)

A local Windows vocabulary app for **look-alike words, synonym groups, and everyday word recall**. Lexicon combines a warm paper-like interface with focused flashcards, editable notes, and local backups.

## Features

- **Look-alike words:** group similar spellings and homophones, adjust the matching threshold, and curate groups manually.
- **Synonym groups:** select words, compare meanings and usage, add examples and distinction notes, then study the group with flashcards.
- **Single-word study:** add a word and meaning offline, recall in either English-to-Chinese or Chinese-to-English direction, and grade your answer.
- **Review:** prioritize new and due words, retry uncertain words, and use the spelling or multiple-choice quiz.
- **Desktop experience:** a standalone window, keyboard shortcuts, local persistence, daily snapshots, and JSON import/export. No separate Node.js console is needed to run the packaged app.

The current interface is in Chinese; English documentation is provided here. Synonym groups are manually curated. Automatic online synonym generation is not included.

## Download and run

Get the Windows x64 assets from [Releases](https://github.com/Lanthanums/Lexicon/releases/tag/v1.0):

| Asset | Use |
| --- | --- |
| `Lexicon-Setup-v1.0-x64.exe` | Install for the current Windows user. |
| `Lexicon-v1.0-win-x64.zip` | Extract the entire folder, then open `Lexicon.exe`. Keep its supporting files together. |
| `Lexicon-v1.0-source.zip` | Clean source archive, without Git history or local build artifacts. |
| `SHA256SUMS.txt` | Checksums for the release downloads. |

The release contains **no personal word library, review history, API credentials, browser profile, or local logs**. A fresh profile starts empty. Built-in examples are optional and load only when requested. Existing data on the same device is not erased by downloading or launching a blank package.

The installer is not code-signed. Packaged builds have been validated on Windows x64; other platforms are not provided.

## Learn with Lexicon

1. Open **单词记忆** to add an English word and its Chinese meaning. Dictionary lookup is optional.
2. Open **近义词群** to select at least two words and write distinction notes. Edit each word's usage and example, read the comparison, and start recall.
3. Use **形近辨析** for spelling/homophone groups, or **综合抽查** for mixed practice.
4. Press **Space** to flip a flashcard, then **1 / 2 / 3** for known / uncertain / unknown. Keyboard shortcuts do not score hidden study pages.

Single-word rounds contain up to 20 words. Known answers schedule reviews after 1, 3, 7, 14, 30, or 60 days, depending on the current level; uncertain or unknown answers return after 5 minutes. These are fixed scheduling rules, not a calibrated measurement of memory retention.

## Local data and migration

Use **设置与备份 → 打开数据与自动备份** to locate the current profile. Desktop data is normally under `%APPDATA%/lexicon-desktop/`. Backup files include `backups/latest.json`, the first snapshot of each day, and snapshots taken before imports.

To bring data from the earlier browser version:

1. Close its old Node.js console so port 3000 is free.
2. Choose **设置与备份 → 从旧版浏览器迁移**.
3. If the helper opens in another browser, copy its URL into the browser previously used for Lexicon.
4. Return to the desktop app and confirm the import. The source browser data stays intact. Alternatively, export JSON in the browser version and import it in the desktop app.

Import replaces the current desktop library after confirmation; a pre-import recovery copy is retained. Backups may contain user-configured dictionary API credentials, so keep them private. The app has no cloud synchronization. Online lookup sends the queried word to the selected provider; the optional daily-word source also requires a network connection.

## Development

Use Node.js **22.12+ or 24 LTS**, npm, and Windows for desktop packaging.

```sh
npm ci
npm run setup:electron
npm run dev
```

Build and run the desktop app:

```sh
npm run build
npm run desktop
npm run desktop:dist
```

The installer is generated in `release/`; an unpacked desktop build is in `release/win-unpacked/`. End users do not need Node.js. To use an Electron download mirror, set `ELECTRON_MIRROR` in your own environment before `npm run setup:electron`; no machine-specific mirror or credentials are committed.

Validation:

```sh
npm test
npm run build
npm run test:e2e
node tests/migration.e2e.cjs
```

The migration test uses an installed Microsoft Edge by default; set `LEXICON_BROWSER_CHANNEL` or `LEXICON_BROWSER_PATH` to select another supported browser. Tests use synthetic words and isolated profiles. Set `LEXICON_ARTIFACT_DIR` to keep reports outside the checkout. Use `LEXICON_EXE` to run desktop regression checks against a packaged executable.

The current full `npm run lint` still reports existing React/style issues. Production type-check/build and the focused data/desktop/migration tests pass; lint is not represented as clean.

## License

[MIT License](LICENSE), copyright **Lanthanums**. Third-party components retain their respective licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
