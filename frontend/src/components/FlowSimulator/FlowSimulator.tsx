import { useEffect, useMemo, useRef, useState } from 'react';
import type { Edge, Node } from 'reactflow';
import type { FlowNodeData } from '../../types';
import { getFlow } from '../../lib/api';
import { mapFlowToNodes, mapFlowToEdges } from '../../pages/FlowEditorPage.helpers';
import styles from './FlowSimulator.module.css';

type BuilderEdgeData = {
  branchKey: string | null;
  condition: string | null;
  sourceNodeType: string;
};

interface StepRecord {
  nodeId: string;
  label: string;
  type: string;
}

interface SubmenuFrame {
  menuNodeId: string;
  menuLabel: string;
}

interface FlowFrame {
  flowId: number;
  nodes: Node<FlowNodeData>[];
  edges: Edge<BuilderEdgeData>[];
  label: string;
}

interface SimState {
  currentNodeId: string;
  visited: StepRecord[];
  done: boolean;
  doneReason?: string;
  isDeadEnd?: boolean;
  submenuStack: SubmenuFrame[];
  flowStack: FlowFrame[];
  notice?: string | null;
}

interface FlowSimulatorProps {
  nodes: Node<FlowNodeData>[];
  edges: Edge<BuilderEdgeData>[];
  onClose: () => void;
  onSubflowEnter?: (flowId: number) => void;
  onSubflowExit?: () => void;
}

const TERMINAL_NODE_TYPES = new Set(['hangup', 'transfer', 'voicemail', 'hunt', 'queue']);
const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  sunday: 'Sunday',
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
};

function getOutgoingEdges(nodeId: string, edges: Edge<BuilderEdgeData>[]): Edge<BuilderEdgeData>[] {
  return edges.filter((edge) => edge.source === nodeId && !edge.id.includes('__submenu_jump_anchor__'));
}

function getEdgeBranch(edge: Edge<BuilderEdgeData>): string {
  return String(edge.data?.condition || edge.data?.branchKey || 'default');
}

function resolveAutoAdvance(node: Node<FlowNodeData>, edges: Edge<BuilderEdgeData>[]): string | null {
  const outgoing = getOutgoingEdges(node.id, edges);
  if (outgoing.length === 1) return outgoing[0].target;
  if (outgoing.length === 0) return null;
  const defaultEdge = outgoing.find((edge) => getEdgeBranch(edge) === 'default');
  return defaultEdge ? defaultEdge.target : null;
}

function isTerminalType(type: string): boolean {
  return TERMINAL_NODE_TYPES.has(type);
}

function resolveSubmenuTargetNodeId(
  node: Node<FlowNodeData>,
  branchKey: string,
  nodeMap: Map<string, Node<FlowNodeData>>,
): string | null {
  const rawTargets = node.data.config?.submenu_branch_targets;
  const targets = rawTargets && typeof rawTargets === 'object' && !Array.isArray(rawTargets)
    ? (rawTargets as Record<string, unknown>)
    : {};
  const targetKey = String(targets[branchKey] || '').trim();
  if (!targetKey) return null;

  const subflowId = Number(node.data.subflowId || 0);
  const directCandidates = [
    targetKey,
    `${subflowId}:${targetKey}`,
    `${subflowId}::${targetKey}`,
    `subflow-${subflowId}:${targetKey}`,
    `${subflowId}/${targetKey}`,
  ];

  for (const candidate of directCandidates) {
    if (nodeMap.has(candidate)) return candidate;
  }

  for (const candidateNode of nodeMap.values()) {
    if (candidateNode.id === targetKey) return candidateNode.id;
    if (subflowId > 0 && candidateNode.id.includes(String(subflowId)) && candidateNode.id.endsWith(`:${targetKey}`)) {
      return candidateNode.id;
    }
  }

  return null;
}

function branchTone(type: string): string {
  if (type === 'transfer' || type === 'play_audio' || type === 'webhook') return styles.dotInfo;
  if (type === 'queue_login' || type === 'voicemail') return styles.dotWarning;
  if (type === 'queue' || type === 'business_hours' || type === 'menu') return styles.dotAccent;
  if (type === 'hangup') return styles.dotMuted;
  return styles.dotDefault;
}

export function FlowSimulator({ nodes, edges, onClose, onSubflowEnter, onSubflowExit }: FlowSimulatorProps) {
  const [simState, setSimState] = useState<SimState | null>(null);
  const [currentDayOverride, setCurrentDayOverride] = useState<string>('');

  const listEndRef = useRef<HTMLDivElement | null>(null);
  const highlightedNodesRef = useRef<Set<string>>(new Set());

  function currentFrameForState(state: SimState | null) {
    if (!state || !state.flowStack || state.flowStack.length === 0) return { flowId: 0, nodes, edges, label: 'Main Flow' } as FlowFrame;
    return state.flowStack[state.flowStack.length - 1];
  }

  function currentNodeMapForState(state: SimState | null) {
    const frame = currentFrameForState(state);
    return new Map(frame.nodes.map((node) => [node.id, node]));
  }

  

  const clearCanvasHighlights = () => {
    for (const nodeId of highlightedNodesRef.current) {
      const el = document.querySelector(`.react-flow__node[data-id=\"${CSS.escape(nodeId)}\"]`);
      if (el) {
        el.classList.remove('flow-sim-highlight-current');
        el.classList.remove('flow-sim-highlight-visited');
      }
    }
    highlightedNodesRef.current.clear();
  };

  const applyCanvasHighlights = (state: SimState | null) => {
    clearCanvasHighlights();
    if (!state) return;
    const currentMap = currentNodeMapForState(state);
    for (const step of state.visited) {
      if (!currentMap.has(step.nodeId)) continue;
      const el = document.querySelector(`.react-flow__node[data-id="${CSS.escape(step.nodeId)}"]`);
      if (el) {
        el.classList.add('flow-sim-highlight-visited');
        highlightedNodesRef.current.add(step.nodeId);
      }
    }

    if (currentMap.has(state.currentNodeId)) {
      const currentEl = document.querySelector(`.react-flow__node[data-id="${CSS.escape(state.currentNodeId)}"]`);
      if (currentEl) {
        currentEl.classList.add('flow-sim-highlight-current');
        highlightedNodesRef.current.add(state.currentNodeId);
      }
    }
  };

  useEffect(() => {
    applyCanvasHighlights(simState);
    return () => {
      clearCanvasHighlights();
    };
  }, [simState]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [simState?.visited.length, simState?.currentNodeId, simState?.done, simState?.notice]);

  const resetSim = () => {
    clearCanvasHighlights();
    setCurrentDayOverride('');
    setSimState(null);
    onSubflowExit?.();
  };

  const startSim = () => {
    clearCanvasHighlights();
    setCurrentDayOverride('');
    const startNode = nodes.find((node) => node.data.type === 'start');
    if (!startNode) return;
    setSimState({
      currentNodeId: startNode.id,
      visited: [],
      done: false,
      submenuStack: [],
      flowStack: [{ flowId: 0, nodes, edges, label: 'Main Flow' }],
      notice: null,
    });
  };

  const returnFromSubmenu = (state: SimState): SimState => {
    if (state.submenuStack.length === 0) {
      return { ...state, done: true, doneReason: state.doneReason || 'Call ended', notice: state.notice || null };
    }

    const nextStack = state.submenuStack.slice(0, -1);
    const frame = state.submenuStack[state.submenuStack.length - 1];

    // Pop the flow stack (we are returning from the topmost subflow)
    const newFlowStack = (state.flowStack || []).slice(0, -1);
    
    if (newFlowStack.length > 1) {
      onSubflowEnter?.(newFlowStack[newFlowStack.length - 1].flowId);
    } else {
      onSubflowExit?.();
    }

    const parentFrame = newFlowStack.length > 0 ? newFlowStack[newFlowStack.length - 1] : { flowId: 0, nodes, edges, label: 'Main Flow' } as FlowFrame;
    const parentNodeMap = new Map(parentFrame.nodes.map((n) => [n.id, n]));
    const menuNode = parentNodeMap.get(frame.menuNodeId);

    if (!menuNode) {
      return {
        ...state,
        submenuStack: nextStack,
        flowStack: newFlowStack,
        done: true,
        doneReason: 'Returned from submenu',
        notice: 'Returned from submenu',
      };
    }

    const outgoing = getOutgoingEdges(menuNode.id, parentFrame.edges);
    const completeEdge = outgoing.find((edge) => getEdgeBranch(edge) === 'complete');
    const fallbackEdge = outgoing.find((edge) => getEdgeBranch(edge) === 'default');
    const nextEdge = completeEdge || fallbackEdge;

    if (!nextEdge) {
      return {
        ...state,
        submenuStack: nextStack,
        flowStack: newFlowStack,
        done: true,
        doneReason: 'Returned from submenu',
        notice: 'Returned from submenu',
      };
    }

    return {
      ...state,
      submenuStack: nextStack,
      flowStack: newFlowStack,
      currentNodeId: nextEdge.target,
      done: false,
      doneReason: undefined,
      isDeadEnd: false,
      notice: 'Returned from submenu',
    };
  };

  const advanceToBranch = async (branchKey: string) => {
    if (!simState || simState.done) return;

    const currentFrame = currentFrameForState(simState);
    const nodeMap = new Map(currentFrame.nodes.map((n) => [n.id, n]));
    const node = nodeMap.get(simState.currentNodeId);
    if (!node) {
      setSimState((prev) => prev ? { ...prev, done: true, doneReason: `Node not found: ${simState.currentNodeId}` } : prev);
      return;
    }

    const outgoing = getOutgoingEdges(node.id, currentFrame.edges);
    const targetEdge = outgoing.find((edge) => {
      const edgeBranch = getEdgeBranch(edge);
      return edgeBranch === branchKey || edgeBranch === 'default';
    });

    const nextVisited = [...simState.visited, { nodeId: node.id, label: node.data.label || node.id, type: node.data.type }];

    if (targetEdge) {
      setSimState({
        ...simState,
        currentNodeId: targetEdge.target,
        visited: nextVisited,
        isDeadEnd: false,
        notice: null,
      });
      return;
    }

    // If menu has submenu mapping -> load subflow and push context
    if (node.data.type === 'menu' && branchKey !== 'complete' && Number(node.data.subflowId || 0) > 0) {
      const rawTargets = node.data.config?.submenu_branch_targets;
      const targets = rawTargets && typeof rawTargets === 'object' && !Array.isArray(rawTargets)
        ? (rawTargets as Record<string, unknown>)
        : {};
      const targetKey = String(targets[branchKey] || '').trim();
      const subflowId = Number(node.data.subflowId || 0);
      console.log('[sim] branchKey:', branchKey);
      console.log('[sim] rawTargets:', JSON.stringify(rawTargets));
      console.log('[sim] targetKey:', targetKey);
      console.log('[sim] subflowId:', subflowId);
      if (targetKey && subflowId > 0) {
          try {
          const response = await getFlow(String(subflowId));
          console.log('[sim] subflow response keys:', Object.keys(response));
          const flowData = (response as any)?.data ?? response;
          console.log('[sim] flowData nodes count:', (flowData as any)?.nodes?.length);
          const subNodes = mapFlowToNodes(flowData as any);
          const subEdges = mapFlowToEdges(flowData as any);
          const subNodeMap = new Map(subNodes.map((n) => [n.id, n]));

          // Pass 1: match by React Flow id
          let targetNode = subNodeMap.get(targetKey as string);

          // Pass 2: try matching by original nodeKey or id patterns
          if (!targetNode) {
            targetNode = subNodes.find((n) => {
              // some mappings keep original nodeKey on data.nodeKey (not guaranteed),
              // try a few heuristics to match common id formats
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
              // @ts-ignore
              if (n.data && (n.data as any).nodeKey === targetKey) return true;
              if (n.id === targetKey) return true;
              if (String(n.id).endsWith(`:${targetKey}`)) return true;
              return false;
            });
          }

          // Pass 3: fall back to a node of type 'start'
          if (!targetNode) {
            targetNode = subNodes.find((n) => n.data.type === 'start');
          }

          if (!targetNode) {
            setSimState({
              ...simState,
              visited: nextVisited,
              done: true,
              doneReason: `Subflow ${subflowId} has no start node`,
            });
            return;
          }

          setSimState({
            ...simState,
            currentNodeId: targetNode.id,
            visited: nextVisited,
            isDeadEnd: false,
            doneReason: undefined,
            submenuStack: [...simState.submenuStack, { menuNodeId: node.id, menuLabel: node.data.label || node.id }],
            flowStack: [...(simState.flowStack || [{ flowId: 0, nodes, edges, label: 'Main Flow' }]), { flowId: subflowId, nodes: subNodes, edges: subEdges, label: (flowData as any).name }],
            notice: null,
          });
          onSubflowEnter?.(subflowId);
          return;
        } catch (err) {
          setSimState((prev) => prev ? { ...prev, notice: `Failed to load submenu #${subflowId}` } : prev);
          return;
        }
      }
    }

    setSimState({
      ...simState,
      visited: nextVisited,
      done: true,
      doneReason: `No edge for branch "${branchKey}"`,
      notice: null,
    });
  };

  const completeCurrentStep = () => {
    if (!simState || simState.done) return;
    const currentFrame = currentFrameForState(simState);
    const nodeMap = new Map(currentFrame.nodes.map((n) => [n.id, n]));
    const node = nodeMap.get(simState.currentNodeId);
    if (!node) return;

    const nextVisited = [...simState.visited, { nodeId: node.id, label: node.data.label || node.id, type: node.data.type }];

    if (simState.submenuStack.length > 0) {
      setSimState(returnFromSubmenu({ ...simState, visited: nextVisited, doneReason: 'Returned from submenu' }));
      return;
    }

    setSimState({
      ...simState,
      visited: nextVisited,
      done: true,
      doneReason: 'Call ended',
      notice: null,
    });
  };

  useEffect(() => {
    if (!simState || simState.done) return;

    const currentFrame = currentFrameForState(simState);
    const nodeMapLocal = new Map(currentFrame.nodes.map((n) => [n.id, n]));
    const node = nodeMapLocal.get(simState.currentNodeId);
    if (!node) return;

    const nodeType = node.data.type;
    const outgoing = getOutgoingEdges(node.id, currentFrame.edges);

    if ((nodeType === 'start' || nodeType === 'group') && outgoing.length > 0) {
      const nextTarget = resolveAutoAdvance(node, currentFrame.edges);
      if (!nextTarget) return;

      setSimState((prev) => {
        if (!prev || prev.done || prev.currentNodeId !== node.id) return prev;
        return {
          ...prev,
          currentNodeId: nextTarget,
          visited: [...prev.visited, { nodeId: node.id, label: node.data.label || node.id, type: nodeType }],
          isDeadEnd: false,
        };
      });
      return;
    }

    if (outgoing.length === 0 && !isTerminalType(nodeType)) {
      if (simState.submenuStack.length > 0) {
        setSimState((prev) => {
          if (!prev || prev.done || prev.currentNodeId !== node.id) return prev;
          const withVisited = {
            ...prev,
            visited: [...prev.visited, { nodeId: node.id, label: node.data.label || node.id, type: nodeType }],
            doneReason: 'Returned from submenu',
          };
          return returnFromSubmenu(withVisited);
        });
        return;
      }

      setSimState((prev) => prev ? { ...prev, isDeadEnd: true } : prev);
      return;
    }

    if (simState.isDeadEnd) {
      setSimState((prev) => prev ? { ...prev, isDeadEnd: false } : prev);
    }
  }, [simState]);

  const breadcrumb = simState
    ? [ ...(simState.flowStack || [{ flowId: 0, nodes, edges, label: 'Main Flow' }]).map((f) => f.label), ...simState.submenuStack.map((item) => `${item.menuLabel} submenu`) ]
    : ['Main Flow'];
  const stepNumber = simState ? simState.visited.length + 1 : 0;

  const renderVisitedPath = (title: string) => {
    if (!simState || simState.visited.length === 0) return null;

    return (
      <div className={styles.card}>
        <div className={styles.cardLabel}>{title}</div>
        <div className={styles.visitedChips}>
          {simState.visited.map((step, index) => (
            <div className={styles.visitedWrap} key={`${step.nodeId}-${index}`}>
              <div className={styles.visitedChip}>
                <span className={`${styles.nodeDot} ${branchTone(step.type)}`} />
                <span className={styles.chipLabel}>{step.label}</span>
              </div>
              {index < simState.visited.length - 1 ? <span className={styles.pathArrow}>→</span> : null}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCurrentStep = () => {
    if (!simState || simState.done) return null;
    const currentFrame = currentFrameForState(simState);
    const nodeMapLocal = new Map(currentFrame.nodes.map((n) => [n.id, n]));
    const node = nodeMapLocal.get(simState.currentNodeId);
    if (!node) return <div className={styles.errorText}>Node not found: {simState.currentNodeId}</div>;

    const type = node.data.type;
    const cfg = (node.data.config || {}) as Record<string, unknown>;
    const outgoing = getOutgoingEdges(node.id, currentFrame.edges);
    const branches = outgoing.map((edge) => getEdgeBranch(edge));
    const isTerminal = isTerminalType(type);

    const menuBranchesRaw = Array.isArray(cfg.branches) ? cfg.branches as string[] : ['1', '2'];
    const menuBranches = type === 'menu'
      ? Array.from(new Set([...menuBranchesRaw.map((value) => String(value)), ...branches])).filter((value) => value !== 'default')
      : branches;

    return (
      <div className={`${styles.card} ${styles.currentCard}`}>
        <div className={styles.cardHeaderRow}>
          <div className={styles.cardLabel}>current node</div>
          {isTerminal ? <span className={styles.endBadge}>END</span> : null}
        </div>
        <div className={styles.cardTitle}>{node.data.label || node.id}</div>
        <div className={styles.typeBadge}>{type}</div>

        {type === 'play_audio' ? (
          <div className={styles.branchList}>
            <button className={styles.nextButton} onClick={() => advanceToBranch('default')} type="button">next →</button>
          </div>
        ) : null}

        {type === 'get_digits' ? (
          <div>
            <div className={styles.cardLabel}>expected digits → branches</div>
            <div className={styles.branchList}>
              {branches.map((branch) => (
                <button key={branch} className={styles.branchButton} onClick={() => advanceToBranch(branch)} type="button">
                  <strong>{branch}</strong>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {type === 'menu' ? (
          <div>
            <div className={styles.cardLabel}>press digit to route</div>
            <div className={styles.branchList}>
              {menuBranches.filter((branch) => branch !== 'complete').map((branch) => (
                <button key={branch} className={styles.branchButton} onClick={() => advanceToBranch(branch)} type="button">
                  <strong>{branch}</strong>
                </button>
              ))}
              {branches.includes('complete') ? (
                <button className={styles.branchButton} onClick={() => advanceToBranch('complete')} type="button"><strong>complete</strong></button>
              ) : null}
            </div>
          </div>
        ) : null}

        {type === 'business_hours' ? (() => {
          const now = new Date();
          const resolvedDay = (currentDayOverride || DAY_KEYS[now.getDay()]) as (typeof DAY_KEYS)[number];
          const schedule = (cfg.schedule as Record<string, { enabled?: boolean; open?: string; close?: string }> | undefined) || {};
          const daySchedule = schedule[resolvedDay];
          const [openHour, openMinute] = String(daySchedule?.open || '09:00').split(':').map(Number);
          const [closeHour, closeMinute] = String(daySchedule?.close || '17:00').split(':').map(Number);
          const currentMinutes = now.getHours() * 60 + now.getMinutes();
          const openMinutes = openHour * 60 + openMinute;
          const closeMinutes = closeHour * 60 + closeMinute;
          const enabled = Boolean(daySchedule?.enabled);
          const inWindow = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
          const isOpen = enabled && inWindow;
          const reason = !enabled
            ? `${DAY_LABELS[resolvedDay]} — CLOSED (not in schedule)`
            : isOpen
            ? `${DAY_LABELS[resolvedDay]} — OPEN (${daySchedule?.open || '09:00'}-${daySchedule?.close || '17:00'})`
            : `${DAY_LABELS[resolvedDay]} — CLOSED (outside ${daySchedule?.open || '09:00'}-${daySchedule?.close || '17:00'})`;

          return (
            <div>
              <div className={styles.cardNodeType}>{DAY_LABELS[resolvedDay]} • {now.toLocaleTimeString()}</div>
              <div className={styles.businessHoursReason}>{reason}</div>
              <div className={styles.overrideRow}>
                <span className={styles.overrideLabel}>override day:</span>
                <select className={styles.daySelect} value={currentDayOverride} onChange={(event) => setCurrentDayOverride(event.target.value)}>
                  <option value="">auto ({DAY_LABELS[resolvedDay]})</option>
                  {DAY_KEYS.map((dayKey) => (
                    <option key={dayKey} value={dayKey}>{DAY_LABELS[dayKey]}</option>
                  ))}
                </select>
              </div>
              <div className={styles.branchList}>
                <button className={styles.branchButton} onClick={() => advanceToBranch('open')} type="button"><strong>open</strong></button>
                <button className={styles.branchButton} onClick={() => advanceToBranch('closed')} type="button"><strong>closed</strong></button>
              </div>
            </div>
          );
        })() : null}

        {type === 'webhook' ? (
          <div>
            <div className={styles.cardNodeType}>URL: {String(cfg.url || '—')}</div>
            <div className={styles.cardNodeType}>Method: {String(cfg.method || 'POST')}</div>
            <div className={styles.mutedText}>Webhook will not be called in simulation</div>
            <div className={styles.branchList}>
              {branches.map((branch) => (
                <button key={branch} className={styles.branchButton} onClick={() => advanceToBranch(branch)} type="button"><strong>{branch}</strong></button>
              ))}
              {branches.length === 0 ? (
                <button className={styles.branchButton} onClick={() => advanceToBranch('default')} type="button"><strong>next</strong></button>
              ) : null}
            </div>
          </div>
        ) : null}

        {type === 'queue_login' || type === 'queue' ? (
          <div className={styles.branchList}>
            {branches.map((branch) => (
              <button key={branch} className={styles.branchButton} onClick={() => advanceToBranch(branch)} type="button"><strong>{branch}</strong></button>
            ))}
            {branches.length === 0 ? (
              <button className={styles.branchButton} onClick={() => advanceToBranch('default')} type="button"><strong>next</strong></button>
            ) : null}
          </div>
        ) : null}

        {type === 'voicemail' || type === 'transfer' || type === 'hunt' || type === 'hangup' ? (
          <div className={styles.branchList}>
            {branches.map((branch) => (
              <button key={branch} className={styles.branchButton} onClick={() => advanceToBranch(branch)} type="button"><strong>{branch}</strong></button>
            ))}
            <button className={styles.branchButton} onClick={completeCurrentStep} type="button"><strong>end</strong></button>
          </div>
        ) : null}

        {simState.isDeadEnd ? (
          <div className={styles.deadEndCard}>Dead end — no edge configured from this node</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.panel}>
        <div className={styles.header}>
          <div className={styles.title}>flow simulator {simState ? <span className={styles.stepCounter}>Step {stepNumber}</span> : null}</div>
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close simulator">×</button>
        </div>

        <div className={styles.body}>
          {breadcrumb.length > 1 ? (
            <div className={styles.breadcrumb}>{breadcrumb.join(' → ')}</div>
          ) : null}

          {simState?.notice ? <div className={styles.notice}>{simState.notice}</div> : null}

          {!simState ? (
            <div className={styles.card}>
              <div className={styles.cardLabel}>dry-run simulator</div>
              <div className={styles.cardNodeType}>Steps through your flow without making real calls. No audio plays, no webhooks fire.</div>
              <div style={{ marginTop: 12 }}>
                <button className={styles.startButton} onClick={startSim} type="button">start simulation</button>
              </div>
            </div>
          ) : simState.done ? (
            <>
              {renderVisitedPath(`path taken (${simState.visited.length} nodes)`) }
              <div className={`${styles.card} ${styles.doneCard}`}>
                <div className={styles.cardLabel}>simulation complete</div>
                <div className={styles.cardNodeType}>{simState.doneReason || 'Call ended'}</div>
                <div style={{ marginTop: 10 }}>
                  <button className={styles.startButton} onClick={resetSim} type="button">reset</button>
                </div>
              </div>
            </>
          ) : (
            <>
              {renderVisitedPath('visited path')}
              {renderCurrentStep()}
              <div style={{ marginTop: 8 }}>
                <button className={styles.branchButton} onClick={resetSim} type="button"><strong>reset</strong></button>
              </div>
            </>
          )}
          <div ref={listEndRef} />
        </div>
      </div>
    </div>
  );
}
