import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalBackendEnvironment, parsePublishedPort, startLocalBackend } from './local-backend.mjs';

const temporaryDirectories = [];
const runningBackends = [];

async function createBackendPaths() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gr4-studio-local-backend-'));
  temporaryDirectories.push(directory);
  return {
    logPath: path.join(directory, 'gr4cp_server.log'),
    portFilePath: path.join(directory, 'gr4cp_server.port'),
  };
}

afterEach(async () => {
  await Promise.all(runningBackends.splice(0).map((backend) => backend.stop()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe('managed local backend', () => {
  it('validates published ports', () => {
    expect(parsePublishedPort('53029\n')).toBe(53029);
    expect(() => parsePublishedPort('0')).toThrow('invalid port');
    expect(() => parsePublishedPort('65536')).toThrow('invalid port');
    expect(() => parsePublishedPort('12x')).toThrow('invalid port');
  });

  it('constructs a prefix-aware child environment without losing existing paths', () => {
    const environment = buildLocalBackendEnvironment('/opt/gr4', {
      PATH: '/usr/bin',
      GNURADIO4_PLUGIN_DIRECTORIES: '/custom/plugins',
    });

    expect(environment.PATH?.split(path.delimiter)).toEqual(['/opt/gr4/bin', '/usr/bin']);
    expect(environment.GNURADIO4_PLUGIN_DIRECTORIES?.split(path.delimiter)).toEqual([
      '/opt/gr4/lib/gnuradio-4/plugins',
      '/opt/gr4/lib',
      '/custom/plugins',
    ]);
  });

  it('captures output and stops the process it owns', async () => {
    const paths = await createBackendPaths();
    const script = [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.env.GR4CP_PORT_FILE, '43123\\n');",
      "console.log('stdout marker');",
      "console.error('stderr marker');",
      'setInterval(() => {}, 1000);',
    ].join('');

    const backend = await startLocalBackend({
      executable: process.execPath,
      args: ['-e', script],
      logPath: paths.logPath,
      portFilePath: paths.portFilePath,
      pollIntervalMs: 10,
      startupTimeoutMs: 2_000,
    });
    runningBackends.push(backend);

    expect(backend.baseUrl).toBe('http://127.0.0.1:43123');
    await backend.stop();
    runningBackends.splice(runningBackends.indexOf(backend), 1);
    const log = await fs.readFile(paths.logPath, 'utf8');
    expect(log).toContain('stdout marker');
    expect(log).toContain('stderr marker');
  });

  it('turns an immediate executable failure into a startup error', async () => {
    const paths = await createBackendPaths();

    await expect(
      startLocalBackend({
        executable: path.join(paths.logPath, 'missing-gr4cp-server'),
        logPath: paths.logPath,
        portFilePath: paths.portFilePath,
        pollIntervalMs: 10,
        startupTimeoutMs: 500,
      }),
    ).rejects.toThrow('Managed control plane failed during startup');
  });

  it('reports an unexpected post-start exit', async () => {
    const paths = await createBackendPaths();
    let resolveUnexpectedExit;
    const unexpectedExit = new Promise((resolve) => {
      resolveUnexpectedExit = resolve;
    });
    const script = [
      "const fs = require('node:fs');",
      "fs.writeFileSync(process.env.GR4CP_PORT_FILE, '43124\\n');",
      'setTimeout(() => process.exit(7), 150);',
    ].join('');

    const backend = await startLocalBackend({
      executable: process.execPath,
      args: ['-e', script],
      logPath: paths.logPath,
      portFilePath: paths.portFilePath,
      pollIntervalMs: 10,
      startupTimeoutMs: 2_000,
      onUnexpectedExit: resolveUnexpectedExit,
    });
    runningBackends.push(backend);

    await expect(unexpectedExit).resolves.toMatchObject({ code: 7, signal: null });
  });
});
