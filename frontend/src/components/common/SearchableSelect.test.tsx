import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SearchableSelect } from './SearchableSelect';

describe('SearchableSelect', () => {
  const options = [
    { value: '1', label: 'Option One' },
    { value: '2', label: 'Option Two' },
    { value: '3', label: 'Other' },
  ];

  it('renders placeholder when no value selected', () => {
    render(<SearchableSelect options={options} value={null} onChange={() => {}} placeholder="Choose..." />);
    expect(screen.getByText('Choose...')).toBeInTheDocument();
  });

  it('renders selected option label', () => {
    render(<SearchableSelect options={options} value="1" onChange={() => {}} />);
    expect(screen.getByText('Option One')).toBeInTheDocument();
  });

  it('opens dropdown and filters options when typing', () => {
    render(<SearchableSelect options={options} value={null} onChange={() => {}} placeholder="Choose..." />);
    fireEvent.click(screen.getByText('Choose...'));
    
    const input = screen.getByPlaceholderText('search…');
    fireEvent.change(input, { target: { value: 'Two' } });
    
    expect(screen.queryByText('Option One')).not.toBeInTheDocument();
    expect(screen.getByText('Option Two')).toBeInTheDocument();
  });

  it('calls onChange with correct value on option click', () => {
    const onChange = vi.fn();
    render(<SearchableSelect options={options} value={null} onChange={onChange} placeholder="Choose..." />);
    fireEvent.click(screen.getByText('Choose...'));
    
    // Select from options, not trigger
    const option = screen.getAllByRole('button').find(b => b.textContent === 'Option Two');
    if (option) fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('closes dropdown when clicking outside', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <SearchableSelect options={options} value={null} onChange={() => {}} placeholder="Choose..." />
      </div>
    );
    fireEvent.click(screen.getByText('Choose...'));
    expect(screen.getByPlaceholderText('search…')).toBeInTheDocument();
    
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByPlaceholderText('search…')).not.toBeInTheDocument();
  });

  it('handles empty options list', () => {
    render(<SearchableSelect options={[]} value={null} onChange={() => {}} placeholder="Choose..." />);
    fireEvent.click(screen.getByText('Choose...'));
    // In current implementation, first option is always the placeholder (to clear)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(1);
  });
});
