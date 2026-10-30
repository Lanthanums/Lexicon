// Rebuild the shipped index from the pinned official OEWN source checkout.
// Usage: node build/build-wordnet.cjs <english-wordnet-source-directory>
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const yaml = require('js-yaml')
const input = path.resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass the extracted Open English WordNet 2025 source directory')
const expected = require('./wordnet-source.json')
for (const [file, hash] of Object.entries(expected.files)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(input, file))).digest('hex')
  if (actual !== hash) throw new Error('Upstream file differs from pinned source: ' + file)
}
const output = path.resolve(__dirname, '../public/wordnet')
fs.mkdirSync(output, { recursive: true })
const shards = new Map()
const normalize = word => word.toLowerCase().replaceAll('_', ' ').trim()
let synsets = 0
for (const filename of fs.readdirSync(path.join(input, 'src/yaml')).sort()) {
  if (!/^(adj|adv|noun|verb)\..*\.yaml$/.test(filename)) continue
  const records = yaml.load(fs.readFileSync(path.join(input, 'src/yaml', filename), 'utf8'))
  for (const [id, value] of Object.entries(records)) {
    const terms = [...new Set(value.members.map(normalize))].filter(w => /^[a-z][a-z'’ -]*$/.test(w))
    if (terms.length < 2) continue
    if (!value.definition?.[0] || !value.partOfSpeech) throw new Error('Missing definition: ' + id)
    synsets++
    for (const term of terms) {
      const key = term[0]
      if (!shards.has(key)) shards.set(key, { lookup: Object.create(null), senses: Object.create(null) })
      const shard = shards.get(key)
      ;(shard.lookup[term] ||= []).push(id)
      shard.senses[id] = { id, pos: value.partOfSpeech, definition: value.definition.join('; '), terms }
    }
  }
}
const files = {}
let terms = 0
for (const [key, shard] of [...shards].sort()) {
  const data = JSON.stringify(shard)
  const name = key + '.json'
  fs.writeFileSync(path.join(output, name), data + '\n')
  files[name] = { bytes: Buffer.byteLength(data + '\n'), sha256: crypto.createHash('sha256').update(data + '\n').digest('hex') }
  terms += Object.keys(shard.lookup).length
}
for (const [src, dest] of [['LICENSE.md','LICENSE-OEWN.txt'],['WNDB_License.txt','LICENSE-WORDNET.txt']]) fs.copyFileSync(path.join(input, src), path.join(output, dest))
const manifest = {
  dataset: 'Open English WordNet', edition: '2025',
  source: 'https://github.com/globalwordnet/english-wordnet/tree/dc343f2683279ecbb13fab4e2fd778d7b162d287',
  commit: 'dc343f2683279ecbb13fab4e2fd778d7b162d287',
  attribution: 'Open English WordNet Team; derived from Princeton University WordNet',
  license: 'CC-BY-4.0; underlying Princeton WordNet License',
  modification: 'Lowercase English lemmas only; multi-member synsets only; definitions retained; first-letter JSON shards. No inferred relations, generated explanations, examples or translations.',
  terms, synsets, files,
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ terms, synsets, shards: shards.size, bytes: Object.values(files).reduce((n, f) => n + f.bytes, 0) }))
