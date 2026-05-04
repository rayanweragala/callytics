import { useEffect, useRef } from 'react';
import { NodeProps, NodeResizer } from 'reactflow';
import type { FlowNodeData } from '../../types';
import styles from './FlowGroupNode.module.css';

export function FlowGroupNode({ data, selected }: NodeProps<FlowNodeData & { diffColor?: string }>) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (data.isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [data.isEditing]);

  const diffStyle = data.diffColor ? { borderColor: `var(${data.diffColor})`, boxShadow: `0 0 0 2px color-mix(in srgb, var(${data.diffColor}) 20%, transparent)` } : undefined;

  return (
    <div className={`${styles.group} ${selected ? styles.selected : ''}`} style={diffStyle}>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={150}
        lineClassName={styles.resizerLine}
        handleClassName={styles.resizerHandle}
      />
      <div className={styles.labelShell}>
        {data.isEditing ? (
          <input
            ref={inputRef}
            className={styles.labelInput}
            value={data.label}
            onBlur={() => data.onLabelSubmit?.()}
            onChange={(event) => data.onLabelChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                data.onLabelSubmit?.();
              }
            }}
            placeholder="group label"
            type="text"
          />
        ) : (
          <div className={styles.label} onDoubleClick={() => data.onLabelDoubleClick?.()}>{data.label || 'group'}</div>
        )}
      </div>
    </div>
  );
}
