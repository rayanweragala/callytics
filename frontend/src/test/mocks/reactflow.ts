import { vi } from 'vitest';
import React from 'react';

export const useNodesState = vi.fn((initial) => [initial, vi.fn(), vi.fn()]);
export const useEdgesState = vi.fn((initial) => [initial, vi.fn(), vi.fn()]);
export const useReactFlow = vi.fn(() => ({
  project: vi.fn((x) => x),
  fitView: vi.fn(),
}));

const ReactFlow = ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'rf__wrapper' }, children);
const MiniMap = () => React.createElement('div', { 'data-testid': 'rf__minimap' });
const Controls = () => React.createElement('div', { 'data-testid': 'rf__controls' });
const Background = () => React.createElement('div', { 'data-testid': 'rf__background' });

vi.mock('reactflow', () => ({
  default: ReactFlow,
  useNodesState,
  useEdgesState,
  useReactFlow,
  MiniMap,
  Controls,
  Background,
  Panel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Handle: () => React.createElement('div', null),
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));
