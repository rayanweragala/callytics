import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MosGauge } from './MosGauge';

describe('MosGauge', () => {
  it('renders label, value, plain label and clamped fill', () => {
    const { container } = render(
      <MosGauge
        label="Jitter"
        value={12.345}
        unit="ms"
        plainLabel="slight"
        fillPct={120}
        grade="fair"
      />,
    );

    expect(screen.getByText('Jitter')).toBeInTheDocument();
    expect(screen.getByText('12.35ms')).toBeInTheDocument();
    expect(screen.getByText('slight')).toBeInTheDocument();

    const fill = container.querySelector('div[style*="width"]') as HTMLDivElement;
    expect(fill.style.width).toBe('100%');
  });
});
