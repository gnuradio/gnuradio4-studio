import crypto from 'node:crypto';

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

export function sandboxProfile(electronBinary) {
  // AppArmor interprets these characters even within quoted attachment paths.
  if (/[\n\r*?\[\]{}@\x00]/.test(electronBinary)) {
    throw new Error('The Electron install path contains AppArmor pattern characters. Choose another prefix.');
  }
  const name = `gr4-studio-${crypto.createHash('sha256').update(electronBinary).digest('hex').slice(0, 12)}`;
  const quotedPath = electronBinary.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return {
    name,
    content: [
      '# Allow the Chromium sandbox to create user namespaces for this executable.',
      '# AppArmor remains enabled; this is an unconfined application profile.',
      'abi <abi/4.0>,',
      'include <tunables/global>',
      `profile ${name} "${quotedPath}" flags=(unconfined) {`,
      '  userns,',
      '  @{exec_path} mr,',
      '}',
      '',
    ].join('\n'),
  };
}

export function sandboxSetupScript(electronBinary, {
  profileDirectory = '/etc/apparmor.d',
  loadedProfiles = '/sys/kernel/security/apparmor/profiles',
  restriction = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
  enabled = '/sys/module/apparmor/parameters/enabled',
} = {}) {
  const { name } = sandboxProfile(electronBinary);
  return `#!/bin/sh
set -eu
PREFIX="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
EXPECTED_ELECTRON=${shellQuote(electronBinary)}
ELECTRON="$PREFIX/libexec/gr4-studio/electron/electron"
PROFILE_NAME=${shellQuote(name)}
PROFILE_SOURCE="$PREFIX/share/gr4-studio/sandbox/$PROFILE_NAME"
PROFILE_DEST=${shellQuote(`${profileDirectory}/${name}`)}
LOADED_PROFILES=${shellQuote(loadedProfiles)}
RESTRICTION=${shellQuote(restriction)}
ENABLED=${shellQuote(enabled)}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This operation requires root privileges and sudo was not found." >&2
    return 1
  fi
}

restricted() {
  [ -r "$ENABLED" ] && [ "$(cat "$ENABLED")" = Y ] &&
    [ -r "$RESTRICTION" ] && [ "$(cat "$RESTRICTION")" = 1 ]
}

check_profile() {
  if [ "$ELECTRON" != "$EXPECTED_ELECTRON" ]; then
    echo "Studio has moved. Reinstall Studio at this prefix to regenerate its AppArmor profile." >&2
    echo "Profile executable: $EXPECTED_ELECTRON" >&2
    echo "Current executable: $ELECTRON" >&2
    return 78
  fi
  if [ ! -f "$PROFILE_SOURCE" ] || [ ! -f "$PROFILE_DEST" ] || ! cmp -s "$PROFILE_SOURCE" "$PROFILE_DEST"; then
    echo "The AppArmor profile for $ELECTRON is missing or out of date." >&2
    echo "Run: \\"$PREFIX/bin/gr4-studio-sandbox-setup\\"" >&2
    return 78
  fi
  # securityfs may pass test -r but deny the actual read. Distinguish grep's
  # no-match status (1) from a read error (2), rather than blocking a valid policy.
  profile_read_status=0
  grep -F -x "$PROFILE_NAME (unconfined)" "$LOADED_PROFILES" >/dev/null 2>&1 || profile_read_status=$?
  case "$profile_read_status" in
    0)
      echo "AppArmor profile $PROFILE_NAME is installed and loaded."
      ;;
    1)
      echo "AppArmor profile $PROFILE_NAME is not loaded in unconfined mode." >&2
      echo "Run: \\"$PREFIX/bin/gr4-studio-sandbox-setup\\"" >&2
      return 78
      ;;
    *)
      echo "AppArmor profile $PROFILE_NAME is installed; loaded state is not readable by this user." >&2
      echo "If sandbox startup fails, reload it with: \\"$PREFIX/bin/gr4-studio-sandbox-setup\\"" >&2
      ;;
  esac
}

case "\${1:---install}" in
  --check)
    # Launch normally on systems where AppArmor does not restrict user namespaces.
    if restricted; then check_profile; fi
    ;;
  --status)
    if restricted; then
      echo "AppArmor user-namespace restriction: enabled"
    else
      echo "AppArmor user-namespace restriction: inactive"
    fi
    check_profile
    ;;
  --install)
    if [ "$ELECTRON" != "$EXPECTED_ELECTRON" ] || [ ! -x "$ELECTRON" ]; then
      echo "Reinstall Studio at this prefix before configuring its AppArmor profile." >&2
      exit 78
    fi
    command -v apparmor_parser >/dev/null 2>&1 || { echo "apparmor_parser was not found." >&2; exit 1; }
    # Validate before touching system policy. Never change system-wide restrictions.
    apparmor_parser --skip-kernel-load --skip-cache "$PROFILE_SOURCE"
    run_as_root install -o root -g root -m 0644 "$PROFILE_SOURCE" "$PROFILE_DEST"
    run_as_root apparmor_parser -r "$PROFILE_DEST"
    echo "Installed and loaded AppArmor profile $PROFILE_NAME for $ELECTRON"
    ;;
  --remove)
    if [ -f "$PROFILE_DEST" ]; then
      run_as_root apparmor_parser -R "$PROFILE_DEST"
      run_as_root rm -f "$PROFILE_DEST"
    fi
    echo "Removed AppArmor profile $PROFILE_NAME"
    ;;
  *)
    echo "Usage: gr4-studio-sandbox-setup [--install|--status|--remove]" >&2
    exit 2
    ;;
esac
`;
}
