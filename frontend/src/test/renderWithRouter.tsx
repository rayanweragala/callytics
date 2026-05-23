import { render, type RenderOptions } from '@testing-library/react';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

interface RenderWithRouterOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: string[];
}

import { ToastProvider } from '../context/ToastContext';

function RouterWrapper({ children, initialEntries }: { children: ReactNode; initialEntries: string[] }) {
  return (
    <MemoryRouter
      initialEntries={initialEntries}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ToastProvider>
        {children}
      </ToastProvider>
    </MemoryRouter>
  );
}

export function renderWithRouter(
  ui: ReactElement,
  { initialEntries = ['/'], ...options }: RenderWithRouterOptions = {},
) {
  return render(ui, {
    wrapper: ({ children }) => <RouterWrapper initialEntries={initialEntries}>{children}</RouterWrapper>,
    ...options,
  });
}
