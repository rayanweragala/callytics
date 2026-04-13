import { CallSession, removeSession } from './callSession';
import { executeNode } from './nodes';

export async function runFlow(
  channel: any,
  session: CallSession,
  ariClient: any
): Promise<void> {

  // Find entry node — type 'start' or first node
  let currentNode = session.flow.nodes.find(n => n.type === 'start')
    || session.flow.nodes[0];

  if (!currentNode) {
    console.error('No entry node found in flow');
    removeSession(session.channelId);
    return;
  }

  session.currentNodeKey = currentNode.nodeKey;

  while (true) {
    const node = session.flow.nodes.find(
      n => n.nodeKey === session.currentNodeKey
    );

    if (!node) {
      console.warn(`Node not found: ${session.currentNodeKey}`);
      break;
    }

    console.log(`Executing node: ${node.type} (${node.nodeKey})`);

    const result = await executeNode(channel, node, session, ariClient);

    console.log(`Node result: ${result}`);

    if (result === 'done' || result === 'hangup') {
      break;
    }

    // Find next edge matching result, fall back to default
    let edge = session.flow.edges.find(
      e => e.sourceNodeKey === session.currentNodeKey 
        && e.branchKey === result
    );

    if (!edge) {
      edge = session.flow.edges.find(
        e => e.sourceNodeKey === session.currentNodeKey 
          && e.branchKey === 'default'
      );
    }

    if (!edge) {
      console.warn(
        `No edge found from ${session.currentNodeKey} with result ${result}`
      );
      break;
    }

    session.currentNodeKey = edge.targetNodeKey;
  }

  console.log(`Call ended: ${session.channelId}`);
  removeSession(session.channelId);
}
