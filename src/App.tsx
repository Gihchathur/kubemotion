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
import YamlEditor from './components/YamlEditor'

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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const parseResult = useMemo(
    () => parseKubernetesYaml(yamlInput),
    [yamlInput],
  )

  const graph = useMemo(
    () => buildKubernetesGraph(parseResult.resources),
    [parseResult.resources],
  )

  const selectedNode = graph.nodes.find(
    (node) => node.id === selectedNodeId,
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

            <div className="editor-actions">
              <button
                type="button"
                className="load-example-button"
                onClick={() => setYamlInput(INITIAL_YAML)}
              >
                Load example
              </button>
              <button
                type="button"
                className="clear-editor-button"
                onClick={() => setYamlInput('')}
              >
                Clear
              </button>

              <span className="resource-count">
                {parseResult.resources.length} resources
              </span>
            </div>
          </div>

          <div className="yaml-editor">
            <YamlEditor
              value={yamlInput}
              onChange={setYamlInput}
            />
          </div>

          <div className="editor-footer">
            <span>{yamlInput.length} characters</span>
            <span>{parseResult.errors.length} errors</span>
          </div>

          {parseResult.errors.length > 0 && (
            <div className="error-panel">
              {parseResult.errors.map((error, index) => (
                <p key={`${error.message}-${index}`}>
                  {error.message}
                </p>
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
                <span>
                  Enter valid Kubernetes YAML to generate a graph.
                </span>
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
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

          {selectedNode && (
            <div className="resource-details">
              <div className="resource-details-header">
                <strong>{selectedNode.label}</strong>
                <span>{selectedNode.type}</span>
              </div>

              <div className="resource-details-meta">
                <span>
                  API: {selectedNode.resource.apiVersion}
                </span>

                <span>
                  Namespace: {selectedNode.resource.metadata.namespace}
                </span>

                {Object.entries(selectedNode.resource.metadata.labels).map(
                  ([key, value]) => (
                    <span key={`${key}-${value}`}>
                      {key}: {value}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
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