import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('renders title + message when open=true', () => {
    render(
      <ConfirmDialog
        open={true}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders nothing when open=false', () => {
    const { container } = render(
      <ConfirmDialog
        open={false}
        title="Delete Item"
        message="Are you sure?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        message="M"
        onConfirm={onConfirm}
        onCancel={() => {}}
        confirmLabel="Yes"
      />
    );
    fireEvent.click(screen.getByText('Yes'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        message="M"
        onConfirm={() => {}}
        onCancel={onCancel}
        cancelLabel="No"
      />
    );
    fireEvent.click(screen.getByText('No'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders default labels if none provided', () => {
    render(
      <ConfirmDialog
        open={true}
        title="T"
        message="M"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    // Source defaults: confirmLabel = 'Leave', cancelLabel = 'Cancel'
    expect(screen.getByText('Leave')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  it('calls onCancel when Escape key is pressed', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        title="T"
        message="M"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
