import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isSessionStreamWebSocketPath,
  probeBackendReady,
  resolveProxyTarget,
  rewriteIndexAssetUrls,
  startDesktopAppServer,
  stripAppApiPrefix,
} from './app-server.mjs';

describe('desktop app server routing', () => {
  it('enforces CSP on the editor and nested display application documents', async () => {
    const staticRoot = await mkdtemp(path.join(tmpdir(), 'gr4-studio-csp-'));
    let server;
    try {
      await writeFile(path.join(staticRoot, 'index.html'), '<script src="./assets/index.js"></script>');
      server = await startDesktopAppServer({ staticRoot, backendBaseUrl: 'http://127.0.0.1:8080' });

      for (const route of ['/', '/index.html', '/app-runtime/launch-1']) {
        const response = await fetch(`${server.origin}${route}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        const policy = response.headers.get('content-security-policy');
        expect(policy).toContain("script-src 'self';");
        expect(policy).not.toContain("'unsafe-eval'");
        expect(policy).toContain("connect-src 'self' http: https: ws: wss:");
        expect(await response.text()).toContain('<script src="/assets/index.js"></script>');
      }
    } finally {
      await server?.close();
      await rm(staticRoot, { recursive: true, force: true });
    }
  });

  it('strips the app-owned /api prefix for upstream requests', () => {
    expect(stripAppApiPrefix('/api/blocks')).toBe('/blocks');
    expect(stripAppApiPrefix('/api/sessions/sess_1/streams/stream_1/ws')).toBe(
      '/sessions/sess_1/streams/stream_1/ws',
    );
  });

  it('recognizes the current session websocket stream route surface', () => {
    expect(isSessionStreamWebSocketPath('/api/sessions/sess_1/streams/stream_1/ws')).toBe(true);
    expect(isSessionStreamWebSocketPath('/api/sessions/sess_1/streams/stream_1/http')).toBe(false);
    expect(isSessionStreamWebSocketPath('/api/blocks')).toBe(false);
  });

  it('rewrites app-owned websocket routes to backend targets', () => {
    expect(
      resolveProxyTarget(
        '/api/sessions/sess_1/streams/stream_1/ws?topic=plot',
        'http://127.0.0.1:8080',
      ).toString(),
    ).toBe('http://127.0.0.1:8080/sessions/sess_1/streams/stream_1/ws?topic=plot');
  });

  it('rewrites desktop index asset urls for nested application routes', () => {
    expect(
      rewriteIndexAssetUrls(
        '<script src="./assets/index.js"></script><link href="./assets/index.css"><link href="./favicon.ico">',
      ),
    ).toBe(
      '<script src="/assets/index.js"></script><link href="/assets/index.css"><link href="/favicon.ico">',
    );
  });

  it('waits for a valid block catalog instead of accepting health-only readiness', async () => {
    const requestedPaths = [];
    const fetchImpl = async (url) => {
      requestedPaths.push(new URL(url).pathname);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    await expect(
      probeBackendReady('http://127.0.0.1:8080', {
        attempts: 1,
        intervalMs: 0,
        fetchImpl,
      }),
    ).resolves.toEqual({ probePath: '/blocks', status: 200 });
    expect(requestedPaths).toEqual(['/blocks']);
  });

  it('rejects a successful response that is not a block catalog', async () => {
    await expect(
      probeBackendReady('http://127.0.0.1:8080', {
        attempts: 1,
        intervalMs: 0,
        fetchImpl: async () =>
          new Response(JSON.stringify({ status: 'healthy' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrow('invalid block catalog payload');
  });
});
