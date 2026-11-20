import fs from 'node:fs/promises';
import path from 'node:path';

// The connection picker is a data document, before the app HTTP server exists.
// Embed the same shipped font/tokens so it needs neither file-origin access nor a CDN.
export async function loadPickerTypography(appPath) {
  const installedCss = path.join(appPath, 'typography.css');
  const publicPath = await fs.access(installedCss).then(() => appPath, () => path.join(appPath, 'public'));
  const [css, font] = await Promise.all([
    fs.readFile(path.join(publicPath, 'typography.css'), 'utf8'),
    fs.readFile(path.join(publicPath, 'fonts', 'InterVariable.woff2')),
  ]);
  return css.replace("url('./fonts/InterVariable.woff2')", `url('data:font/woff2;base64,${font.toString('base64')}')`);
}
