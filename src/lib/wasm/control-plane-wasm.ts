// Loader for the WASM build of gnuradio4-control-plane.

export type Gr4cpResponse = {
  status: number;
  contentType: string;
  body: string;
};

export type Gr4cpSinkSnapshot = {
  sequence: number;
  kind: 'text' | 'binary';
  payload: string | Uint8Array;
};

export type Gr4cpModule = {
  handleRequest(method: string, target: string, body: string): Gr4cpResponse;
  initialize(): Gr4cpResponse;
  studioSinkEndpoints?: () => string[];
  studioSinkSnapshot?: (endpoint: string) => Gr4cpSinkSnapshot | null;
};

type Gr4cpModuleFactory = (options?: Record<string, unknown>) => Promise<Gr4cpModule>;

export const DEFAULT_WASM_MODULE_URL = '/wasm/gr4cp_wasm.mjs';

let modulePromise: Promise<Gr4cpModule> | null = null;

export function isCrossOriginIsolated(): boolean {
  return typeof globalThis.crossOriginIsolated === 'boolean' ? globalThis.crossOriginIsolated : false;
}

async function instantiate(moduleUrl: string): Promise<Gr4cpModule> {
  if (!isCrossOriginIsolated()) {
    throw new Error(
      'The control plane WASM module is built with pthreads and needs SharedArrayBuffer. ' +
        'Serve the page cross-origin isolated (Cross-Origin-Opener-Policy: same-origin and ' +
        'Cross-Origin-Embedder-Policy: require-corp).',
    );
  }

  const glue = (await import(/* @vite-ignore */ moduleUrl)) as { default: Gr4cpModuleFactory };
  const instance = await glue.default();

  const health = instance.initialize();
  if (health.status !== 200) {
    throw new Error(`Control plane WASM module failed to initialize: ${health.status} ${health.body}`);
  }

  return instance;
}

export function loadControlPlaneWasm(moduleUrl: string = DEFAULT_WASM_MODULE_URL): Promise<Gr4cpModule> {
  modulePromise ??= instantiate(moduleUrl).catch((error: unknown) => {
    // Let a later attempt retry instead of caching the rejection forever.
    modulePromise = null;
    throw error;
  });

  return modulePromise;
}

export function resetControlPlaneWasmForTests(): void {
  modulePromise = null;
}
