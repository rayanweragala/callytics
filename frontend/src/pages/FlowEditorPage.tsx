import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeMouseHandler,
  MiniMap,
  Node,
  NodeMouseHandler,
  OnSelectionChangeParams,
  ReactFlowInstance,
  reconnectEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import { getFlow, listAudio, updateFlow } from '../lib/api';
import type { AudioFileItem, BuilderNodeType, FlowDetail, FlowNodeData } from '../types';
import { SearchableSelect } from '../components/common/SearchableSelect';
import { FlowCanvasEdge } from '../components/builder/FlowCanvasEdge';
import { FlowCanvasNode } from '../components/builder/FlowCanvasNode';
import { HuntNode } from '../components/nodes/HuntNode';
import { HuntConfigPanel } from '../components/panels/HuntConfigPanel';
import { layoutFlow } from '../utils/layoutFlow';
import styles from './FlowEditorPage.module.css';

const nodeTypes = {
  flowNode: FlowCanvasNode,
  huntNode: HuntNode,
};

const edgeTypes = {
  flowEdge: FlowCanvasEdge,
};

const palette: Array<{ type: BuilderNodeType; label: string }> = [
  { type: 'start', label: 'start' },
  { type: 'play_audio', label: 'play audio' },
  { type: 'get_digits', label: 'get digits' },
  { type: 'transfer', label: 'transfer' },
  { type: 'hunt', label: 'Hunt Group' },
  { type: 'hangup', label: 'hangup' },
];

const conditionValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'timeout', 'invalid', 'default'];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

type BuilderEdgeData = {
  branchKey: string;
  condition: string | null;
  sourceNodeType: string;
  onDelete?: (edgeId: string) => void;
};

function typeConfig(type: BuilderNodeType): Record<string, unknown> {
  if (type === 'play_audio') return { audio_file_path: '', audio_file_id: '' };
  if (type === 'get_digits') return { timeout_ms: 5000, prompt_path: '', prompt_audio_file_id: '' };
  if (type === 'transfer') return { destination: '', timeout_ms: 30000, on_no_answer: '' };
  if (type === 'hunt') {
    return {
      destinations: ['SIP/101'],
      strategy: 'sequential',
      attempt_timeout_ms: 20000,
      total_timeout_ms: 60000,
      hold_audio_file_id: null,
      busy_audio_file_id: null,
      on_no_answer: '',
    };
  }
  return {};
}

function buildCanvasNode(type: BuilderNodeType, index: number): Node<FlowNodeData> {
  const key = `${type}-${Date.now()}-${index}`;
  return {
    id: key,
    type: type === 'hunt' ? 'huntNode' : 'flowNode',
    position: { x: 120 + index * 40, y: 120 + index * 30 },
    data: {
      label: palette.find((item) => item.type === type)?.label || type,
      type,
      config: typeConfig(type),
    },
  };
}

function shouldAutoArrange(nodes: Array<Node<FlowNodeData>>): boolean {
  if (nodes.length <= 1) return false;
  const xValues = nodes.map((node) => node.position.x);
  const yValues = nodes.map((node) => node.position.y);
  const width = Math.max(...xValues) - Math.min(...xValues);
  const height = Math.max(...yValues) - Math.min(...yValues);
  return width < 300 && height < 300;
}

function applyAutoLayout(nodes: Array<Node<FlowNodeData>>, panelWidth: number): Array<Node<FlowNodeData>> {
  if (!shouldAutoArrange(nodes)) {
    return nodes;
  }

  const centerX = Math.max(80, Math.round(panelWidth / 2) - 85);
  return nodes.map((node, index) => ({
    ...node,
    position: {
      x: centerX,
      y: 80 + index * 150,
    },
  }));
}

function withNodeDeleteCallbacks(
  nodes: Array<Node<FlowNodeData>>,
  onDelete: (nodeId: string) => void,
): Array<Node<FlowNodeData>> {
  return nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onDelete: () => onDelete(node.id),
    },
  }));
}

function attachEdgeMetadata(
  edges: Edge<BuilderEdgeData>[],
  nodes: Array<Node<FlowNodeData>>,
  onDelete: (edgeId: string) => void,
): Edge<BuilderEdgeData>[] {
  const grouped = new Map<string, Edge<BuilderEdgeData>[]>();

  for (const edge of edges) {
    const key = `${edge.source}|${edge.target}`;
    const existing = grouped.get(key) || [];
    existing.push(edge);
    grouped.set(key, existing);
  }

  return edges.map((edge) => {
    const sourceNodeType = nodes.find((node) => node.id === edge.source)?.data.type || 'hangup';
    const condition = edge.data?.condition ?? null;
    const siblings = grouped.get(`${edge.source}|${edge.target}`) || [edge];
    const parallelIndex = siblings.findIndex((sibling) => sibling.id === edge.id);
    return {
      ...edge,
      type: 'flowEdge',
      selectable: true,
      reconnectable: true,
      label: undefined,
      data: {
        branchKey: edge.data?.branchKey || condition || 'default',
        condition,
        sourceNodeType,
        parallelIndex,
        parallelTotal: siblings.length,
        onDelete: () => onDelete(edge.id),
      },
      style: { stroke: edge.selected ? 'var(--color-active)' : 'var(--border-strong)' },
    };
  });
}

function mapFlowToNodes(flow: FlowDetail): Array<Node<FlowNodeData>> {
  return flow.nodes.map((node) => ({
    id: node.nodeKey,
    type: node.type === 'hunt' ? 'huntNode' : 'flowNode',
    position: { x: node.positionX, y: node.positionY },
    data: {
      label: node.label || node.nodeKey,
      type: node.type,
      config: node.config,
    },
    draggable: true,
  }));
}

function mapFlowToEdges(flow: FlowDetail): Edge<BuilderEdgeData>[] {
  const nodeTypeMap = new Map(flow.nodes.map((node) => [node.nodeKey, node.type]));
  return flow.edges.map((edge) => ({
    id: String(edge.id),
    source: edge.sourceNodeKey,
    target: edge.targetNodeKey,
    label: undefined,
    type: 'flowEdge',
    selectable: true,
    reconnectable: true,
    data: {
      branchKey: edge.branchKey,
      condition: edge.condition,
      sourceNodeType: nodeTypeMap.get(edge.sourceNodeKey) || 'hangup',
    },
    style: { stroke: 'var(--border-strong)' },
  }));
}

function makeEdgeKey(source: string | null, target: string | null, sourceHandle: string | null | undefined, condition: string | null): string {
  return `${source || ''}|${target || ''}|${sourceHandle || ''}|${condition || ''}`;
}

function minimapNodeColor(node: Node<FlowNodeData>): string {
  switch (node.data?.type) {
    case 'start':
      return '#00dc82';
    case 'play_audio':
      return '#3b82f6';
    case 'get_digits':
      return '#f5a623';
    case 'transfer':
      return '#3b82f6';
    case 'hunt':
      return '#f5a623';
    case 'hangup':
      return '#ff4444';
    default:
      return '#555555';
  }
}

const miniMapSizeProps = { width: 160, height: 120 } as unknown as Record<string, number>;

export function FlowEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const fitDone = useRef(false);
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdgeData>([]);
  const [audioItems, setAudioItems] = useState<AudioFileItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  useEffect(() => {
    if (rfInstance && nodes.length > 0 && !fitDone.current) {
      fitDone.current = true;
      const timer = window.setTimeout(() => {
        void rfInstance.fitView({ padding: 0.2, duration: 300 });
      }, 100);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [rfInstance, nodes.length]);

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((current) => {
      const target = current.find((node) => node.id === nodeId);
      if (!target || target.data.type === 'start') {
        return current;
      }
      return withNodeDeleteCallbacks(current.filter((node) => node.id !== nodeId), deleteNode);
    });
    setEdges((current) => attachEdgeMetadata(current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId), nodes, deleteEdge));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, [nodes, setNodes]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    setSelectedEdgeId((current) => (current === edgeId ? null : current));
  }, [setEdges]);

  useEffect(() => {
    const loadAudio = async () => {
      const response = await listAudio(1, 100);
      setAudioItems(response.data);
    };
    void loadAudio();
  }, []);

  useEffect(() => {
    fitDone.current = false;
    let active = true;

    const load = async () => {
      const response = await getFlow(id);
      if (!active) {
        return;
      }
      setFlow(response.data);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = withNodeDeleteCallbacks(arrangedNodes, deleteNode);
      setNodes(nextNodes);
      setEdges(attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, deleteEdge));
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    };

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
  );

  const selectedEdge = useMemo(
    () => edges.find((edge) => edge.id === selectedEdgeId) || null,
    [edges, selectedEdgeId],
  );

  const selectedEdgeSourceNode = useMemo(
    () => (selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) || null : null),
    [nodes, selectedEdge],
  );

  useEffect(() => {
    return () => {
      if (saveFeedbackTimer.current) {
        window.clearTimeout(saveFeedbackTimer.current);
      }
    };
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNodeType = nodes.find((node) => node.id === connection.source)?.data.type || 'hangup';
      const condition = sourceNodeType === 'get_digits' ? 'default' : null;
      const branchKey = sourceNodeType === 'hunt' ? 'no answer' : condition || 'default';
      const newKey = makeEdgeKey(connection.source, connection.target, connection.sourceHandle, condition);

      setEdges((current) => {
        if (sourceNodeType === 'hunt' && current.some((edge) => edge.source === connection.source)) {
          return current;
        }
        const duplicate = current.find((edge) => makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) === newKey);
        if (duplicate) {
          return current;
        }
        const next = addEdge(
            {
              ...connection,
              label: undefined,
              type: 'flowEdge',
              reconnectable: true,
              style: { stroke: 'var(--border-strong)' },
              data: { branchKey, condition, sourceNodeType },
            },
current,
        );
        return attachEdgeMetadata(next, nodes, deleteEdge);
      });
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
    },
    [deleteEdge, nodes, setEdges],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, clickedEdge) => {
      setSelectedNodeId(null);
      setSelectedEdgeId(clickedEdge.id);
      setEdges((current) =>
        attachEdgeMetadata(
          current.map((edge) => ({
            ...edge,
            selected: edge.id === clickedEdge.id,
          })),
          nodes,
          deleteEdge,
        ),
      );
    },
    [deleteEdge, nodes, setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge<BuilderEdgeData>, newConnection: Connection) => {
      const oldCondition = oldEdge.data?.condition ?? null;
      const duplicateKey = makeEdgeKey(newConnection.source, newConnection.target, newConnection.sourceHandle, oldCondition);
      setEdges((current) => {
        const duplicate = current.find((edge) => edge.id !== oldEdge.id && makeEdgeKey(edge.source, edge.target, edge.sourceHandle, edge.data?.condition ?? null) == duplicateKey);
        if (duplicate) {
          return current;
        }
        const sourceNodeType = nodes.find((node) => node.id === (newConnection.source || oldEdge.source))?.data.type || oldEdge.data?.sourceNodeType || 'hangup';
        const reconnected = reconnectEdge(oldEdge, newConnection, current).map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                data: {
                  branchKey: oldEdge.data?.branchKey || oldCondition || 'default',
                  condition: oldCondition,
                  sourceNodeType: String(sourceNodeType),
                  onDelete: () => deleteEdge(edge.id),
                },
              }
            : edge,
        );
        return attachEdgeMetadata(reconnected, nodes, deleteEdge);
      });
    },
    [deleteEdge, nodes, setEdges],
  );

  const onReconnectStart = useCallback(() => {}, []);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  const handleSelectionChange = ({ nodes: selectedNodes, edges: selectedEdges }: OnSelectionChangeParams) => {
    const firstNode = selectedNodes[0] as Node<FlowNodeData> | undefined;
    const firstEdge = selectedEdges[0] as Edge<BuilderEdgeData> | undefined;

    if (firstNode) {
      setSelectedNodeId(firstNode.id);
      setSelectedEdgeId(null);
      return;
    }

    if (firstEdge) {
      setSelectedNodeId(null);
      setSelectedEdgeId(firstEdge.id);
    }
  };

  const handleDragStart = (type: BuilderNodeType) => {
    window.sessionStorage.setItem('flow-builder-node-type', type);
  };

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const type = window.sessionStorage.getItem('flow-builder-node-type') as BuilderNodeType | null;
      if (!type || !rfInstance) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const position = rfInstance.project({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      const newNode = buildCanvasNode(type, nodes.length);
      newNode.position = position;
      setNodes((current) => withNodeDeleteCallbacks([...current, newNode], deleteNode));
      setSelectedNodeId(newNode.id);
      setSelectedEdgeId(null);
    },
    [rfInstance, deleteNode, nodes.length, setNodes],
  );

  const handleLabelChange = (value: string) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      withNodeDeleteCallbacks(
        current.map((node) => (
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, label: value } }
            : node
        )),
        deleteNode,
      ),
    );
  };

  const handleConfigValueChange = (field: string, value: unknown) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      withNodeDeleteCallbacks(
        current.map((node) => {
          if (node.id !== selectedNodeId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                [field]: value,
              },
            },
          };
        }),
        deleteNode,
      ),
    );
  };

  const handleConfigChange = (field: string, value: string) => {
    const numericFields = new Set(['timeout_ms', 'attempt_timeout_ms', 'total_timeout_ms']);
    handleConfigValueChange(field, numericFields.has(field) ? Number(value) || 0 : value);
  };

  const handleConfigReplace = (nextConfig: Record<string, unknown>) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      withNodeDeleteCallbacks(
        current.map((node) => (
          node.id === selectedNodeId
            ? { ...node, data: { ...node.data, config: nextConfig } }
            : node
        )),
        deleteNode,
      ),
    );
  };

  const handleEdgeConditionChange = (value: string | null) => {
    if (!selectedEdgeId) return;
    setEdges((current) =>
      attachEdgeMetadata(
        current.map((edge) =>
          edge.id === selectedEdgeId
            ? {
                ...edge,
                data: {
                  branchKey: value || 'default',
                  condition: value,
                  sourceNodeType: String(edge.data?.sourceNodeType || nodes.find((node) => node.id === edge.source)?.data.type || 'hangup'),
                  onDelete: () => deleteEdge(edge.id),
                },
              }
            : edge,
        ),
        nodes,
        deleteEdge,
      ),
    );
  };

  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const audioFileSelected = Number(selectedConfig.audio_file_id || 0) > 0;
  const promptAudioSelected = Number(selectedConfig.prompt_audio_file_id || 0) > 0;
  const audioOptions = audioItems.map((item) => ({ value: String(item.id), label: item.name }));
  const nodeOptions = nodes.map((node) => ({ value: node.id, label: `${node.id} — ${node.data.label}` }));
  const conditionOptions = conditionValues.map((value) => ({ value, label: value }));

  const saveFlow = async () => {
    if (!flow) return;
    setSaveState('saving');
    try {
      const payload = {
        name: flow.name,
        description: flow.description || '',
        slug: flow.slug,
        nodes: nodes.map((node) => ({
          nodeKey: node.id,
          type: node.data.type,
          label: node.data.label,
          positionX: node.position.x,
          positionY: node.position.y,
          config: node.data.config,
        })),
        edges: edges.map((edge) => ({
          sourceNodeKey: edge.source,
          targetNodeKey: edge.target,
          branchKey: String(edge.data?.branchKey || edge.data?.condition || 'default'),
          condition: edge.data?.condition ?? null,
        })),
      };
      const response = await updateFlow(id, payload);
      setFlow(response.data);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = withNodeDeleteCallbacks(arrangedNodes, deleteNode);
      setNodes(nextNodes);
      setEdges(attachEdgeMetadata(mapFlowToEdges(response.data), nextNodes, deleteEdge));
      setSelectedEdgeId(null);
      setSaveState('saved');
    } catch {
      setSaveState('failed');
    } finally {
      if (saveFeedbackTimer.current) {
        window.clearTimeout(saveFeedbackTimer.current);
      }
      saveFeedbackTimer.current = window.setTimeout(() => {
        setSaveState('idle');
      }, 2000);
    }
  };

  const setFlowName = (value: string) => {
    if (!flow) return;
    setFlow({ ...flow, name: value });
  };

  const handleTidyLayout = () => {
    const nextNodes = withNodeDeleteCallbacks(layoutFlow(nodes, edges), deleteNode);
    setNodes(nextNodes);
    window.setTimeout(() => {
      void rfInstance?.fitView({ padding: 0.2, duration: 400 });
    }, 50);
  };

  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : 'save';
  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.secondaryButton} onClick={() => navigate('/flows')} type="button">back</button>
          <button className={styles.secondaryButton} onClick={handleTidyLayout} type="button">tidy layout</button>
          <input className={styles.flowNameInput} value={flow?.name || 'loading…'} onChange={(event) => setFlowName(event.target.value)} />
        </div>
        <button className={saveButtonClass} onClick={() => void saveFlow()} type="button">{saveLabel}</button>
      </div>

      <div className={styles.editorShell}>
        <section className={styles.leftPanel}>
          <div className={styles.panelTitle}>node palette</div>
          <div className={styles.paletteList}>
            {palette.map((item) => (
              <div
                className={styles.paletteItem}
                draggable={item.type !== 'start'}
                key={item.type}
                onDragStart={() => handleDragStart(item.type)}
                title={item.type === 'start' ? 'Seed flows already contain the required start node' : 'Drag onto canvas'}
              >
                <span className={`${styles.paletteBar} ${styles[`bar${item.type.replace('_', '')}`]}`} />
                <div>
                  <div className={styles.paletteType}>{item.type}</div>
                  <div className={styles.paletteLabel}>{item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section ref={canvasPanelRef} className={styles.canvasPanel} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <div className={styles.canvasWrapper}>
            <ReactFlow
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onReconnectStart={onReconnectStart}
            onEdgeClick={onEdgeClick}
            onNodeClick={handleNodeClick}
            onSelectionChange={handleSelectionChange}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedEdgeId(null);
            }}
            onNodesDelete={(deletedNodes) => {
              const deletedIds = new Set(deletedNodes.map((node) => node.id));
              setEdges((current) => attachEdgeMetadata(current.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)), nodes, deleteEdge));
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={(instance) => {
              setRfInstance(instance);
              if (nodes.length > 0 && !fitDone.current) {
                fitDone.current = true;
                window.setTimeout(() => {
                  void instance.fitView({ padding: 0.2, duration: 300 });
                }, 100);
              }
            }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background color="#1f1f1f" gap={24} />
            <Controls position="bottom-left" />
            <MiniMap
              nodeColor={minimapNodeColor}
              maskColor="rgba(0, 0, 0, 0.6)"
              position="bottom-right"
              {...miniMapSizeProps}
              style={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: '6px',
                width: 160,
                height: 120,
              }}
              pannable
              zoomable
            />
          </ReactFlow>
          </div>
        </section>

        <section className={styles.rightPanel}>
          <div className={styles.panelTitle}>{selectedEdge ? 'edge config' : 'node config'}</div>
          {selectedEdge && selectedEdgeSourceNode?.data.type === 'get_digits' ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>condition</span>
                <SearchableSelect
                  options={conditionOptions}
                  value={selectedEdge.data?.condition || null}
                  onChange={handleEdgeConditionChange}
                  placeholder="select condition"
                />
              </label>
              <div className={styles.meta}>source: {selectedEdge.source}</div>
              <div className={styles.meta}>target: {selectedEdge.target}</div>
            </div>
          ) : selectedNode ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>label</span>
                <input className={styles.input} value={selectedNode.data.label} onChange={(event) => handleLabelChange(event.target.value)} />
              </label>

              {selectedNode.data.type === 'play_audio' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>audio file</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.audio_file_id ? String(selectedConfig.audio_file_id) : null}
                      onChange={(value) => handleConfigChange('audio_file_id', value || '')}
                      placeholder="built-in path / manual"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>audio_file_path</span>
                    <input
                      className={styles.input}
                      disabled={audioFileSelected}
                      placeholder={audioFileSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                      value={audioFileSelected ? 'disabled — using audio file above' : String(selectedConfig.audio_file_path || '')}
                      onChange={(event) => handleConfigChange('audio_file_path', event.target.value)}
                    />
                  </label>
                </>
              ) : null}

              {selectedNode.data.type === 'get_digits' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt audio</span>
                    <SearchableSelect
                      options={audioOptions}
                      value={selectedConfig.prompt_audio_file_id ? String(selectedConfig.prompt_audio_file_id) : null}
                      onChange={(value) => handleConfigChange('prompt_audio_file_id', value || '')}
                      placeholder="built-in path / manual"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>prompt_path</span>
                    <input
                      className={styles.input}
                      disabled={promptAudioSelected}
                      placeholder={promptAudioSelected ? 'disabled — using audio file above' : 'built-in sound path'}
                      value={promptAudioSelected ? 'disabled — using audio file above' : String(selectedConfig.prompt_path || '')}
                      onChange={(event) => handleConfigChange('prompt_path', event.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout_ms</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.timeout_ms || 5000)} onChange={(event) => handleConfigChange('timeout_ms', event.target.value)} />
                  </label>
                </>
              ) : null}

              {selectedNode.data.type === 'hunt' ? (
                <HuntConfigPanel
                  nodeId={selectedNode.id}
                  config={selectedConfig}
                  audioOptions={audioOptions}
                  nodeOptions={nodeOptions}
                  onConfigReplace={handleConfigReplace}
                />
              ) : null}

              {selectedNode.data.type === 'transfer' ? (
                <>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>destination</span>
                    <input className={styles.input} placeholder="SIP/trunk/+94XXXXXXXXX" value={String(selectedConfig.destination || '')} onChange={(event) => handleConfigChange('destination', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>timeout_ms</span>
                    <input className={styles.input} type="number" value={String(selectedConfig.timeout_ms || 30000)} onChange={(event) => handleConfigChange('timeout_ms', event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>on_no_answer</span>
                    <SearchableSelect
                      options={nodeOptions.filter((option) => option.value !== selectedNode.id)}
                      value={selectedConfig.on_no_answer ? String(selectedConfig.on_no_answer) : null}
                      onChange={(value) => handleConfigChange('on_no_answer', value || '')}
                      placeholder="select fallback node"
                    />
                  </label>
                </>
              ) : null}

              <div className={styles.meta}>node key: {selectedNode.id}</div>
              <div className={styles.meta}>type: {selectedNode.data.type}</div>
            </div>
          ) : (
            <div className={styles.empty}>Select a node or edge to edit its config.</div>
          )}
        </section>
      </div>
    </div>
  );
}
