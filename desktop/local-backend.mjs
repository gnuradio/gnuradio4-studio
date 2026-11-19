import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeExit({ code, signal, error }) {
  if (error) {
    return error.message;
  }
  if (signal) {
    return `terminated by signal ${signal}`;
  }
  return `exited with status ${code ?? 'unknown'}`;
}

function emitOutput(onOutput, stream, text) {
  try {
    onOutput?.({
      stream,
      text: String(text),
      receivedAt: new Date().toISOString(),
    });
  } catch {
    // Console consumers must not interfere with the managed process.
  }
}

async function appendLifecycleLog(logPath, message, onOutput) {
  const text = `[gr4-studio ${new Date().toISOString()}] ${message}\n`;
  try {
    await fs.appendFile(logPath, text, 'utf8');
  } catch {
    // Lifecycle logging must not mask the underlying backend failure.
  }
  emitOutput(onOutput, 'lifecycle', text);
}

// Windows environment names are case-insensitive and PATH usually arrives as "Path". Extending that key,
// rather than adding a "PATH" beside it, keeps the child from seeing two variables of which Node passes
// only one: the first in sort order, so that is the key to extend when several spellings are present.
function environmentKey(environment, name, platform) {
  if (platform !== 'win32') {
    return name;
  }
  return Object.keys(environment).filter((key) => key.toUpperCase() === name).sort()[0] ?? name;
}

function prependEnvironmentPath(environment, name, entries, platform) {
  const key = environmentKey(environment, name, platform);
  const existing = environment[key];
  const values = [...entries, ...(existing ? existing.split(path.delimiter) : [])].filter(Boolean);
  environment[key] = [...new Set(values)].join(path.delimiter);
}

// The first of the candidate log files whose directory can be created and written to. A system-wide
// install (/usr from a .deb, /usr/local/gnuradio4 on macOS, an all-users Windows install) has a
// prefix the user cannot write, so its var/logs is followed by a per-user fallback.
export async function chooseWritableLogPath(candidates) {
  for (const candidate of candidates.filter(Boolean)) {
    const directory = path.dirname(candidate);
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.access(directory, fs.constants.W_OK);
      return candidate;
    } catch {
      // try the next one
    }
  }
  throw new Error(`None of these log directories is writable: ${candidates.map((c) => path.dirname(c)).join(', ')}`);
}

export function buildLocalBackendEnvironment(prefix, baseEnvironment = process.env, platform = process.platform) {
  const environment = { ...baseEnvironment };
  if (!prefix) {
    return environment;
  }

  // Windows has no RPATH: the backend and the plugins find the prefix's DLLs through PATH
  prependEnvironmentPath(environment, 'PATH', [path.join(prefix, 'bin')], platform);
  prependEnvironmentPath(environment, 'CMAKE_PREFIX_PATH', [prefix], platform);
  prependEnvironmentPath(
    environment,
    'PKG_CONFIG_PATH',
    [path.join(prefix, 'lib', 'pkgconfig'), path.join(prefix, 'lib64', 'pkgconfig'), path.join(prefix, 'share', 'pkgconfig')],
    platform,
  );
  prependEnvironmentPath(environment, 'LD_LIBRARY_PATH', [path.join(prefix, 'lib'), path.join(prefix, 'lib64')], platform);
  prependEnvironmentPath(environment, 'DYLD_LIBRARY_PATH', [path.join(prefix, 'lib'), path.join(prefix, 'lib64')], platform);
  prependEnvironmentPath(environment, 'PYTHONPATH', [path.join(prefix, 'lib', 'python3', 'site-packages')], platform);
  prependEnvironmentPath(
    environment,
    'GNURADIO4_PLUGIN_DIRECTORIES',
    [path.join(prefix, 'lib', 'gnuradio-4', 'plugins'), path.join(prefix, 'lib')],
    platform,
  );
  environment.GR4_STUDIO_PREFIX = prefix;
  return environment;
}

export function parsePublishedPort(value) {
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`gr4cp_server published an invalid port: ${normalized || '(empty)'}`);
  }

  const port = Number(normalized);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`gr4cp_server published an invalid port: ${normalized}`);
  }
  return port;
}

export async function startLocalBackend({
  executable,
  args = [],
  environment = process.env,
  logPath,
  portFilePath,
  host = '127.0.0.1',
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  onOutput,
  onUnexpectedExit,
  spawnImpl = spawn,
}) {
  if (!executable || !logPath || !portFilePath) {
    throw new Error('Local backend executable, log path, and port file path are required.');
  }

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.mkdir(path.dirname(portFilePath), { recursive: true });
  await fs.rm(portFilePath, { force: true });
  const startupLine = `[gr4-studio ${new Date().toISOString()}] Starting managed control plane: ${executable}\n`;
  await fs.writeFile(logPath, startupLine, 'utf8');
  emitOutput(onOutput, 'lifecycle', startupLine);

  let ready = false;
  let stopping = false;
  let spawnError = null;
  let exitDetails = null;
  let resolveExited;
  const exited = new Promise((resolve) => {
    resolveExited = resolve;
  });
  let resolveFinalized;
  const finalized = new Promise((resolve) => {
    resolveFinalized = resolve;
  });

  const logStream = createWriteStream(logPath, { flags: 'a' });
  logStream.on('error', () => {
    // The diagnostics UI can report a log read failure; keep the backend alive.
  });
  let child;
  let synchronousSpawnError = null;
  try {
    child = spawnImpl(executable, args, {
      env: {
        ...environment,
        GR4CP_PORT: '0',
        GR4CP_PORT_FILE: portFilePath,
        GR4CP_STREAM_STDIO: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (chunk) => {
      emitOutput(onOutput, 'stdout', chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk) => {
      emitOutput(onOutput, 'stderr', chunk.toString('utf8'));
    });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    // Attach these before the first post-spawn await so an immediate exec
    // failure cannot become an unhandled ChildProcess error.
    child.once('error', (error) => {
      spawnError = error;
    });
    child.once('close', (code, signal) => {
      exitDetails = { code, signal, error: spawnError };
      resolveExited(exitDetails);
      void fs.rm(portFilePath, { force: true });
      logStream.end();
      void finished(logStream)
        .catch(() => undefined)
        .then(() => appendLifecycleLog(logPath, `Managed control plane ${describeExit(exitDetails)}.`, onOutput))
        .then(() => {
          if (ready && !stopping) {
            onUnexpectedExit?.(exitDetails);
          }
        })
        .finally(resolveFinalized);
    });
  } catch (error) {
    synchronousSpawnError = error;
  }

  if (synchronousSpawnError) {
    logStream.end();
    await finished(logStream).catch(() => undefined);
    const message = `Managed control plane failed during startup: ${synchronousSpawnError instanceof Error ? synchronousSpawnError.message : String(synchronousSpawnError)}`;
    await appendLifecycleLog(logPath, message, onOutput);
    throw new Error(message, { cause: synchronousSpawnError });
  }

  const stop = async () => {
    stopping = true;
    if (exitDetails) {
      await finalized;
      await fs.rm(portFilePath, { force: true });
      return exitDetails;
    }

    child.kill('SIGTERM');
    const graceful = await Promise.race([
      exited.then((details) => ({ details, timedOut: false })),
      sleep(shutdownTimeoutMs).then(() => ({ details: null, timedOut: true })),
    ]);
    if (graceful.timedOut && !exitDetails) {
      child.kill('SIGKILL');
    }
    const details = exitDetails ?? (await exited);
    await finalized;
    await fs.rm(portFilePath, { force: true });
    return details;
  };

  const deadline = Date.now() + startupTimeoutMs;
  let previousPublishedValue = null;
  try {
    while (Date.now() < deadline) {
      if (exitDetails || spawnError) {
        throw new Error(`Managed control plane failed during startup: ${describeExit(exitDetails ?? { error: spawnError })}`);
      }

      try {
        const publishedValue = (await fs.readFile(portFilePath, 'utf8')).trim();
        if (publishedValue) {
          parsePublishedPort(publishedValue);
          if (publishedValue === previousPublishedValue) {
            const port = parsePublishedPort(publishedValue);
            ready = true;
            await fs.rm(portFilePath, { force: true });
            return {
              baseUrl: `http://${host}:${port}`,
              port,
              logPath,
              executable,
              processId: child.pid ?? null,
              stop,
              waitForExit: () => exited,
              getExitDetails: () => exitDetails,
            };
          }
          previousPublishedValue = publishedValue;
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      await Promise.race([sleep(pollIntervalMs), exited]);
    }

    throw new Error(`Managed control plane did not publish a port within ${startupTimeoutMs} ms.`);
  } catch (error) {
    await stop();
    await appendLifecycleLog(logPath, error instanceof Error ? error.message : String(error), onOutput);
    throw error;
  }
}
