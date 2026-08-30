import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { ToastProvider } from './components/ToastHost'

const root = createRoot(document.getElementById('root')!)
root.render(
  <I18nProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </I18nProvider>
)
