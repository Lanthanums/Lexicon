import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

/** Ship the license texts of browser packages actually included in chunks. */
export function thirdPartyNotices(): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle() {
      const packages = new Map<string, string>()
      packages.set('shadcn/ui (component templates)', readFileSync(path.resolve('build/licenses/shadcn-ui-LICENSE.txt'), 'utf8').trim())
      const missing: string[] = []
      for (const raw of this.getModuleIds()) {
        if (raw.includes('\0')) continue
        const id = raw.replaceAll('\\', '/').split('?')[0]
        const marker = '/node_modules/'
        const index = id.lastIndexOf(marker)
        if (index < 0) continue
        const suffix = id.slice(index + marker.length).split('/')
        const name = suffix[0].startsWith('@') ? suffix.slice(0, 2).join('/') : suffix[0]
        const root = id.slice(0, index + marker.length) + name
        try {
          const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
          const files = readdirSync(root, { withFileTypes: true }).filter(f => f.isFile() && /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f.name))
          const texts = files.map(f => readFileSync(path.join(root, f.name), 'utf8').trim())
          if (!texts.length && name === 'react-remove-scroll-bar') texts.push(readFileSync(path.resolve('build/licenses/react-remove-scroll-bar-LICENSE.txt'), 'utf8').trim())
          if (!texts.length && name.startsWith('@radix-ui/')) texts.push(readFileSync(path.resolve('build/licenses/radix-ui-LICENSE.txt'), 'utf8').trim())
          if (!texts.length) { missing.push(name); continue }
          packages.set(`${pkg.name}@${pkg.version}`, `License: ${typeof pkg.license === 'string' ? pkg.license : 'See license text'}\n\n${texts.join('\n\n')}`)
        } catch (error) {
          this.error(`Cannot collect license for ${name}: ${error instanceof Error ? error.message.replaceAll(root, name) : 'read failed'}`)
        }
      }
      if (missing.length) this.error(`Missing license texts: ${[...new Set(missing)].join(', ')}`)
      const content = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, text]) => `${'='.repeat(72)}\n${name}\n${'='.repeat(72)}\n${text}\n`).join('\n')
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: 'Third-party software bundled with Lexicon.\nCopyrights and license terms remain with their respective authors.\n\n' + content })
    },
  }
}
