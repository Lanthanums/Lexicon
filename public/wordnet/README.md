# Offline synonym index

Source: Open English WordNet Team, Open English WordNet 2025, derived from Princeton University WordNet.

Pinned official source: https://github.com/globalwordnet/english-wordnet/tree/dc343f2683279ecbb13fab4e2fd778d7b162d287

Licenses: CC BY 4.0 and the underlying Princeton WordNet License. Full texts: `LICENSE-OEWN.txt`, `LICENSE-WORDNET.txt`. These data retain their own license, independently of the Lexicon application.

Modification: lowercase English lemmas containing ASCII letters, spaces, apostrophes and hyphens; underscores become spaces; only synsets with at least two distinct retained members are included. Definitions are retained in English. No model, generated explanation, translation or inferred transitive relation is included. Single-member senses, non-matching spelling forms and some names are omitted. The lookup does not perform lemmatization, and absence from the index does not establish absence of synonyms.

The 26 letter shards are bundled with the application and loaded on demand. First use does not download a corpus. `manifest.json` records the exact source, transformation, counts and per-file SHA256.

To reproduce: obtain the pinned source checkout, run `npm ci`, then `npm run build:wordnet -- /path/to/english-wordnet`. The generator uses the pinned development dependency `js-yaml`; no YAML parser is shipped to the learning interface.
