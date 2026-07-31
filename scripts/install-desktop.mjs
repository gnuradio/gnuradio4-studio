import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

function parsePrefix(argv) {
  const prefixIndex = argv.indexOf('--prefix');
  if (prefixIndex !== -1 && argv[prefixIndex + 1]) {
    return argv[prefixIndex + 1];
  }

  const equalsArg = argv.find((arg) => arg.startsWith('--prefix='));
  if (equalsArg) {
    return equalsArg.slice('--prefix='.length);
  }

  return process.env.PREFIX || process.env.GR4_STUDIO_PREFIX;
}

async function main() {
  const prefix = parsePrefix(process.argv.slice(2));
  if (!prefix) {
    throw new Error('Missing prefix. Pass --prefix <path> or set PREFIX.');
  }

  const projectRoot = process.cwd();
  const distDir = path.join(projectRoot, 'dist');
  const appDir = path.join(prefix, 'share', 'gr4-studio');
  const binDir = path.join(prefix, 'bin');
  const electronDistDir = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  const electronRuntimeDir = path.join(prefix, 'libexec', 'gr4-studio', 'electron');
  const electronRelativeBinary =
    process.platform === 'darwin' ? path.join('Electron.app', 'Contents', 'MacOS', 'Electron') : 'electron';
  const electronBinary = path.join(electronRuntimeDir, electronRelativeBinary);

  await fs.access(distDir);
  await fs.access(path.join(electronDistDir, electronRelativeBinary));
  await fs.rm(appDir, { recursive: true, force: true });
  await fs.rm(electronRuntimeDir, { recursive: true, force: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await fs.cp(distDir, appDir, { recursive: true, force: true });
  await fs.cp(path.join(projectRoot, 'desktop'), path.join(appDir, 'desktop'), { recursive: true, force: true });
  await fs.cp(electronDistDir, electronRuntimeDir, { recursive: true, force: true });

  await fs.writeFile(
    path.join(appDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'gr4-studio',
        productName: 'gr4-studio',
        private: true,
        type: 'module',
        main: 'desktop/main.mjs',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const launcher = [
    '#!/bin/sh',
    'set -eu',
    '',
    'PREFIX="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
    'APP_DIR="$PREFIX/share/gr4-studio"',
    `BUNDLED_ELECTRON="$PREFIX/${path.relative(prefix, electronBinary)}"`,
    'SANDBOX_MARKER="$PREFIX/var/lib/gr4-studio/apparmor-profile-installed"',
    'REMOTE_EXPLICIT_URL="${GR4_STUDIO_CONTROL_PLANE_BASE_URL:-}"',
    'BACKEND_URL=""',
    'REMOTE_REQUESTED="0"',
    '',
    'for arg in "$@"; do',
    '  case "$arg" in',
    '    --remote|--remote=*) REMOTE_REQUESTED="1" ;;',
    '    --local) REMOTE_REQUESTED="0" ;;',
    '  esac',
    'done',
    '',
    'if [ -n "$REMOTE_EXPLICIT_URL" ]; then',
    '  REMOTE_REQUESTED="1"',
    'fi',
    '',
    'export PATH="$PREFIX/bin:${PATH:-}"',
    'export CMAKE_PREFIX_PATH="$PREFIX${CMAKE_PREFIX_PATH:+:${CMAKE_PREFIX_PATH}}"',
    'export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/lib64/pkgconfig:$PREFIX/share/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"',
    'export LD_LIBRARY_PATH="$PREFIX/lib:$PREFIX/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
    'export DYLD_LIBRARY_PATH="$PREFIX/lib:$PREFIX/lib64${DYLD_LIBRARY_PATH:+:${DYLD_LIBRARY_PATH}}"',
    'export PYTHONPATH="$PREFIX/lib/python3/site-packages${PYTHONPATH:+:${PYTHONPATH}}"',
    'export GNURADIO4_PLUGIN_DIRECTORIES="$PREFIX/lib/gnuradio-4/plugins:$PREFIX/lib${GNURADIO4_PLUGIN_DIRECTORIES:+:${GNURADIO4_PLUGIN_DIRECTORIES}}"',
    'export GR4_STUDIO_PREFIX="$PREFIX"',
    'export GR4_STUDIO_BACKEND_MODE="local"',
    '',
    'BACKEND_LOG_DIR="$PREFIX/var/logs"',
    'BACKEND_LOG_FILE="$BACKEND_LOG_DIR/gr4cp_server.log"',
    'BACKEND_PORT_FILE="$PREFIX/var/run/gr4-studio-control-plane.$$.port"',
    'mkdir -p "$BACKEND_LOG_DIR" "$(dirname -- "$BACKEND_PORT_FILE")"',
    'export GR4_STUDIO_BACKEND_LOG_FILE="$BACKEND_LOG_FILE"',
    '',
    'BACKEND_PID=""',
    'ELECTRON_PID=""',
    '',
    'cleanup() {',
    '  if [ -n "$ELECTRON_PID" ] && kill -0 "$ELECTRON_PID" >/dev/null 2>&1; then',
    '    kill "$ELECTRON_PID" >/dev/null 2>&1 || true',
    '    wait "$ELECTRON_PID" >/dev/null 2>&1 || true',
    '  fi',
    '  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then',
    '    kill "$BACKEND_PID" >/dev/null 2>&1 || true',
    '    wait "$BACKEND_PID" >/dev/null 2>&1 || true',
    '  fi',
    '  rm -f "$BACKEND_PORT_FILE"',
    '}',
    'on_int() {',
    '  cleanup',
    '  exit 130',
    '}',
    'on_term() {',
    '  cleanup',
    '  exit 143',
    '}',
    'trap cleanup EXIT',
    'trap on_int INT',
    'trap on_term TERM',
    '',
    'if [ -n "$REMOTE_EXPLICIT_URL" ]; then',
    '  export GR4_STUDIO_CONTROL_PLANE_BASE_URL="$REMOTE_EXPLICIT_URL"',
    '  export GR4_STUDIO_BACKEND_MODE="remote"',
    'fi',
    '',
    'check_electron() {',
    '  if [ -n "${GR4_STUDIO_ELECTRON_BIN:-}" ]; then',
    '    if [ ! -x "$GR4_STUDIO_ELECTRON_BIN" ]; then',
    '      echo "GR4_STUDIO_ELECTRON_BIN is not executable: $GR4_STUDIO_ELECTRON_BIN" >&2',
    '      return 126',
    '    fi',
    '    return 0',
    '  fi',
    '',
    '  if [ ! -x "$BUNDLED_ELECTRON" ]; then',
    '    echo "Bundled Electron runtime is missing: $BUNDLED_ELECTRON" >&2',
    '    echo "Rebuild and reinstall gr4-studio." >&2',
    '    return 126',
    '  fi',
    '',
    '  if [ "$(uname -s)" = "Linux" ] &&',
    '     [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ] &&',
    '     [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns)" = "1" ] &&',
    '     [ ! -f "$SANDBOX_MARKER" ]; then',
    '    echo "Electron sandbox access has not been configured for this prefix." >&2',
    '    echo "Run: $PREFIX/bin/gr4-studio-sandbox-setup" >&2',
    '    return 78',
    '  fi',
    '',
    '  return 0',
    '}',
    '',
    'launch_electron() {',
    '  if [ -n "${GR4_STUDIO_ELECTRON_BIN:-}" ]; then',
    '    "$GR4_STUDIO_ELECTRON_BIN" "$APP_DIR" "$@" &',
    '  else',
    '    "$BUNDLED_ELECTRON" "$APP_DIR" "$@" &',
    '  fi',
    '  ELECTRON_PID="$!"',
    '  wait "$ELECTRON_PID"',
    '  return "$?"',
    '}',
    '',
    'backend_startup_failed() {',
    '  BACKEND_STATUS="1"',
    '  if [ -n "$BACKEND_PID" ]; then',
    '    wait "$BACKEND_PID" || BACKEND_STATUS="$?"',
    '    BACKEND_PID=""',
    '  fi',
    '  echo "gr4cp_server exited during startup (status $BACKEND_STATUS)." >&2',
    '  if [ -s "$BACKEND_LOG_FILE" ]; then',
    '    echo "--- $BACKEND_LOG_FILE ---" >&2',
    '    tail -n 40 "$BACKEND_LOG_FILE" >&2',
    '  fi',
    '  exit "$BACKEND_STATUS"',
    '}',
    '',
    'check_electron',
    '',
    'if [ "$REMOTE_REQUESTED" = "0" ]; then',
    '  if ! command -v gr4cp_server >/dev/null 2>&1; then',
    '    echo "gr4cp_server not found on PATH" >&2',
    '    exit 127',
    '  fi',
    '',
    '  rm -f "$BACKEND_PORT_FILE"',
    '  GR4CP_PORT=0 GR4CP_PORT_FILE="$BACKEND_PORT_FILE" gr4cp_server >"$BACKEND_LOG_FILE" 2>&1 &',
    '  BACKEND_PID="$!"',
    '  PORT_WAIT_ATTEMPTS=0',
    '  while [ ! -s "$BACKEND_PORT_FILE" ]; do',
    '    if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then',
    '      backend_startup_failed',
    '    fi',
    '    PORT_WAIT_ATTEMPTS=$((PORT_WAIT_ATTEMPTS + 1))',
    '    if [ "$PORT_WAIT_ATTEMPTS" -ge 100 ]; then',
    '      echo "gr4cp_server did not publish its selected port within 10 seconds." >&2',
    '      exit 1',
    '    fi',
    '    sleep 0.1',
    '  done',
    '  BACKEND_PORT="$(tr -d "[:space:]" < "$BACKEND_PORT_FILE")"',
    '  case "$BACKEND_PORT" in',
    '    ""|*[!0-9]*) echo "gr4cp_server published an invalid port: $BACKEND_PORT" >&2; exit 1 ;;',
    '  esac',
    '  if [ "$BACKEND_PORT" -lt 1 ] || [ "$BACKEND_PORT" -gt 65535 ]; then',
    '    echo "gr4cp_server published an invalid port: $BACKEND_PORT" >&2',
    '    exit 1',
    '  fi',
    '  BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"',
    '  export GR4_STUDIO_BACKEND_MODE="local"',
    '  export GR4_STUDIO_CONTROL_PLANE_BASE_URL="$BACKEND_URL"',
    '  echo "[gr4-studio] Using local backend $GR4_STUDIO_CONTROL_PLANE_BASE_URL" >&2',
    'else',
    '  echo "[gr4-studio] Using remote backend $GR4_STUDIO_CONTROL_PLANE_BASE_URL" >&2',
    'fi',
    '',
    'launch_electron "$@"',
    '',
  ].join('\n');

  const launcherPath = path.join(binDir, 'gr4-studio');
  await fs.writeFile(launcherPath, launcher, 'utf8');
  await fs.chmod(launcherPath, 0o755);

  if (process.platform === 'linux') {
    const profileId = crypto.createHash('sha256').update(electronBinary).digest('hex').slice(0, 12);
    const profileName = `gr4-studio-${profileId}`;
    const profileDir = path.join(appDir, 'sandbox');
    const profilePath = path.join(profileDir, profileName);
    const quotedElectronBinary = electronBinary.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const profile = [
      '# This narrowly scoped unconfined profile permits Electron to create the',
      '# unprivileged user namespaces required by the Chromium sandbox.',
      '',
      'abi <abi/4.0>,',
      'include <tunables/global>',
      '',
      `profile ${profileName} "${quotedElectronBinary}" flags=(unconfined) {`,
      '  userns,',
      '  @{exec_path} mr,',
      '}',
      '',
    ].join('\n');
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(profilePath, profile, 'utf8');

    const sandboxSetup = [
      '#!/bin/sh',
      'set -eu',
      '',
      'PREFIX="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
      `PROFILE_NAME="${profileName}"`,
      'PROFILE_SOURCE="$PREFIX/share/gr4-studio/sandbox/$PROFILE_NAME"',
      'PROFILE_DEST="/etc/apparmor.d/$PROFILE_NAME"',
      'MARKER="$PREFIX/var/lib/gr4-studio/apparmor-profile-installed"',
      '',
      'run_as_root() {',
      '  if [ "$(id -u)" -eq 0 ]; then',
      '    "$@"',
      '  elif command -v sudo >/dev/null 2>&1; then',
      '    sudo "$@"',
      '  else',
      '    echo "This operation requires root privileges and sudo was not found." >&2',
      '    exit 1',
      '  fi',
      '}',
      '',
      'if ! command -v apparmor_parser >/dev/null 2>&1; then',
      '  echo "apparmor_parser was not found; this setup is only needed on AppArmor systems." >&2',
      '  exit 1',
      'fi',
      '',
      'case "${1:---install}" in',
      '  --install)',
      '    run_as_root install -o root -g root -m 0644 "$PROFILE_SOURCE" "$PROFILE_DEST"',
      '    run_as_root apparmor_parser -r "$PROFILE_DEST"',
      '    mkdir -p "$(dirname -- "$MARKER")"',
      '    touch "$MARKER"',
      '    echo "Installed and loaded AppArmor profile $PROFILE_NAME"',
      '    ;;',
      '  --remove)',
      '    if [ -f "$PROFILE_DEST" ]; then',
      '      run_as_root apparmor_parser -R "$PROFILE_DEST"',
      '      run_as_root rm -f "$PROFILE_DEST"',
      '      echo "Removed AppArmor profile $PROFILE_NAME"',
      '    else',
      '      echo "AppArmor profile $PROFILE_NAME is not installed"',
      '    fi',
      '    rm -f "$MARKER"',
      '    ;;',
      '  *)',
      '    echo "Usage: gr4-studio-sandbox-setup [--install|--remove]" >&2',
      '    exit 2',
      '    ;;',
      'esac',
      '',
    ].join('\n');
    const sandboxSetupPath = path.join(binDir, 'gr4-studio-sandbox-setup');
    await fs.writeFile(sandboxSetupPath, sandboxSetup, 'utf8');
    await fs.chmod(sandboxSetupPath, 0o755);
  }

  console.log(`Installed desktop launcher to ${launcherPath}`);
  console.log(`Installed frontend assets to ${appDir}`);
  console.log(`Installed Electron runtime to ${electronRuntimeDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
