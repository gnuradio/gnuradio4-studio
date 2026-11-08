import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEV_SERVER_URL = 'http://127.0.0.1:5173';
const ELECTRON_FALLBACK = 'electron@35.6.0';
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8080';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok || response.status === 304) {
        return;
      }
    } catch {
      // Vite is still starting up.
    }

    await sleep(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

function spawnDetached(command, args, extraEnv = {}) {
  return spawn(command, args, {
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: 'inherit',
  });
}

async function main() {
  const projectRoot = process.cwd();
  await fs.access(path.join(projectRoot, 'package.json'));
  const backendUrl =
    process.env.GR4_STUDIO_CONTROL_PLANE_BASE_URL || process.env.GR4_CONTROL_PLANE_URL || DEFAULT_BACKEND_URL;

  const vite = spawnDetached('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
    GR4_STUDIO_DEV_SERVER_URL: DEV_SERVER_URL,
  });
  await waitForUrl(DEV_SERVER_URL);
  console.info(`[desktop:dev] Using backend ${backendUrl}`);

  const workspaceRoot = path.resolve(projectRoot, '..', '..');
  const sourceElectron = path.join(workspaceRoot, 'src', 'gr4-studio', 'node_modules', '.bin', 'electron');
  const electron = process.env.GR4_STUDIO_ELECTRON_BIN
    ? spawnDetached(process.env.GR4_STUDIO_ELECTRON_BIN, [projectRoot], {
        GR4_STUDIO_DEV_SERVER_URL: DEV_SERVER_URL,
        GR4_STUDIO_CONTROL_PLANE_BASE_URL: backendUrl,
      })
    : (await fs
        .stat(sourceElectron)
        .then(() =>
          spawnDetached(sourceElectron, [projectRoot], {
            GR4_STUDIO_DEV_SERVER_URL: DEV_SERVER_URL,
            GR4_STUDIO_CONTROL_PLANE_BASE_URL: backendUrl,
          }),
        )
        .catch(() =>
          spawnDetached('npx', ['--yes', ELECTRON_FALLBACK, projectRoot], {
            GR4_STUDIO_DEV_SERVER_URL: DEV_SERVER_URL,
            GR4_STUDIO_CONTROL_PLANE_BASE_URL: backendUrl,
          }),
        ));

  const stop = () => {
    vite.kill('SIGTERM');
    electron.kill('SIGTERM');
  };

  vite.on('exit', (code) => {
    electron.kill('SIGTERM');
    process.exitCode = code ?? 0;
  });

  electron.on('error', (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    stop();
    process.exitCode = 1;
  });

  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  process.on('SIGTERM', () => {
    stop();
    process.exit(143);
  });

  electron.on('exit', (code) => {
    vite.kill('SIGTERM');
    process.exitCode = code ?? 0;
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
