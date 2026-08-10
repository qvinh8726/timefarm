import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AuthProvider } from './lib/auth'
import { AppStoreProvider } from './lib/state'
import './analytics.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <AppStoreProvider>
        <App />
      </AppStoreProvider>
    </AuthProvider>
  </StrictMode>,
)
