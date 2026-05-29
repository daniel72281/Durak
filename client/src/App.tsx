import { useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { useTranslation } from 'react-i18next'
import type { HelloPayload } from '@shared/types'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

function App() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [serverMessage, setServerMessage] = useState<string>('')

  useEffect(() => {
    const socket: Socket = io(SERVER_URL)
    socket.on('connect', () => setStatus('connected'))
    socket.on('disconnect', () => setStatus('disconnected'))
    socket.on('hello', (payload: HelloPayload) => setServerMessage(payload.message))
    return () => {
      socket.disconnect()
    }
  }, [])

  const toggleLanguage = () => {
    const next = i18n.language.startsWith('he') ? 'en' : 'he'
    void i18n.changeLanguage(next)
  }

  return (
    <main className="app">
      <header className="header">
        <h1>{t('app.title')}</h1>
        <button onClick={toggleLanguage} className="lang-toggle" type="button">
          {t('language.switch')}
        </button>
      </header>
      <p className="subtitle">{t('app.subtitle')}</p>
      <section className="status">
        <span className={`status-dot status-${status}`} />
        <span>{t(`status.${status}`)}</span>
      </section>
      {serverMessage && <p className="server-message">→ {serverMessage}</p>}
    </main>
  )
}

export default App
