import { FlowEdge } from '../flowLoader';

export function resolveGetDigitsEdge(edges: FlowEdge[], result: string): FlowEdge | null {
  const exact = edges.find((edge) => edge.condition === result);
  if (exact) {
    return exact;
  }

  if (result === 'timeout') {
    return edges.find((edge) => edge.condition === 'timeout')
      || edges.find((edge) => edge.condition === 'default' || edge.condition === null)
      || null;
  }

  return edges.find((edge) => edge.condition === 'invalid')
    || edges.find((edge) => edge.condition === 'default' || edge.condition === null)
    || null;
}

export function resolveNextEdge(currentNodeKey: string, nodeType: string, result: string, edges: FlowEdge[]): FlowEdge | null {
  const outgoing = edges.filter((edge) => edge.sourceNodeKey === currentNodeKey);
  if (outgoing.length === 0) {
    return null;
  }

  if (nodeType === 'get_digits') {
    return resolveGetDigitsEdge(outgoing, result);
  }

  const conditionalEdges = outgoing.filter((edge) => edge.condition !== null && edge.condition !== undefined);
  if (conditionalEdges.length > 0) {
    return (
      conditionalEdges.find((edge) => edge.condition === result)
      || conditionalEdges.find((edge) => edge.condition === 'default')
      || outgoing.find((edge) => edge.condition === null)
      || null
    );
  }

  return (
    outgoing.find((edge) => edge.branchKey === result)
    || outgoing.find((edge) => edge.branchKey === 'default')
    || outgoing.find((edge) => edge.condition === null)
    || null
  );
}
