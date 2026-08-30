import { useEffect, useRef } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

/**
 * Dialog keyboard behaviour: Escape closes, Tab cycles inside the dialog, and
 * focus returns to whatever opened it. Attach the returned ref to the dialog
 * element (not the backdrop).
 *
 * The close callback is read through a ref so an inline arrow function in the
 * parent does not re-run the effect on every render — that would keep yanking
 * focus back to the first control while the user types.
 */
export function useModalA11y<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    const container = ref.current
    const previouslyFocused = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] => {
      if (!container) return []
      return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement)
    }

    focusable()[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !container) return

      const items = focusable()
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null

      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      try {
        previouslyFocused?.focus?.()
      } catch {
        // The opener may be gone by now.
      }
    }
  }, [])

  return ref
}
