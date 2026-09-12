/**
 * Renders the dialog a fix opens when it needs values that belong to the person
 * applying it, on its own, so the form and the arguments it writes can be
 * looked at without installing a game. Not part of the app build.
 *
 * `?empty=1` opens it with nothing prefilled, the way it looks for a fix being
 * applied for the first time; without it the values come back from the launch
 * arguments the game already runs with.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../src/renderer/i18n'
import { FixInputsModal } from '../src/renderer/components/library/FixInputsModal'
import { extractFixInputValues } from '../src/shared/fixInputs'
import '../src/renderer/App.css'

const empty = location.search.includes('empty')

const fix = {
  kind: 'voidlauncher.gameFix',
  schemaVersion: 1,
  id: 'subnautica-below-zero-multiplayer',
  title: 'Subnautica Below Zero + Multiplayer (BOT Benson)',
  createdAt: new Date().toISOString(),
  game: { id: '18049', title: 'Subnautica Below Zero' },
  proton: {
    runtimeName: 'Proton-GE Latest',
    options: { launchArgs: '-peerIp {{peerIp}} -peerId {{username}}:connectIP:127.0.0.1 -userId {{userId}} -username {{username}}' }
  },
  inputs: [
    { id: 'username', label: 'Your player name', description: "Shown in game, and it has to differ from the other players'. No spaces.", type: 'text' as const, default: 'Player', required: true },
    { id: 'userId', label: 'Your player number', description: 'Any number, as long as no one else in the session picked the same one.', type: 'number' as const, default: '1', required: true },
    { id: 'peerIp', label: "This machine's IPv4 address", description: 'The LAN address of this PC for players on the same network or VPN; your public IPv4 over the internet.', type: 'ipv4' as const, default: '192.168.0.10', required: true }
  ]
}

const inEffect = '-peerIp 192.168.1.212 -peerId MrOz:connectIP:127.0.0.1 -userId 1 -username MrOz'

document.body.style.background = '#0b0d12'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <FixInputsModal
        fix={fix as any}
        initialValues={empty ? {} : extractFixInputValues(fix.proton.options.launchArgs, inEffect)}
        onCancel={() => {}}
        onSubmit={(values) => console.log('apply', values)}
      />
    </I18nProvider>
  </React.StrictMode>
)
