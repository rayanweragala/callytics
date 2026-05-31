import { useState } from 'react';
import type { ToastItem } from '../context/ToastContext';
import styles from './Toast.module.css';

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

const TYPE_CLASS: Record<ToastItem['type'], string> = {
  success: styles.toastSuccess,
  error: styles.toastError,
  warning: styles.toastWarning,
};

export function Toast({ toast, onDismiss }: ToastProps) {
  const [dismissing, setDismissing] = useState(false);

  const handleDismiss = () => {
    setDismissing(true);
  };

  const handleAnimationEnd = () => {
    if (dismissing) {
      onDismiss(toast.id);
    }
  };

  return (
    <div
      className={`${styles.toast} ${TYPE_CLASS[toast.type]} ${dismissing ? styles.dismissing : ''}`}
      onAnimationEnd={handleAnimationEnd}
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
    >
      <span className={styles.message}>{toast.message}</span>
      <button
        className={styles.closeButton}
        onClick={handleDismiss}
        type="button"
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
