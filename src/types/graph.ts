import type { KubernetesResource } from './kubernetes'

export type GraphNodeType = string

export type GraphEdgeType = string

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