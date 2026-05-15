import React, { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, Copy, RefreshCw, Terminal } from 'lucide-react'

export interface ProtonLogModalProps {
  title: string
  text: string
  loading: boolean
  live: boolean
  error: string | null
  logPath?: string | null
  updatedAt?: number | null
  onRefresh: () => void
  onCopy: () => void
  onClose: () => void
}

export function ProtonLogModal({
  title,
  text,
  loading,
  live,
  error,
  logPath,
  updatedAt,
  onRefresh,
  onCopy,
  onClose
}: ProtonLogModalProps) {
  const bodyRef = useRef<HTMLPreElement | null>(null)
  const stickToBottomRef = useRef(false)
  const hasRenderedTextRef = useRef(false)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    if (!hasRenderedTextRef.current && text) {
      hasRenderedTextRef.current = true
      el.scrollTop = 0
      return
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [text])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal config-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1100, width: 'min(1100px, 94vw)' }}>
        <div className="config-modal-body">
          <div className="modal-header" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="eyebrow">Logs do Proton</p>
              <h3>{title}</h3>
              <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, opacity: 0.82 }}>
                <span style={{ padding: '4px 8px', borderRadius: 999, background: live ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.08)', border: live ? '1px solid rgba(34,197,94,0.35)' : '1px solid rgba(255,255,255,0.08)' }}>
                  {live ? 'Ao vivo' : 'Parado'}
                </span>
                {updatedAt ? <span>Atualizado: {new Date(updatedAt).toLocaleTimeString()}</span> : null}
                {logPath ? <span title={logPath}>Arquivo: {logPath}</span> : <span>Sem arquivo `steam-*.log` detectado</span>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button className="btn ghost" onClick={onRefresh} disabled={loading} title="Atualizar agora">
                <RefreshCw size={14} className={loading ? 'of-spin' : undefined} />
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  const el = bodyRef.current
                  if (!el) return
                  stickToBottomRef.current = false
                  el.scrollTop = 0
                }}
                title="Ir para o início preservado"
              >
                <ArrowUp size={14} />
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  const el = bodyRef.current
                  if (!el) return
                  stickToBottomRef.current = true
                  el.scrollTop = el.scrollHeight
                }}
                title="Ir para o fim"
              >
                <ArrowDown size={14} />
              </button>
              <button className="btn ghost" onClick={onCopy} title="Copiar logs">
                <Copy size={14} />
              </button>
              <button className="btn ghost" onClick={onClose} title="Fechar">
                ✕
              </button>
            </div>
          </div>

          {error ? (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(185, 28, 28, 0.22)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fff' }}>
              {error}
            </div>
          ) : null}

          <div style={{ marginTop: 12, borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(7,10,15,0.94)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', fontSize: 12, opacity: 0.85 }}>
              <Terminal size={14} />
              <span>Início preservado + eventos recentes filtrados + tail</span>
            </div>

            <pre
              ref={bodyRef}
              onScroll={() => {
                const el = bodyRef.current
                if (!el) return
                const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
                stickToBottomRef.current = distanceToBottom < 40
              }}
              style={{
                margin: 0,
                padding: '14px 16px',
                minHeight: 420,
                maxHeight: '65vh',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace',
                fontSize: 12.5,
                lineHeight: 1.55,
                color: '#d7dee9'
              }}
            >
              {text || (loading ? 'Carregando logs...' : 'Nenhum log disponível ainda. Inicie o jogo com Proton log ativo ou aguarde saída do processo.')}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}
