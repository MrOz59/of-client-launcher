import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export function resolveAppIconPath(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'icon.png'),
        path.join(process.resourcesPath, 'resources', 'icon.png')
      ]
    : [
        path.join(process.cwd(), 'icon.png'),
        path.join(process.cwd(), 'resources', 'icon.png'),
        path.join(__dirname, '../../icon.png')
      ]

  return candidates.find(candidate => {
    try {
      return fs.existsSync(candidate)
    } catch {
      return false
    }
  })
}
