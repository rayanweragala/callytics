import '@testing-library/jest-dom';
import { vi } from 'vitest';
import React from 'react';

// Add CSS custom property shim
const cssVars = {
  '--bg-base': '#0a0a0a',
  '--accent': '#0070f3',
  '--color-error': '#ff0000',
  '--color-warning': '#f5a623',
  '--color-info': '#0070f3',
  '--bg-surface': '#111111',
  '--text-primary': '#ffffff',
  '--text-muted': '#888888',
  '--border-color': '#333333',
};

Object.entries(cssVars).forEach(([key, value]) => {
  document.documentElement.style.setProperty(key, value);
});

// Mock missing browser APIs
Element.prototype.scrollIntoView = vi.fn();

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
global.ResizeObserver = MockResizeObserver as any;

class MockAudio {
  src = '';
  preload = '';
  readyState = 0;
  currentTime = 0;
  duration = 100; 
  paused = true;
  muted = false;
  listeners: Record<string, Function[]> = {};

  addEventListener(event: string, cb: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(cb);
  }
  removeEventListener(event: string, cb: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(l => l !== cb);
  }
  dispatchEvent(event: string) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb());
    }
  }

  play = vi.fn().mockImplementation(async function(this: any) { 
    this.paused = false; 
    this.dispatchEvent('play');
    return Promise.resolve(); 
  });
  pause = vi.fn().mockImplementation(function(this: any) { 
    this.paused = true; 
    this.dispatchEvent('pause');
  });

  constructor() {
    // Auto-trigger metadata load in next tick
    setTimeout(() => this.dispatchEvent('loadedmetadata'), 0);
  }
}
global.Audio = MockAudio as any;

// Mock React Flow globally
vi.mock('reactflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'rf__wrapper' }, children),
  useNodesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useEdgesState: (initial: any) => [initial, vi.fn(), vi.fn()],
  useReactFlow: () => ({
    project: (x: any) => x,
    fitView: vi.fn(),
  }),
  MiniMap: () => React.createElement('div', { 'data-testid': 'rf__minimap' }),
  Controls: () => React.createElement('div', { 'data-testid': 'rf__controls' }),
  Background: () => React.createElement('div', { 'data-testid': 'rf__background' }),
  Panel: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  Handle: () => React.createElement('div', null),
  MarkerType: { ArrowClosed: 'arrowclosed' },
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  NodeResizer: () => React.createElement('div', null),
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
  getBezierPath: () => ['M0,0 C0,0 100,100 100,100', 50, 50],
  BaseEdge: ({ 'data-testid': _t, ...rest }: any) => React.createElement('path', { 'data-testid': 'rf__base-edge', ...rest }),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'rf__edge-label-renderer' }, children),
}));
