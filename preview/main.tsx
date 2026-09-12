/**
 * Renders one screen on its own, so it can be looked at without launching the
 * launcher. Not part of the app build.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../src/renderer/i18n'
import { FixEditorModal } from '../src/renderer/components/library/FixEditorModal'
import '../src/renderer/App.css'

const broken = location.search.includes('broken')

const draft = {
  kind: 'voidlauncher.gameFix',
  schemaVersion: 1,
  id: 'subnautica-nitrox',
  title: broken ? '' : 'Subnautica + Nitrox (multiplayer)',
  description: 'Faz o Nitrox carregar de verdade. O mod não injeta por proxy DLL: quem carrega o NitroxPatcher é o próprio launcher do mod, um app .NET 9.',
  author: 'MrOz59',
  createdAt: new Date().toISOString(),
  launcherVersion: '0.4.0',
  game: { id: '18121', title: 'Subnautica', url: 'https://online-fix.me/games/survival/18121-subnautica-po-seti.html', installedVersion: 'Build 03102025' },
  proton: {
    runtimeName: 'Proton-GE Latest',
    options: { launchArgs: broken ? '-username {{username}} -userId {{userId}}' : '-username {{username}}' },
    steamAppId: '264710'
  },
  components: { winetricks: broken ? ['dotnet desktop/9'] : ['dotnetdesktop9'] },
  launchExecutable: 'Nitrox.Launcher.exe',
  runtimeAssemblies: broken
    ? [{ name: 'System.Net.Primitives.dll', into: '../../etc' }, { name: 'nope.txt', into: 'lib' }]
    : [{ name: 'System.Net.Primitives.dll', into: 'Nitrox/lib/net472' }],
  downloads: broken
    ? [{ id: 'd1', label: '', url: 'http://example.com/patch.exe', sha256: 'nope', install: [{ from: '../etc', into: 'root:' }] }]
    : [{
        id: 'nitrox-1-8',
        label: 'Nitrox 1.8.0.0 (equipe do Nitrox)',
        url: 'https://github.com/SubnauticaNitrox/Nitrox/releases/download/v1.8.0.0/Nitrox.zip',
        sha256: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
        install: [{ from: 'Nitrox', into: 'game:Nitrox' }]
      }],
  inputs: broken
    ? [{ id: '2player', label: '', type: 'text', required: true }]
    : [{ id: 'username', label: 'Seu nome de jogador', description: 'Precisa ser diferente do dos outros. Sem espaços.', type: 'text', default: 'Player', required: true }],
  notes: ['Instale os componentes ANTES de usar.', 'O executável agora é Nitrox/Nitrox.Launcher.exe.']
}

;(window as any).electronAPI = {
  buildGameFixDraft: async () => ({ success: true, fix: draft }),
  listGameExecutables: async () => ({
    success: true,
    installed: true,
    executables: [
      { name: 'Subnautica.exe', relativePath: 'Subnautica.exe', size: 90 },
      { name: 'Nitrox.Launcher.exe', relativePath: 'Nitrox/Nitrox.Launcher.exe', size: 3 },
      { name: 'unins000.exe', relativePath: 'unins000.exe', size: 2 }
    ]
  }),
  saveGameFix: async () => ({ success: true }),
  exportGameFix: async () => ({ success: true, path: '/home/ozzy/subnautica-nitrox.json' })
}

document.body.style.background = '#0b0d12'

// The tab is internal state, so the harness clicks it: #extras opens that tab.
if (location.hash) {
  const wanted = location.hash.slice(1).toLowerCase()
  setTimeout(() => {
    for (const button of Array.from(document.querySelectorAll('.config-tab-btn'))) {
      if ((button.textContent || '').trim().toLowerCase().startsWith(wanted)) (button as HTMLElement).click()
    }
  }, 400)
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <FixEditorModal gameUrl="https://online-fix.me/x.html" onClose={() => {}} onSaved={() => {}} />
    </I18nProvider>
  </React.StrictMode>
)
