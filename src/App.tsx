
import { useState } from 'react'
import './App.css'

function App() {
  const [yamlContent, setYamlContent] = useState('')

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <h1>KubeMotion</h1>
            <p>Kubernetes architecture visualizer</p>
          </div>
        </div>

        <div className="topbar-actions">
          <span className="status-indicator">
            <span className="status-dot" />
            Frontend only
          </span>
          <button className="example-button">
            Load example
          </button>
        </div>
      </header>

      <main className="workspace">
        <section className="editor-panel">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">01 / INPUT</span>
              <h2>Manifest editor</h2>
            </div>
            <span className="file-label">kubernetes.yaml</span>
          </div>

          <div className="editor-wrapper">
            <div className="editor-toolbar">
              <span className="editor-language">YAML</span>
              <span className="editor-hint">Paste your manifest</span>
            </div>

            <textarea
              className="yaml-editor"
              value={yamlContent}
              onChange={(event) => setYamlContent(event.target.value)}
              placeholder="# Paste your Kubernetes YAML here..."
              spellCheck={false}
            />
          </div>

          <div className="panel-footer">
            <span>{yamlContent.length} characters</span>
            <span>Live editing enabled</span>
          </div>
        </section>

        <section className="visualization-panel">
          <div className="panel-header">
            <div>
              <span className="panel-eyebrow">02 / VISUALIZE</span>
              <h2>Architecture canvas</h2>
            </div>
            <span className="canvas-status">Waiting for manifest</span>
          </div>

          <div className="canvas">
            <div className="empty-state">
              <div className="empty-icon">✦</div>
              <h3>Your architecture starts here</h3>
              <p>
                Paste a Kubernetes manifest to see your resources
                transform into an interactive architecture.
              </p>
              <div className="empty-hint">
                <span>YAML</span>
                <span>→</span>
                <span>Graph</span>
                <span>→</span>
                <span>Traffic</span>
              </div>
            </div>

            <div className="canvas-grid" />
          </div>

          <div className="panel-footer">
            <span>0 resources</span>
            <span>Simulation idle</span>
          </div>
        </section>
      </main>

      <footer className="app-footer">
        <span>KubeMotion</span>
        <span>Built for exploring Kubernetes architectures</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  )
}

export default App