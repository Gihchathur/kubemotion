import { describe, expect, it } from 'vitest'
import { parseKubernetesYaml } from './kubernetesParser'
import { buildKubernetesGraph } from './graphBuilder'

describe('buildKubernetesGraph', () => {
  it('creates nodes for supported Kubernetes resources', () => {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: default
spec:
  selector:
    app: web
`

    const parseResult = parseKubernetesYaml(yaml)
    const graph = buildKubernetesGraph(parseResult.resources)

    expect(graph.nodes).toHaveLength(2)
    expect(graph.nodes.map((node) => node.type)).toEqual([
      'deployment',
      'service',
    ])
  })

  it('connects a Service to a matching Deployment', () => {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: default
spec:
  selector:
    app: web
`

    const parseResult = parseKubernetesYaml(yaml)
    const graph = buildKubernetesGraph(parseResult.resources)

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0]).toMatchObject({
      source: 'default/Service/web-service',
      target: 'default/Deployment/web',
      type: 'service-to-deployment',
    })
  })

  it('does not connect resources across namespaces', () => {
    const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: production
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: default
spec:
  selector:
    app: web
`

    const parseResult = parseKubernetesYaml(yaml)
    const graph = buildKubernetesGraph(parseResult.resources)

    expect(graph.edges).toHaveLength(0)
  })

  it('places services above deployments', () => {
  const yaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: default
  labels:
    app: web
spec:
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
        - name: web
          image: nginx:latest
---
apiVersion: v1
kind: Service
metadata:
  name: web-service
  namespace: default
spec:
  selector:
    app: web
`

  const parseResult = parseKubernetesYaml(yaml)
  const graph = buildKubernetesGraph(parseResult.resources)

  const deployment = graph.nodes.find(
    (node) => node.resource.kind === 'Deployment',
  )

  const service = graph.nodes.find(
    (node) => node.resource.kind === 'Service',
  )

  expect(service).toBeDefined()
  expect(deployment).toBeDefined()
  expect(service!.position.y).toBeLessThan(deployment!.position.y)
})
})

