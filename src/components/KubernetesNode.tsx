import {
  Handle,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react'

type KubernetesNodeData = {
  label: string
  kind: string
  tooltip?: string
}

type KubernetesNodeType = Node<KubernetesNodeData>

const KIND_COLORS: Record<string, string> = {
  deployment: '#38bdf8',
  service: '#a78bfa',
  ingress: '#f59e0b',
  pod: '#22c55e',
  configmap: '#14b8a6',
  secret: '#f43f5e',
  pvc: '#e879f9',
  serviceaccount: '#facc15',
}

function KubernetesNode({ data }: NodeProps<KubernetesNodeType>) {
  const color = KIND_COLORS[data.kind] ?? '#94a3b8'

  return (
    <div
      title={data.tooltip}
      style={{
        width: 190,
        maxWidth: 190,
        overflow: 'hidden',
        border: `1px solid ${color}`,
        borderRadius: 14,
        background: '#172033',
        color: '#f8fafc',
        boxShadow: `0 0 24px ${color}18`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: color,
          border: '2px solid #0b1220',
        }}
      />

      <div
        style={{
          padding: '8px 14px',
          background: `${color}18`,
          borderBottom: `1px solid ${color}45`,
          color,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.12em',
        }}
      >
        {data.kind.toUpperCase()}
      </div>

      <div
        style={{
          padding: '13px 12px',
          fontSize: 14,
          fontWeight: 600,
          textAlign: 'center',
        }}
      >
        {data.label}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: color,
          border: '2px solid #0b1220',
        }}
      />
    </div>
  )
}

export default KubernetesNode