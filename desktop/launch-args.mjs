export function normalizeBackendUrl(input) {
  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export function parseLaunchArgs(
  argv,
  { defaultApp = false, environment = process.env } = {},
) {
  const args = argv.slice(defaultApp ? 2 : 1);
  const remoteIndex = args.findIndex((arg) => arg === '--remote' || arg.startsWith('--remote='));
  const localIndex = args.findIndex((arg) => arg === '--local');
  const envUrl = normalizeBackendUrl(environment.GR4_STUDIO_CONTROL_PLANE_BASE_URL);
  const backendMode = environment.GR4_STUDIO_BACKEND_MODE;

  if (localIndex !== -1 && remoteIndex === -1) {
    return { mode: 'local', remoteUrl: null, promptForRemote: false };
  }

  if (remoteIndex !== -1) {
    const token = args[remoteIndex];
    if (token.includes('=')) {
      const remoteUrl = normalizeBackendUrl(token.split('=', 2)[1]);
      return { mode: 'remote', remoteUrl, promptForRemote: !remoteUrl };
    }

    const next = args[remoteIndex + 1];
    if (next && !next.startsWith('-')) {
      const remoteUrl = normalizeBackendUrl(next);
      return { mode: 'remote', remoteUrl, promptForRemote: !remoteUrl };
    }

    return { mode: 'remote', remoteUrl: envUrl, promptForRemote: !envUrl };
  }

  if (backendMode === 'local') {
    return { mode: 'local', remoteUrl: null, promptForRemote: false };
  }

  if (backendMode === 'remote' || envUrl) {
    return { mode: 'remote', remoteUrl: envUrl, promptForRemote: !envUrl };
  }

  return { mode: 'local', remoteUrl: null, promptForRemote: false };
}
