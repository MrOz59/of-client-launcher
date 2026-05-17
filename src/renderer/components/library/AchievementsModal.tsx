import React from 'react'
import { CheckCircle2, Eye, FileJson, Lock, Plus, RefreshCw, Trash2, Trophy, X } from 'lucide-react'

export interface AchievementsModalProps {
  gameUrl: string | null
  title: string
  loading: boolean
  error: string | null
  sources: any[]
  items: any[]
  revealedHiddenIds: Record<string, boolean>
  schemaRefreshedOnce: boolean
  onClose: () => void
  onReload: () => void
  onImportSchema: () => void
  onCreateSchema: () => void
  onRemoveSchema: () => void
  onRevealHidden: (id: string, hasMeaningfulName: boolean, hasMeaningfulDesc: boolean) => void
  onForceRefreshSchema: () => void
}

export function AchievementsModal({
  gameUrl,
  title,
  loading,
  error,
  sources,
  items,
  revealedHiddenIds,
  onClose,
  onReload,
  onImportSchema,
  onCreateSchema,
  onRemoveSchema,
  onRevealHidden,
  onForceRefreshSchema
}: AchievementsModalProps) {
  if (!gameUrl) return null

  const unlockedCount = items.filter((x: any) => !!x?.unlocked).length
  const total = items.length
  const progress = total > 0 ? Math.round((unlockedCount / total) * 100) : 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal config-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="config-modal-body">
          <div className="modal-header">
            <div>
              <p className="eyebrow">Conquistas</p>
              <h3>{title}</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="btn ghost"
                onClick={onReload}
                disabled={loading}
                title="Recarregar"
              >
                {loading ? <RefreshCw size={14} className="of-spin" /> : <RefreshCw size={14} />}
              </button>

              <button
                className="btn ghost"
                onClick={onImportSchema}
                disabled={loading}
                title="Importar schema (JSON)"
              >
                <FileJson size={14} /> Importar
              </button>

              <button
                className="btn ghost"
                onClick={onCreateSchema}
                disabled={loading}
                title="Criar ou editar schema"
              >
                <Plus size={14} /> Schema
              </button>

              <button
                className="btn ghost"
                onClick={onRemoveSchema}
                disabled={loading}
                title="Remover schema importado"
              >
                <Trash2 size={14} /> Remover
              </button>

              <button className="btn ghost" onClick={onClose} title="Fechar">
                <X size={14} />
              </button>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(185, 28, 28, 0.22)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fff' }}>
              {error}
            </div>
          )}

          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Conquistas</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>{unlockedCount}/{total} ({progress}%)</div>
              </div>
              <div style={{ marginTop: 10, height: 7, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${progress}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: progress >= 100 ? '#d6a72f' : '#3b82f6',
                    transition: 'width 180ms ease'
                  }}
                />
              </div>

              <div style={{ marginTop: 10, maxHeight: 360, overflow: 'auto', paddingRight: 6 }}>
                {loading ? (
                  <div style={{ opacity: 0.9, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <RefreshCw size={14} className="of-spin" /> Carregando...
                  </div>
                ) : items?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {items.map((a: any) => (
                      <AchievementItem
                        key={String(a.id)}
                        achievement={a}
                        isRevealed={!!revealedHiddenIds[String(a?.id || '')]}
                        onReveal={(hasMeaningfulName, hasMeaningfulDesc) => onRevealHidden(String(a?.id || ''), hasMeaningfulName, hasMeaningfulDesc)}
                        onForceRefreshSchema={onForceRefreshSchema}
                      />
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>
                    Nenhuma conquista encontrada.
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                      Possíveis causas:
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        <li>O jogo não possui conquistas no Steam</li>
                        <li>O jogo ainda não foi iniciado ou o emulador ainda não criou os arquivos</li>
                        <li>O AppID/Offer ID não foi detectado para buscar um schema</li>
                        <li>A Steam API Key não está configurada nas Configurações</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Fontes detectadas</div>
                <div style={{ opacity: 0.8, fontSize: 12 }}>{Array.isArray(sources) ? sources.length : 0}</div>
              </div>
              <div style={{ marginTop: 10, maxHeight: 180, overflow: 'auto', paddingRight: 6 }}>
                {sources?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {sources.map((s: any, idx: number) => (
                      <div key={`${idx}:${String(s.path || s.label || '')}`} style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.12)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 12 }}>
                          <FileJson size={13} />
                          {String(s.label || s.kind || 'Fonte')}
                        </div>
                        {s.path && <div style={{ marginTop: 4, fontSize: 12, opacity: 0.8, wordBreak: 'break-all' }}>{String(s.path)}</div>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ opacity: 0.8, fontSize: 13 }}>
                    Nenhuma fonte encontrada. Inicie o jogo uma vez para o crack/emulador criar os arquivos.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AchievementItemProps {
  achievement: any
  isRevealed: boolean
  onReveal: (hasMeaningfulName: boolean, hasMeaningfulDesc: boolean) => void
  onForceRefreshSchema: () => void
}

function AchievementItem({ achievement: a, isRevealed, onReveal, onForceRefreshSchema }: AchievementItemProps) {
  const isHiddenLocked = Boolean(a?.hidden) && !a?.unlocked
  const rawName = String(a?.name || '')
  const rawId = String(a?.id || '')
  const rawDesc = String(a?.description || '')
  const percent = typeof a?.percent === 'number' && Number.isFinite(a.percent) ? Number(a.percent) : null

  const nameLooksInternal = !rawName || rawName === rawId || rawName.startsWith('ACHIEVEMENT_')
  const hasMeaningfulName = !nameLooksInternal
  const hasMeaningfulDesc = Boolean(rawDesc.trim())

  const revealed = isHiddenLocked && rawId ? isRevealed : false

  const reveal = () => {
    if (!isHiddenLocked || revealed || !rawId) return
    onReveal(hasMeaningfulName, hasMeaningfulDesc)
  }

  // Hidden achievements:
  // - Mask by default while locked.
  // - Allow user to reveal on click.
  const displayName = (isHiddenLocked && !revealed)
    ? 'Conquista escondida'
    : (isHiddenLocked && !hasMeaningfulName ? 'Conquista escondida' : String(a?.name || a?.id || 'Conquista'))

  const displayDescription = (isHiddenLocked && !revealed)
    ? 'Clique para revelar.'
    : (rawDesc || (a?.unlocked ? '' : 'Sem descrição disponível.'))

  const shouldShowId = !a?.unlocked && rawId && (!rawName || rawName === rawId || rawName.startsWith('ACHIEVEMENT_'))

  return (
    <div
      style={{
        padding: '10px 10px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.12)',
        opacity: a?.unlocked ? 1 : 0.82
      }}
    >
      <div
        style={{ display: 'flex', gap: 10, cursor: isHiddenLocked && !revealed ? 'pointer' : 'default' }}
        onClick={reveal}
        title={isHiddenLocked && !revealed ? 'Clique para revelar' : undefined}
      >
        <div style={{ width: 40, height: 40, flex: '0 0 auto' }}>
          {a?.iconUrl || a?.iconPath ? (
            <img
              src={String(a.iconUrl || a.iconPath)}
              alt={displayName}
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                objectFit: 'cover',
                filter: a?.unlocked ? 'none' : 'grayscale(1)'
              }}
            />
          ) : (
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.10)',
                background: 'rgba(255,255,255,0.04)'
              }}
            >
              <Trophy size={18} />
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {displayName}
              </div>
              {isHiddenLocked && (
                <div style={{ fontSize: 11, opacity: 0.72, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '2px 8px', flex: '0 0 auto' }}>
                  {revealed ? <><Eye size={11} /> Revelada</> : 'Escondida'}
                </div>
              )}
            </div>
            {a?.unlocked ? (
              a?.unlockedAt ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: 0.8 }}>
                  <CheckCircle2 size={13} /> {new Date(Number(a.unlockedAt)).toLocaleString()}
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: 0.7 }}>
                  <CheckCircle2 size={13} /> Desbloqueada
                </div>
              )
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: 0.6 }}>
                <Lock size={13} /> Bloqueada
              </div>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85, lineHeight: 1.25 }}>
            {displayDescription}
          </div>
          {percent != null && (
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
              {percent.toFixed(1)}% desbloquearam
            </div>
          )}
          {shouldShowId && (
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.55, wordBreak: 'break-all' }}>{rawId}</div>
          )}
        </div>
      </div>
    </div>
  )
}
