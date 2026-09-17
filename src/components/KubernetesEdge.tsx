import { useState } from 'react'
import { EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'

type EdgeData = { label?: string; tooltip?: string }

export default function KubernetesEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  data,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false)
  const edgeData = data as EdgeData | undefined
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.18,
  })

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <path
        d={path}
        fill="none"
        stroke="#64748b"
        strokeWidth={hovered ? 3 : 1.7}
        strokeLinecap="round"
        opacity={hovered ? 1 : 0.78}
      />
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="edge-hover-label"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
          >
            <strong>{edgeData?.label ?? 'relationship'}</strong>
            <span>{edgeData?.tooltip ?? 'Kubernetes relationship'}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
