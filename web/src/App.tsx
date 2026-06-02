import { useEffect, useState } from 'react'
import './App.css'
import { Intake } from './views/Intake'
import { Admin } from './views/Admin'
import { Metrics } from './views/Metrics'
import { ThemeToggle } from './components/ThemeToggle'
import { ModeIndicator } from './components/ModeIndicator'
import { getMetrics, type ExtractionMode } from './api'

type Tab = 'intake' | 'admin' | 'metrics'

/**
 * App shell: a header and two tabs.
 *   - Intake = the patient/front-desk face (unstructured request → ranked slots)
 *   - Admin  = the exec/practice face (calendar, cost & efficiency metrics)
 * The shell owns nothing but which tab is showing; each view fetches its own data.
 */
function App() {
  const [tab, setTab] = useState<Tab>('intake')
  const [mode, setMode] = useState<ExtractionMode>('tiered')
  const [online, setOnline] = useState(true)

  // Is the LLM reachable (server has a key)? Gates the "agentic" mode.
  useEffect(() => {
    getMetrics()
      .then((m) => setOnline(m.online))
      .catch(() => {})
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__bar">
          <div className="app-header__mark">🦷</div>
          <div className="app-header__title">
            Scheduling Assistant <span>· ops console</span>
          </div>
          <div className="app-header__spacer" />
          <ModeIndicator mode={mode} setMode={setMode} online={online} />
          <ThemeToggle />
        </div>
        <nav className="tabs">
          <button
            className={`tab ${tab === 'intake' ? 'tab--active' : ''}`}
            onClick={() => setTab('intake')}
          >
            🗓️ Patient Intake
          </button>
          <button
            className={`tab ${tab === 'admin' ? 'tab--active' : ''}`}
            onClick={() => setTab('admin')}
          >
            🛠️ Admin
          </button>
          <button
            className={`tab ${tab === 'metrics' ? 'tab--active' : ''}`}
            onClick={() => setTab('metrics')}
          >
            📊 Metrics
          </button>
        </nav>
      </header>

      <main className="app-main">
        {tab === 'intake' ? <Intake mode={mode} /> : tab === 'admin' ? <Admin /> : <Metrics />}
      </main>
    </div>
  )
}

export default App
