import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LiveDot } from './LiveDot';

describe('LiveDot', () => {
  it('renders without crashing', () => {
    const { container } = render(<LiveDot active={true} />);
    expect(container.firstChild).toBeInTheDocument();
  });
});
