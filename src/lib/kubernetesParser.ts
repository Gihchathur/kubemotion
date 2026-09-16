
import * as yaml from 'js-yaml'
import type {
  KubernetesResource,
  KubernetesResourceKind,
  ParseError,
  ParseResult,
} from '../types/kubernetes'

const SUPPORTED_KINDS: ReadonlySet<string> = new Set([
  'Deployment',
  'Service',
  'Ingress',
  'Pod',
  'ConfigMap',
  'Secret',
  'PersistentVolumeClaim',
  'ServiceAccount',
])

interface RawKubernetesDocument {
  apiVersion?: unknown
  kind?: unknown
  metadata?: unknown
  spec?: unknown
  data?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const result = value[key]
  return typeof result === 'string' ? result : undefined
}

function normalizeResource(
  document: RawKubernetesDocument,
  documentIndex: number,
): KubernetesResource | ParseError {
  if (typeof document.apiVersion !== 'string') {
    return {
      message: 'Missing or invalid apiVersion.',
      documentIndex,
    }
  }

  if (typeof document.kind !== 'string') {
    return {
      message: 'Missing or invalid kind.',
      documentIndex,
    }
  }

  if (!SUPPORTED_KINDS.has(document.kind)) {
    return {
      message: `Unsupported resource kind: ${document.kind}.`,
      documentIndex,
    }
  }

  if (!isObject(document.metadata)) {
    return {
      message: 'Missing or invalid metadata.',
      documentIndex,
    }
  }

  const name = getString(document.metadata, 'name')

  if (!name) {
    return {
      message: 'Resource metadata.name is required.',
      documentIndex,
    }
  }

  const namespace =
    getString(document.metadata, 'namespace') ?? 'default'

  const labels = isObject(document.metadata.labels)
    ? Object.fromEntries(
        Object.entries(document.metadata.labels).filter(
          ([, value]) => typeof value === 'string',
        ),
      ) as Record<string, string>
    : {}

  const resource: KubernetesResource = {
    id: `${namespace}/${document.kind}/${name}`,
    kind: document.kind as KubernetesResourceKind,
    apiVersion: document.apiVersion,
    metadata: {
      name,
      namespace,
      labels,
    },
    spec: isObject(document.spec) ? document.spec : {},
  }

  if (isObject(document.data)) {
    resource.data = document.data
  }

  return resource
}

export function parseKubernetesYaml(input: string): ParseResult {
  const resources: KubernetesResource[] = []
  const errors: ParseError[] = []
  const warnings: string[] = []

  if (!input.trim()) {
    return { resources, errors, warnings }
  }

  let documents: unknown[]

  try {
    documents = yaml.loadAll(input)
  } catch (error) {
    return {
      resources,
      errors: [
        {
          message:
            error instanceof Error
              ? `YAML syntax error: ${error.message}`
              : 'YAML syntax error.',
        },
      ],
      warnings,
    }
  }

  documents.forEach((document, index) => {
    if (document === undefined || document === null) {
      return
    }

    if (!isObject(document)) {
      errors.push({
        message: 'Each YAML document must contain an object.',
        documentIndex: index,
      })
      return
    }

    const result = normalizeResource(document, index)

    if ('message' in result) {
      errors.push(result)
      return
    }

    resources.push(result)
  })

  if (resources.length === 0 && errors.length === 0) {
    warnings.push('No Kubernetes resources found.')
  }

  return { resources, errors, warnings }
}