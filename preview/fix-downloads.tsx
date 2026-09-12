/**
 * Renders the consent screen a fix has to pass before anything is fetched, on
 * its own, so the warning and the facts about the file can be read without
 * applying a fix. Not part of the app build.
 *
 * `?busy=1` shows it mid-download, with the progress bar; `?os=windows`
 * shows it as a Windows install, where `prefix:` is the real user folder.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from '../src/renderer/i18n'
import { FixDownloadsModal } from '../src/renderer/components/library/FixDownloadsModal'
import fix from '../fixes/subnautica-below-zero-multiplayer.json'
import '../src/renderer/App.css'

const busy = location.search.includes('busy')
const os = location.search.includes('os=windows') ? 'windows' : 'linux'

document.body.style.background = '#0b0d12'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <FixDownloadsModal
        fix={fix as any}
        os={os}
        busy={busy}
        progress={busy ? { label: (fix as any).downloads[0].label, phase: 'download', percent: 41 } : null}
        onCancel={() => {}}
        onConfirm={(withDownloads) => console.log('confirm', withDownloads)}
      />
    </I18nProvider>
  </React.StrictMode>
)
