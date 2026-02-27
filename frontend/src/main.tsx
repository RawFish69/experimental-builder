import { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ErrorInfo } from 'react';
import '@/app/theme.css';
import { App } from '@/app/App';

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
        <div className="flex min-h-screen items-center justify-center p-6" style={{ background: '#070c14', color: '#e5f4ff' }}>
          <div className="max-w-xl rounded-2xl p-6" style={{ background: '#0f1725', border: '1px solid #2d3f58' }}>
            <div className="text-xl font-semibold">Something went wrong</div>
            <div className="mt-2 text-sm" style={{ color: '#93aac3' }}>
              {this.state.error?.message ?? 'Failed to load the app.'} Try refreshing the page.
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
