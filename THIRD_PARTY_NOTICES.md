# Third-party notices

Lexicon is licensed under the MIT License, copyright Lanthanums.
Third-party software keeps its own copyright and license.

- Electron and its bundled Chromium/Node.js components: see LICENSE.electron.txt and LICENSES.chromium.html in the desktop distribution.
- shadcn/ui component templates: see [upstream license](build/licenses/shadcn-ui-LICENSE.txt); the same text is included in the production notices.
- Browser libraries included by the production build: see dist/THIRD_PARTY_NOTICES.txt (also accessible within the packaged application resources).
- Development dependencies: see the package metadata and license files installed by npm, with exact versions and integrity hashes recorded in package-lock.json.

No bundled third-party copyright notice is replaced by the Lexicon author attribution.

## Offline lexical data and optional service

- Open English WordNet Team, Open English WordNet 2025, derived from Princeton University WordNet. Source commit: `dc343f2683279ecbb13fab4e2fd778d7b162d287`, [official source](https://github.com/globalwordnet/english-wordnet/tree/dc343f2683279ecbb13fab4e2fd778d7b162d287). Data is licensed under CC BY 4.0 with the underlying Princeton WordNet license retained. Full license texts are distributed in `public/wordnet/LICENSE-OEWN.txt` and `LICENSE-WORDNET.txt` (under `dist/wordnet/` in the application). Lexicon lowercases eligible English lemmas, retains multi-member synsets and their English definitions, and splits the index by initial letter. The dataset is not relicensed under Lexicon's MIT license. See the data manifest for file hashes and transformations.
- The optional online synonym relation check uses the [Datamuse API](https://www.datamuse.com/api/). Requests send the selected English lemma and, when configured, the user's API key. This check does not supply a sense-specific guarantee or independently validate every WordNet relation. The offline mode does not call this service.
