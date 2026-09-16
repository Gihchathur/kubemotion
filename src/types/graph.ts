import type { KubernetesResource } from './kubernetes'

export type GraphNodeType =
  | 'deployment'
  | 'service'
  | 'ingress'
  | 'pod'
  | 'configmap'
  | 'secret'
  | 'pvc'
  | 'serviceaccount'

export type GraphEdgeType =
  | 'service-to-deployment'
  | 'ingress-to-service'
  | 'deployment-to-configmap'
  | 'deployment-to-secret'
  | 'deployment-to-pvc'

export interface GraphNode {
  id: string
  type: GraphNodeType
  label: string
  resource: KubernetesResource
  position: {
    x: number
    y: number
  }
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: GraphEdgeType
  label?: string
}

export interface KubernetesGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}