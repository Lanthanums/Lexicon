const fs = require('node:fs/promises')

// Antivirus, indexers and sync clients can hold the destination open for a moment.
const TRANSIENT = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RETRY_DELAYS = [40, 120, 300]
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

// Some Windows file systems reject rename even within the same directory.
// Keep the staged snapshot until the cross-device copy has succeeded.
async function replaceSnapshot(staged, destination, io = fs, wait = pause) {
  for (let attempt = 0; ; attempt++) {
    try {
      await io.rename(staged, destination)
      return
    } catch (error) {
      if (TRANSIENT.has(error.code) && attempt < RETRY_DELAYS.length) {
        await wait(RETRY_DELAYS[attempt])
        continue
      }
      if (error.code !== 'EXDEV') throw error
      await io.copyFile(staged, destination)
      await io.unlink(staged).catch(() => {})
      return
    }
  }
}

/**
 * Serialises snapshot writes and skips intermediate states: while one write runs,
 * only the newest pending snapshot is kept. Every caller resolves once a snapshot
 * at least as new as its own is on disk.
 */
function createSnapshotWriter(write) {
  let running = null
  let pending = null
  function drain() {
    const job = pending
    pending = null
    running = write(job.raw).then(() => job.resolve(), error => job.reject(error)).finally(() => {
      running = null
      if (pending) drain()
    })
  }
  return raw => {
    if (pending) {
      const replaced = pending
      pending = { raw, waiters: replaced.waiters }
    } else pending = { raw, waiters: [] }
    const job = pending
    const done = new Promise((resolve, reject) => job.waiters.push({ resolve, reject }))
    job.resolve = () => job.waiters.forEach(waiter => waiter.resolve())
    job.reject = error => job.waiters.forEach(waiter => waiter.reject(error))
    if (!running) drain()
    return done
  }
}

module.exports = { replaceSnapshot, createSnapshotWriter }
