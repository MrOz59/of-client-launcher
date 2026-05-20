import React from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { useI18n } from '../../i18n'

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
  const { t } = useI18n()

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flex: '1 1 260px', minWidth: 220, flexWrap: 'wrap' }}>
        <div className="input-row" style={{ width: '100%', maxWidth: 420, gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span>{t('library.filters.search')}</span>
            {search?.trim() && (
              <button
                className="btn ghost"
                onClick={() => onSearchChange('')}
                style={{ padding: '6px 10px', lineHeight: 1 }}
                title={t('common.clear')}
              >
                {t('common.clear')}
              </button>
            )}
          </label>
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('library.filters.searchPlaceholder')}
            spellCheck={false}
          />
        </div>

        <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
          <label>{t('library.filters.collection')}</label>
          <select value={category} onChange={(e) => onCategoryChange(e.target.value as any)}>
            <option value="all">{t('library.filters.all')}</option>
            <option value="favorites">{t('library.filters.favorites')}</option>
            <option value="installed">{t('library.filters.installed')}</option>
            <option value="updating">{t('library.filters.updating')}</option>
          </select>
        </div>

        <div className="input-row" style={{ width: '100%', maxWidth: 240, gap: 6 }}>
          <label>{t('library.filters.sort')}</label>
          <select value={sort} onChange={(e) => onSortChange(e.target.value as any)}>
            <option value="recent">{t('library.filters.recent')}</option>
            <option value="name">{t('library.filters.name')}</option>
            <option value="size">{t('library.filters.size')}</option>
          </select>
        </div>

        <div className="input-row" style={{ width: 44, maxWidth: 44, gap: 6 }}>
          <label style={{ visibility: 'hidden' }}>{t('library.filters.action')}</label>
          <button
            className="btn ghost"
            onClick={onScan}
            disabled={scanning}
            title={t('library.filters.scanInstalled')}
            aria-label={t('library.filters.scanInstalled')}
            style={{ padding: 8, opacity: 0.9, lineHeight: 1, minWidth: 44, height: 42, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {scanning ? <RefreshCw size={16} className="of-spin" /> : <Search size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
