import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalBackendEnvironment, chooseWritableLogPath, parsePublishedPort, startLocalBackend } from './local-backend.mjs';

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
    const environment = buildLocalBackendEnvironment(
      '/opt/gr4',
      {
        PATH: '/usr/bin',
        GNURADIO4_PLUGIN_DIRECTORIES: '/custom/plugins',
      },
      'linux',
    );

    expect(environment.PATH?.split(path.delimiter)).toEqual([path.join('/opt/gr4', 'bin'), '/usr/bin']);
    expect(environment.GNURADIO4_PLUGIN_DIRECTORIES?.split(path.delimiter)).toEqual([
      path.join('/opt/gr4', 'lib', 'gnuradio-4', 'plugins'),
      path.join('/opt/gr4', 'lib'),
      '/custom/plugins',
    ]);
  });

  it('extends the existing Windows Path variable instead of adding a second PATH', () => {
    const systemDirectory = path.join('/windows', 'system32');
    const environment = buildLocalBackendEnvironment('/opt/gr4', { Path: systemDirectory }, 'win32');

    expect(Object.keys(environment).filter((key) => key.toUpperCase() === 'PATH')).toEqual(['Path']);
    expect(environment.Path?.split(path.delimiter)).toEqual([
      path.join('/opt/gr4', 'bin'),
      path.join('/opt/gr4', 'lib', 'gnuradio-4', 'plugins'),
      systemDirectory,
    ]);
  });

  it('falls back to the next log directory when the first cannot be created', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gr4-studio-log-'));
    temporaryDirectories.push(directory);
    // a directory below a regular file can be created on no platform
    const blocker = path.join(directory, 'not-a-directory');
    await fs.writeFile(blocker, '');
    const unwritable = path.join(blocker, 'var', 'logs', 'gr4cp_server.log');
    const fallback = path.join(directory, 'user-logs', 'gr4cp_server.log');

    expect(await chooseWritableLogPath([unwritable, fallback])).toBe(fallback);
    expect(await chooseWritableLogPath([null, fallback])).toBe(fallback);
    await expect(chooseWritableLogPath([unwritable])).rejects.toThrow('writable');
  });

  it('extends the spelling Node passes to the child when Path and PATH are both present', () => {
    const environment = buildLocalBackendEnvironment('/opt/gr4', { Path: '/stale', PATH: '/used' }, 'win32');

    expect(environment.PATH?.split(path.delimiter)).toEqual([path.join('/opt/gr4', 'bin'), path.join('/opt/gr4', 'lib', 'gnuradio-4', 'plugins'), '/used']);
    expect(environment.Path).toBe('/stale');
  });

  it("lists the shared plugin tree of the manifest that names this prefix, before the prefix's own", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gr4-studio-manifest-'));
    temporaryDirectories.push(base);
    const prefix = path.join(base, 'Programs', 'GNURadio4', 'v14');
    const pluginRoot = path.join(base, '.gnuradio-4', 'plugins', 'v14');
    const otherPluginRoot = path.join(base, '.gnuradio-4', 'plugins', 'v13');
    await fs.mkdir(pluginRoot, { recursive: true });
    await fs.mkdir(otherPluginRoot, { recursive: true });
    const writeManifest = async (version, manifest) => {
      const directory = path.join(base, '.gnuradio-4', 'manifest', version);
      await fs.mkdir(directory, { recursive: true });
      // as the installers' PowerShell writes it, with a byte order mark
      await fs.writeFile(path.join(directory, 'manifest.json'), String.fromCharCode(0xfeff) + JSON.stringify(manifest));
    };
    // Windows compares paths without regard to case
    await writeManifest('v14', { 'install-root': prefix.toUpperCase(), 'plugin-root': pluginRoot });
    await writeManifest('v13', { 'install-root': path.join(base, 'elsewhere'), 'plugin-root': otherPluginRoot });

    const environment = buildLocalBackendEnvironment(prefix, { LocalAppData: base }, 'win32');

    expect(environment.GNURADIO4_PLUGIN_DIRECTORIES?.split(path.delimiter)).toEqual([
      pluginRoot,
      path.join(prefix, 'lib', 'gnuradio-4', 'plugins'),
      path.join(prefix, 'lib'),
    ]);
  });

  it('captures output and stops the process it owns', async () => {
    const paths = await createBackendPaths();
    const capturedOutput = [];
    const script = [
      "const fs = require('node:fs');",
      "fs.writeSync(1, 'stdout marker\\n');",
      "fs.writeSync(2, 'stderr marker\\n');",
      // Publish readiness only after the output under test has been emitted.
      "fs.writeFileSync(process.env.GR4CP_PORT_FILE, '43123\\n');",
      'setInterval(() => {}, 1000);',
    ].join('');

    const backend = await startLocalBackend({
      executable: process.execPath,
      args: ['-e', script],
      logPath: paths.logPath,
      portFilePath: paths.portFilePath,
      pollIntervalMs: 10,
      startupTimeoutMs: 2_000,
      onOutput: (entry) => capturedOutput.push(entry),
    });
    runningBackends.push(backend);

    expect(backend.baseUrl).toBe('http://127.0.0.1:43123');
    await backend.stop();
    runningBackends.splice(runningBackends.indexOf(backend), 1);
    const log = await fs.readFile(paths.logPath, 'utf8');
    expect(log).toContain('stdout marker');
    expect(log).toContain('stderr marker');
    expect(capturedOutput).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stream: 'stdout', text: expect.stringContaining('stdout marker') }),
        expect.objectContaining({ stream: 'stderr', text: expect.stringContaining('stderr marker') }),
      ]),
    );
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
