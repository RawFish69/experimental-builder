import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ErrorInfo } from 'react';
import '@/app/theme.css';
import { App } from '@/app/App';
import { applyThemeMode, readStoredThemeMode } from '@/app/theme-mode';

class AppErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
  state = { hasError: false, error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App failed to render:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'var(--wb-bg-bottom)', color: 'var(--wb-text)' }}>
          <div className="max-w-xl rounded-2xl p-6" style={{ background: 'var(--wb-panel)', border: '1px solid var(--wb-border)' }}>
            <div className="text-xl font-semibold">Something went wrong</div>
            <div className="mt-2 text-sm" style={{ color: 'var(--wb-muted)' }}>
              {this.state.error?.message ?? 'Failed to load the app.'} Try refreshing the page.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

applyThemeMode(readStoredThemeMode());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
