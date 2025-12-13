import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'

type InstallHelp = {
  platform: NodeJS.Platform
  distroId?: string | null
  distroLike?: string | null
  docsUrl: string
  recommended?: {
    title: string
    commands: string[]
    notes?: string
  } | null
}

function readOsRelease(): Record<string, string> {
  try {
    const txt = fs.readFileSync('/etc/os-release', 'utf8')
    const out: Record<string, string> = {}
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (!m) continue
      const key = m[1]
      let val = m[2] || ''
      val = val.replace(/^\"|\"$/g, '')
      out[key] = val
    }
    return out
  } catch {
    return {}
  }
}

export function getZeroTierInstallHelp(): InstallHelp {
  const platform = process.platform
  const docsUrl = 'https://www.zerotier.com/download/'

  if (platform === 'win32') {
    return {
      platform,
      docsUrl,
      recommended: {
        title: 'Windows: instalar ZeroTier',
        commands: [],
        notes: 'Abra o instalador oficial do ZeroTier. Após instalar, reinicie o launcher se necessário.'
      }
    }
  }

  if (platform === 'darwin') {
    return {
      platform,
      docsUrl,
      recommended: {
        title: 'macOS: instalar ZeroTier',
        commands: [],
        notes: 'Abra o instalador oficial do ZeroTier.'
      }
    }
  }

  const osr = readOsRelease()
  const distroId = (osr.ID || null)
  const distroLike = (osr.ID_LIKE || null)

  const isArchLike = [distroId, distroLike].filter(Boolean).join(' ').toLowerCase().includes('arch') ||
    String(distroId || '').toLowerCase().includes('cachyos')

  if (platform === 'linux' && isArchLike) {
    return {
      platform,
      distroId,
      distroLike,
      docsUrl,
      recommended: {
        title: 'Arch/CachyOS: instalar via pacman',
        commands: [
          'sudo pacman -S --needed zerotier-one',
          'sudo systemctl enable --now zerotier-one'
        ],
        notes: 'Isso instala o serviço e inicia automaticamente.'
      }
    }
  }

  return {
    platform,
    distroId,
    distroLike,
    docsUrl,
    recommended: {
      title: 'Linux: instalar ZeroTier',
      commands: [],
      notes: 'Use a página oficial para instruções para sua distro.'
    }
  }
}

export async function installZeroTierArchWithPkexec(): Promise<{ success: boolean; error?: string }> {
  if (process.platform !== 'linux') return { success: false, error: 'Disponível apenas no Linux' }

  const osr = readOsRelease()
  const distroId = (osr.ID || '').toLowerCase()
  const distroLike = (osr.ID_LIKE || '').toLowerCase()
  const isArchLike = `${distroId} ${distroLike}`.includes('arch') || distroId.includes('cachyos')
  if (!isArchLike) return { success: false, error: 'Instalador automático suportado apenas em Arch-like (por enquanto)' }

  const cmd = [
    'sh',
    '-lc',
    'pacman -Syu --noconfirm && pacman -S --noconfirm --needed zerotier-one && systemctl enable --now zerotier-one'
  ]

  const trySpawn = (bin: string, args: string[]) =>
    new Promise<{ ok: boolean; code: number | null }>((resolve) => {
      const p = spawn(bin, args, { stdio: 'inherit' })
      p.on('close', (code) => resolve({ ok: code === 0, code }))
      p.on('error', () => resolve({ ok: false, code: null }))
    })

  // Prefer pkexec (GUI prompt), fallback to sudo in terminal contexts.
  const pkexecRes = await trySpawn('pkexec', cmd)
  if (pkexecRes.ok) return { success: true }

  const sudoRes = await trySpawn('sudo', cmd)
  if (sudoRes.ok) return { success: true }

  return { success: false, error: 'Falha ao executar pkexec/sudo para instalar e iniciar o ZeroTier' }
}

