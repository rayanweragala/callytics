import { CallSession } from './callSession';
import { executeNode } from './nodes';
import { resolveNextEdge } from './engine/edgeResolver';

export async function runFlow(
  channel: { id: string },
  session: CallSession,
  ariClient: unknown
): Promise<void> {
  const currentNode = session.flow.nodes.find((node) => node.type === 'start') || session.flow.nodes[0];

  if (!currentNode) {
    console.error('No entry node found in flow');
    return;
  }

  session.currentNodeKey = currentNode.nodeKey;

  while (true) {
    const node = session.flow.nodes.find((item) => item.nodeKey === session.currentNodeKey);

    if (!node) {
      console.warn(`Node not found: ${session.currentNodeKey}`);
      break;
    }

    console.log(`Executing node: ${node.type} (${node.nodeKey})`);

    const result = await executeNode(channel as never, node, session, ariClient);

    console.log(`Node result: ${result}`);

    if (result === 'done' || result === 'hangup') {
      break;
    }

    if (result.startsWith('route:')) {
      session.currentNodeKey = result.slice('route:'.length);
      continue;
    }

    const edge = resolveNextEdge(session.currentNodeKey, node.type, result, session.flow.edges);

    if (!edge) {
      console.error(`No edge found from ${session.currentNodeKey} with result ${result}`);
      break;
    }

    session.currentNodeKey = edge.targetNodeKey;
  }

  console.log(`Call ended: ${session.channelId}`);
}
