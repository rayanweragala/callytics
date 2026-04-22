import { getSipVerdict } from './sipVerdict';
import type { SipPacket } from '../types';

const basePacket = (method: string): SipPacket => ({
  id: '1-0',
  timestamp: '10:00:00.000',
  method,
  from: '<sip:1001@example.com>',
  to: '<sip:2001@example.com>',
  callId: 'call-1',
  direction: 'in',
  rawJson: '{}',
});

describe('getSipVerdict', () => {
  it('INVITE -> 200 -> BYE => green completed normally', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('200'), basePacket('BYE')]);
    expect(verdict.message).toContain('completed normally');
    expect(verdict.colour).toBe('green');
  });

  it('INVITE -> 200 and no BYE => amber dropped', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('200')]);
    expect(verdict.message).toContain('no BYE');
    expect(verdict.colour).toBe('amber');
  });

  it('INVITE -> 486 => amber busy', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('486')]);
    expect(verdict.message).toContain('busy');
    expect(verdict.colour).toBe('amber');
  });

  it('INVITE -> 404 => red not found', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('404')]);
    expect(verdict.message).toContain('Number not found');
    expect(verdict.colour).toBe('red');
  });

  it('INVITE -> 408 => red timeout', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('408')]);
    expect(verdict.message).toContain('timeout');
    expect(verdict.colour).toBe('red');
  });

  it('INVITE -> 403 => red forbidden credentials', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('403')]);
    expect(verdict.message).toContain('Forbidden');
    expect(verdict.colour).toBe('red');
  });

  it('INVITE -> 503 => red service unavailable', () => {
    const verdict = getSipVerdict([basePacket('INVITE'), basePacket('503')]);
    expect(verdict.message).toContain('Service unavailable');
    expect(verdict.colour).toBe('red');
  });

  it('INVITE with no response => red nat/firewall', () => {
    const verdict = getSipVerdict([basePacket('INVITE')]);
    expect(verdict.message).toContain('No response');
    expect(verdict.colour).toBe('red');
  });

  it('REGISTER -> 200 => green registered', () => {
    const verdict = getSipVerdict([basePacket('REGISTER'), basePacket('200')]);
    expect(verdict.message).toContain('registered successfully');
    expect(verdict.colour).toBe('green');
  });

  it('REGISTER -> 401/407 => red wrong password', () => {
    const verdict = getSipVerdict([basePacket('REGISTER'), basePacket('401')]);
    expect(verdict.message).toContain('wrong password');
    expect(verdict.colour).toBe('red');
  });

  it('REGISTER -> 403 => red registration forbidden', () => {
    const verdict = getSipVerdict([basePacket('REGISTER'), basePacket('403')]);
    expect(verdict.message).toContain('Registration forbidden');
    expect(verdict.colour).toBe('red');
  });
});
