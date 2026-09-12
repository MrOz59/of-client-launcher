import React from 'react'
import { AlertCircle, Check, RefreshCw, SlidersHorizontal, X } from 'lucide-react'
import type { CommunityGameFix } from './types'
import { useI18n } from '../../i18n'
import { useModalA11y } from '../../hooks/useModalA11y'
import { isValidFixInputValue, substituteFixPlaceholders, type FixInput } from '../../../shared/fixInputs'

export interface FixInputsModalProps {
  fix: CommunityGameFix
  /** What to open on: the answers already in effect, or the fix author's defaults. */
  initialValues: Record<string, string>
  busy?: boolean
  onCancel: () => void
  onSubmit: (values: Record<string, string>) => void
}

/**
 * Asks for the values a fix cannot carry.
 *
 * A fix is a file that travels between machines, so anything that identifies
 * this one — a player name, an address, an id that has to differ from everyone
 * else's — cannot be in it. Those used to live in a note telling the person to
 * go and edit the launch arguments themselves, which is the step that gets
 * skipped and turns into "the fix doesn't work".
 *
 * The arguments the fix will write are shown as they are typed, because the
 * values only make sense in the line they end up in.
 */
export function FixInputsModal({ fix, initialValues, busy, onCancel, onSubmit }: FixInputsModalProps) {
  const { t } = useI18n()
  const dialogRef = useModalA11y<HTMLDivElement>(onCancel)
  const inputs = React.useMemo<FixInput[]>(() => fix.inputs || [], [fix])

  const [values, setValues] = React.useState<Record<string, string>>(() => {
    const start: Record<string, string> = {}
    for (const input of inputs) start[input.id] = initialValues[input.id] ?? input.default ?? ''
    return start
  })
  // Nothing is marked wrong before it has been typed in and left alone.
  const [touched, setTouched] = React.useState<Record<string, boolean>>({})

  // The a11y hook opens on the first focusable thing in the dialog, which is
  // the close button. A form of prefilled fields should open on the first one.
  const firstFieldRef = React.useRef<HTMLInputElement | null>(null)
  React.useEffect(() => {
    firstFieldRef.current?.focus()
    firstFieldRef.current?.select()
  }, [])

  const problemFor = (input: FixInput): string | null => {
    const value = (values[input.id] || '').trim()
    if (!value) return input.required ? t('library.fixInputs.required') : null
    if (isValidFixInputValue(input.type, value)) return null
    if (input.type === 'ipv4') return t('library.fixInputs.invalidIpv4')
    if (input.type === 'number') return t('library.fixInputs.invalidNumber')
    return t('library.fixInputs.invalidText')
  }

  const blocked = busy || inputs.some((input) => problemFor(input) !== null)

  const submit = () => {
    if (blocked) return
    const trimmed: Record<string, string> = {}
    for (const input of inputs) trimmed[input.id] = (values[input.id] || '').trim()
    onSubmit(trimmed)
  }

  const launchArgsTemplate = String(fix.proton?.options?.launchArgs || '')
  const preview = launchArgsTemplate ? substituteFixPlaceholders(launchArgsTemplate, values) : ''

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal config-modal fix-inputs"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-inputs-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="config-modal-body">
          <div className="modal-header config-modal-header">
            <div className="config-modal-title">
              <div className="config-modal-icon">
                <SlidersHorizontal size={20} />
              </div>
              <div>
                <p className="eyebrow">{fix.title}</p>
                <h3 id="fix-inputs-title">{t('library.fixInputs.title')}</h3>
              </div>
            </div>
            <button className="config-close-btn" onClick={onCancel} title={t('common.close')} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          <p className="config-hint">{t('library.fixInputs.intro')}</p>

          <form
            className="fix-inputs-scroll"
            onSubmit={(e) => { e.preventDefault(); submit() }}
          >
            {inputs.map((input, index) => {
              const problem = touched[input.id] ? problemFor(input) : null
              return (
                <div className="config-form-group" key={input.id}>
                  <label htmlFor={`fix-input-${input.id}`}>{input.label}</label>
                  <input
                    id={`fix-input-${input.id}`}
                    className="config-input"
                    ref={index === 0 ? firstFieldRef : undefined}
                    value={values[input.id] || ''}
                    spellCheck={false}
                    placeholder={input.default || ''}
                    onChange={(e) => setValues((current) => ({ ...current, [input.id]: e.target.value }))}
                    onBlur={() => setTouched((current) => ({ ...current, [input.id]: true }))}
                    aria-invalid={problem ? true : undefined}
                    aria-describedby={input.description ? `fix-input-desc-${input.id}` : undefined}
                  />
                  {input.description ? (
                    <p className="config-hint" id={`fix-input-desc-${input.id}`}>{input.description}</p>
                  ) : null}
                  {problem ? (
                    <p className="fix-inputs-problem">
                      <AlertCircle size={12} />
                      <span>{problem}</span>
                    </p>
                  ) : null}
                </div>
              )
            })}

            {preview ? (
              <div className="config-form-group">
                <label>{t('library.fixInputs.preview')}</label>
                <code className="fix-inputs-preview">{preview}</code>
              </div>
            ) : null}

            {/* Submits on Enter from any field, without a second visible button. */}
            <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
          </form>

          <div className="fix-editor-footer">
            <div className="fix-editor-verdict">
              <span>{t('library.fixInputs.footerHint')}</span>
            </div>
            <div className="config-btn-group">
              <button className="config-btn ghost" onClick={onCancel} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button className="config-btn primary" onClick={submit} disabled={blocked}>
                {busy ? <RefreshCw size={14} className="of-spin" /> : <Check size={14} />}
                {t('library.configModal.fixes.apply')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
