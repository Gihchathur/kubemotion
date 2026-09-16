import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import './App.css'
import { buildKubernetesGraph } from './lib/graphBuilder'
import { parseKubernetesYaml } from './lib/kubernetesParser'
import KubernetesNode from './components/KubernetesNode'


const INITIAL_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  selector:
    app: web
  ports:
    - port: 80
      targetPort: 80`


const nodeTypes = {
  kubernetes: KubernetesNode,
}
function App() {
  const [yamlInput, setYamlInput] = useState(INITIAL_YAML)

  const parseResult = useMemo(
    () => parseKubernetesYaml(yamlInput),
    [yamlInput],
  )

  const graph = useMemo(
    () => buildKubernetesGraph(parseResult.resources),
    [parseResult.resources],
  )

  const nodes: Node[] = graph.nodes.map((node) => ({
    id: node.id,
    position: node.position,
    type: 'kubernetes',
    data: {
      label: node.label,
      kind: node.type,
    },
  }))

  const edges: Edge[] = graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    animated: true,
    style: {
      stroke: '#38bdf8',
      strokeWidth: 2,
    },
    labelStyle: {
      fill: '#cbd5e1',
      fontSize: 11,
    },
  }))

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <h1>KubeMotion</h1>
            <p>Kubernetes architecture visualizer</p>
          </div>
        </div>

        <div className="topbar-status">
          <span className="status-dot" />
          <span>Browser-only</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="editor-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Input</span>
              <h2>Kubernetes YAML</h2>
            </div>
            <span className="resource-count">
              {parseResult.resources.length} resources
            </span>
          </div>

          <textarea
            className="yaml-editor"
            value={yamlInput}
            onChange={(event) => setYamlInput(event.target.value)}
            spellCheck={false}
            aria-label="Kubernetes YAML input"
          />

          <div className="editor-footer">
            <span>{yamlInput.length} characters</span>
            <span>{parseResult.errors.length} errors</span>
          </div>

          {parseResult.errors.length > 0 && (
            <div className="error-panel">
              {parseResult.errors.map((error, index) => (
                <p key={`${error.message}-${index}`}>{error.message}</p>
              ))}
            </div>
          )}
        </aside>

        <section className="canvas-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Visualization</span>
              <h2>Architecture graph</h2>
            </div>
            <span className="resource-count">
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
          </div>

          <div className="flow-wrapper">
            {graph.nodes.length === 0 ? (
              <div className="empty-state">
                <strong>No graph available</strong>
                <span>Enter valid Kubernetes YAML to generate a graph.</span>
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
              >
                <Background color="#334155" gap={24} />
                <Controls />
                <MiniMap />
              </ReactFlow>
            )}
          </div>
        </section>
      </section>

      <footer className="app-footer">
        <span>Made for exploring Kubernetes architecture</span>
        <span>v0.1.0</span>
      </footer>
    </main>
  )
}

export default App