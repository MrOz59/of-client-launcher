import { useState, useRef, useCallback, useEffect } from 'react'
import type { Game, IniField } from './types'

export function useOnlineFixIni() {
  const [iniContent, setIniContent] = useState('')
  const [iniPath, setIniPath] = useState<string | null>(null)
  const [iniLoading, setIniLoading] = useState(false)
  const [iniSaving, setIniSaving] = useState(false)
  const [iniError, setIniError] = useState<string | null>(null)
  const [iniDirty, setIniDirty] = useState(false)
  const [iniFields, setIniFields] = useState<IniField[]>([])
  const [iniOriginalContent, setIniOriginalContent] = useState('')
  const [iniLastSavedAt, setIniLastSavedAt] = useState<number | null>(null)

  // Refs for autosave
  const iniFieldsRef = useRef<IniField[]>([])
  const iniOriginalContentRef = useRef<string>('')
  const iniAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync refs with state
  useEffect(() => { iniFieldsRef.current = iniFields }, [iniFields])
  useEffect(() => { iniOriginalContentRef.current = iniOriginalContent }, [iniOriginalContent])

  const resetState = useCallback(() => {
    setIniContent('')
    setIniOriginalContent('')
    iniOriginalContentRef.current = ''
    setIniPath(null)
    setIniDirty(false)
    setIniError(null)
    setIniLoading(false)
    setIniSaving(false)
    setIniFields([])
    iniFieldsRef.current = []
    setIniLastSavedAt(null)
  }, [])

  const parseIniFields = useCallback((text: string): IniField[] => {
    const fields: IniField[] = []
    const lines = (text || '').split(/\r?\n/)
    const kvRegex = /^\s*([^=;\[#]+?)\s*=\s*(.*)$/

    lines.forEach((line) => {
      const match = line.match(kvRegex)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim()
        if (key) fields.push({ key, value })
      }
    })
    return fields
  }, [])

  const buildIniContent = useCallback((originalContent: string, fields: IniField[]): string => {
    const validFields = fields.filter(f => f.key && f.key.trim())
    if (validFields.length === 0) return originalContent || ''
    if (!originalContent || originalContent.trim() === '') {
      return validFields.map(f => `${f.key}=${f.value}`).join('\n')
    }

    const fieldMap = new Map<string, string>()
    validFields.forEach(f => fieldMap.set(f.key.toLowerCase().trim(), f.value))

    const lines = originalContent.split(/\r?\n/)
    const kvRegex = /^(\s*)([^=;\[#]+?)(\s*=\s*)(.*)$/
    const usedKeys = new Set<string>()

    const updatedLines = lines.map(line => {
      const match = line.match(kvRegex)
      if (match) {
        const [, indent, key, separator] = match
        const keyLower = key.trim().toLowerCase()
        if (fieldMap.has(keyLower)) {
          usedKeys.add(keyLower)
          return `${indent}${key.trim()}${separator}${fieldMap.get(keyLower)}`
        }
      }
      return line
    })

    validFields.forEach(f => {
      const keyLower = f.key.toLowerCase().trim()
      if (!usedKeys.has(keyLower)) updatedLines.push(`${f.key}=${f.value}`)
    })

    return updatedLines.join('\n')
  }, [])

  const buildCurrentIniText = useCallback((): string => {
    const currentFields = iniFieldsRef.current
    const currentOriginal = iniOriginalContentRef.current
    const validFields = currentFields.filter(f => f.key && f.key.trim())

    if (validFields.length === 0) return currentOriginal || iniContent || ''
    if (currentOriginal && currentOriginal.trim()) return buildIniContent(currentOriginal, validFields)
    return validFields.map(f => `${f.key}=${f.value}`).join('\n')
  }, [buildIniContent, iniContent])

  const updateField = useCallback((index: number, newValue: string) => {
    setIniFields(prev => {
      const newFields = [...prev]
      newFields[index] = { ...newFields[index], value: newValue }
      iniFieldsRef.current = newFields
      return newFields
    })
    setIniDirty(true)
  }, [])

  const updateFieldKey = useCallback((index: number, newKey: string) => {
    setIniFields(prev => {
      const newFields = [...prev]
      newFields[index] = { ...newFields[index], key: newKey }
      iniFieldsRef.current = newFields
      return newFields
    })
    setIniDirty(true)
  }, [])

  const addField = useCallback(() => {
    setIniFields(prev => {
      const newFields = [...prev, { key: '', value: '' }]
      iniFieldsRef.current = newFields
      return newFields
    })
    setIniDirty(true)
  }, [])

  const removeField = useCallback((index: number) => {
    setIniFields(prev => {
      const newFields = prev.filter((_, i) => i !== index)
      iniFieldsRef.current = newFields
      return newFields
    })
    setIniDirty(true)
  }, [])

  const reprocessText = useCallback(() => {
    const fields = parseIniFields(iniOriginalContent || iniContent)
    setIniFields(fields)
    iniFieldsRef.current = fields
  }, [parseIniFields, iniOriginalContent, iniContent])

  const loadIni = useCallback(async (game: Game) => {
    if (!game.install_path) {
      setIniError('Jogo precisa estar instalado para editar o OnlineFix.ini')
      setIniContent('')
      setIniOriginalContent('')
      iniOriginalContentRef.current = ''
      setIniPath(null)
      setIniFields([])
      iniFieldsRef.current = []
      return
    }
    setIniLoading(true)
    setIniError(null)
    try {
      const res = await window.electronAPI.getOnlineFixIni(game.url)
      if (!res.success) {
        setIniError(res.error || 'Falha ao carregar OnlineFix.ini')
        setIniContent('')
        setIniOriginalContent('')
        iniOriginalContentRef.current = ''
        setIniPath(null)
        setIniFields([])
        iniFieldsRef.current = []
        return
      }
      const txt = res.content || ''
      setIniContent(txt)
      setIniOriginalContent(txt)
      iniOriginalContentRef.current = txt
      setIniPath(res.path || null)
      setIniDirty(false)
      const fields = parseIniFields(txt)
      setIniFields(fields)
      iniFieldsRef.current = fields
    } catch (e: any) {
      setIniError(e?.message || 'Falha ao carregar OnlineFix.ini')
      setIniContent('')
      setIniOriginalContent('')
      iniOriginalContentRef.current = ''
      setIniPath(null)
      setIniFields([])
      iniFieldsRef.current = []
    } finally {
      setIniLoading(false)
    }
  }, [parseIniFields])

  const saveIni = useCallback(async (game: Game) => {
    if (!game.install_path) return
    setIniSaving(true)
    setIniError(null)
    try {
      const textToSave = buildCurrentIniText()
      const res = await window.electronAPI.saveOnlineFixIni(game.url, textToSave)
      if (!res.success) throw new Error(res.error || 'Falha ao salvar')
      setIniContent(textToSave)
      setIniOriginalContent(textToSave)
      iniOriginalContentRef.current = textToSave
      setIniDirty(false)
      setIniLastSavedAt(Date.now())
      if (res.path) setIniPath(res.path)
    } catch (e: any) {
      setIniError(e?.message || 'Falha ao salvar OnlineFix.ini')
    } finally {
      setIniSaving(false)
    }
  }, [buildCurrentIniText])

  // Cleanup autosave timer
  const clearAutosaveTimer = useCallback(() => {
    if (iniAutosaveTimerRef.current) {
      clearTimeout(iniAutosaveTimerRef.current)
      iniAutosaveTimerRef.current = null
    }
  }, [])

  return {
    // State
    iniContent,
    iniPath,
    iniLoading,
    iniSaving,
    iniError,
    iniDirty,
    iniFields,
    iniOriginalContent,
    iniLastSavedAt,

    // Refs
    iniAutosaveTimerRef,

    // Actions
    resetState,
    loadIni,
    saveIni,
    updateField,
    updateFieldKey,
    addField,
    removeField,
    reprocessText,
    buildCurrentIniText,
    clearAutosaveTimer
  }
}
