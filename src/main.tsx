import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// StrictMode disabled for performance - causes double-mounting in dev
// Re-enable when debugging side effects
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
