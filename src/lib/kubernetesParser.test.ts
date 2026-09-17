
import { describe, expect, it } from 'vitest'
import { parseKubernetesYaml } from './kubernetesParser'

describe('parseKubernetesYaml', () => {
  it('parses multiple Kubernetes resources', () => {
    const input = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
spec:
  replicas: 2
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
spec:
  selector:
    app: web
`

    const result = parseKubernetesYaml(input)

    expect(result.errors).toHaveLength(0)
    expect(result.resources).toHaveLength(2)
    expect(result.resources[0].kind).toBe('Deployment')
    expect(result.resources[1].kind).toBe('Service')
  })

  it('uses default namespace when none is provided', () => {
    const input = `
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  APP_MODE: production
`

    const result = parseKubernetesYaml(input)

    expect(result.errors).toHaveLength(0)
    expect(result.resources[0].metadata.namespace).toBe('default')
  })

  it('reports malformed YAML', () => {
    const input = `
apiVersion: v1
kind: Service
metadata:
  name: [invalid
`

    const result = parseKubernetesYaml(input)

    expect(result.resources).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('accepts additional Kubernetes resource kinds as generic nodes', () => {
    const input = `
apiVersion: v1
kind: Namespace
metadata:
  name: production
`

    const result = parseKubernetesYaml(input)

    expect(result.resources).toHaveLength(1)
    expect(result.errors).toHaveLength(0)
    expect(result.resources[0].kind).toBe('Namespace')
    expect(result.warnings[0]).toContain('Generic resource support')
  })

  it('returns an empty result for empty input', () => {
    const result = parseKubernetesYaml('')

    expect(result.resources).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })
})