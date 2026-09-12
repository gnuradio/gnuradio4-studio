import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { downloadArtifact } = require('@electron/get');

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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${command} was terminated by ${signal}`
            : `${command} exited with status ${code ?? 'unknown'}`,
        ),
      );
    });
  });
}

function electronRelativeBinary() {
  switch (process.env.npm_config_platform || process.platform) {
    case 'darwin':
    case 'mas':
      return path.join('Electron.app', 'Contents', 'MacOS', 'Electron');
    case 'win32':
      return 'electron.exe';
    default:
      return 'electron';
  }
}

function requiredElectronFiles(distDir, relativeBinary) {
  const files = [path.join(distDir, relativeBinary)];
  const platform = process.env.npm_config_platform || process.platform;
  if (platform === 'darwin' || platform === 'mas') {
    files.push(
      path.join(
        distDir,
        'Electron.app',
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework',
      ),
    );
  }
  return files;
}

async function ensureElectronRuntime(projectRoot, electronDistDir, relativeBinary) {
  const requiredFiles = requiredElectronFiles(electronDistDir, relativeBinary);
  if ((await Promise.all(requiredFiles.map(fileExists))).every(Boolean)) {
    return;
  }

  console.log('Electron runtime is incomplete; downloading and repairing it...');

  const electronPackageDir = path.join(projectRoot, 'node_modules', 'electron');
  const electronPackage = JSON.parse(await fs.readFile(path.join(electronPackageDir, 'package.json'), 'utf8'));
  const checksums = JSON.parse(await fs.readFile(path.join(electronPackageDir, 'checksums.json'), 'utf8'));
  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const archivePath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: 'electron',
    platform,
    arch,
    checksums,
  });

  // Electron 35's extract-zip dependency can stop partway through macOS archives
  // on newer Node releases. CMake is already required to build this project and
  // provides a portable extractor on macOS, Linux, and Windows.
  const stagingDir = await fs.mkdtemp(path.join(electronPackageDir, '.gr4-electron-dist-'));
  const backupDir = path.join(electronPackageDir, `.gr4-electron-dist-backup-${process.pid}`);
  let backedUp = false;
  let installed = false;
  try {
    await run(process.env.CMAKE_COMMAND || 'cmake', ['-E', 'tar', 'xf', archivePath], { cwd: stagingDir });

    const stagedRequiredFiles = requiredElectronFiles(stagingDir, relativeBinary);
    if (!(await Promise.all(stagedRequiredFiles.map(fileExists))).every(Boolean)) {
      throw new Error(`Downloaded Electron ${electronPackage.version} archive is incomplete for ${platform}-${arch}`);
    }

    await fs.rm(backupDir, { recursive: true, force: true });
    try {
      await fs.rename(electronDistDir, backupDir);
      backedUp = true;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    await fs.rename(stagingDir, electronDistDir);
    installed = true;
    await fs.writeFile(path.join(electronPackageDir, 'path.txt'), relativeBinary, 'utf8');
    await fs.rm(backupDir, { recursive: true, force: true });
    backedUp = false;
  } catch (error) {
    if (installed) {
      await fs.rm(electronDistDir, { recursive: true, force: true });
    }
    if (backedUp) {
      await fs.rename(backupDir, electronDistDir);
    }
    throw error;
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
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
  const relativeElectronBinary = electronRelativeBinary();
  const electronBinary = path.join(electronRuntimeDir, relativeElectronBinary);
  const electronResourcesDir =
    process.platform === 'darwin'
      ? path.join(electronRuntimeDir, 'Electron.app', 'Contents', 'Resources')
      : path.join(electronRuntimeDir, 'resources');

  await fs.access(distDir);
  await ensureElectronRuntime(projectRoot, electronDistDir, relativeElectronBinary);
  await fs.rm(appDir, { recursive: true, force: true });
  await fs.rm(electronRuntimeDir, { recursive: true, force: true });
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(binDir, { recursive: true });

  await fs.cp(distDir, appDir, { recursive: true, force: true });
  await fs.cp(path.join(projectRoot, 'desktop'), path.join(appDir, 'desktop'), { recursive: true, force: true });
  await fs.cp(electronDistDir, electronRuntimeDir, {
    recursive: true,
    force: true,
    // Electron's macOS frameworks use relative symlinks within each bundle.
    // Resolving them while copying produces absolute links into node_modules,
    // which prevents Chromium from locating resources such as icudtl.dat.
    verbatimSymlinks: true,
  });

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

  // Supplying the app path remains useful for alternate Electron binaries, while
  // embedding the same app lets the bundled runtime launch directly (including
  // opening Electron.app from Finder on macOS).
  await fs.cp(appDir, path.join(electronResourcesDir, 'app'), { recursive: true, force: true });

  const launcher = [
    '#!/bin/sh',
    'set -eu',
    '',
    'PREFIX="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"',
    'APP_DIR="$PREFIX/share/gr4-studio"',
    `BUNDLED_ELECTRON="$PREFIX/${path.relative(prefix, electronBinary)}"`,
    'SANDBOX_MARKER="$PREFIX/var/lib/gr4-studio/apparmor-profile-installed"',
    '',
    'export PATH="$PREFIX/bin:${PATH:-}"',
    'export CMAKE_PREFIX_PATH="$PREFIX${CMAKE_PREFIX_PATH:+:${CMAKE_PREFIX_PATH}}"',
    'export PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig:$PREFIX/lib64/pkgconfig:$PREFIX/share/pkgconfig${PKG_CONFIG_PATH:+:${PKG_CONFIG_PATH}}"',
    'export LD_LIBRARY_PATH="$PREFIX/lib:$PREFIX/lib64${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
    'export DYLD_LIBRARY_PATH="$PREFIX/lib:$PREFIX/lib64${DYLD_LIBRARY_PATH:+:${DYLD_LIBRARY_PATH}}"',
    'export PYTHONPATH="$PREFIX/lib/python3/site-packages${PYTHONPATH:+:${PYTHONPATH}}"',
    'export GNURADIO4_PLUGIN_DIRECTORIES="$PREFIX/lib/gnuradio-4/plugins:$PREFIX/lib${GNURADIO4_PLUGIN_DIRECTORIES:+:${GNURADIO4_PLUGIN_DIRECTORIES}}"',
    'export GR4_STUDIO_PREFIX="$PREFIX"',
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
    'check_electron',
    '',
    'if [ -n "${GR4_STUDIO_ELECTRON_BIN:-}" ]; then',
    '  exec "$GR4_STUDIO_ELECTRON_BIN" "$APP_DIR" "$@"',
    'else',
    '  exec "$BUNDLED_ELECTRON" "$APP_DIR" "$@"',
    'fi',
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
