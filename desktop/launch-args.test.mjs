import { describe, expect, it } from 'vitest';
import { normalizeBackendUrl, parseLaunchArgs } from './launch-args.mjs';

describe('desktop launch arguments', () => {
  it('normalizes supported backend urls', () => {
    expect(normalizeBackendUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(normalizeBackendUrl('file:///tmp/backend')).toBeNull();
  });

  it('defaults to an Electron-owned local backend', () => {
    expect(parseLaunchArgs(['electron', '/app'], { defaultApp: true, environment: {} })).toEqual({
      mode: 'local',
      remoteUrl: null,
      promptForRemote: false,
    });
  });

  it('lets explicit command-line modes override inherited environment modes', () => {
    expect(
      parseLaunchArgs(['electron', '/app', '--local'], {
        defaultApp: true,
        environment: {
          GR4_STUDIO_BACKEND_MODE: 'remote',
          GR4_STUDIO_CONTROL_PLANE_BASE_URL: 'http://example.test:8080',
        },
      }),
    ).toMatchObject({ mode: 'local' });

    expect(
      parseLaunchArgs(['electron', '/app', '--remote=http://remote.test:9000'], {
        defaultApp: true,
        environment: { GR4_STUDIO_BACKEND_MODE: 'local' },
      }),
    ).toEqual({
      mode: 'remote',
      remoteUrl: 'http://remote.test:9000',
      promptForRemote: false,
    });
  });

  it('parses packaged-app arguments without an app-directory operand', () => {
    expect(
      parseLaunchArgs(['gr4-studio', '--remote', 'http://remote.test:9000'], {
        defaultApp: false,
        environment: {},
      }),
    ).toMatchObject({ mode: 'remote', remoteUrl: 'http://remote.test:9000' });
  });

  it('opens the endpoint picker for a missing or invalid remote url', () => {
    expect(
      parseLaunchArgs(['electron', '/app', '--remote=not-a-url'], { defaultApp: true, environment: {} }),
    ).toMatchObject({ mode: 'remote', remoteUrl: null, promptForRemote: true });
  });
});
