# Repository structure

| Directory or file | Purpose |
| --- | --- |
| `src/` | React application, shared controls, vocabulary state and learning rules. `sections/Management.tsx` and `ManagementEditor.tsx` provide the current management interface. |
| `electron/` | Sandboxed desktop window, preload bridge, local snapshot persistence and dictionary transport. |
| `public/wordnet/` | Public offline lexical index, pinned-source manifest and original dataset licences. |
| `assets/` | Desktop application icon. `public/favicon.ico` serves the browser build. |
| `scripts/` | WordNet generator, pinned upstream hashes and the production licence collector. These are source scripts, not generated builds. |
| `docs/` | Release notes, memory-scheduling rules, third-party notices and preserved upstream licence texts. |
| `tests/` | Unit tests and Electron integration suites using synthetic libraries and isolated profiles. Older desktop/unified/synonyms entry points remain as compatibility aliases. |
| `README.md`, `README_zh.md` | English and Chinese product, usage and development guides. |
| `LICENSE` | MIT application licence. Third-party data retains its own terms. |
| `package.json`, `package-lock.json` | Application version, scripts and pinned dependency resolution. |

`package.json` is the single version source: Vite embeds it in the About section and sidebar, and Electron Builder uses it for application and installer metadata.

Local generated folders (`node_modules/`, `dist/`, `release/`, test reports), user profiles, backups and credentials are excluded from Git. `npm run build` generates `dist/`; Windows package commands generate `release/`. Downloadable binaries belong in GitHub Releases.

The current page entry point is `src/pages/Home.tsx`; vocabulary management uses `Management.tsx` and `ManagementEditor.tsx`. Older implementations remain separate from this entry point.
