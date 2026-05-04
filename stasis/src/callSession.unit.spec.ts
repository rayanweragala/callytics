import { addSession, createSession, getSession, removeSession } from './callSession';

describe('callSession', () => {
  beforeEach(() => {
    removeSession('c1');
    removeSession('c2');
    removeSession('c3');
    removeSession('cA');
    removeSession('cB');
  });

  it('createSession returns a session with the expected shape', () => {
    const sess = createSession('c1', '1000', { id: 1, name: 'f1' } as any, 'start_1');
    expect(sess).toEqual(expect.objectContaining({
      callUuid: 'c1',
      channelId: 'c1',
      callerNumber: '1000',
      currentNodeKey: 'start_1',
      variables: {},
    }));
    expect(sess.flow.id).toBe(1);
    expect(sess.startedAt).toBeInstanceOf(Date);
  });

  it('addSession stores it; getSession retrieves it by call_uuid', () => {
    const sess = createSession('c2', '1000', { id: 1 } as any, 's1');
    addSession(sess);
    expect(getSession('c2')).toBe(sess);
  });

  it('removeSession deletes it; subsequent getSession returns undefined', () => {
    const sess = createSession('c3', '1000', { id: 1 } as any, 's1');
    addSession(sess);
    removeSession('c3');
    expect(getSession('c3')).toBeUndefined();
  });

  it('two sessions do not overwrite each other', () => {
    const sA = createSession('cA', '1', { id: 1 } as any, 's1');
    const sB = createSession('cB', '2', { id: 1 } as any, 's1');
    addSession(sA);
    addSession(sB);
    expect(getSession('cA')).toBe(sA);
    expect(getSession('cB')).toBe(sB);
  });
});
