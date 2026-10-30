import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const { replaceSnapshot } = createRequire(import.meta.url)('../electron/snapshot.cjs')
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
  await assert.rejects(replaceSnapshot('staged', 'latest', {
    rename: async () => { throw error },
    copyFile: async () => { assert.fail('unrelated errors must not copy') },
    unlink: async () => { assert.fail('recovery file must remain') },
  }), error)
})

test('copy failure keeps the staged recovery file and reports the save failure', async () => {
  const error = failure('ENOSPC')
  await assert.rejects(replaceSnapshot('staged', 'latest', {
    rename: async () => { throw failure('EXDEV') },
    copyFile: async () => { throw error },
    unlink: async () => { assert.fail('recovery file must remain') },
  }), error)
})
