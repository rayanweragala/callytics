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
});
