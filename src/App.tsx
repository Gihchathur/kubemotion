import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { buildKubernetesGraph } from './lib/graphBuilder'
import { parseKubernetesYaml } from './lib/kubernetesParser'
import { readHelmChart, type HelmChartBundle } from './lib/helmChart'
import KubernetesNode from './components/KubernetesNode'
import KubernetesEdge from './components/KubernetesEdge'
import YamlEditor from './components/YamlEditor'
import type { KubernetesResource } from './types/kubernetes'

const INITIAL_YAML = `# KubeMotion production-style demo
# Three workloads, ingress routing, configuration, secrets and storage.
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: production
  labels:
    app: frontend
    tier: web
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      serviceAccountName: frontend-sa
      securityContext:
        runAsNonRoot: true
      containers:
        - name: frontend
          image: ghcr.io/example/frontend:1.4.2
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - configMapRef:
                name: frontend-config
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: http
          livenessProbe:
            httpGet:
              path: /health
              port: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: production
  labels:
    app: api
    tier: backend
spec:
  replicas: 4
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      serviceAccountName: api-sa
      containers:
        - name: api
          image: ghcr.io/example/api:2.8.1
          ports:
            - name: http
              containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: database-url
          resources:
            requests:
              cpu: 250m
              memory: 256Mi
            limits:
              cpu: 1
              memory: 1Gi
          readinessProbe:
            httpGet:
              path: /ready
              port: http
          volumeMounts:
            - name: api-config
              mountPath: /etc/api
              readOnly: true
            - name: api-data
              mountPath: /var/lib/api
      volumes:
        - name: api-config
          configMap:
            name: api-config
        - name: api-data
          persistentVolumeClaim:
            claimName: api-data
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: production
  labels:
    app: worker
    tier: background
spec:
  replicas: 2
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      serviceAccountName: worker-sa
      containers:
        - name: worker
          image: ghcr.io/example/worker:1.9.0
          envFrom:
            - secretRef:
                name: worker-secrets
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            exec:
              command: ["/bin/sh", "-c", "test -f /tmp/worker-ready"]
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: production
spec:
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: http
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: production
spec:
  selector:
    app: api
  ports:
    - name: http
      port: 8080
      targetPort: http
---
apiVersion: v1
kind: Service
metadata:
  name: worker-metrics
  namespace: production
spec:
  selector:
    app: worker
  ports:
    - name: metrics
      port: 9090
      targetPort: 9090
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: production-gateway
  namespace: production
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 8080
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: frontend-config
  namespace: production
data:
  API_BASE_URL: https://api.example.com
  FEATURE_FLAGS: checkout,search
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: api-config
  namespace: production
data:
  LOG_LEVEL: info
  OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector.observability:4317
---
apiVersion: v1
kind: Secret
metadata:
  name: api-secrets
  namespace: production
type: Opaque
data:
  database-url: ZHVtbXk=
---
apiVersion: v1
kind: Secret
metadata:
  name: worker-secrets
  namespace: production
type: Opaque
data:
  queue-password: ZHVtbXk=
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: api-data
  namespace: production
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 20Gi
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: frontend-sa
  namespace: production
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api-sa
  namespace: production
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: worker-sa
  namespace: production`

const nodeTypes = { kubernetes: KubernetesNode }
const edgeTypes = { kubernetes: KubernetesEdge }

function getWarnings(resources: KubernetesResource[]): string[] {
  const warnings: string[] = []
  const ids = new Set(resources.map((resource) => resource.id))

  for (const resource of resources) {
    const spec = resource.spec as Record<string, any>
    if (resource.kind === 'Deployment') {
      const template = spec.template?.spec ?? {}
      const containers = Array.isArray(template.containers) ? template.containers : []
      if (containers.some((container: any) => !container.resources?.requests || !container.resources?.limits)) {
        warnings.push(`${resource.metadata.name}: container resources are incomplete.`)
      }
      if (containers.some((container: any) => !container.readinessProbe)) {
        warnings.push(`${resource.metadata.name}: readinessProbe is missing.`)
      }
      if (containers.some((container: any) => typeof container.image === 'string' && /:latest$/.test(container.image))) {
        warnings.push(`${resource.metadata.name}: image uses the mutable latest tag.`)
      }
      const serviceAccountName = template.serviceAccountName
      if (serviceAccountName && !ids.has(`${resource.metadata.namespace}/ServiceAccount/${serviceAccountName}`)) {
        warnings.push(`${resource.metadata.name}: referenced ServiceAccount '${serviceAccountName}' is missing.`)
      }
    }

    if (resource.kind === 'Service') {
      const selector = spec.selector
      if (!selector || Object.keys(selector).length === 0) {
        warnings.push(`${resource.metadata.name}: Service has no selector; verify manually managed endpoints.`)
      }
    }
  }

  return warnings
}

function sanitizeHelmTemplates(bundle: HelmChartBundle): string {
  return bundle.files
    .filter((file) => /(^|\/)templates\/.*\.(ya?ml)$/.test(file.path) && !/NOTES\.txt$/.test(file.path))
    .map((file) => {
      const content = file.content
        // Remove Helm control-only lines, but preserve YAML keys that contain expressions.
        .replace(/^\s*{{-?\s*(?:if|else|end|range|with|define|block|include|template)\b.*?}}\s*$/gm, '')
        .replace(/{{-?\s*[^}]+\s*-?}}/g, 'demo')
        .replace(/\|\s*quote/g, '')
        .replace(/\|\s*default\s+[^\s]+/g, '')
      return `# ${file.path}\n${content}`
    })
    .join('\n---\n')
}

function App() {
  const [yamlInput, setYamlInput] = useState(INITIAL_YAML)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [kindFilter, setKindFilter] = useState('all')
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const [editorCollapsed, setEditorCollapsed] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [layoutMode, setLayoutMode] = useState<'layered' | 'compact'>('layered')
  const [viewMode, setViewMode] = useState<'tree' | 'connections'>('tree')
  const [activeTab, setActiveTab] = useState<'overview' | 'yaml' | 'relationships'>('overview')
  const [helmChart, setHelmChart] = useState<HelmChartBundle | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return
      if (event.key === 'Enter') {
        event.preventDefault()
        setYamlInput(INITIAL_YAML)
        setHelmChart(null)
      }
      if (event.shiftKey && event.key === 'Backspace') {
        event.preventDefault()
        setYamlInput('')
        setHelmChart(null)
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        flowInstance?.fitView({ duration: 450, padding: 0.2 })
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [flowInstance])

  const parseResult = useMemo(() => parseKubernetesYaml(yamlInput), [yamlInput])
  const graph = useMemo(() => buildKubernetesGraph(parseResult.resources), [parseResult.resources])
  const warnings = useMemo(() => [...parseResult.warnings, ...getWarnings(parseResult.resources)], [parseResult.warnings, parseResult.resources])
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()

  const visibleNodeIds = useMemo(() => new Set(graph.nodes.filter((node) => {
    const searchable = [node.label, node.type, node.resource.kind, node.resource.metadata.namespace].join(' ').toLowerCase()
    const matchesSearch = !normalizedSearchQuery || searchable.includes(normalizedSearchQuery)
    const matchesKind = kindFilter === 'all' || node.resource.kind.toLowerCase() === kindFilter
    return matchesSearch && matchesKind
  }).map((node) => node.id)), [graph.nodes, kindFilter, normalizedSearchQuery])

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId)
  const resourceCounts = graph.nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.resource.kind] = (counts[node.resource.kind] ?? 0) + 1
    return counts
  }, {})

  const nodes: Node[] = graph.nodes.filter((node) => visibleNodeIds.has(node.id)).map((node) => ({
    id: node.id,
    position: layoutMode === 'compact' ? { x: node.position.x * 0.72, y: node.position.y * 0.72 } : node.position,
    type: 'kubernetes',
    data: { label: node.label, kind: node.type, tooltip: `${node.resource.kind} · ${node.resource.metadata.namespace} · ${node.resource.id}` },
  }))

  const edges: Edge[] = graph.edges
    .filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target))
    .filter((edge) => viewMode === 'connections' || ['route-to-service', 'service-to-workload', 'workload-to-serviceaccount', 'workload-to-configmap', 'workload-to-secret', 'workload-to-pvc'].includes(edge.type))
    .map((edge) => {
    const edgeColor = '#64748b'
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: { label: edge.label ?? edge.type, tooltip: `${edge.source} → ${edge.target} · ${edge.label ?? edge.type}` },
      ariaLabel: `${edge.source} to ${edge.target}: ${edge.label ?? edge.type}`,
      type: 'kubernetes',
      style: { stroke: edgeColor, strokeWidth: 2 },
    }
  })

  async function handleHelmUpload(file?: File) {
    if (!file) return
    setUploadMessage('Reading Helm chart…')
    try {
      const bundle = await readHelmChart(file)
      const renderedLikeYaml = sanitizeHelmTemplates(bundle)
      setHelmChart(bundle)
      setYamlInput(renderedLikeYaml)
      setUploadMessage(`${bundle.files.length} chart files loaded`)
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Unable to read Helm chart.')
    }
  }

  function exportMermaid() {
    const lines = ['flowchart TD']
    for (const node of graph.nodes) lines.push(`  ${safeId(node.id)}["${node.resource.kind}: ${node.label}"]`)
    for (const edge of graph.edges) lines.push(`  ${safeId(edge.source)} -->|${edge.label ?? edge.type}| ${safeId(edge.target)}`)
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'kubemotion-architecture.mmd'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark">K</div><div><h1>KubeMotion</h1><p>Kubernetes & Helm architecture visualizer</p></div></div>
        <div className="topbar-actions"><span className="status-dot" /> Browser-only <button className="ghost-button" onClick={() => setInspectorOpen((open) => !open)}>{inspectorOpen ? 'Hide inspector' : 'Show inspector'}</button></div>
      </header>

      <section className={`workspace ${editorCollapsed ? 'editor-collapsed' : ''} ${inspectorOpen ? '' : 'inspector-hidden'}`}>
        <aside className="editor-panel">
          <div className={`panel-heading ${editorCollapsed ? 'collapsed-heading' : ''}`}>
            {!editorCollapsed && <div><span className="eyebrow">Input</span><h2>Kubernetes / Helm source</h2></div>}
            <button className="icon-button editor-toggle" onClick={() => setEditorCollapsed((collapsed) => !collapsed)} aria-label={editorCollapsed ? 'Reopen YAML editor' : 'Collapse YAML editor'} title={editorCollapsed ? 'Reopen YAML editor' : 'Collapse YAML editor'}>{editorCollapsed ? '›' : '‹'}</button>
          </div>
          {!editorCollapsed && <>
            <div className="editor-toolbar">
              <button onClick={() => { setYamlInput(INITIAL_YAML); setHelmChart(null) }}>Load example</button>
              <button onClick={() => fileInputRef.current?.click()}>Import .tgz</button>
              <input ref={fileInputRef} type="file" accept=".tgz,application/gzip,application/x-gzip" hidden onChange={(event) => void handleHelmUpload(event.target.files?.[0])} />
              <button className="danger-button" onClick={() => { setYamlInput(''); setHelmChart(null) }}>Clear</button>
              <span className={`validation-badge ${parseResult.errors.length ? 'invalid' : 'valid'}`}>{parseResult.errors.length ? 'Invalid YAML' : 'Valid YAML'}</span>
            </div>
            {helmChart && <div className="helm-summary"><strong>{helmChart.chartName}</strong><span>{helmChart.version ? `v${helmChart.version}` : 'Helm chart'}</span><small>{helmChart.description ?? 'Template files are shown in source view.'}</small></div>}
            {uploadMessage && <div className="upload-message">{uploadMessage}</div>}
            <div className="yaml-editor"><YamlEditor value={yamlInput} onChange={setYamlInput} /></div>
            <div className="editor-footer"><span>{yamlInput.length.toLocaleString()} chars</span><span>Ctrl+Enter example · Ctrl+F fit</span><span>{parseResult.errors.length} errors</span></div>
            {parseResult.errors.length > 0 && <div className="error-panel">{parseResult.errors.map((error, index) => <p key={`${error.message}-${index}`}>{error.message}</p>)}</div>}
          </>}
        </aside>

        <section className="canvas-panel">
          <div className="panel-heading canvas-heading">
            <div><span className="eyebrow">Visualization</span><h2>Architecture graph</h2></div>
            <div className="search-controls"><select value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}><option value="all">All kinds</option>{Array.from(new Set(graph.nodes.map((node) => node.resource.kind))).sort().map((kind) => <option key={kind} value={kind.toLowerCase()}>{kind}</option>)}</select><input type="search" placeholder="Search resources…" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></div>
            <div className="canvas-actions"><select value={viewMode} onChange={(event) => setViewMode(event.target.value as 'tree' | 'connections')}><option value="tree">Argo CD tree</option><option value="connections">All connections</option></select><select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value as 'layered' | 'compact')}><option value="layered">Readable spacing</option><option value="compact">Compact spacing</option></select><button onClick={() => flowInstance?.fitView({ duration: 450, padding: 0.2 })}>Fit graph</button><button onClick={exportMermaid}>Export Mermaid</button></div>
          </div>

          <div className="stat-grid"><div><span>Resources</span><strong>{graph.nodes.length}</strong></div><div><span>Visible</span><strong>{nodes.length}</strong></div><div><span>Relationships</span><strong>{edges.length}</strong></div><div><span>Issues</span><strong className={warnings.length ? 'warning-number' : ''}>{parseResult.errors.length + warnings.length}</strong></div></div>
          <div className="breakdown">{Object.entries(resourceCounts).map(([kind, count]) => <span key={kind}>{kind} <b>{count}</b></span>)}</div>
          <div className="graph-legend">
            {['deployment','service','ingress','pod','configmap','secret','pvc','serviceaccount'].map((kind) => <span key={kind}><i className={`legend-dot ${kind}`} />{kind === 'pvc' ? 'PVC' : kind === 'serviceaccount' ? 'ServiceAccount' : kind.charAt(0).toUpperCase() + kind.slice(1)}</span>)}
            <span><i className="legend-line service-line" />Service → workload</span><span><i className="legend-line ingress-line" />Ingress → Service</span><span><i className="legend-line config-line" />Configuration relationship</span>
          </div>

          <div className="flow-wrapper">
            {nodes.length === 0 ? <div className="empty-state">No matching resources. Clear the filters or load an example.</div> : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView onInit={setFlowInstance} onNodeClick={(_, node) => { setSelectedNodeId(node.id); setInspectorOpen(true) }} onPaneClick={() => setSelectedNodeId(null)}><Background gap={22} size={1} color="#223047" /><MiniMap className="compact-minimap" pannable zoomable nodeStrokeWidth={2} /><Controls /></ReactFlow>}
            {!inspectorOpen && <button className="reopen-inspector" onClick={() => setInspectorOpen(true)} aria-label="Reopen resource inspector">↗ Inspector</button>}
          </div>
        </section>

        {inspectorOpen && <aside className="inspector-panel">
          <div className="panel-heading"><div><span className="eyebrow">Inspector</span><h2>{selectedNode ? selectedNode.label : 'Resource details'}</h2></div><button className="icon-button" onClick={() => setInspectorOpen(false)}>×</button></div>
          {selectedNode ? <div className="inspector-content"><div className="resource-chip">{selectedNode.resource.kind}<span>{selectedNode.resource.metadata.namespace}</span></div><div className="tabs">{(['overview','yaml','relationships'] as const).map((tab) => <button className={activeTab === tab ? 'active' : ''} key={tab} onClick={() => setActiveTab(tab)}>{tab}</button>)}</div>{activeTab === 'overview' && <><dl><dt>API version</dt><dd>{selectedNode.resource.apiVersion}</dd><dt>Resource ID</dt><dd>{selectedNode.resource.id}</dd><dt>Labels</dt><dd>{Object.keys(selectedNode.resource.metadata.labels).length ? Object.entries(selectedNode.resource.metadata.labels).map(([key, value]) => <span className="label-pill" key={key}>{key}: {value}</span>) : '—'}</dd></dl><h3>Rule-based checks</h3><ul className="issue-list">{warnings.filter((warning) => warning.startsWith(`${selectedNode.label}:`)).map((warning) => <li key={warning}>{warning}</li>)}{warnings.filter((warning) => warning.startsWith(`${selectedNode.label}:`)).length === 0 && <li className="ok">No detected issues for this resource.</li>}</ul></>}{activeTab === 'yaml' && <pre className="resource-json">{JSON.stringify(selectedNode.resource, null, 2)}</pre>}{activeTab === 'relationships' && <ul className="relationship-list">{graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).map((edge) => <li key={edge.id}>{edge.source === selectedNode.id ? `→ ${edge.target}` : `← ${edge.source}`}<small>{edge.label ?? edge.type}</small></li>)}{graph.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length === 0 && <li>No relationships detected.</li>}</ul>}</div> : <div className="inspector-empty">Select a node in the graph to inspect its metadata, YAML, labels, relationships, and warnings.</div>}
          <div className="problems-panel"><h3>Analysis</h3><p>{parseResult.errors.length} parser errors · {warnings.length} warnings</p>{warnings.slice(0, 5).map((warning) => <div key={warning}>{warning}</div>)}</div>
        </aside>}
      </section>
    </main>
  )
}

function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9_]/g, '_') }

export default App
