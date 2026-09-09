/**
 * Switches for parts of the launcher that are built but not currently shown.
 *
 * The code behind a disabled flag stays wired up and compiled — flipping the
 * flag back to true is the whole of turning the feature on again.
 */

/**
 * The classic store: the embedded online-fix.me webview, its sidebar entry and
 * every "open in the classic store" action. Hidden while the native store
 * covers the same ground; the tab itself still renders if something navigates
 * to it.
 */
export const CLASSIC_STORE_ENABLED = false
