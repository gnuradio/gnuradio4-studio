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
// Non-null once a transport is installed: the studio talks to the in-process module instead of HTTP.
let transportModuleUrl: string | null = null;
let binarySizeBytes: number | null = null;
const binarySizeListeners = new Set<() => void>();

// Called by the transports at install time: the module is not loaded yet, but it is the backend now.
export function markControlPlaneWasmEnabled(moduleUrl: string = DEFAULT_WASM_MODULE_URL): void {
  transportModuleUrl ??= moduleUrl;
}

export function isControlPlaneWasmEnabled(): boolean {
  return transportModuleUrl !== null;
}

export function getControlPlaneWasmModuleUrl(): string | null {
  return transportModuleUrl;
}

// Emscripten emits the binary next to its glue module, under the same base name.
export function controlPlaneWasmBinaryUrl(moduleUrl: string): string {
  return moduleUrl.replace(/\.m?js$/, '') + '.wasm';
}

// Byte size of the loaded .wasm binary, or null until it has been measured.
export function getControlPlaneWasmBinarySize(): number | null {
  return binarySizeBytes;
}

export function subscribeToControlPlaneWasmBinarySize(listener: () => void): () => void {
  binarySizeListeners.add(listener);
  return () => {
    binarySizeListeners.delete(listener);
  };
}

function setBinarySize(bytes: number | null): void {
  if (bytes === binarySizeBytes) {
    return;
  }
  binarySizeBytes = bytes;
  binarySizeListeners.forEach((listener) => {
    listener();
  });
}

function resolveHref(url: string): string {
  try {
    return new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.href).href;
  } catch {
    return url;
  }
}

// The dev server streams the binary without a Content-Length, so resource timing is the reliable
// source; it also costs no extra request, since the binary has just been fetched.
function readSizeFromResourceTiming(binaryUrl: string): number | null {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
    return null;
  }

  const href = resolveHref(binaryUrl);
  const entries = performance
    .getEntriesByType('resource')
    .filter((candidate): candidate is PerformanceResourceTiming => candidate.name.split('?')[0] === href);
  const entry = entries[entries.length - 1];
  if (!entry) {
    return null;
  }

  const size = entry.decodedBodySize || entry.encodedBodySize || entry.transferSize;
  return size > 0 ? size : null;
}

async function readSizeFromHeadRequest(binaryUrl: string): Promise<number | null> {
  try {
    const response = await fetch(binaryUrl, { method: 'HEAD' });
    const length = Number(response.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

async function measureBinarySize(moduleUrl: string): Promise<void> {
  const binaryUrl = controlPlaneWasmBinaryUrl(moduleUrl);
  setBinarySize(readSizeFromResourceTiming(binaryUrl) ?? (await readSizeFromHeadRequest(binaryUrl)));
}

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
  if (modulePromise === null) {
    modulePromise = instantiate(moduleUrl).then(
      (module) => {
        void measureBinarySize(moduleUrl);
        return module;
      },
      (error: unknown) => {
        // Let a later attempt retry instead of caching the rejection forever.
        modulePromise = null;
        throw error;
      },
    );
  }

  return modulePromise;
}

export function resetControlPlaneWasmForTests(): void {
  modulePromise = null;
  transportModuleUrl = null;
  binarySizeBytes = null;
}
