import React, { Component, ReactNode } from 'react';
import styles from './ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.boundary}>
          <h1>Something went wrong</h1>
          <p>We encountered an unexpected error. Please refresh the page or try again later.</p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details className={styles.details}>
              <summary>Error Details</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          )}
          <button onClick={() => window.location.reload()} type="button">
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
