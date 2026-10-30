# Lexicon

**Give every word a place.** A Windows desktop vocabulary app for collecting words, connecting related meanings and practising recall.

[简体中文](README_zh.md) · [Downloads](https://github.com/Lanthanums/Lexicon/releases) · [Release notes](docs/RELEASE_NOTES.md)

Current stable version: **v2.0** (`2.0.0`). The interface is in Chinese, with light, dark and system appearance modes. The [v2.0 release](https://github.com/Lanthanums/Lexicon/releases/tag/v2.0) provides the Windows x64 installer, portable archive, source archive and checksums.

## Your word space

| Area | What you can do |
| --- | --- |
| Today | See a daily word, calendar and actual learning activity over the past 14 or 30 days, then start reviewing. |
| Input & Management | Look up definitions, add words in batches, organise spelling, synonym and custom groups, or keep words on their own. |
| Quiz | Practise with multiple choice, spelling, progressive hints and synonym recall; consolidate mistakes afterwards. |
| Settings & Backup | Change appearance and dictionary preferences, configure synonym matching, and export, import or recover your library. |

## Get started

For a packaged Windows build, download the version you want from [Releases](https://github.com/Lanthanums/Lexicon/releases). Use the installer, or fully extract the portable archive and run `Lexicon.exe` inside its application folder. Close older instances first.

1. Open **录入与管理词汇** and enter a word. To add several, separate them with semicolons, for example `effluent;affluent;effulgent`. Chinese semicolons and newlines also work.
2. Review missing definitions or ambiguous grouping choices together, then save the batch. Cancelling keeps your input and adds nothing.
3. Organise your words, then open **综合抽查** to practise. Export a JSON backup from **设置与备份** when you want a portable copy of your library.

The first-run guide introduces all four areas and offers four short exercises for less obvious interactions. These run in the real management interface with a temporary example library that is discarded on exit. Skip an exercise, press Escape, or replay the guide from Settings at any time.

## Organise words and relationships

Blue cards are spelling groups, green cards are synonym groups, grey cards are custom groups and yellow cards are isolated words. Each word can belong to one group of each type at the same time; it is isolated when it belongs to none. Automatic matching is editable, and lexical relationships still need context when choosing an interchangeable word.

Cards show words, phonetics, one-line collapsible definitions and five mastery dots. The pencil opens a unified editor for names, notes, type, members, order and word details. Expand a member to edit definitions, phonetics, usage and examples. The list view shows each word once with its memberships and sorting controls.

| Less obvious interaction | Result |
| --- | --- |
| Drag a word onto another card | Move only that word into the destination relationship. |
| Drag a card from outside its word areas | Merge the whole card. Same types retain their type; mixed types default to a custom group with an explicit type choice. |
| Hold the three-line grip in the editor, then drag | Reorder members. Focus the grip and use the up/down keys as an alternative. |
| Click the five mastery dots in the editor | Open a 0–5 slider. Changes take effect when you save; manual adjustments do not add practice counts. |

Moving a member preserves its other relationship types. An unresolved merge type remains available across restarts until you explicitly choose it. Undo restores prior membership and order.

The editor distinguishes **removing from a group**, **deleting a word everywhere** and **dissolving a group**. Removing or dissolving preserves the words and their learning history; deleting a word removes its relationships and history. Dissolving also removes that group's notes. Confirmations and undo help you review these actions, and closing an editor with unsaved changes asks before discarding them.

## Practise and review

Review prioritises due words, then new words, with advance practice available afterwards. Intervals respond to elapsed recall and mistakes; an incorrect answer is scheduled to return after about five minutes. Immediate repetitions do not keep inflating the interval.

Spelling hints reveal the first letter, phonetics and then the full word. Assisted answers do not increase mastery. Synonym recall accepts answers in any order: groups of up to three require all members, while larger groups require at least 80%, rounded up. Missed members remain available for consolidation even when the group passes. Retry queues carry across additional rounds until completed or reset.

Scheduling uses a transparent heuristic exponential model. It is not trained FSRS and does not provide a calibrated personal retention estimate. The seven-day forecast assumes all scheduled reviews are answered correctly and no words are added. See [Memory scheduling](docs/MEMORY_SCHEDULING.md) for the rules and limits.

## Local data, dictionaries and backups

Your library is stored locally, with automatic desktop snapshots and JSON export/import. Imports require confirmation and retain a pre-import recovery copy. There is no cloud synchronisation. A blank distribution contains no personal learning records; launching it normally still opens your existing local library if one is present.

- Export a backup before upgrading or switching versions. v2 adds custom groups, member order and unresolved merge choices that older versions do not understand. Existing word IDs, definitions and learning history are preserved; archived conflicting synonym relationships remain exportable in `relationArchive`.
- Dictionary and synonym credentials are stored locally and may be included in exported backups. Check a backup before sharing it.
- Offline synonym candidates use the bundled **Open English WordNet 2025** index. Optional API verification uses Datamuse; definition lookups use the configured dictionary services. These requests need a network connection. No on-device model is installed or trained.
- Public dictionary data is separate from your personal library. Dataset and dependency licences remain in [Third-party notices](docs/THIRD_PARTY_NOTICES.md).

## What's new in v2.0

- Batch lookup, one combined review dialog and compact controls that stay accessible while scrolling.
- A four-area overview plus four hidden-interaction exercises in an isolated practice library.
- Guide hints appear after positioning, including after window resizing; dialogs fade without shifting their centres, and popovers retain their anchors.
- Immediate mastery-slider feedback, simpler page transitions and reduced-motion support for review charts.
- A shared package version for the sidebar, About, executable and installer.
- Adaptive review scheduling, clearer backup controls and a staged-copy fallback when Windows reports `EXDEV` while saving a snapshot.

See [Release notes](docs/RELEASE_NOTES.md) for this revision.

## Build and run

Use Node.js 22.12+ or 24 and npm. Windows is the supported packaging target.

```sh
git clone https://github.com/Lanthanums/Lexicon.git
cd Lexicon
npm ci
npm run setup:electron
npm run build
npm run desktop
```

For browser-based UI development, run `npm run dev`. Desktop snapshot and native appearance integration require Electron.

```sh
# Windows application folder
npm run desktop:pack

# Windows installer
npm run desktop:dist
```

Generated packages are written to `release/`. The source checkout contains no personal profiles, API credentials or installed dependencies.

## Verification

```sh
npm test
npm run test:e2e
```

The v2.0 release passed **51 unit tests and 38 packaged Electron regression groups** with no page errors. Coverage includes real word/card drags, long-press sorting, mastery editing, temporary-guide isolation, frame-by-frame dialog positioning, backup recovery and light/dark layouts at desktop and narrow widths. Tests use synthetic libraries and isolated profiles.

Set `LEXICON_EXE` to test a packaged executable and `LEXICON_ARTIFACT_DIR` to choose a report directory. `npm run test:guide` and `npm run test:motion` run the focused suites. The legacy desktop/unified/synonyms test entry points forward to the current v2 regression.

Full-repository ESLint still reports 15 existing errors and one warning; it is not a passing check. The focused guide and shared-dialog checks pass. The Windows installer is unsigned.

## Repository layout

`src/` contains the application, `electron/` the desktop host, `public/wordnet/` the offline index, `scripts/` the build/data tools, `docs/` the technical notes and licences, and `tests/` the regression suites. Generated packages and personal profiles are excluded from Git. See [Repository structure](docs/STRUCTURE.md).

## Licence

Lexicon is released under the [MIT License](LICENSE), by **Lanthanums**. Bundled datasets and dependencies retain their respective licences and attribution.
