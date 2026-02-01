import React from 'react'
import { RefreshCw, Cloud, CloudOff, CheckCircle2, Loader2 } from 'lucide-react'
import type { CloudSavesBannerState, Game } from './types'

export interface CloudSavesBannerProps {
  banner: CloudSavesBannerState
  games: Game[]
  onOpenBackups: () => void
  onClose: () => void
}

export function CloudSavesBanner({ banner, games, onOpenBackups, onClose }: CloudSavesBannerProps) {
  const gameTitle = banner.gameUrl
    ? (games.find(g => g.url === banner.gameUrl)?.title || 'Jogo')
    : null

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '10px 14px',
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background:
          banner.level === 'error'
            ? 'rgba(185, 28, 28, 0.22)'
            : banner.level === 'warning'
              ? 'rgba(245, 158, 11, 0.18)'
              : banner.level === 'success'
                ? 'rgba(34, 197, 94, 0.16)'
                : 'rgba(59, 130, 246, 0.14)',
        border:
          banner.level === 'error'
            ? '1px solid rgba(239, 68, 68, 0.35)'
            : banner.level === 'warning'
              ? '1px solid rgba(245, 158, 11, 0.30)'
              : banner.level === 'success'
                ? '1px solid rgba(34, 197, 94, 0.26)'
                : '1px solid rgba(59, 130, 246, 0.24)',
        color: '#fff',
        transition: 'all 0.2s ease'
      }}
    >
      {banner.level === 'info' ? (
        <Loader2 size={16} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
      ) : banner.level === 'success' ? (
        <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
      ) : banner.level === 'error' ? (
        <CloudOff size={16} style={{ color: '#ef4444' }} />
      ) : (
        <Cloud size={16} style={{ color: '#f59e0b' }} />
      )}
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
        {gameTitle
          ? `${gameTitle}: ${banner.message}`
          : banner.message}
        {banner.conflict && (
          <span style={{ marginLeft: 8, opacity: 0.85, fontSize: 12 }}>
            (conflito detectado)
          </span>
        )}
      </div>
      {banner.gameUrl && (
        <button className="btn ghost" onClick={onOpenBackups} style={{ fontSize: 12 }}>
          Ver backups
        </button>
      )}
      <button
        className="btn ghost"
        onClick={onClose}
        title="Fechar"
        style={{ paddingInline: 8, opacity: 0.7 }}
      >
        ✕
      </button>
    </div>
  )
}
