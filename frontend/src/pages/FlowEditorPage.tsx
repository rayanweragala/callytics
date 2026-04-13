import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeMouseHandler,
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
import styles from './FlowEditorPage.module.css';

const nodeTypes = {
  flowNode: FlowCanvasNode,
};

const edgeTypes = {
  flowEdge: FlowCanvasEdge,
};

const palette: Array<{ type: BuilderNodeType; label: string }> = [
  { type: 'start', label: 'start' },
  { type: 'play_audio', label: 'play audio' },
  { type: 'get_digits', label: 'get digits' },
  { type: 'hangup', label: 'hangup' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

function typeConfig(type: BuilderNodeType): Record<string, unknown> {
  if (type === 'play_audio') return { audio_file_path: '' };
  if (type === 'get_digits') return { timeout_ms: 5000, prompt_path: '' };
  return {};
}

function buildCanvasNode(type: BuilderNodeType, index: number): Node<FlowNodeData> {
  const key = `${type}-${Date.now()}-${index}`;
  return {
    id: key,
    type: 'flowNode',
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

function withDeleteCallbacks(
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

function mapFlowToNodes(flow: FlowDetail): Array<Node<FlowNodeData>> {
  return flow.nodes.map((node) => ({
    id: node.nodeKey,
    type: 'flowNode',
    position: { x: node.positionX, y: node.positionY },
    data: {
      label: node.label || node.nodeKey,
      type: node.type,
      config: node.config,
    },
    draggable: true,
  }));
}

function withEdgeDeleteCallbacks(
  edges: Edge[],
  onDelete: (edgeId: string) => void,
): Edge[] {
  return edges.map((edge) => ({
    ...edge,
    type: 'flowEdge',
    selectable: true,
    reconnectable: true,
    data: {
      ...(edge.data || {}),
      onDelete: () => onDelete(edge.id),
    },
  }));
}

function mapFlowToEdges(flow: FlowDetail): Edge[] {
  return flow.edges.map((edge) => ({
    id: String(edge.id),
    source: edge.sourceNodeKey,
    target: edge.targetNodeKey,
    label: undefined,
    type: 'flowEdge',
    selectable: true,
    reconnectable: true,
    data: { branchKey: edge.branchKey },
    style: { stroke: 'var(--border-strong)' },
  }));
}

export function FlowEditorPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canvasPanelRef = useRef<HTMLDivElement | null>(null);
  const saveFeedbackTimer = useRef<number | null>(null);
  const fitDone = useRef(false);
  const [flow, setFlow] = useState<FlowDetail | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [audioItems, setAudioItems] = useState<AudioFileItem[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
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
      return current.filter((node) => node.id !== nodeId);
    });
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId((current) => (current === nodeId ? null : current));
  }, [setEdges, setNodes]);

  const deleteEdge = useCallback((edgeId: string) => {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
  }, [setEdges]);

  useEffect(() => {
    const loadAudio = async () => {
      const response = await listAudio();
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
      setNodes(withDeleteCallbacks(arrangedNodes, deleteNode));
      setEdges(withEdgeDeleteCallbacks(mapFlowToEdges(response.data), deleteEdge));
    };

    void load();

    return () => {
      active = false;
    };
  }, [id, setEdges, setNodes]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId],
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
      setEdges((current) => {
        const duplicate = current.find(
          (edge) =>
            edge.source === connection.source &&
            edge.target === connection.target &&
            edge.sourceHandle === connection.sourceHandle,
        );
        if (duplicate) {
          return current;
        }
        return withEdgeDeleteCallbacks(
          addEdge(
            {
              ...connection,
              label: undefined,
              type: 'flowEdge',
              style: { stroke: 'var(--border-strong)' },
              data: { branchKey: 'default' },
            },
            current,
          ),
          deleteEdge,
        );
      });
    },
    [deleteEdge, setEdges],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, clickedEdge) => {
      setEdges((current) =>
        withEdgeDeleteCallbacks(
          current.map((edge) => ({
            ...edge,
            selected: edge.id === clickedEdge.id,
          })),
          deleteEdge,
        ),
      );
    },
    [deleteEdge, setEdges],
  );

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      setEdges((current) => {
        const duplicate = current.find(
          (edge) =>
            edge.id !== oldEdge.id &&
            edge.source === newConnection.source &&
            edge.target === newConnection.target &&
            edge.sourceHandle === newConnection.sourceHandle,
        );
        if (duplicate) {
          return current;
        }
        return withEdgeDeleteCallbacks(reconnectEdge(oldEdge, newConnection, current), deleteEdge);
      });
    },
    [deleteEdge, setEdges],
  );

  const onReconnectStart = useCallback(() => {}, []);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    setSelectedNodeId(node.id);
  };

  const handleSelectionChange = ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
    const firstNode = selectedNodes[0] as Node<FlowNodeData> | undefined;
    setSelectedNodeId(firstNode?.id || null);
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
      setNodes((current) => withDeleteCallbacks([...current, newNode], deleteNode));
      setSelectedNodeId(newNode.id);
    },
    [rfInstance, deleteNode, nodes.length, setNodes],
  );

  const handleLabelChange = (value: string) => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((current) =>
      withDeleteCallbacks(
        current.map((node) => {
          if (node.id === selectedNodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                label: value,
              },
            };
          }
          return node;
        }),
        deleteNode,
      ),
    );
  };

  const handleConfigChange = (field: string, value: string) => {
    if (!selectedNodeId) {
      return;
    }

    setNodes((current) =>
      withDeleteCallbacks(
        current.map((node) => {
          if (node.id === selectedNodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                config: {
                  ...node.data.config,
                  [field]: field === 'timeout_ms' ? Number(value) || 0 : value,
                },
              },
            };
          }
          return node;
        }),
        deleteNode,
      ),
    );
  };

  const selectedConfig = (selectedNode?.data.config || {}) as Record<string, unknown>;
  const audioFileSelected = Number(selectedConfig.audio_file_id || 0) > 0;
  const promptAudioSelected = Number(selectedConfig.prompt_audio_file_id || 0) > 0;
  const audioOptions = audioItems.map((item) => ({ value: String(item.id), label: item.name }));

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
          branchKey: String(edge.data?.branchKey || 'default'),
        })),
      };
      const response = await updateFlow(id, payload);
      setFlow(response.data);
      const panelWidth = canvasPanelRef.current?.clientWidth || 900;
      const mappedNodes = mapFlowToNodes(response.data);
      const arrangedNodes = applyAutoLayout(mappedNodes, panelWidth);
      const nextNodes = withDeleteCallbacks(arrangedNodes, deleteNode);
      setNodes(nextNodes);
      setEdges(withEdgeDeleteCallbacks(mapFlowToEdges(response.data), deleteEdge));
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

  const saveLabel = saveState === 'saving' ? 'saving…' : saveState === 'saved' ? 'saved ✓' : saveState === 'failed' ? 'failed' : 'save';
  const saveButtonClass = saveState === 'failed' ? `${styles.primaryButton} ${styles.failedButton}` : styles.primaryButton;

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.secondaryButton} onClick={() => navigate('/flows')} type="button">back</button>
          <input
            className={styles.flowNameInput}
            value={flow?.name || 'loading…'}
            onChange={(event) => setFlowName(event.target.value)}
          />
        </div>
        <button className={saveButtonClass} onClick={() => void saveFlow()} type="button">
          {saveLabel}
        </button>
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
            onNodesDelete={(deletedNodes) => {
              const deletedIds = new Set(deletedNodes.map((node) => node.id));
              setEdges((current) => current.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)));
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
            <Controls />
          </ReactFlow>
        </section>

        <section className={styles.rightPanel}>
          <div className={styles.panelTitle}>node config</div>
          {selectedNode ? (
            <div className={styles.form}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>label</span>
                <input
                  className={styles.input}
                  value={selectedNode.data.label}
                  onChange={(event) => handleLabelChange(event.target.value)}
                />
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
                    <input
                      className={styles.input}
                      type="number"
                      value={String(selectedConfig.timeout_ms || 5000)}
                      onChange={(event) => handleConfigChange('timeout_ms', event.target.value)}
                    />
                  </label>
                </>
              ) : null}

              <div className={styles.meta}>node key: {selectedNode.id}</div>
              <div className={styles.meta}>type: {selectedNode.data.type}</div>
            </div>
          ) : (
            <div className={styles.empty}>Select a node to edit its config.</div>
          )}
        </section>
      </div>
    </div>
  );
}
