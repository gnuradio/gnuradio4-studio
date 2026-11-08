import { afterEach, describe, expect, it, vi } from 'vitest';
import viteConfig, { stripAppApiPrefix } from './vite.config';

describe('desktop CSP', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('allows Vite inline scripts only in desktop development responses', async () => {
    const config = await viteConfig({ mode: 'desktop', command: 'serve' });
    const developmentPolicy = config.server?.headers?.['Content-Security-Policy'];
    const previewPolicy = config.preview?.headers?.['Content-Security-Policy'];
    expect(developmentPolicy).toContain("script-src 'self' 'unsafe-inline';");
    expect(previewPolicy).toContain("script-src 'self';");
    expect(developmentPolicy).not.toContain("'unsafe-eval'");
    expect(previewPolicy).not.toContain("'unsafe-eval'");
  });

  it('protects desktop development while retaining Vite development mode', async () => {
    vi.stubEnv('GR4_STUDIO_DEV_SERVER_URL', 'http://127.0.0.1:5173');
    const config = await viteConfig({ mode: 'development', command: 'serve' });
    expect(config.server?.headers?.['Content-Security-Policy']).toContain("script-src 'self' 'unsafe-inline';");
    expect(config.base).toBe('/');
  });

  it('keeps the policy scoped to desktop mode', async () => {
    vi.stubEnv('GR4_STUDIO_DEV_SERVER_URL', '');
    const config = await viteConfig({ mode: 'development', command: 'serve' });
    expect(config.server?.headers?.['Content-Security-Policy']).toBeUndefined();
    expect(config.preview?.headers?.['Content-Security-Policy']).toBeUndefined();
  });
});

describe('stripAppApiPrefix', () => {
  it('rewrites app-owned api routes to upstream control-plane routes', () => {
    expect(stripAppApiPrefix('/api/blocks')).toBe('/blocks');
    expect(stripAppApiPrefix('/api/sessions/sess_1/start')).toBe('/sessions/sess_1/start');
    expect(stripAppApiPrefix('/api/sessions/sess_1/streams/stream_1/ws')).toBe(
      '/sessions/sess_1/streams/stream_1/ws',
    );
  });

  it('leaves non-api routes unchanged', () => {
    expect(stripAppApiPrefix('/__gr4studio/runtime-http-proxy')).toBe('/__gr4studio/runtime-http-proxy');
    expect(stripAppApiPrefix('/assets/index.js')).toBe('/assets/index.js');
  });
});
