// Routes the studio's /api/* traffic into the in-process control plane instead of over HTTP.

import { loadControlPlaneWasm, type Gr4cpResponse } from './control-plane-wasm';

const APP_API_BASE_PATH = '/api';

export function isAppApiPath(pathname: string): boolean {
  return pathname === APP_API_BASE_PATH || pathname.startsWith(`${APP_API_BASE_PATH}/`);
}

export function stripAppApiPrefix(pathname: string): string {
  if (!isAppApiPath(pathname)) {
    return pathname;
  }

  const stripped = pathname.slice(APP_API_BASE_PATH.length);
  return stripped.length > 0 ? stripped : '/';
}

function toResponse(result: Gr4cpResponse): Response {
  const body = result.status === 204 || result.status === 205 ? null : result.body;
  const headers = new Headers();
  if (result.contentType) {
    headers.set('content-type', result.contentType);
  }

  return new Response(body, { status: result.status, headers });
}

function resolveUrl(input: RequestInfo | URL): URL {
  const base = typeof window === 'undefined' ? 'http://localhost' : window.location.href;
  if (typeof input === 'string') {
    return new URL(input, base);
  }
  if (input instanceof URL) {
    return input;
  }
  return new URL(input.url, base);
}

async function resolveBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (init?.body != null) {
    return typeof init.body === 'string' ? init.body : await new Response(init.body).text();
  }
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return await input.clone().text();
  }
  return '';
}

function resolveMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return input.method.toUpperCase();
  }
  return 'GET';
}


// Wrap `globalThis.fetch` so /api/* requests are served by the WASM control plane
export function installWasmApiTransport(moduleUrl?: string): () => void {
  const originalFetch = globalThis.fetch.bind(globalThis);

  const patchedFetch: typeof fetch = async (input, init) => {
    const url = resolveUrl(input);

    if (url.origin !== window.location.origin || !isAppApiPath(url.pathname)) {
      return originalFetch(input as RequestInfo, init);
    }

    const module = await loadControlPlaneWasm(moduleUrl);
    const target = `${stripAppApiPrefix(url.pathname)}${url.search}`;

    return toResponse(module.handleRequest(resolveMethod(input, init), target, await resolveBody(input, init)));
  };

  globalThis.fetch = patchedFetch;

  return () => {
    if (globalThis.fetch === patchedFetch) {
      globalThis.fetch = originalFetch;
    }
  };
}
