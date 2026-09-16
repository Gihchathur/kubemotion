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
  ]

  const layerSpacing = 220
  const nodeSpacing = 280

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
        x: 80 + positionInLayer * nodeSpacing,
        y: 80 + Math.max(layerIndex, 0) * layerSpacing,
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

  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
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
      if (
        getResourceNamespace(service) === getResourceNamespace(workload) &&
        labelsMatch(workload, selector)
      ) {
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
          .filter((name): name is string => Boolean(name)),
      ) ?? []

    for (const service of services) {
      if (
        getResourceNamespace(ingress) === getResourceNamespace(service) &&
        serviceNames.includes(getResourceName(service))
      ) {
        edges.push(
          createEdge(ingress, service, 'ingress-to-service', 'routes to'),
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

  const deployments = resources.filter(
    (resource) => resource.kind === 'Deployment',
  )

  for (const deployment of deployments) {
    const template = deployment.spec.template as {
        spec?: {
            volumes?: {
            configMap?: {
                name?: string
            }
            secret?: {
                secretName?: string
            }
            persistentVolumeClaim?: {
                claimName?: string
            }
            }[]
        }
        } | undefined

    
    const volumes = template?.spec?.volumes ?? []

    for (const volume of volumes) {
      const configMapName = volume.configMap?.name
      const secretName = volume.secret?.secretName
      const pvcName = volume.persistentVolumeClaim?.claimName

      for (const resource of resources) {
        if (
          getResourceNamespace(resource) !==
          getResourceNamespace(deployment)
        ) {
          continue
        }

        if (
          resource.kind === 'ConfigMap' &&
          resource.metadata.name === configMapName
        ) {
          edges.push(
            createEdge(
              deployment,
              resource,
              'deployment-to-configmap',
              'mounts',
            ),
          )
        }

        if (
          resource.kind === 'Secret' &&
          resource.metadata.name === secretName
        ) {
          edges.push(
            createEdge(
              deployment,
              resource,
              'deployment-to-secret',
              'mounts',
            ),
          )
        }

        if (
          resource.kind === 'PersistentVolumeClaim' &&
          resource.metadata.name === pvcName
        ) {
          edges.push(
            createEdge(
              deployment,
              resource,
              'deployment-to-pvc',
              'mounts',
            ),
          )
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