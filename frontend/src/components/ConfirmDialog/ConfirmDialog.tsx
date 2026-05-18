import { useEffect } from 'react';
import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  onConfirm: () => void;
  onSecondary?: () => void;
  onCancel: () => void;
  inline?: boolean;
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Leave',
  cancelLabel = 'Cancel',
  secondaryLabel,
  onConfirm,
  onSecondary,
  onCancel,
  inline = false,
  isLoading = false,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isLoading) {
          event.preventDefault();
          onCancel();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLoading, onCancel, open]);

  if (!open) {
    return null;
  }

  const dialogBody = (
    <div
      aria-describedby="confirm-dialog-message"
      aria-labelledby="confirm-dialog-title"
      aria-modal={inline ? undefined : true}
      className={inline ? styles.inlineDialog : styles.dialog}
      role={inline ? undefined : 'dialog'}
    >
      <div className={styles.content}>
        <h2 className={styles.title} id="confirm-dialog-title">{title}</h2>
        <p className={styles.message} id="confirm-dialog-message">{message}</p>
      </div>
      <div className={styles.actions}>
        <button
          className={styles.cancelButton}
          onClick={onCancel}
          type="button"
          disabled={isLoading}
        >
          {cancelLabel}
        </button>
        {secondaryLabel && onSecondary ? (
          <button
            className={styles.secondaryButton}
            onClick={onSecondary}
            type="button"
            disabled={isLoading}
          >
            {secondaryLabel}
          </button>
        ) : null}
        <button
          className={`${styles.confirmButton}${isLoading ? ` ${styles.confirmButtonLoading}` : ''}`}
          onClick={onConfirm}
          type="button"
          disabled={isLoading}
          aria-busy={isLoading}
        >
          <span className={styles.confirmButtonLabel}>{confirmLabel}</span>
          {isLoading ? <span className={styles.confirmSpinner} aria-hidden="true" /> : null}
        </button>
      </div>
    </div>
  );

  if (inline) {
    return <div className={styles.inlineWrapper}>{dialogBody}</div>;
  }

  return (
    <div className={styles.overlay} role="presentation">
      {dialogBody}
    </div>
  );
}
