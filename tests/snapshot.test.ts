import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { replaceSnapshot, createSnapshotWriter } = createRequire(import.meta.url)('../electron/snapshot.cjs')
const failure = (code: string) => Object.assign(new Error(code), { code })

test('snapshot replacement prefers atomic rename without copying', async () => {
  const calls: string[] = []
  await replaceSnapshot('staged', 'latest', {
    rename: async (from: string, to: string) => { calls.push(`rename:${from}:${to}`) },
    copyFile: async () => { assert.fail('copy must not run') },
    unlink: async () => { assert.fail('cleanup must not run') },
  })
  assert.deepEqual(calls, ['rename:staged:latest'])
})

test('EXDEV copies the completed snapshot before removing its staged recovery file', async () => {
  const calls: string[] = []
  await replaceSnapshot('staged', 'latest', {
    rename: async () => { throw failure('EXDEV') },
    copyFile: async (from: string, to: string) => { calls.push(`copy:${from}:${to}`) },
    unlink: async (file: string) => { calls.push(`unlink:${file}`) },
  })
  assert.deepEqual(calls, ['copy:staged:latest', 'unlink:staged'])
})

test('other rename failures propagate without replacing the destination', async () => {
  const error = failure('EPERM')
  let attempts = 0
  await assert.rejects(replaceSnapshot('staged', 'latest', {
    rename: async () => { attempts++; throw error },
    copyFile: async () => { assert.fail('unrelated errors must not copy') },
    unlink: async () => { assert.fail('recovery file must remain') },
  }, async () => {}), error)
  assert.equal(attempts, 4)
})

test('a briefly locked destination is retried before the save fails', async () => {
  const calls: string[] = []
  await replaceSnapshot('staged', 'latest', {
    rename: async () => { calls.push('rename'); if (calls.filter(call => call === 'rename').length < 3) throw failure('EBUSY') },
    copyFile: async () => { assert.fail('copy must not run') },
    unlink: async () => { assert.fail('cleanup must not run') },
  }, async (ms: number) => { calls.push('wait:' + ms) })
  assert.deepEqual(calls, ['rename', 'wait:40', 'rename', 'wait:120', 'rename'])
})

test('queued snapshots collapse to the newest one and every caller is told when it is saved', async () => {
  const written: string[] = []
  let release!: () => void
  const writer = createSnapshotWriter(async (raw: string) => {
    written.push(raw)
    if (raw === 'a') await new Promise<void>(resolve => { release = resolve })
  })
  const a = writer('a'), b = writer('b'), c = writer('c')
  await Promise.resolve()
  release()
  await Promise.all([a, b, c])
  assert.deepEqual(written, ['a', 'c'])
  const failing = createSnapshotWriter(async () => { throw failure('ENOSPC') })
  await assert.rejects(failing('x'))
  const recovered: string[] = []
  const writer2 = createSnapshotWriter(async (raw: string) => { recovered.push(raw); if (raw === 'bad') throw failure('ENOSPC') })
  await assert.rejects(writer2('bad'))
  await writer2('good')
  assert.deepEqual(recovered, ['bad', 'good'])
})

test('copy failure keeps the staged recovery file and reports the save failure', async () => {
  const error = failure('ENOSPC')
  await assert.rejects(replaceSnapshot('staged', 'latest', {
    rename: async () => { throw failure('EXDEV') },
    copyFile: async () => { throw error },
    unlink: async () => { assert.fail('recovery file must remain') },
  }), error)
})
