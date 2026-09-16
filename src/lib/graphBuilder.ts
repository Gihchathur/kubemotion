import type {
  KubernetesResource,
  KubernetesResourceKind,
} from '../types/kubernetes'

import type {
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphNodeType,
  KubernetesGraph,
} from '../types/graph'

const KIND_TO_NODE_TYPE: Record<string, GraphNodeType> = {
  Deployment: 'deployment',
  Service: 'service',
  Ingress: 'ingress',
  Pod: 'pod',
  ConfigMap: 'configmap',
  Secret: 'secret',
  PersistentVolumeClaim: 'pvc',
  ServiceAccount: 'serviceaccount',
}

function getNodeId(resource: KubernetesResource): string {
  return resource.id
}

function getNodeType(resource: KubernetesResource): GraphNodeType {
  return KIND_TO_NODE_TYPE[resource.kind]
}

function getResourceName(resource: KubernetesResource): string {
  return resource.metadata.name
}

function getResourceNamespace(resource: KubernetesResource): string {
  return resource.metadata.namespace
}

function createNodes(resources: KubernetesResource[]): GraphNode[] {
  const layerOrder: KubernetesResourceKind[] = [
    'Ingress',
    'Service',
    'Deployment',
    'Pod',
    'ConfigMap',
    'Secret',
    'PersistentVolumeClaim',
    'ServiceAccount',
  ]

  const layerSpacing = 240
  const nodeSpacing = 320

  return resources.map((resource) => {
    const layerIndex = layerOrder.indexOf(resource.kind)

    const sameLayerResources = resources.filter(
      (item) => item.kind === resource.kind,
    )

    const positionInLayer = sameLayerResources.findIndex(
      (item) => item.id === resource.id,
    )

    return {
      id: getNodeId(resource),
      type: getNodeType(resource),
      label: getResourceName(resource),
      resource,
      position: {
        x: 120 + positionInLayer * nodeSpacing,
        y: 100 + Math.max(layerIndex, 0) * layerSpacing,
      },
    }
  })
}

function createEdge(
  source: KubernetesResource,
  target: KubernetesResource,
  type: GraphEdgeType,
  label?: string,
): GraphEdge {
  return {
    id: `${source.id}->${target.id}:${type}`,
    source: source.id,
    target: target.id,
    type,
    label,
  }
}

function getSelector(
  resource: KubernetesResource,
): Record<string, string> {
  const selector = resource.spec.selector

  if (
    !selector ||
    typeof selector !== 'object' ||
    Array.isArray(selector)
  ) {
    return {}
  }

  return selector as Record<string, string>
}

function labelsMatch(
  resource: KubernetesResource,
  selector: Record<string, string>,
): boolean {
  const labels = resource.metadata.labels

  return Object.entries(selector).every(
    ([key, value]) => labels[key] === value,
  )
}

function createServiceEdges(
  resources: KubernetesResource[],
): GraphEdge[] {
  const edges: GraphEdge[] = []

  const services = resources.filter(
    (resource) => resource.kind === 'Service',
  )

  const workloads = resources.filter((resource) =>
    ['Deployment', 'Pod'].includes(resource.kind),
  )

  for (const service of services) {
    const selector = getSelector(service)

    if (Object.keys(selector).length === 0) {
      continue
    }

    for (const workload of workloads) {
      const sameNamespace =
        getResourceNamespace(service) ===
        getResourceNamespace(workload)

      if (sameNamespace && labelsMatch(workload, selector)) {
        edges.push(
          createEdge(
            service,
            workload,
            'service-to-deployment',
            'selects',
          ),
        )
      }
    }
  }

  return edges
}

function createIngressEdges(
  resources: KubernetesResource[],
): GraphEdge[] {
  const edges: GraphEdge[] = []

  const ingresses = resources.filter(
    (resource) => resource.kind === 'Ingress',
  )

  const services = resources.filter(
    (resource) => resource.kind === 'Service',
  )

  for (const ingress of ingresses) {
    const spec = ingress.spec as {
      rules?: Array<{
        http?: {
          paths?: Array<{
            backend?: {
              service?: {
                name?: string
              }
            }
          }>
        }
      }>
    }

    const serviceNames =
      spec.rules?.flatMap((rule) =>
        rule.http?.paths
          ?.map((path) => path.backend?.service?.name)
          .filter(
            (name): name is string => Boolean(name),
          ),
      ) ?? []

    for (const service of services) {
      const sameNamespace =
        getResourceNamespace(ingress) ===
        getResourceNamespace(service)

      const serviceIsReferenced = serviceNames.includes(
        getResourceName(service),
      )

      if (sameNamespace && serviceIsReferenced) {
        edges.push(
          createEdge(
            ingress,
            service,
            'ingress-to-service',
            'routes to',
          ),
        )
      }
    }
  }

  return edges
}

function createVolumeAndConfigEdges(
  resources: KubernetesResource[],
): GraphEdge[] {
  const edges: GraphEdge[] = []

  const resourcesById = new Map(
    resources.map((resource) => [resource.id, resource]),
  )

  const deployments = resources.filter(
    (resource) => resource.kind === 'Deployment',
  )

  for (const deployment of deployments) {
    const template = deployment.spec.template

    if (
      !template ||
      typeof template !== 'object' ||
      Array.isArray(template)
    ) {
      continue
    }

    const podSpec = (template as Record<string, unknown>).spec

    if (
      !podSpec ||
      typeof podSpec !== 'object' ||
      Array.isArray(podSpec)
    ) {
      continue
    }

    const volumes = (podSpec as Record<string, unknown>).volumes

    if (!Array.isArray(volumes)) {
      continue
    }

    for (const volume of volumes) {
      if (
        !volume ||
        typeof volume !== 'object' ||
        Array.isArray(volume)
      ) {
        continue
      }

      const volumeRecord = volume as Record<string, unknown>

      if (typeof volumeRecord.name !== 'string') {
        continue
      }

      const configMap = volumeRecord.configMap

      if (
        configMap &&
        typeof configMap === 'object' &&
        !Array.isArray(configMap)
      ) {
        const configMapName = (
          configMap as Record<string, unknown>
        ).name

        if (typeof configMapName === 'string') {
          const target = resourcesById.get(
            `${deployment.metadata.namespace}/ConfigMap/${configMapName}`,
          )

          if (target) {
            edges.push(
              createEdge(
                deployment,
                target,
                'deployment-to-configmap',
                'config',
              ),
            )
          }
        }
      }

      const secret = volumeRecord.secret

      if (
        secret &&
        typeof secret === 'object' &&
        !Array.isArray(secret)
      ) {
        const secretName = (
          secret as Record<string, unknown>
        ).secretName

        if (typeof secretName === 'string') {
          const target = resourcesById.get(
            `${deployment.metadata.namespace}/Secret/${secretName}`,
          )

          if (target) {
            edges.push(
              createEdge(
                deployment,
                target,
                'deployment-to-secret',
                'secret',
              ),
            )
          }
        }
      }

      const persistentVolumeClaim =
        volumeRecord.persistentVolumeClaim

      if (
        persistentVolumeClaim &&
        typeof persistentVolumeClaim === 'object' &&
        !Array.isArray(persistentVolumeClaim)
      ) {
        const claimName = (
          persistentVolumeClaim as Record<string, unknown>
        ).claimName

        if (typeof claimName === 'string') {
          const target = resourcesById.get(
            `${deployment.metadata.namespace}/PersistentVolumeClaim/${claimName}`,
          )

          if (target) {
            edges.push(
              createEdge(
                deployment,
                target,
                'deployment-to-pvc',
                'storage',
              ),
            )
          }
        }
      }
    }
  }

  return edges
}

export function buildKubernetesGraph(
  resources: KubernetesResource[],
): KubernetesGraph {
  const nodes = createNodes(resources)

  const edges = [
    ...createServiceEdges(resources),
    ...createIngressEdges(resources),
    ...createVolumeAndConfigEdges(resources),
  ]

  return {
    nodes,
    edges,
  }
}