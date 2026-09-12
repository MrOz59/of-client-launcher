import React from 'react'
import { AlertCircle, Check, Copy, Download, FileText, Monitor, Plus, RefreshCw, SlidersHorizontal, Trash2, Wrench, X } from 'lucide-react'
import type { CommunityGameFix } from './types'
import { useI18n } from '../../i18n'
import { ipcErrorText } from '../../../shared/ipcErrors'
import { useModalA11y } from '../../hooks/useModalA11y'

export interface FixEditorModalProps {
  gameUrl: string
  /** An existing fix to edit; without one the editor starts from how the game is set up now. */
  initialFix?: CommunityGameFix | null
  onClose: () => void
  onSaved: (fix: CommunityGameFix) => void
}

type Executable = { name: string; relativePath: string; size: number }
type EditorTab = 'basic' | 'proton' | 'extras' | 'json'
type Problem = { tab: EditorTab; message: string }

/** The published repo names each file after the fix id, so the id has to be one. */
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const COMPONENT_PATTERN = /^[a-z0-9_.+-]+$/i
const EXECUTABLE_PATTERN = /^[^/\\]+\.exe$/i
const ASSEMBLY_PATTERN = /^[A-Za-z0-9_.+-]+\.dll$/i

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function parseComponents(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean))).slice(0, 40)
}

/**
 * Writes a fix for the game in front of you.
 *
 * A fix is a small JSON that travels between machines, and until now the
 * launcher could only read one: the export button wrote a snapshot of the
 * current settings with no title, no notes and no components — everything that
 * makes a fix worth sharing had to be typed into the file by hand.
 *
 * The form is split the way the game's own settings are, one tab per concern,
 * because the alternative — every field stacked in a modal whose body is the
 * scroll container — buried the save button under a page of inputs. What must
 * stay in sight instead is what stops a fix from being valid, so the footer
 * holds the verdict and the actions, and each tab flags the problems inside it.
 */
export function FixEditorModal({ gameUrl, initialFix, onClose, onSaved }: FixEditorModalProps) {
  const { t } = useI18n()
  const dialogRef = useModalA11y<HTMLDivElement>(onClose)

  const [tab, setTab] = React.useState<EditorTab>('basic')
  const [draft, setDraft] = React.useState<CommunityGameFix | null>(null)
  const [executables, setExecutables] = React.useState<Executable[]>([])
  const [folderMissing, setFolderMissing] = React.useState(false)
  const [busy, setBusy] = React.useState<'load' | 'save' | 'export' | null>('load')
  const [error, setError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  // Free text while typing: a list rebuilt on every keystroke would eat the
  // space between two verbs before the second one exists.
  const [winetricksText, setWinetricksText] = React.useState('')
  const [notesText, setNotesText] = React.useState('')
  const [carryOptions, setCarryOptions] = React.useState(true)

  React.useEffect(() => {
    let disposed = false

    const load = async () => {
      try {
        const base = initialFix
          ? (JSON.parse(JSON.stringify(initialFix)) as CommunityGameFix)
          : await (async () => {
              const res = await window.electronAPI.buildGameFixDraft(gameUrl)
              if (!res?.success || !res.fix) throw new Error(ipcErrorText(t, res, t('library.fixEditor.loadFailed')))
              return res.fix as CommunityGameFix
            })()

        if (disposed) return

        setDraft({ ...base, id: base.id && ID_PATTERN.test(base.id) ? base.id : slugify(base.title || 'game-fix') })
        setWinetricksText((base.components?.winetricks || []).join(' '))
        setNotesText((base.notes || []).join('\n'))
        setCarryOptions(Object.keys(base.proton?.options || {}).length > 0)
      } catch (err: any) {
        if (!disposed) setError(err?.message || t('library.fixEditor.loadFailed'))
      } finally {
        if (!disposed) setBusy(null)
      }
    }

    void load()
    // The folder scan is independent: a fix can be written before the game is installed.
    window.electronAPI.listGameExecutables(gameUrl).then((res) => {
      if (disposed || !res?.success) return
      setExecutables(res.executables || [])
      setFolderMissing(res.installed === false)
    }).catch(() => {})

    return () => { disposed = true }
  }, [gameUrl, initialFix, t])

  // The draft arrives after the dialog mounts, so the a11y hook's initial focus
  // finds only the close button. Once the form is there, start on the title.
  const titleRef = React.useRef<HTMLInputElement | null>(null)
  const focusedOnce = React.useRef(false)
  React.useEffect(() => {
    if (!draft || focusedOnce.current) return
    focusedOnce.current = true
    titleRef.current?.focus()
  }, [draft])

  const patch = (values: Partial<CommunityGameFix>) => {
    setMessage(null)
    setDraft((current) => (current ? { ...current, ...values } : current))
  }

  const winetricks = parseComponents(winetricksText)
  const notes = notesText.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 12)
  const assemblies = draft?.runtimeAssemblies || []

  /** The same checks the repo's validator runs, so nothing leaves here broken. */
  const problems: Problem[] = []
  if (draft) {
    if (!String(draft.title || '').trim()) problems.push({ tab: 'basic', message: t('library.fixEditor.problem.title') })
    if (!ID_PATTERN.test(draft.id || '')) problems.push({ tab: 'basic', message: t('library.fixEditor.problem.id') })
    if (draft.launchExecutable && !EXECUTABLE_PATTERN.test(draft.launchExecutable)) {
      problems.push({ tab: 'proton', message: t('library.fixEditor.problem.executable', { name: draft.launchExecutable }) })
    }
    for (const verb of winetricks) {
      if (!COMPONENT_PATTERN.test(verb)) problems.push({ tab: 'extras', message: t('library.fixEditor.problem.component', { name: verb }) })
    }
    for (const entry of assemblies) {
      if (!ASSEMBLY_PATTERN.test(entry.name || '')) problems.push({ tab: 'extras', message: t('library.fixEditor.problem.assemblyName', { name: entry.name || '—' }) })
      const into = String(entry.into || '')
      if (!into) problems.push({ tab: 'extras', message: t('library.fixEditor.problem.assemblyInto') })
      else if (into.startsWith('/') || /^[A-Za-z]:/.test(into) || into.split(/[\\/]/).includes('..')) {
        problems.push({ tab: 'extras', message: t('library.fixEditor.problem.assemblyOutside', { path: into }) })
      }
    }
  }

  const compose = (): CommunityGameFix | null => {
    if (!draft) return null
    return {
      ...draft,
      title: String(draft.title || '').trim(),
      description: String(draft.description || '').trim(),
      author: String(draft.author || '').trim(),
      proton: {
        ...draft.proton,
        // An empty options object means "whatever the launcher already does",
        // which is what a fix about components or an executable should say.
        options: carryOptions ? draft.proton?.options || {} : {}
      },
      components: { winetricks },
      launchExecutable: draft.launchExecutable || null,
      runtimeAssemblies: assemblies.filter((entry) => entry.name || entry.into),
      notes
    }
  }

  const fix = compose()
  const blocked = !fix || problems.length > 0 || busy !== null

  const save = async () => {
    if (!fix) return
    setBusy('save')
    setError(null)
    setMessage(null)
    try {
      const res = await window.electronAPI.saveGameFix(gameUrl, fix)
      if (!res?.success) {
        setError(ipcErrorText(t, res, t('library.fixEditor.saveFailed')))
        return
      }
      onSaved((res.fix || fix) as CommunityGameFix)
    } catch (err: any) {
      setError(err?.message || t('library.fixEditor.saveFailed'))
    } finally {
      setBusy(null)
    }
  }

  const exportFile = async () => {
    if (!fix) return
    setBusy('export')
    setError(null)
    setMessage(null)
    try {
      const res = await window.electronAPI.exportGameFix(gameUrl, fix)
      if (res?.canceled) return
      if (!res?.success) {
        setError(ipcErrorText(t, res, t('library.fixEditor.exportFailed')))
        return
      }
      setMessage(res.path ? t('library.fixEditor.exportedTo', { path: res.path }) : t('library.fixEditor.exported'))
    } catch (err: any) {
      setError(err?.message || t('library.fixEditor.exportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const copyJson = async () => {
    if (!fix) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(fix, null, 2))
      setMessage(t('library.fixEditor.copied'))
    } catch {
      setError(t('library.fixEditor.copyFailed'))
    }
  }

  const updateAssembly = (index: number, values: Partial<{ name: string; into: string }>) => {
    patch({ runtimeAssemblies: assemblies.map((entry, i) => (i === index ? { ...entry, ...values } : entry)) })
  }

  const executableOptions = draft?.launchExecutable && !executables.some((exe) => exe.name === draft.launchExecutable)
    ? [{ name: draft.launchExecutable, relativePath: draft.launchExecutable, size: 0 }, ...executables]
    : executables

  const tabs = [
    { id: 'basic', label: t('library.fixEditor.tabBasic'), icon: FileText },
    { id: 'proton', label: t('library.fixEditor.tabProton'), icon: Monitor },
    { id: 'extras', label: t('library.fixEditor.tabExtras'), icon: Wrench },
    { id: 'json', label: t('library.fixEditor.tabJson'), icon: Copy }
  ] as Array<{ id: EditorTab; label: string; icon: typeof FileText }>

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal config-modal fix-editor"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-editor-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="config-modal-body">
          <div className="modal-header config-modal-header">
            <div className="config-modal-title">
              <div className="config-modal-icon">
                <SlidersHorizontal size={20} />
              </div>
              <div>
                <p className="eyebrow">{t('library.fixEditor.eyebrow')}</p>
                <h3 id="fix-editor-title">{initialFix ? t('library.fixEditor.titleEdit') : t('library.fixEditor.titleNew')}</h3>
              </div>
            </div>
            <button className="config-close-btn" onClick={onClose} title={t('common.close')} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          {busy === 'load' && !draft ? (
            <div className="config-ini-empty"><p>{t('common.loading')}</p></div>
          ) : !draft ? (
            <div className="config-error"><AlertCircle size={14} /><span>{error || t('library.fixEditor.loadFailed')}</span></div>
          ) : (
            <>
              <div className="config-tabs">
                {tabs.map(({ id, label, icon: Icon }) => {
                  const count = problems.filter((problem) => problem.tab === id).length
                  return (
                    <button
                      key={id}
                      type="button"
                      className={tab === id ? 'config-tab-btn active' : 'config-tab-btn'}
                      onClick={() => setTab(id)}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                      {count > 0 && <span className="fix-editor-tab-badge" aria-label={t('library.fixEditor.tabProblems', { count: String(count) })}>{count}</span>}
                    </button>
                  )
                })}
              </div>

              <div className="fix-editor-scroll">
                {tab === 'basic' && (
                  <>
                    <div className="config-form-row">
                      <div className="config-form-group">
                        <label htmlFor="fix-title">{t('library.fixEditor.fieldTitle')}</label>
                        <input
                          id="fix-title"
                          ref={titleRef}
                          className="config-input"
                          value={draft.title || ''}
                          onChange={(e) => {
                            const title = e.target.value
                            // The id follows the title until someone edits it themselves.
                            const followsTitle = !draft.id || draft.id === slugify(draft.title || '')
                            patch(followsTitle ? { title, id: slugify(title) } : { title })
                          }}
                          placeholder={t('library.fixEditor.fieldTitlePlaceholder')}
                        />
                      </div>
                      <div className="config-form-group">
                        <label htmlFor="fix-id">{t('library.fixEditor.fieldId')}</label>
                        <input id="fix-id" className="config-input" value={draft.id || ''} onChange={(e) => patch({ id: e.target.value.trim() })} />
                        <p className="config-hint">{t('library.fixEditor.fieldIdHint')}</p>
                      </div>
                    </div>

                    <div className="config-form-group">
                      <label htmlFor="fix-description">{t('library.fixEditor.fieldDescription')}</label>
                      <textarea
                        id="fix-description"
                        className="config-input"
                        rows={4}
                        value={draft.description || ''}
                        onChange={(e) => patch({ description: e.target.value })}
                        placeholder={t('library.fixEditor.fieldDescriptionHint')}
                      />
                    </div>

                    <div className="config-form-row">
                      <div className="config-form-group">
                        <label htmlFor="fix-author">{t('library.fixEditor.fieldAuthor')}</label>
                        <input id="fix-author" className="config-input" value={draft.author || ''} onChange={(e) => patch({ author: e.target.value })} />
                      </div>
                      <div className="config-form-group">
                        <label htmlFor="fix-game">{t('library.fixEditor.fieldGame')}</label>
                        <input id="fix-game" className="config-input" value={draft.game?.title || draft.game?.id || ''} readOnly />
                        <p className="config-hint">{t('library.fixEditor.fieldGameHint')}</p>
                      </div>
                    </div>
                  </>
                )}

                {tab === 'proton' && (
                  <>
                    <div className="config-form-row">
                      <div className="config-form-group">
                        <label htmlFor="fix-runtime">{t('library.configModal.proton.version')}</label>
                        <input
                          id="fix-runtime"
                          className="config-input"
                          value={draft.proton?.runtimeName || ''}
                          onChange={(e) => patch({ proton: { ...draft.proton, runtimeName: e.target.value } })}
                          placeholder={t('library.configModal.proton.autoExperimental')}
                        />
                        <p className="config-hint">{t('library.fixEditor.runtimeHint')}</p>
                      </div>
                      <div className="config-form-group">
                        <label htmlFor="fix-appid">Steam AppID</label>
                        <input
                          id="fix-appid"
                          className="config-input"
                          value={draft.proton?.steamAppId || ''}
                          onChange={(e) => patch({ proton: { ...draft.proton, steamAppId: e.target.value.replace(/\D/g, '') } })}
                        />
                      </div>
                    </div>

                    <div className="config-form-group">
                      <label htmlFor="fix-executable">{t('library.fixEditor.launchExecutable')}</label>
                      {executableOptions.length > 0 ? (
                        <select
                          id="fix-executable"
                          className="config-select"
                          value={draft.launchExecutable || ''}
                          onChange={(e) => patch({ launchExecutable: e.target.value || null })}
                        >
                          <option value="">{t('library.fixEditor.executableNone')}</option>
                          {executableOptions.map((exe) => (
                            <option key={exe.relativePath} value={exe.name}>{exe.relativePath}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="fix-executable"
                          className="config-input"
                          value={draft.launchExecutable || ''}
                          onChange={(e) => patch({ launchExecutable: e.target.value.trim() || null })}
                          placeholder="Game.exe"
                        />
                      )}
                      <p className="config-hint">
                        {folderMissing ? t('library.fixEditor.executableNoFolder') : t('library.fixEditor.launchExecutableHint')}
                      </p>
                    </div>

                    <label className="config-toggle-item">
                      <input type="checkbox" checked={carryOptions} onChange={(e) => { setCarryOptions(e.target.checked); setMessage(null) }} />
                      <span>{t('library.fixEditor.carryOptions')}</span>
                    </label>
                    <p className="config-hint">{t('library.fixEditor.carryOptionsHint')}</p>
                  </>
                )}

                {tab === 'extras' && (
                  <>
                    <div className="fix-editor-group">
                      <h5>{t('library.fixEditor.sectionComponents')}</h5>
                      <div className="config-form-row">
                        <div className="config-form-group">
                          <label htmlFor="fix-winetricks">winetricks</label>
                          <input id="fix-winetricks" className="config-input" value={winetricksText} onChange={(e) => { setWinetricksText(e.target.value); setMessage(null) }} placeholder="dotnetdesktop9 vcrun2022" />
                        </div>
                      </div>
                      <p className="config-hint">{t('library.fixEditor.componentsHint')}</p>
                    </div>

                    <div className="fix-editor-group">
                      <h5>{t('library.fixEditor.sectionAssemblies')}</h5>
                      {assemblies.length === 0 ? (
                        <p className="config-hint">{t('library.fixEditor.noAssemblies')}</p>
                      ) : (
                        <div className="fix-editor-rows">
                          {assemblies.map((entry, index) => (
                            <div className="fix-editor-row" key={index}>
                              <div className="config-form-group">
                                {index === 0 && <label htmlFor={`fix-asm-name-${index}`}>{t('library.fixEditor.assemblyName')}</label>}
                                <input
                                  id={`fix-asm-name-${index}`}
                                  className="config-input"
                                  value={entry.name}
                                  onChange={(e) => updateAssembly(index, { name: e.target.value.trim() })}
                                  placeholder="System.Net.Primitives.dll"
                                  aria-label={t('library.fixEditor.assemblyName')}
                                />
                              </div>
                              <div className="config-form-group">
                                {index === 0 && <label htmlFor={`fix-asm-into-${index}`}>{t('library.fixEditor.assemblyInto')}</label>}
                                <input
                                  id={`fix-asm-into-${index}`}
                                  className="config-input"
                                  value={entry.into}
                                  onChange={(e) => updateAssembly(index, { into: e.target.value })}
                                  placeholder="Nitrox/lib/net472"
                                  aria-label={t('library.fixEditor.assemblyInto')}
                                />
                              </div>
                              <button
                                className="config-btn ghost"
                                onClick={() => patch({ runtimeAssemblies: assemblies.filter((_, i) => i !== index) })}
                                title={t('library.fixEditor.removeAssembly')}
                                aria-label={t('library.fixEditor.removeAssembly')}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <button
                        className="config-btn secondary"
                        style={{ marginTop: 10 }}
                        onClick={() => patch({ runtimeAssemblies: [...assemblies, { name: '', into: '' }] })}
                      >
                        <Plus size={14} />
                        {t('library.fixEditor.addAssembly')}
                      </button>
                      <p className="config-hint">{t('library.fixEditor.assembliesHint')}</p>
                    </div>

                    <div className="fix-editor-group">
                      <h5>{t('library.fixEditor.sectionNotes')}</h5>
                      <textarea
                        className="config-input"
                        rows={5}
                        value={notesText}
                        onChange={(e) => { setNotesText(e.target.value); setMessage(null) }}
                        placeholder={t('library.fixEditor.notesPlaceholder')}
                        aria-label={t('library.fixEditor.sectionNotes')}
                      />
                      <p className="config-hint">{t('library.fixEditor.notesHint')}</p>
                    </div>
                  </>
                )}

                {tab === 'json' && (
                  <>
                    <div className="fix-editor-json-head">
                      <p className="config-hint" style={{ margin: 0 }}>{t('library.fixEditor.jsonHint')}</p>
                      <button className="config-btn secondary" onClick={copyJson}>
                        <Copy size={14} />
                        {t('library.fixEditor.copyJson')}
                      </button>
                    </div>
                    <pre className="config-code-block">{JSON.stringify(fix, null, 2)}</pre>
                  </>
                )}
              </div>

              {error ? <div className="config-error"><AlertCircle size={14} /><span>{error}</span></div> : null}
              {message ? <div className="diagnostic-repair-empty"><Check size={14} /><span>{message}</span></div> : null}

              <div className="fix-editor-footer">
                {problems.length > 0 ? (
                  <button
                    type="button"
                    className="fix-editor-verdict problem"
                    onClick={() => setTab(problems[0].tab)}
                    title={t('library.fixEditor.goToProblem')}
                  >
                    <AlertCircle size={14} />
                    <span>{t('library.fixEditor.problemsSummary', { count: String(problems.length), first: problems[0].message })}</span>
                  </button>
                ) : (
                  <div className="fix-editor-verdict ok">
                    <Check size={14} />
                    <span>{t('library.fixEditor.ready')}</span>
                  </div>
                )}

                <div className="config-btn-group">
                  <button className="config-btn ghost" onClick={onClose} disabled={busy === 'save' || busy === 'export'}>
                    {t('common.cancel')}
                  </button>
                  <button className="config-btn secondary" onClick={exportFile} disabled={blocked}>
                    {busy === 'export' ? <RefreshCw size={14} className="of-spin" /> : <Download size={14} />}
                    {t('library.fixEditor.export')}
                  </button>
                  <button className="config-btn primary" onClick={save} disabled={blocked}>
                    {busy === 'save' ? <RefreshCw size={14} className="of-spin" /> : <Check size={14} />}
                    {t('library.fixEditor.save')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default FixEditorModal
