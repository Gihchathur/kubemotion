import type { KubernetesResource } from '../types/kubernetes'
import type { GraphEdge, GraphNode, KubernetesGraph } from '../types/graph'

const WORKLOAD_KINDS = new Set([
  'Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod',
])

const NODE_TYPES: Record<string, string> = {
  Deployment: 'deployment',
  StatefulSet: 'statefulset',
  DaemonSet: 'daemonset',
  ReplicaSet: 'replicaset',
  Job: 'job',
  CronJob: 'cronjob',
  Pod: 'pod',
  Service: 'service',
  Ingress: 'ingress',
  Gateway: 'gateway',
  HTTPRoute: 'httproute',
  ConfigMap: 'configmap',
  Secret: 'secret',
  PersistentVolumeClaim: 'pvc',
  ServiceAccount: 'serviceaccount',
}

const isRecord = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const namespaceOf = (resource: KubernetesResource) => resource.metadata.namespace || 'default'
const idOf = (namespace: string, kind: string, name: unknown) =>
  typeof name === 'string' && name.length > 0 ? `${namespace}/${kind}/${name}` : undefined

function selectorOf(resource: KubernetesResource): Record<string, string> {
  const selector = resource.spec.selector
  return isRecord(selector) ? selector as Record<string, string> : {}
}

function labelsMatch(resource: KubernetesResource, selector: Record<string, string>): boolean {
  return Object.entries(selector).every(([key, value]) => resource.metadata.labels[key] === value)
}

function podSpecOf(resource: KubernetesResource): Record<string, any> {
  if (resource.kind === 'Pod') return isRecord(resource.spec) ? resource.spec : {}
  const template = resource.spec.template
  return isRecord(template) && isRecord(template.spec) ? template.spec : {}
}

function createNodes(resources: KubernetesResource[], edges: GraphEdge[]): GraphNode[] {
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]))
  const workloads = resources
    .filter((resource) => WORKLOAD_KINDS.has(resource.kind))
    .sort((a, b) => `${namespaceOf(a)}/${a.metadata.name}`.localeCompare(`${namespaceOf(b)}/${b.metadata.name}`))
  const positions = new Map<string, { x: number; y: number }>()
  const workloadColumn = new Map<string, number>()
  const childIdsByWorkload = new Map<string, string[]>()
  const serviceTargets = new Map<string, string[]>()
  const incoming = new Map<string, number>()

  // First collect graph topology. Explicit ownerReferences are preferred because
  // they are the same ownership signal Kubernetes controllers expose to Argo CD.
  for (const edge of edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    const source = resourceById.get(edge.source)
    const target = resourceById.get(edge.target)
    if (!source || !target) continue
    if (edge.type === 'service-to-workload' && WORKLOAD_KINDS.has(target.kind)) {
      const targets = serviceTargets.get(source.id) ?? []
      targets.push(target.id)
      serviceTargets.set(source.id, targets)
    }
    if (WORKLOAD_KINDS.has(source.kind) && !['Service', 'Ingress', 'Gateway', 'HTTPRoute'].includes(target.kind)) {
      const children = childIdsByWorkload.get(source.id) ?? []
      if (!children.includes(target.id)) children.push(target.id)
      childIdsByWorkload.set(source.id, children)
    }
  }

  // Stable workload columns. Column width is intentionally generous so that
  // dependency cards never overlap adjacent workloads.
  const columnWidth = 330
  const left = 100
  const xFor = (column: number) => left + column * columnWidth
  // Keep the routing tier clearly separated from services. The previous
  // coordinates placed Ingress cards in the same vertical band as Services,
  // which made the route edges appear to pass through the cards.
  const routeY = 34
  const serviceY = 190
  const workloadY = 380
  const dependencyY = 585

  workloads.forEach((workload, index) => {
    workloadColumn.set(workload.id, index)
    positions.set(workload.id, { x: xFor(index), y: workloadY })
  })

  const services = resources.filter((resource) => resource.kind === 'Service')
  const routes = resources.filter((resource) => ['Ingress', 'Gateway', 'HTTPRoute'].includes(resource.kind))

  // Services belong above their selected workloads. If a service has multiple
  // targets, center it over the target group rather than routing across the page.
  const serviceRows = new Map<number, number>()
  for (const service of services) {
    const columns = (serviceTargets.get(service.id) ?? [])
      .map((id) => workloadColumn.get(id))
      .filter((value): value is number => value !== undefined)
    const column = columns.length
      ? columns.reduce((sum, value) => sum + value, 0) / columns.length
      : workloads.length ? workloads.length - 1 : 0
    const roundedColumn = Math.round(column)
    const row = serviceRows.get(roundedColumn) ?? 0
    serviceRows.set(roundedColumn, row + 1)
    positions.set(service.id, { x: xFor(column), y: serviceY - row * 86 })
  }

  // Put routes at the top, centered over the services they reference.
  routes.forEach((route, index) => {
    const targetColumns = edges
      .filter((edge) => edge.source === route.id && edge.type === 'route-to-service')
      .map((edge) => positions.get(edge.target)?.x)
      .filter((value): value is number => value !== undefined)
    const x = targetColumns.length
      ? targetColumns.reduce((sum, value) => sum + value, 0) / targetColumns.length
      : xFor(Math.max(0, (workloads.length - 1) / 2))
    positions.set(route.id, { x, y: routeY + index * 104 })
  })

  // Dependencies are laid out as a compact, readable tree under each workload.
  // A vertical stack is used first; only wider dependency groups fan out.
  for (const workload of workloads) {
    const children = (childIdsByWorkload.get(workload.id) ?? [])
      .sort((a, b) => `${resourceById.get(a)?.kind}/${resourceById.get(a)?.metadata.name}`
        .localeCompare(`${resourceById.get(b)?.kind}/${resourceById.get(b)?.metadata.name}`))
    const parent = positions.get(workload.id) ?? { x: left, y: workloadY }
    const fanout = children.length > 2
    children.forEach((childId, index) => {
      const row = fanout ? Math.floor(index / 2) : index
      const side = fanout ? (index % 2 === 0 ? -1 : 1) : 0
      positions.set(childId, {
        x: parent.x + side * 118,
        y: dependencyY + row * 116,
      })
    })
  }

  // Generic resources (Namespace, RBAC, policy, autoscaling, monitoring, etc.)
  // remain visible, but are placed in a deterministic overflow grid instead of
  // being dropped or piled on top of other cards.
  const unplaced = resources.filter((resource) => !positions.has(resource.id))
  const overflowStartX = xFor(workloads.length + 0.5)
  unplaced.forEach((resource, index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    positions.set(resource.id, {
      x: overflowStartX + column * 260,
      y: 70 + row * 116,
    })
  })

  return resources.map((resource) => ({
    id: resource.id,
    type: NODE_TYPES[resource.kind] ?? resource.kind.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: resource.metadata.name,
    resource,
    position: positions.get(resource.id) ?? { x: left, y: workloadY },
  }))
}

function createEdge(
  source: KubernetesResource,
  target: KubernetesResource,
  relation: string,
  label: string,
): GraphEdge {
  return {
    id: `${source.id}->${target.id}:${relation}`,
    source: source.id,
    target: target.id,
    type: relation,
    label,
  }
}

function buildEdges(resources: KubernetesResource[]): GraphEdge[] {
  const edges: GraphEdge[] = []
  const seen = new Set<string>()
  const byId = new Map(resources.map((resource) => [resource.id, resource]))
  const workloads = resources.filter((resource) => WORKLOAD_KINDS.has(resource.kind))
  const add = (source: KubernetesResource | undefined, target: KubernetesResource | undefined, relation: string, label: string) => {
    if (!source || !target || source.id === target.id) return
    const edge = createEdge(source, target, relation, label)
    if (seen.has(edge.id)) return
    seen.add(edge.id)
    edges.push(edge)
  }
  const find = (namespace: string, kind: string, name: unknown) => byId.get(idOf(namespace, kind, name) ?? '')

  // Service selectors point to every matching workload, not merely the first one.
  for (const service of resources.filter((resource) => resource.kind === 'Service')) {
    const selector = selectorOf(service)
    for (const workload of workloads) {
      if (namespaceOf(service) === namespaceOf(workload) && Object.keys(selector).length && labelsMatch(workload, selector)) {
        add(service, workload, 'service-to-workload', 'selects')
      }
    }
  }

  // Ingress/Gateway-style HTTP routing points to the referenced Service.
  for (const route of resources.filter((resource) => ['Ingress', 'HTTPRoute'].includes(resource.kind))) {
    const spec = route.spec as Record<string, any>
    const names: string[] = []
    for (const rule of Array.isArray(spec.rules) ? spec.rules : []) {
      for (const path of Array.isArray(rule?.http?.paths) ? rule.http.paths : []) {
        const name = path?.backend?.service?.name ?? path?.backendRefs?.[0]?.name
        if (typeof name === 'string') names.push(name)
      }
    }
    for (const name of names) add(route, find(namespaceOf(route), 'Service', name), 'route-to-service', 'routes to')
  }

  // Workload-owned configuration, secrets, storage and identity.
  for (const workload of workloads) {
    const namespace = namespaceOf(workload)
    const podSpec = podSpecOf(workload)
    add(workload, find(namespace, 'ServiceAccount', podSpec.serviceAccountName), 'workload-to-serviceaccount', 'uses')

    for (const volume of Array.isArray(podSpec.volumes) ? podSpec.volumes : []) {
      if (!isRecord(volume)) continue
      add(workload, find(namespace, 'ConfigMap', volume.configMap?.name), 'workload-to-configmap', 'mounts')
      add(workload, find(namespace, 'Secret', volume.secret?.secretName), 'workload-to-secret', 'mounts')
      add(workload, find(namespace, 'PersistentVolumeClaim', volume.persistentVolumeClaim?.claimName), 'workload-to-pvc', 'mounts')
    }

    for (const container of Array.isArray(podSpec.containers) ? podSpec.containers : []) {
      if (!isRecord(container)) continue
      for (const env of Array.isArray(container.env) ? container.env : []) {
        if (!isRecord(env) || !isRecord(env.valueFrom)) continue
        add(workload, find(namespace, 'Secret', env.valueFrom.secretKeyRef?.name), 'workload-to-secret', 'env')
        add(workload, find(namespace, 'ConfigMap', env.valueFrom.configMapKeyRef?.name), 'workload-to-configmap', 'env')
      }
      for (const envFrom of Array.isArray(container.envFrom) ? container.envFrom : []) {
        if (!isRecord(envFrom)) continue
        add(workload, find(namespace, 'Secret', envFrom.secretRef?.name), 'workload-to-secret', 'envFrom')
        add(workload, find(namespace, 'ConfigMap', envFrom.configMapRef?.name), 'workload-to-configmap', 'envFrom')
      }
    }
  }

  // Common controller relationships.
  for (const resource of resources) {
    const spec = resource.spec as Record<string, any>
    if (resource.kind === 'HorizontalPodAutoscaler' && isRecord(spec.scaleTargetRef)) {
      add(resource, find(namespaceOf(resource), String(spec.scaleTargetRef.kind ?? 'Deployment'), spec.scaleTargetRef.name), 'hpa-to-workload', 'scales')
    }
    if (['RoleBinding', 'ClusterRoleBinding'].includes(resource.kind)) {
      for (const subject of Array.isArray(spec.subjects) ? spec.subjects : []) {
        if (isRecord(subject) && subject.kind === 'ServiceAccount') {
          add(resource, find(subject.namespace ?? namespaceOf(resource), 'ServiceAccount', subject.name), 'binding-to-serviceaccount', 'binds')
        }
      }
    }
  }

  return edges
}

export function buildKubernetesGraph(resources: KubernetesResource[]): KubernetesGraph {
  const edges = buildEdges(resources)
  return { nodes: createNodes(resources, edges), edges }
}
