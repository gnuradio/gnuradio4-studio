import path from 'node:path';

function value(text) {
  return text.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\r', '\\r').replaceAll('\t', '\\t');
}

export function desktopEntry(prefix) {
  const launcher = path.join(prefix, 'bin', 'gr4-studio');
  // Exec has argument quoting in addition to desktop-entry string escaping.
  const executable = value('"' + launcher.replace(/[\\$\x60"]/g, '\\$&').replaceAll('%', '%%') + '"');
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    'Name=GNU Radio 4 Studio',
    'Comment=Design and run GNU Radio 4 flowgraphs',
    'Exec=' + executable,
    'TryExec=' + value(launcher),
    'Icon=' + value(path.join(prefix, 'share', 'gr4-studio', 'apple-touch-icon.png')),
    'Terminal=false',
    'Categories=Development;Science;',
    'Keywords=GNU Radio;SDR;Flowgraph;',
    'StartupNotify=true',
    'StartupWMClass=gr4-studio',
    '',
  ].join('\n');
}
