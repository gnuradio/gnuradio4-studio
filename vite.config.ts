import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve as resolvePath } from 'node:path';

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const DEFAULT_GRCTRL_BASE_URL = 'http://127.0.0.1:8080';
const APP_API_BASE_PATH = '/api';

const WASM_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
};

function shouldProxyApiPath(url: string | undefined): boolean {
  return Boolean(url && (url === APP_API_BASE_PATH || url.startsWith(`${APP_API_BASE_PATH}/`)));
}

export function stripAppApiPrefix(url: string): string {
  if (!shouldProxyApiPath(url)) {
    return url;
  }

  const stripped = url.slice(APP_API_BASE_PATH.length);
  return stripped.length > 0 ? stripped : '/';
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_CONTROL_PLANE_BASE_URL || DEFAULT_GRCTRL_BASE_URL;
  const useWasmControlPlane = env.VITE_CONTROL_PLANE_TRANSPORT === 'wasm';
  const crossOriginIsolationHeaders = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  };

  return {
    base: mode === 'desktop' ? './' : '/',
    plugins: [
      react(),
      {
        name: 'gr4studio-wasm-assets',
        configureServer(server) {
          const wasmDir = resolvePath(process.cwd(), 'public', 'wasm');

          server.middlewares.use('/wasm', (req, res, next) => {
            const pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
            const filePath = join(wasmDir, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
            const contentType = WASM_ASSET_CONTENT_TYPES[extname(filePath)];

            if (!contentType || !filePath.startsWith(`${wasmDir}/`)) {
              next();
              return;
            }

            try {
              if (!statSync(filePath).isFile()) {
                next();
                return;
              }
            } catch {
              next();
              return;
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-cache');
            if (useWasmControlPlane) {
              for (const [header, value] of Object.entries(crossOriginIsolationHeaders)) {
                res.setHeader(header, value);
              }
            }
            createReadStream(filePath).pipe(res);
          });
        },
      },
      {
        name: 'gr4studio-runtime-http-proxy',
        configureServer(server) {
          server.middlewares.use('/__gr4studio/runtime-http-proxy', async (req, res) => {
            try {
              const requestUrl = new URL(req.url ?? '', 'http://localhost');
              const target = requestUrl.searchParams.get('target');

              if (!target) {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing target query parameter' }));
                return;
              }

              const parsedTarget = new URL(target);
              if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
                res.statusCode = 400;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ error: 'Unsupported target protocol' }));
                return;
              }

              const upstream = await fetch(parsedTarget.toString(), {
                method: 'GET',
                headers: {
                  Accept: 'application/json',
                },
              });

              const payload = await upstream.text();
              res.statusCode = upstream.status;
              res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json');
              res.end(payload);
            } catch (error) {
              res.statusCode = 502;
              res.setHeader('content-type', 'application/json');
              res.end(
                JSON.stringify({
                  error: error instanceof Error ? error.message : 'Proxy request failed',
                }),
              );
            }
          });
        },
      },
    ],
    server: {
      host: true,
      headers: useWasmControlPlane ? crossOriginIsolationHeaders : undefined,
      proxy: useWasmControlPlane
        ? undefined
        : {
            [APP_API_BASE_PATH]: {
              target: proxyTarget,
              changeOrigin: true,
              ws: true,
              rewrite: stripAppApiPrefix,
            },
          },
    },
    preview: {
      headers: useWasmControlPlane ? crossOriginIsolationHeaders : undefined,
    },
  };
});
