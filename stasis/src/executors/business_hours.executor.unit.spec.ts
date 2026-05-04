import { evaluateBusinessHours, executeBusinessHours } from './business_hours.executor';
import { FlowNode } from '../flowLoader';

describe('business_hours.executor', () => {
  it('returns open when current time is within configured schedule', () => {
    const result = evaluateBusinessHours(
      {
        timezone: 'Asia/Colombo',
        schedule: {
          friday: { enabled: true, open: '09:00', close: '17:00' },
        },
      },
      new Date('2026-04-17T05:00:00.000Z'),
    );

    expect(result).toBe('open');
  });

  it('returns closed when day is disabled', () => {
    const result = evaluateBusinessHours(
      {
        timezone: 'Asia/Colombo',
        schedule: {
          friday: { enabled: false, open: '09:00', close: '17:00' },
        },
      },
      new Date('2026-04-17T05:00:00.000Z'),
    );

    expect(result).toBe('closed');
  });

  it('returns closed when current time is outside schedule window', () => {
    const result = evaluateBusinessHours(
      {
        timezone: 'Asia/Colombo',
        schedule: {
          friday: { enabled: true, open: '09:00', close: '17:00' },
        },
      },
      new Date('2026-04-17T15:30:00.000Z'),
    );

    expect(result).toBe('closed');
  });

  it('executeBusinessHours uses node config and returns closed for invalid timezone', async () => {
    const node: FlowNode = {
      nodeKey: 'biz-hours-1',
      type: 'business_hours',
      label: 'Business Hours',
      config: {
        timezone: 'Invalid/Timezone',
        schedule: {
          friday: { enabled: true, open: '09:00', close: '17:00' },
        },
      },
    };

    await expect(executeBusinessHours(node)).resolves.toBe('closed');
  });
});
