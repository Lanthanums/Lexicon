// Rebuild the shipped index from the pinned official OEWN source checkout.
// Usage: node scripts/build-wordnet.cjs <english-wordnet-source-directory>
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
const adjectives = new Map()

function indexSense(sense) {
  synsets++
  for (const term of sense.terms) {
    const key = term[0]
    if (!shards.has(key)) shards.set(key, { lookup: Object.create(null), senses: Object.create(null) })
    const shard = shards.get(key)
    ;(shard.lookup[term] ||= []).push(sense.id)
    shard.senses[sense.id] = sense
  }
}

for (const filename of fs.readdirSync(path.join(input, 'src/yaml')).sort()) {
  if (!/^(adj|adv|noun|verb)\..*\.yaml$/.test(filename)) continue
  const records = yaml.load(fs.readFileSync(path.join(input, 'src/yaml', filename), 'utf8'))
  for (const [id, value] of Object.entries(records)) {
    const terms = [...new Set(value.members.map(normalize))].filter(w => /^[a-z][a-z'’ -]*$/.test(w))
    if (!terms.length) continue
    if (!value.definition?.[0] || !value.partOfSpeech) throw new Error('Missing definition: ' + id)
    const sense = { id, pos: value.partOfSpeech, definition: value.definition.join('; '), terms }
    if (sense.pos === 'a' || sense.pos === 's') adjectives.set(id, { sense, similar: value.similar ?? [] })
    if (terms.length >= 2) indexSense(sense)
  }
}
// Keep each explicit adjective link local to its two endpoint synsets.
// Never combine satellites through a common head or follow a chain of links.
const adjectiveLinks = new Set()
for (const { sense, similar } of adjectives.values()) {
  for (const linkedId of similar) {
    const linked = adjectives.get(linkedId)?.sense
    if (!linked || linkedId === sense.id) continue
    const ids = [sense.id, linkedId].sort()
    const id = ids.join('~')
    if (adjectiveLinks.has(id)) continue
    adjectiveLinks.add(id)
    const [left, right] = ids.map(key => adjectives.get(key).sense)
    const terms = [...new Set([...left.terms, ...right.terms])]
    if (terms.length < 2) continue
    indexSense({ id, pos: 'a', definition: left.definition + ' / ' + right.definition, terms, related: true })
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
  modification: 'Lowercase English lemmas; multi-member synsets and direct adjective similar links indexed by first letter. Linked records preserve both endpoint definitions and are marked related. No transitive links, generated explanations, examples or translations.',
  terms, synsets, files,
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ terms, synsets, shards: shards.size, bytes: Object.values(files).reduce((n, f) => n + f.bytes, 0) }))
