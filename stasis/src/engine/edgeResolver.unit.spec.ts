import { resolveNextEdge } from './edgeResolver';
import { FlowEdge } from '../flowLoader';

function edge(condition: string | null, targetNodeKey = 'next'): FlowEdge {
  return {
    sourceNodeKey: 'menu',
    targetNodeKey,
    branchKey: condition ?? 'default',
    condition,
  };
}

describe('resolveNextEdge', () => {
  it(`digit '2' pressed, edge exists for '2' -> resolves to that edge`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '2', [edge('2', 'digit-2'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('digit-2');
  });

  it(`digit '7' pressed, no '7' edge, invalid edge exists -> resolves to invalid`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '7', [edge('invalid', 'invalid-node'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('invalid-node');
  });

  it(`digit '5' pressed, no '5' edge, no 'invalid' edge, default edge exists -> resolves to default`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '5', [edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('fallback');
  });

  it(`timeout result, 'timeout' edge exists -> resolves to timeout`, () => {
    const result = resolveNextEdge('menu', 'get_digits', 'timeout', [edge('timeout', 'timeout-node'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('timeout-node');
  });

  it(`timeout result, no 'timeout' edge, 'default' edge exists -> resolves to default`, () => {
    const result = resolveNextEdge('menu', 'get_digits', 'timeout', [edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('fallback');
  });

  it('unconditional edge (condition: null) -> always resolves regardless of result', () => {
    const result = resolveNextEdge('menu', 'play_audio', 'anything', [edge(null, 'always')]);
    expect(result?.targetNodeKey).toBe('always');
  });

  it(`digit '*' pressed, edge exists for '*' -> resolves to that edge`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '*', [edge('*', 'star-node'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('star-node');
  });

  it(`digit '#' pressed, edge exists for '#' -> resolves to that edge`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '#', [edge('#', 'hash-node'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('hash-node');
  });

  it(`digit '0' pressed, edge exists for '0' -> resolves to that edge`, () => {
    const result = resolveNextEdge('menu', 'get_digits', '0', [edge('0', 'zero-node'), edge('default', 'fallback')]);
    expect(result?.targetNodeKey).toBe('zero-node');
  });

  it(`menu option-key condition: result 'sales' matches edge whose condition is 'sales'`, () => {
    const edges = [
      { sourceNodeKey: 'menu', targetNodeKey: 'sales-node', branchKey: 'sales', condition: 'sales' },
      { sourceNodeKey: 'menu', targetNodeKey: 'support-node', branchKey: 'support', condition: 'support' },
    ];
    // A menu node uses 'get_digits' type — 'sales' acts as an exact condition match
    const result = resolveNextEdge('menu', 'get_digits', 'sales', edges);
    expect(result?.targetNodeKey).toBe('sales-node');
  });

  it('no edges at all -> returns null', () => {
    const result = resolveNextEdge('menu', 'get_digits', '1', []);
    expect(result).toBeNull();
  });

  it('no matching edge for result and no default edge -> returns null', () => {
    const result = resolveNextEdge('menu', 'get_digits', '3', [edge('1', 'one-node')]);
    expect(result).toBeNull();
  });

  it('non-get_digits node with matching conditional edge -> resolves to exact match', () => {
    const edges = [
      { sourceNodeKey: 'branch-1', targetNodeKey: 'yes-path', branchKey: 'yes', condition: 'yes' },
      { sourceNodeKey: 'branch-1', targetNodeKey: 'no-path', branchKey: 'no', condition: 'no' },
      { sourceNodeKey: 'branch-1', targetNodeKey: 'default-path', branchKey: 'default', condition: 'default' },
    ];
    const result = resolveNextEdge('branch-1', 'branch', 'yes', edges);
    expect(result?.targetNodeKey).toBe('yes-path');
  });

  it('non-get_digits node with no exact match falls back to default conditional edge', () => {
    const edges = [
      { sourceNodeKey: 'branch-1', targetNodeKey: 'yes-path', branchKey: 'yes', condition: 'yes' },
      { sourceNodeKey: 'branch-1', targetNodeKey: 'default-path', branchKey: 'default', condition: 'default' },
    ];
    const result = resolveNextEdge('branch-1', 'branch', 'no', edges);
    expect(result?.targetNodeKey).toBe('default-path');
  });

  it('non-get_digits node with no conditional edges falls back by branchKey', () => {
    const edges = [
      { sourceNodeKey: 'play-1', targetNodeKey: 'next-node', branchKey: 'default', condition: null },
    ];
    const result = resolveNextEdge('play-1', 'play_audio', 'anything', edges);
    expect(result?.targetNodeKey).toBe('next-node');
  });
});
