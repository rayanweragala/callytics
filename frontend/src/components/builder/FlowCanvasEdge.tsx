import { BaseEdge, EdgeLabelRenderer, EdgeProps, getBezierPath } from 'reactflow';
import styles from './FlowCanvasEdge.module.css';

interface EdgeData {
  branchKey?: string;
  onDelete?: (edgeId: string) => void;
}

export function FlowCanvasEdge(props: EdgeProps<EdgeData>) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    selected,
    markerEnd,
    data,
  } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? 'var(--color-active)' : 'var(--border-strong)',
          strokeWidth: selected ? 2.5 : 1.5,
        }}
      />
      {selected && data?.onDelete ? (
        <EdgeLabelRenderer>
          <button
            className={styles.deleteButton}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              data.onDelete?.(id);
            }}
            type="button"
          >
            ×
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}
