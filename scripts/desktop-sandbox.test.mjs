import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sandboxProfile, sandboxSetupScript } from './desktop-sandbox.mjs';

const roots = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio sandbox '));
  roots.push(root);
  const electron = path.join(root, 'libexec/gr4-studio/electron/electron');
  const profile = sandboxProfile(electron);
  const paths = {
    profileDirectory: path.join(root, 'policy'),
    loadedProfiles: path.join(root, 'loaded'),
    restriction: path.join(root, 'restriction'),
    enabled: path.join(root, 'enabled'),
  };
  const source = path.join(root, 'share/gr4-studio/sandbox', profile.name);
  const destination = path.join(paths.profileDirectory, profile.name);
  const script = path.join(root, 'bin/gr4-studio-sandbox-setup');
  for (const file of [electron, source, destination, script]) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(source, profile.content);
  fs.writeFileSync(script, sandboxSetupScript(electron, paths));
  fs.writeFileSync(paths.restriction, '1\n');
  fs.writeFileSync(paths.enabled, 'Y\n');
  fs.writeFileSync(paths.loadedProfiles, '');
  return { root, source, destination, paths, profile, script,
    run: (arg = '--check') => spawnSync('sh', [script, arg], { encoding: 'utf8' }),
  };
}

describe('installed AppArmor preflight', () => {
  it('rejects a missing profile even with an old installation marker', () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.root, 'var/lib/gr4-studio'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'var/lib/gr4-studio/apparmor-profile-installed'), '');
    const result = f.run();
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('missing or out of date');
    expect(result.stderr).toContain(f.script);
  });
  it('distinguishes an installed profile from a loaded profile', () => {
    const f = fixture();
    fs.copyFileSync(f.source, f.destination);
    expect(f.run().status).toBe(78);
    fs.writeFileSync(f.paths.loadedProfiles, f.profile.name + ' (unconfined)\n');
    expect(f.run().status).toBe(0);
    fs.writeFileSync(f.destination, '# stale');
    expect(f.run().status).toBe(78);
  });
  it('allows launch with inactive restrictions but still diagnoses missing policy', () => {
    const f = fixture();
    fs.writeFileSync(f.paths.restriction, '0');
    expect(f.run().status).toBe(0);
    expect(f.run('--status').status).toBe(78);
  });
  it('reports unverifiable loaded state without falsely claiming it is loaded', () => {
    const f = fixture();
    fs.copyFileSync(f.source, f.destination);
    fs.unlinkSync(f.paths.loadedProfiles);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('loaded state is not readable');
  });
  it('diagnoses a relocated prefix rather than loading a stale attachment', () => {
    const f = fixture();
    fs.writeFileSync(f.script, sandboxSetupScript('/old/prefix/electron', f.paths));
    expect(f.run().status).toBe(78);
    expect(f.run().stderr).toContain('Studio has moved');
  });
  it('does not mistake a read error for a missing loaded profile when test -r succeeds', () => {
    const f = fixture();
    fs.copyFileSync(f.source, f.destination);
    fs.unlinkSync(f.paths.loadedProfiles);
    // A directory passes test -r but grep cannot read it as a profile list.
    // securityfs can likewise pass the access check and deny the actual read.
    fs.mkdirSync(f.paths.loadedProfiles);
    const result = f.run();
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('loaded state is not readable');
    expect(result.stderr).not.toContain('is not loaded in unconfined mode');
    expect(result.stderr).not.toContain('grep:');
  });
  it('rejects AppArmor patterns in the executable path', () => {
    expect(() => sandboxProfile('/tmp/*/electron')).toThrow('pattern characters');
  });
});
