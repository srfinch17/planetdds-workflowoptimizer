import { useState } from 'react'
import './App.css'
import { Intake } from './views/Intake'
import { Admin } from './views/Admin'

type Tab = 'intake' | 'admin'

/**
 * App shell: a header and two tabs.
 *   - Intake = the patient/front-desk face (unstructured request → ranked slots)
 *   - Admin  = the exec/practice face (calendar, cost & efficiency metrics)
 * The shell owns nothing but which tab is showing; each view fetches its own data.
 */
function App() {
  const [tab, setTab] = useState<Tab>('intake')

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header__bar">
          <div className="app-header__mark">S</div>
          <div className="app-header__title">
            Scheduling Assistant <span>· Planet DDS</span>
          </div>
          <div className="app-header__spacer" />
          <div className="app-header__mode">agentic · explainable · cost-aware</div>
        </div>
        <nav className="tabs">
          <button
            className={`tab ${tab === 'intake' ? 'tab--active' : ''}`}
            onClick={() => setTab('intake')}
          >
            Patient Intake
          </button>
          <button
            className={`tab ${tab === 'admin' ? 'tab--active' : ''}`}
            onClick={() => setTab('admin')}
          >
            Admin Dashboard
          </button>
        </nav>
      </header>

      <main className="app-main">{tab === 'intake' ? <Intake /> : <Admin />}</main>
    </div>
  )
}

export default App
