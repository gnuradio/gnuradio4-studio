import { createServer, request as httpRequest } from 'node:http';
import fs from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import path from 'node:path';

const APP_API_BASE_PATH = '/api';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout(signal, timeoutMs) {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener(
      'abort',
      () => {
        controller.abort();
      },
      { once: true },
    );
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(handle);
    },
  };
}

async function readRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export function rewriteIndexAssetUrls(html) {
  return html.replace(/\b(src|href)="\.\/([^"]+)"/g, (_match, attribute, assetPath) => {
    return `${attribute}="/${assetPath}"`;
  });
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function buildProxyRequestHeaders(requestHeaders, body) {
  return {
    Accept: firstHeaderValue(requestHeaders.accept) ?? 'application/json',
    ...(firstHeaderValue(requestHeaders['content-type'])
      ? { 'Content-Type': firstHeaderValue(requestHeaders['content-type']) }
      : {}),
    ...(body ? { 'Content-Length': String(body.length) } : {}),
  };
}

function proxyHttpRequest(targetUrl, method, headers, body) {
  return new Promise((resolve, reject) => {
    const requestImpl = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const upstream = requestImpl(
      targetUrl,
      {
        method,
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 502,
            headers: response.headers,
            payload: Buffer.concat(chunks),
          });
        });
        response.on('error', reject);
      },
    );

    upstream.on('error', reject);

    if (body && body.length > 0) {
      upstream.write(body);
    }

    upstream.end();
  });
}

export function stripAppApiPrefix(pathname) {
  if (pathname === APP_API_BASE_PATH) {
    return '/';
  }

  if (pathname.startsWith(`${APP_API_BASE_PATH}/`)) {
    return pathname.slice(APP_API_BASE_PATH.length);
  }

  return pathname;
}

export function isSessionStreamWebSocketPath(pathname) {
  return /^\/api\/sessions\/[^/]+\/streams\/[^/]+\/ws$/.test(pathname);
}

export function resolveProxyTarget(requestUrl, backendBaseUrl) {
  const parsedRequestUrl = new URL(requestUrl, 'http://127.0.0.1');
  const targetUrl = new URL(stripAppApiPrefix(parsedRequestUrl.pathname), backendBaseUrl);
  targetUrl.search = parsedRequestUrl.search;
  return targetUrl;
}

async function proxyApiRequest(req, res, backendBaseUrl) {
  const targetUrl = resolveProxyTarget(req.url ?? '/', backendBaseUrl);

  const requestBody =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await readRequestBody(req);

  const upstream = await proxyHttpRequest(
    targetUrl,
    req.method ?? 'GET',
    buildProxyRequestHeaders(req.headers, requestBody && requestBody.length > 0 ? requestBody : undefined),
    requestBody && requestBody.length > 0 ? requestBody : undefined,
  );

  res.statusCode = upstream.statusCode;

  const contentType = Array.isArray(upstream.headers['content-type'])
    ? upstream.headers['content-type'][0]
    : upstream.headers['content-type'];
  if (contentType) {
    res.setHeader('content-type', contentType);
  }

  const cacheControl = Array.isArray(upstream.headers['cache-control'])
    ? upstream.headers['cache-control'][0]
    : upstream.headers['cache-control'];
  if (cacheControl) {
    res.setHeader('cache-control', cacheControl);
  }

  const location = Array.isArray(upstream.headers.location)
    ? upstream.headers.location[0]
    : upstream.headers.location;
  if (location) {
    res.setHeader('location', location);
  }

  res.setHeader('content-length', String(upstream.payload.length));
  res.end(upstream.payload);
}

function writeProxySocketError(socket, statusCode, statusMessage) {
  if (!socket.writable) {
    socket.destroy();
    return;
  }

  socket.write(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
}

function proxyWebSocketUpgrade(req, socket, head, backendBaseUrl) {
  const targetUrl = resolveProxyTarget(req.url ?? '/', backendBaseUrl);
  const requestImpl = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstreamRequest = requestImpl(targetUrl, {
    method: req.method ?? 'GET',
    headers: {
      ...req.headers,
      host: targetUrl.host,
      connection: 'Upgrade',
      upgrade: 'websocket',
    },
  });

  upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
    const statusCode = upstreamResponse.statusCode ?? 101;
    const statusMessage = upstreamResponse.statusMessage ?? 'Switching Protocols';
    socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);

    for (const [headerName, headerValue] of Object.entries(upstreamResponse.headers)) {
      if (!headerValue) {
        continue;
      }

      socket.write(`${headerName}: ${Array.isArray(headerValue) ? headerValue.join(', ') : headerValue}\r\n`);
    }

    socket.write('\r\n');

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    if (upstreamHead.length > 0) {
      socket.write(upstreamHead);
    }

    upstreamSocket.on('error', () => {
      socket.destroy();
    });
    socket.on('error', () => {
      upstreamSocket.destroy();
    });

    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstreamRequest.on('response', (upstreamResponse) => {
    upstreamResponse.resume();
    writeProxySocketError(socket, upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage ?? 'Bad Gateway');
  });

  upstreamRequest.on('error', () => {
    writeProxySocketError(socket, 502, 'Bad Gateway');
  });

  upstreamRequest.end();
}

async function serveStaticAsset(req, res, staticRoot) {
  const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
  const pathname = decodeURIComponent(requestUrl.pathname);
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = path.resolve(staticRoot, relativePath);
  const normalizedRoot = path.resolve(staticRoot);

  if (
    !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`) &&
    resolvedPath !== path.join(normalizedRoot, 'index.html')
  ) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  try {
    const payload =
      path.basename(resolvedPath) === 'index.html'
        ? Buffer.from(rewriteIndexAssetUrls(await fs.readFile(resolvedPath, 'utf8')))
        : await fs.readFile(resolvedPath);
    res.statusCode = 200;
    res.setHeader('content-type', getContentType(resolvedPath));
    res.end(payload);
  } catch {
    if (!path.extname(relativePath)) {
      const fallbackPath = path.join(staticRoot, 'index.html');
      const payload = Buffer.from(rewriteIndexAssetUrls(await fs.readFile(fallbackPath, 'utf8')));
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(payload);
      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
  }
}

export async function probeBackendReady(
  backendBaseUrl,
  { attempts = 60, intervalMs = 500, requestTimeoutMs = 1_500, fetchImpl = fetch } = {},
) {
  let lastError = 'No successful response received.';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const probePath = '/blocks';
    const targetUrl = new URL(probePath, backendBaseUrl);
    const timeout = withTimeout(undefined, requestTimeoutMs);

    try {
      const response = await fetchImpl(targetUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: timeout.signal,
      });

      if (!response.ok) {
        lastError = `${targetUrl} returned ${response.status} ${response.statusText}`;
      } else {
        const payload = await response.json();
        const blocks = Array.isArray(payload) ? payload : payload?.blocks;
        if (!Array.isArray(blocks)) {
          lastError = `${targetUrl} returned an invalid block catalog payload`;
        } else {
          return { probePath, status: response.status };
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      timeout.dispose();
    }

    if (attempt < attempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `Backend ${backendBaseUrl} did not become reachable after ${attempts} attempts. Last error: ${lastError}`,
  );
}

export async function startDesktopAppServer({
  backendBaseUrl,
  staticRoot,
  host = '127.0.0.1',
} = {}) {
  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname === APP_API_BASE_PATH || requestUrl.pathname.startsWith(`${APP_API_BASE_PATH}/`)) {
        await proxyApiRequest(req, res, backendBaseUrl);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end('Method Not Allowed');
        return;
      }

      await serveStaticAsset(req, res, staticRoot);
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'Desktop app server request failed',
        }),
      );
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!isSessionStreamWebSocketPath(requestUrl.pathname)) {
        writeProxySocketError(socket, 404, 'Not Found');
        return;
      }

      proxyWebSocketUpgrade(req, socket, head, backendBaseUrl);
    } catch {
      writeProxySocketError(socket, 502, 'Bad Gateway');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      resolve(undefined);
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Desktop app server failed to bind a TCP port.');
  }

  return {
    origin: `http://${host}:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(undefined);
        });
      });
    },
  };
}
