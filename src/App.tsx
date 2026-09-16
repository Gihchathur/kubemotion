import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
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
  namespace: production
  labels:
    app: web
    tier: frontend
    environment: production
  annotations:
    description: "Production web application"
spec:
  replicas: 3
  revisionHistoryLimit: 5
  minReadySeconds: 10
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
  selector:
    matchLabels:
      app: web
      tier: frontend
  template:
    metadata:
      labels:
        app: web
        tier: frontend
        environment: production
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
        prometheus.io/path: "/metrics"
    spec:
      serviceAccountName: web-service-account
      terminationGracePeriodSeconds: 30
      securityContext:
        runAsNonRoot: true
        fsGroup: 101

      containers:
        - name: web
          image: nginx:1.27-alpine
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 80
              protocol: TCP
          env:
            - name: APP_ENV
              value: production
            - name: LOG_LEVEL
              value: info
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 2
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /
              port: http
            initialDelaySeconds: 20
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command:
                  - /bin/sh
                  - -c
                  - sleep 10
          volumeMounts:
            - name: web-config
              mountPath: /etc/nginx/conf.d
              readOnly: true
            - name: web-cache
              mountPath: /var/cache/nginx

      volumes:
        - name: web-config
          configMap:
            name: web-config
        - name: web-cache
          emptyDir: {}

---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: production
  labels:
    app: web
    tier: frontend
  annotations:
    prometheus.io/scrape: "true"
spec:
  type: ClusterIP
  selector:
    app: web
    tier: frontend
  ports:
    - name: http
      port: 80
      targetPort: http
      protocol: TCP
  sessionAffinity: None

---
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-config
  namespace: production
  labels:
    app: web
data:
  default.conf: |
    server {
      listen 80;
      server_name _;

      location / {
        root /usr/share/nginx/html;
        index index.html;
      }

      location /health {
        access_log off;
        return 200 'healthy';
      }
    }

---
apiVersion: v1
kind: Secret
metadata:
  name: web-secrets
  namespace: production
  labels:
    app: web
type: Opaque
stringData:
  API_KEY: "demo-api-key"
  DATABASE_PASSWORD: "demo-password"

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: web-storage
  namespace: production
  labels:
    app: web
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
  storageClassName: standard

---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: web-service-account
  namespace: production

---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web-ingress
  namespace: production
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: web.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 80`

const nodeTypes = {
  kubernetes: KubernetesNode,
}

function App() {
  const [yamlInput, setYamlInput] = useState(INITIAL_YAML)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')

  const [kindFilter, setKindFilter] = useState('all')

  const [flowInstance, setFlowInstance] =
  useState<ReactFlowInstance | null>(null)

  useEffect(() => {
    const handleKeyboardShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey) {
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        setYamlInput(INITIAL_YAML)
      }

      if (event.shiftKey && event.key === 'Backspace') {
        event.preventDefault()
        setYamlInput('')
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcut)

    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcut)
    }
  }, [])

  const parseResult = useMemo(
    () => parseKubernetesYaml(yamlInput),
    [yamlInput],
  )

  const graph = useMemo(
    () => buildKubernetesGraph(parseResult.resources),
    [parseResult.resources],
  )

  const selectedNode = graph.nodes.find(
    (node) =>
      node.id === selectedNodeId &&
      visibleNodeIds.has(node.id),
  )

  const normalizedSearchQuery = searchQuery.trim().toLowerCase()

  const visibleNodeIds = new Set(
    graph.nodes
      .filter((node) => {
        const matchesSearch =
          !normalizedSearchQuery ||
          [
            node.label,
            node.type,
            node.resource.kind,
            node.resource.metadata.namespace,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearchQuery)

        const matchesKind =
          kindFilter === 'all' ||
          node.resource.kind.toLowerCase() === kindFilter

        return matchesSearch && matchesKind
      })
      .map((node) => node.id),
  )

  const nodes: Node[] = graph.nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .map((node) => ({
    id: node.id,
    position: node.position,
    type: 'kubernetes',
    data: {
      label: node.label,
      kind: node.type,
    },
  }))

  const edges: Edge[] = graph.edges
    .filter(
      (edge) =>
        visibleNodeIds.has(edge.source) &&
        visibleNodeIds.has(edge.target),
    )
    .map((edge) => {
      const edgeColor =
        edge.type === 'service-to-deployment'
          ? '#a78bfa'
          : edge.type === 'ingress-to-service'
            ? '#f59e0b'
            : '#38bdf8'

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        animated: true,
        type: 'smoothstep',
        markerEnd: {
          type: 'arrowclosed',
          color: edgeColor,
        },
        style: {
          stroke: edgeColor,
          strokeWidth: 2,
        },
        labelStyle: {
          fill: '#cbd5e1',
          fontSize: 11,
        },
        labelBgStyle: {
          fill: '#111827',
          fillOpacity: 0.9,
        },
      }
    })

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

              <span
                className={`validation-badge ${
                  parseResult.errors.length === 0 ? 'valid' : 'invalid'
                }`}
              >
                {parseResult.errors.length === 0 ? 'Valid YAML' : 'Invalid YAML'}
              </span>
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

            <span className="shortcut-hints">
              <span>Ctrl + Enter: Load example</span>
              <span>Ctrl + Shift + Backspace: Clear</span>
            </span>

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

            

            <div className="search-controls">
              <select
                className="resource-kind-filter"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value)}
                aria-label="Filter resources by kind"
              >
                <option value="all">All kinds</option>
                <option value="deployment">Deployment</option>
                <option value="service">Service</option>
                <option value="ingress">Ingress</option>
                <option value="pod">Pod</option>
                <option value="configmap">ConfigMap</option>
                <option value="secret">Secret</option>
                <option value="persistentvolumeclaim">
                  PersistentVolumeClaim
                </option>
                <option value="serviceaccount">ServiceAccount</option>
              </select>

              <input
                className="resource-search"
                type="search"
                placeholder="Search resources..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search Kubernetes resources"
              />

              {searchQuery && (
                <button
                  type="button"
                  className="clear-search-button"
                  onClick={() => setSearchQuery('')}
                >
                  Clear
                </button>
              )}
            </div>

            <div className="editor-actions">
              <button
                type="button"
                className="reset-graph-button"
                onClick={() => flowInstance?.fitView({ duration: 500 })}
                disabled={!flowInstance}
              >
                Reset view
              </button>

              <span className="resource-count search-result-count">
                {nodes.length} of {graph.nodes.length} nodes · {edges.length} edges
              </span>
            </div>
          </div>

          <div className="resource-legend">
            {[
              ['Deployment', '#38bdf8'],
              ['Service', '#a78bfa'],
              ['Ingress', '#f59e0b'],
              ['Pod', '#22c55e'],
              ['ConfigMap', '#14b8a6'],
              ['Secret', '#f43f5e'],
              ['PVC', '#e879f9'],
              ['ServiceAccount', '#facc15'],
            ].map(([label, color]) => (
              <span key={label} className="legend-item">
                <span
                  className="legend-color"
                  style={{ backgroundColor: color }}
                />
                {label}
              </span>
            ))}

            <span className="legend-divider" />

            <span className="legend-item">
              <span
                className="legend-line"
                style={{ backgroundColor: '#a78bfa' }}
              />
              Service → Deployment
            </span>

            <span className="legend-item">
              <span
                className="legend-line"
                style={{ backgroundColor: '#f59e0b' }}
              />
              Ingress → Service
            </span>

            <span className="legend-item">
              <span
                className="legend-line"
                style={{ backgroundColor: '#38bdf8' }}
              />
              Configuration relationship
            </span>
          </div>

          <div className="flow-wrapper">
            {nodes.length === 0 ? (
              <div className="empty-state">
                <strong>
                  {graph.nodes.length === 0
                    ? 'No graph available'
                    : 'No matching resources'}
                </strong>

                <span>
                  {graph.nodes.length === 0
                    ? 'Enter valid Kubernetes YAML to generate a graph.'
                    : 'Try a different resource name, kind, or namespace.'}
                </span>
              </div>
            ) : (
              <ReactFlow
                key={`${nodes.length}-${edges.length}-${searchQuery}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId(null)}
                onInit={setFlowInstance}
                fitView
                nodesDraggable
                nodesConnectable={false}
                elementsSelectable
              >
                <Background
                  color="#334155"
                  gap={24}
                  size={1}
                />
                <Controls />
                <MiniMap />
              </ReactFlow>
            )}
          </div>

          {selectedNode && (
            <div className="resource-details">
              <div className="resource-details-header">
                <div className="resource-title">
                  <strong>{selectedNode.label}</strong>
                  <span>{selectedNode.type}</span>
                </div>

                <button
                  type="button"
                  className="close-details-button"
                  onClick={() => setSelectedNodeId(null)}
                  aria-label="Close resource details"
                >
                  ×
                </button>
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