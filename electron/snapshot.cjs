const fs = require('node:fs/promises')

// Some Windows file systems reject rename even within the same directory.
// Keep the staged snapshot until the cross-device copy has succeeded.
async function replaceSnapshot(staged, destination, io = fs) {
  try {
    await io.rename(staged, destination)
  } catch (error) {
    if (error.code !== 'EXDEV') throw error
    await io.copyFile(staged, destination)
    await io.unlink(staged).catch(() => {})
  }
}

module.exports = { replaceSnapshot }
