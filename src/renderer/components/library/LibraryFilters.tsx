import React from 'react'
import { RefreshCw, Search } from 'lucide-react'

export interface LibraryFiltersProps {
  search: string
  onSearchChange: (value: string) => void
  category: 'all' | 'favorites' | 'installed' | 'updating'
  onCategoryChange: (value: 'all' | 'favorites' | 'installed' | 'updating') => void
  sort: 'recent' | 'name' | 'size'
  onSortChange: (value: 'recent' | 'name' | 'size') => void
  onScan: () => void
  scanning: boolean
}

export function LibraryFilters({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  sort,
  onSortChange,
  onScan,
  scanning
}: LibraryFiltersProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flex: '1 1 260px', minWidth: 220, flexWrap: 'wrap' }}>
        <div className="input-row" style={{ width: '100%', maxWidth: 420, gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>Buscar</span>
            {search?.trim() && (
              <button
                className="btn ghost"
                onClick={() => onSearchChange('')}
                style={{ padding: '6px 10px', lineHeight: 1 }}
                title="Limpar"
              >
                Limpar
              </button>
            )}
          </label>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar jogo..."
            spellCheck={false}
          />
        </div>

        <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
          <label>Coleção</label>
          <select value={category} onChange={(e) => onCategoryChange(e.target.value as any)}>
            <option value="all">Todos</option>
            <option value="favorites">Favoritos</option>
            <option value="installed">Instalados</option>
            <option value="updating">Em atualização</option>
          </select>
        </div>

        <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
          <label>Ordenar</label>
          <select value={sort} onChange={(e) => onSortChange(e.target.value as any)}>
            <option value="recent">Jogado recentemente</option>
            <option value="name">Nome</option>
            <option value="size">Tamanho</option>
          </select>
        </div>

        <div className="input-row" style={{ width: 44, maxWidth: 44, gap: 6 }}>
          <label style={{ visibility: 'hidden' }}>Ação</label>
          <button
            className="btn ghost"
            onClick={onScan}
            disabled={scanning}
            title="Escanear jogos instalados no disco"
            aria-label="Escanear jogos instalados no disco"
            style={{ padding: 8, opacity: 0.9, lineHeight: 1, minWidth: 44, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {scanning ? <RefreshCw size={16} className="of-spin" /> : <Search size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
