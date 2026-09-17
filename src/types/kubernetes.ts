
/**
 * Kubernetes resource kinds supported by KubeMotion.
 */
export type KubernetesResourceKind = string

/**
 * Metadata shared by Kubernetes resources.
 */
export interface KubernetesMetadata {
  name: string
  namespace: string
  labels: Record<string, string>
}

/**
 * A normalized Kubernetes resource.
 *
 * This is the internal representation used by the parser
 * and, later, the architecture graph engine.
 */
export interface KubernetesResource {
  id: string
  kind: KubernetesResourceKind
  apiVersion: string
  metadata: KubernetesMetadata
  spec: Record<string, unknown>
  data?: Record<string, unknown>
}

/**
 * Result returned by the YAML parser.
 */
export interface ParseResult {
  resources: KubernetesResource[]
  errors: ParseError[]
  warnings: string[]
}

/**
 * A readable parsing or validation error.
 */
export interface ParseError {
  message: string
  documentIndex?: number
  resourceName?: string
  line?: number
}