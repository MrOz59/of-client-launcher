import React from 'react'

export interface SchemaEditorModalProps {
  title: string
  value: string
  error: string | null
  busy: boolean
  onValueChange: (value: string) => void
  onClose: () => void
  onGenerateTemplate: () => void
  onCopy: () => void
  onClear: () => void
  onSave: () => void
}

export function SchemaEditorModal({
  title,
  value,
  error,
  busy,
  onValueChange,
  onClose,
  onGenerateTemplate,
  onCopy,
  onClear,
  onSave
}: SchemaEditorModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal config-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="config-modal-body">
          <div className="modal-header">
            <div>
              <p className="eyebrow">Schema custom</p>
              <h3>{title}</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn ghost"
                onClick={onGenerateTemplate}
                disabled={busy}
                title="Recriar a partir das conquistas atuais"
              >
                Gerar template
              </button>
              <button
                className="btn ghost"
                onClick={onCopy}
                disabled={busy}
                title="Copiar JSON"
              >
                Copiar
              </button>
              <button className="btn ghost" onClick={onClose} title="Fechar">
                ✕
              </button>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(185, 28, 28, 0.22)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fff' }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <textarea
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              rows={14}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 260,
                resize: 'vertical',
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(0,0,0,0.25)',
                color: '#fff',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 12
              }}
            />
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Formato: {"{ items: [{ id, name, description?, iconUrl?, hidden? }] }"}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className="btn ghost"
                onClick={onClear}
                disabled={busy}
              >
                Limpar
              </button>
              <button
                className="btn accent"
                onClick={onSave}
                disabled={busy}
              >
                {busy ? 'Salvando...' : 'Salvar schema'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
