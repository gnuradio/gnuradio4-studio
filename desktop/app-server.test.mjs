import { describe, expect, it } from 'vitest';
import {
  isSessionStreamWebSocketPath,
  probeBackendReady,
  resolveProxyTarget,
  rewriteIndexAssetUrls,
  stripAppApiPrefix,
} from './app-server.mjs';

describe('desktop app server routing', () => {
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
