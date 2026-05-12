import React from 'react';
import styles from './FlowVersionDiffSummary.module.css';
import { BuilderNodeType } from '../../types';

export interface ConfigChange {
  field: string;
  prev: any;
  curr: any;
}

export interface NodeDiff {
  id: string;
  label: string;
  type: BuilderNodeType;
  configDiff?: ConfigChange[];
}

export interface EdgeDiff {
  key: string;
  source: string;
  target: string;
  branch: string;
}

export interface FlowVersionDiffSummaryProps {
  addedNodes: NodeDiff[];
  removedNodes: NodeDiff[];
  changedNodes: NodeDiff[];
  addedEdges: EdgeDiff[];
  removedEdges: EdgeDiff[];
}

export function FlowVersionDiffSummary({
  addedNodes,
  removedNodes,
  changedNodes,
  addedEdges,
  removedEdges,
}: FlowVersionDiffSummaryProps) {
  const hasChanges =
    addedNodes.length > 0 ||
    removedNodes.length > 0 ||
    changedNodes.length > 0 ||
    addedEdges.length > 0 ||
    removedEdges.length > 0;

  if (!hasChanges) {
    return <div className={styles.noChanges}>No differences detected between these versions.</div>;
  }

  const renderConfigValue = (val: any) => {
    if (val === null || val === undefined) return <em className={styles.emptyVal}>null</em>;
    if (typeof val === 'object') {
      return <pre className={styles.jsonValue}>{JSON.stringify(val, null, 2)}</pre>;
    }
    return String(val);
  };

  return (
    <div className={styles.container}>
      {addedNodes.length > 0 && (
        <section className={styles.section}>
          <h4 className={`${styles.title} ${styles.addedTitle}`}>Nodes Added ({addedNodes.length})</h4>
          <ul className={styles.list}>
            {addedNodes.map((node) => (
              <li key={node.id} className={styles.item}>
                <span className={styles.nodeType}>{node.type}</span>
                <span className={styles.nodeLabel}>{node.label || node.id}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {removedNodes.length > 0 && (
        <section className={styles.section}>
          <h4 className={`${styles.title} ${styles.removedTitle}`}>Nodes Removed ({removedNodes.length})</h4>
          <ul className={styles.list}>
            {removedNodes.map((node) => (
              <li key={node.id} className={styles.item}>
                <span className={styles.nodeType}>{node.type}</span>
                <span className={styles.nodeLabel}>{node.label || node.id}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {changedNodes.length > 0 && (
        <section className={styles.section}>
          <h4 className={`${styles.title} ${styles.changedTitle}`}>Nodes Changed ({changedNodes.length})</h4>
          <ul className={styles.list}>
            {changedNodes.map((node) => (
              <li key={node.id} className={styles.itemComplex}>
                <div className={styles.itemHeader}>
                  <span className={styles.nodeType}>{node.type}</span>
                  <span className={styles.nodeLabel}>{node.label || node.id}</span>
                </div>
                {node.configDiff && node.configDiff.length > 0 && (
                  <table className={styles.configTable}>
                    <thead>
                      <tr>
                        <th>Property</th>
                        <th>From</th>
                        <th>To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {node.configDiff.map((change) => (
                        <tr key={change.field}>
                          <td className={styles.fieldCell}>{change.field}</td>
                          <td className={styles.oldValCell}>{renderConfigValue(change.prev)}</td>
                          <td className={styles.newValCell}>{renderConfigValue(change.curr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(addedEdges.length > 0 || removedEdges.length > 0) && (
        <section className={styles.section}>
          <h4 className={`${styles.title} ${styles.changedTitle}`}>Edge Changes ({addedEdges.length + removedEdges.length})</h4>
          <ul className={styles.list}>
            {addedEdges.map((edge) => (
              <li key={`added-${edge.key}`} className={styles.item}>
                <span className={styles.addedBadge}>added</span>
                <span className={styles.edgeDesc}>
                  {edge.source} ➔ {edge.target} {edge.branch !== 'default' ? `(${edge.branch})` : ''}
                </span>
              </li>
            ))}
            {removedEdges.map((edge) => (
              <li key={`removed-${edge.key}`} className={styles.item}>
                <span className={styles.removedBadge}>removed</span>
                <span className={styles.edgeDesc}>
                  {edge.source} ➔ {edge.target} {edge.branch !== 'default' ? `(${edge.branch})` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
