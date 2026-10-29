#!/bin/sh
set -eu
PREFIX="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
SOURCE="$PREFIX/share/applications/gr4-studio.desktop"
DATA_HOME="$(printenv XDG_DATA_HOME || true)"
if [ -z "$DATA_HOME" ]; then DATA_HOME="$HOME/.local/share"; fi
APPLICATIONS="$DATA_HOME/applications"
DESTINATION="$APPLICATIONS/gr4-studio.desktop"
ACTION=--install
if [ "$#" -gt 0 ]; then ACTION="$1"; fi

case "$ACTION" in
  --install)
    mkdir -p "$APPLICATIONS"
    if [ "$SOURCE" != "$DESTINATION" ]; then
      install -m 0644 "$SOURCE" "$DESTINATION"
    fi
    echo "Registered GNU Radio 4 Studio: $DESTINATION"
    echo "Restart Studio, then pin GNU Radio 4 Studio to your dock."
    ;;
  --remove)
    if [ "$SOURCE" = "$DESTINATION" ]; then
      echo "The desktop entry belongs to this install prefix; remove it when uninstalling Studio." >&2
      exit 1
    fi
    if [ -f "$DESTINATION" ]; then
      if ! cmp -s "$SOURCE" "$DESTINATION"; then
        echo "This desktop entry belongs to another install prefix; leaving it in place." >&2
        exit 1
      fi
      rm "$DESTINATION"
    fi
    ;;
  *)
    echo "Usage: gr4-studio-desktop-setup [--install|--remove]" >&2
    exit 2
    ;;
esac
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APPLICATIONS"
fi
