import { EdgeLabelRenderer, EdgeProps, getBezierPath } from 'reactflow';
import styles from './FlowCanvasEdge.module.css';

interface EdgeData {
  branchKey?: string;
  condition?: string | null;
  sourceNodeType?: string;
  parallelIndex?: number;
  parallelTotal?: number;
  isSubflowJump?: boolean;
  subflowJumpLabel?: string;
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

  const parallelOffset = ((data?.parallelIndex || 0) - (((data?.parallelTotal || 1) - 1) / 2)) * 18;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY: sourceY + parallelOffset,
    sourcePosition,
    targetX,
    targetY: targetY + parallelOffset,
    targetPosition,
  });

  const isSubflowJump = Boolean(data?.isSubflowJump);
  const showLabel = isSubflowJump
    || (data?.sourceNodeType === 'get_digits' && Boolean(data?.condition))
    || data?.sourceNodeType === 'hunt';
  const labelText = isSubflowJump
    ? String(data?.subflowJumpLabel || data?.branchKey || 'subflow jump')
    : data?.sourceNodeType === 'hunt'
      ? String(data?.branchKey || 'no answer')
      : String(data?.condition || '');

  return (
    <>
      <path
        className={`react-flow__edge-path ${styles.edgePath} ${isSubflowJump ? styles.edgeSubflowJump : ''} ${selected ? styles.edgeSelected : ''}`.trim()}
        d={edgePath}
        fill="none"
        markerEnd={markerEnd}
      />
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className={`${styles.label} ${isSubflowJump ? styles.subflowJumpLabel : ''}`}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - (selected ? 14 : 0)}px)` }}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      ) : null}
      {selected && data?.onDelete && !isSubflowJump ? (
        <EdgeLabelRenderer>
          <button
            className={styles.deleteButton}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (showLabel ? 14 : 0)}px)` }}
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
