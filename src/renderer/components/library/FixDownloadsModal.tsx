import React from 'react'
import { AlertTriangle, Check, Download, FolderOpen, RefreshCw, ShieldAlert, X } from 'lucide-react'
import type { CommunityGameFix } from './types'
import { useI18n } from '../../i18n'
import { useModalA11y } from '../../hooks/useModalA11y'
import { fixDownloadHost, formatBytes, parseInstallTarget, type FixDownload } from '../../../shared/fixDownloads'
import { fixAppliesToOs, type FixOs } from '../../../shared/fixOs'

export interface FixDownloadsModalProps {
  fix: CommunityGameFix
  /** The system this launcher is on; a fix may carry files for one and not the other. */
  os: FixOs | null
  busy?: boolean
  /** What the launcher is doing right now, while the files come down. */
  progress?: { label: string; phase: 'download' | 'extract' | 'install'; percent: number } | null
  onCancel: () => void
  /** Apply the fix. `withDownloads` false means the person already has the files. */
  onConfirm: (withDownloads: boolean) => void
}

/**
 * The screen that stands between a fix and the network.
 *
 * Everything else a fix does is inert — it names a winetricks verb, an
 * executable already in the folder, a setting. A download is the one thing that
 * brings a file from outside onto the machine, into a folder whose programs the
 * launcher then runs. So it gets a screen of its own, and the screen says
 * what is actually true: the launcher checks that the file is byte for byte the
 * one the fix pinned, and nothing more than that. Whether the person who pinned
 * it meant well is not something a checksum can answer.
 *
 * The third button matters as much as the warning. Someone who already put the
 * files there by hand should not have to pull 30 MB again to apply a fix, and
 * without that option they would just skip the fix and edit settings manually.
 */
export function FixDownloadsModal({ fix, os, busy, progress, onCancel, onConfirm }: FixDownloadsModalProps) {
  const { t } = useI18n()
  const dialogRef = useModalA11y<HTMLDivElement>(onCancel)
  const [understood, setUnderstood] = React.useState(false)

  const downloads: FixDownload[] = (fix.downloads || []).filter((entry) => fixAppliesToOs(entry.os, os))
  const total = downloads.reduce((sum, entry) => sum + (entry.size || 0), 0)

  const destinationLabel = (into: string) => {
    const target = parseInstallTarget(into)
    if (!target) return into
    const root = target.root === 'game'
      ? t('library.fixDownloads.rootGame')
      : os === 'windows'
        ? t('library.fixDownloads.rootProfile')
        : t('library.fixDownloads.rootPrefix')
    return target.path ? `${root} / ${target.path}` : root
  }

  const phaseLabel = (phase: 'download' | 'extract' | 'install') =>
    phase === 'download'
      ? t('library.fixDownloads.phaseDownload')
      : phase === 'extract'
        ? t('library.fixDownloads.phaseExtract')
        : t('library.fixDownloads.phaseInstall')

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="modal config-modal fix-downloads"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-downloads-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="config-modal-body">
          <div className="modal-header config-modal-header">
            <div className="config-modal-title">
              <div className="config-modal-icon config-modal-icon--warn">
                <ShieldAlert size={20} />
              </div>
              <div>
                <p className="eyebrow">{fix.title}</p>
                <h3 id="fix-downloads-title">{t('library.fixDownloads.title')}</h3>
              </div>
            </div>
            <button className="config-close-btn" onClick={onCancel} disabled={busy} title={t('common.close')} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          <div className="fix-downloads-warning">
            <AlertTriangle size={20} />
            <div>
              <strong>{t('library.fixDownloads.warningTitle')}</strong>
              <p>{t('library.fixDownloads.warningBody', { author: fix.author || t('library.fixDownloads.unknownAuthor') })}</p>
              <p>{t('library.fixDownloads.warningChecksum')}</p>
            </div>
          </div>

          <div className="fix-downloads-scroll">
            {downloads.map((entry) => (
              <div className="fix-downloads-item" key={entry.id}>
                <div className="fix-downloads-item-head">
                  <Download size={14} />
                  <strong>{entry.label}</strong>
                  {entry.size ? <span className="fix-downloads-size">{formatBytes(entry.size)}</span> : null}
                </div>

                <dl className="fix-downloads-facts">
                  <dt>{t('library.fixDownloads.host')}</dt>
                  <dd><strong>{fixDownloadHost(entry.url)}</strong></dd>

                  <dt>{t('library.fixDownloads.url')}</dt>
                  <dd><code>{entry.url}</code></dd>

                  <dt>{t('library.fixDownloads.checksum')}</dt>
                  <dd><code title={entry.sha256}>{entry.sha256}</code></dd>

                  <dt>{t('library.fixDownloads.destination')}</dt>
                  <dd>
                    {entry.install.map((rule, index) => (
                      <span className="fix-downloads-destination" key={index}>
                        <FolderOpen size={12} />
                        {destinationLabel(rule.into)}
                      </span>
                    ))}
                  </dd>
                </dl>
              </div>
            ))}
          </div>

          {progress ? (
            <div className="fix-downloads-progress">
              <div className="fix-downloads-progress-bar">
                <span style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }} />
              </div>
              <span>{phaseLabel(progress.phase)} — {progress.label} ({Math.round(progress.percent)}%)</span>
            </div>
          ) : null}

          <label className="fix-downloads-consent">
            <input
              type="checkbox"
              checked={understood}
              disabled={busy}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>{t('library.fixDownloads.consent')}</span>
          </label>

          <div className="fix-editor-footer">
            <div className="fix-editor-verdict">
              <span>{total ? t('library.fixDownloads.totalSize', { size: formatBytes(total) }) : ''}</span>
            </div>
            <div className="config-btn-group">
              <button className="config-btn ghost" onClick={onCancel} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                className="config-btn secondary"
                onClick={() => onConfirm(false)}
                disabled={busy}
                title={t('library.fixDownloads.skipHint')}
              >
                {t('library.fixDownloads.skip')}
              </button>
              <button className="config-btn primary" onClick={() => onConfirm(true)} disabled={busy || !understood}>
                {busy ? <RefreshCw size={14} className="of-spin" /> : <Check size={14} />}
                {t('library.fixDownloads.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
