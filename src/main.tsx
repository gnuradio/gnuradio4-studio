import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { AppRoutes } from './app/routes';
import { config } from './lib/config';
import { installWasmApiTransport } from './lib/wasm/wasm-api-transport';
import { installWasmSinkTransport } from './lib/wasm/wasm-sink-transport';
import './styles/index.css';

if (import.meta.env.VITE_CONTROL_PLANE_TRANSPORT === 'wasm') {
  installWasmApiTransport(import.meta.env.VITE_CONTROL_PLANE_WASM_URL);
  installWasmSinkTransport();
  console.info('[config] Control plane transport: in-process WASM module');
}

const queryClient = new QueryClient();
const Router = window.location.protocol === 'file:' ? HashRouter : BrowserRouter;

type DesktopBootStatus = {
  phase: 'starting' | 'waiting-backend' | 'ready' | 'error';
  message: string;
  controlPlaneBaseUrl: string;
  backendMode: 'local' | 'remote' | 'unknown';
  source: 'default' | 'explicit';
  appServerOrigin?: string;
  probePath?: string;
  currentSessionRouting: 'app-api';
};

type FatalAppErrorProps = {
  error: unknown;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function FatalAppError({ error }: FatalAppErrorProps) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-10">
        <div className="w-full rounded-2xl border border-rose-900/70 bg-rose-950/30 p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-300">Renderer Startup Failed</p>
          <h1 className="mt-3 text-2xl font-semibold text-rose-100">gr4-studio could not render the application UI.</h1>
          <p className="mt-3 text-sm text-rose-200/90">
            Current-session traffic uses app-owned <code>/api/*</code> routes. Check the terminal for renderer logs and
            verify the backend and app shell configuration shown below.
          </p>
          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-200">
            <p>
              <span className="text-slate-400">Backend mode:</span> {config.backendMode}
            </p>
            <p>
              <span className="text-slate-400">Backend URL:</span> {config.controlPlaneBaseUrl}
            </p>
            <p>
              <span className="text-slate-400">Renderer origin:</span> {window.location.origin}
            </p>
            <p>
              <span className="text-slate-400">Current-session routing:</span> app-api via <code>/api/*</code>
            </p>
          </div>
          <pre className="mt-5 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-rose-200">
            {formatError(error)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function BootScreen({ status }: { status: DesktopBootStatus }) {
  const title =
    status.phase === 'error'
      ? 'Backend Startup Failed'
      : status.backendMode === 'local'
        ? 'Starting Local Backend'
        : 'Connecting to Backend';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-10">
        <div className="w-full rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/30">
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                status.phase === 'error' ? 'bg-rose-400' : 'animate-pulse bg-sky-400'
              }`}
            />
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">gr4-studio Startup</p>
          </div>
          <h1 className="mt-4 text-2xl font-semibold text-slate-100">{title}</h1>
          <p className="mt-3 text-sm text-slate-300">{status.message}</p>

          <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/80 p-4 text-sm text-slate-200">
            <p>
              <span className="text-slate-400">Backend mode:</span> {status.backendMode}
            </p>
            <p>
              <span className="text-slate-400">Backend source:</span> {status.source}
            </p>
            <p>
              <span className="text-slate-400">Backend URL:</span> {status.controlPlaneBaseUrl}
            </p>
            <p>
              <span className="text-slate-400">Current-session routing:</span> {status.currentSessionRouting} via{' '}
              <code>/api/*</code>
            </p>
            {status.appServerOrigin ? (
              <p>
                <span className="text-slate-400">App server origin:</span> {status.appServerOrigin}
              </p>
            ) : null}
            {status.probePath ? (
              <p>
                <span className="text-slate-400">Probe:</span> {status.probePath}
              </p>
            ) : null}
          </div>

          {status.phase === 'error' ? (
            <p className="mt-4 text-sm text-rose-300">
              The Studio window is open, but the backend did not become ready. Check the terminal and backend log for
              details.
            </p>
          ) : (
            <p className="mt-4 text-sm text-slate-400">The app will continue automatically once the backend is ready.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function useDesktopBootStatus(): DesktopBootStatus | null {
  const [status, setStatus] = React.useState<DesktopBootStatus | null>(null);

  React.useEffect(() => {
    if (!window.gr4StudioShell?.getBootStatus) {
      return undefined;
    }

    let cancelled = false;
    void window.gr4StudioShell.getBootStatus().then((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });

    const dispose = window.gr4StudioShell.onBootStatus?.((nextStatus) => {
      if (!cancelled) {
        setStatus(nextStatus);
      }
    });

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  return status;
}

function AppBootstrap() {
  const bootStatus = useDesktopBootStatus();
  const isDesktopBootManaged = Boolean(window.gr4StudioShell?.getBootStatus);
  const isDisplayApplicationRoute =
    window.location.pathname.startsWith('/app-runtime/') || window.location.hash.startsWith('#/app-runtime/');

  if (isDesktopBootManaged && !bootStatus && !isDisplayApplicationRoute) {
    return (
      <BootScreen
        status={{
          phase: 'starting',
          message: 'Opening gr4-studio…',
          controlPlaneBaseUrl: config.controlPlaneBaseUrl,
          backendMode: config.backendMode,
          source: config.source === 'desktop' ? 'explicit' : 'default',
          currentSessionRouting: 'app-api',
        }}
      />
    );
  }

  if (bootStatus && bootStatus.phase !== 'ready' && !isDisplayApplicationRoute) {
    return <BootScreen status={bootStatus} />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ReactFlowProvider>
          <AppRoutes />
        </ReactFlowProvider>
      </Router>
    </QueryClientProvider>
  );
}

type RootErrorBoundaryState = {
  error: unknown;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error('[gr4-studio] Renderer root crashed', error);
  }

  render() {
    if (this.state.error) {
      return <FatalAppError error={this.state.error} />;
    }

    return this.props.children;
  }
}

function renderFatalAppError(error: unknown) {
  const container = document.getElementById('root');
  if (!container) {
    throw error;
  }

  ReactDOM.createRoot(container).render(<FatalAppError error={error} />);
}

window.addEventListener('error', (event) => {
  console.error('[gr4-studio] Unhandled renderer error', event.error ?? event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[gr4-studio] Unhandled renderer promise rejection', event.reason);
});

try {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <RootErrorBoundary>
        <AppBootstrap />
      </RootErrorBoundary>
    </React.StrictMode>,
  );
} catch (error) {
  console.error('[gr4-studio] Renderer bootstrap failed', error);
  renderFatalAppError(error);
}
