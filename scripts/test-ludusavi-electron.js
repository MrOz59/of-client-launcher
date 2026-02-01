// Dev helper to validate Ludusavi auto-download inside Electron runtime.
// Run: npx electron scripts/test-ludusavi-electron.js

const { app } = require('electron')

try {
  app.setName('VoidLauncher')
} catch {
  // ignore
}

app.whenReady().then(async () => {
  try {
    const ludusavi = require('../dist/main/ludusavi')

    const ensured = await ludusavi.ensureLudusaviAvailable({ allowDownload: true })
    console.log('[ensure]', ensured)

    const ver = await ludusavi.runLudusavi(['--version'])
    console.log('[version]', { ok: ver.ok, stdout: ver.stdout.trim(), stderr: ver.stderr.trim() })
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    try {
      app.quit()
    } catch {
      // ignore
    }
  }
})
