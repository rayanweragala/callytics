import { createPortal } from 'react-dom';
import { Toast } from './Toast';
import { useToastContext } from '../context/ToastContext';

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  alignItems: 'flex-end',
  pointerEvents: 'none',
};

export function ToastContainer() {
  const { toasts, dismissToast } = useToastContext();

  if (toasts.length === 0) return null;

  return createPortal(
    <div style={containerStyle} aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
    </div>,
    document.body,
  );
}
