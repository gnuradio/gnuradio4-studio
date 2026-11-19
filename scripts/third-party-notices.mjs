import fs from 'node:fs/promises';
import path from 'node:path';

// The licence files a package ships, by the names npm packages use for them
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i;

// The npm packages the desktop app ships: the production dependencies in package-lock.json, which Vite
// bundles into the app. Development and optional packages are not shipped.
async function shippedPackages(projectRoot) {
  const lock = JSON.parse(await fs.readFile(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  return Object.entries(lock.packages ?? {})
    .filter(([location, entry]) => location.startsWith('node_modules/') && !entry.dev && !entry.devOptional && !entry.optional)
    .map(([location, entry]) => ({
      location,
      name: location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version,
      license: entry.license ?? 'unknown',
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

async function licenseTexts(packageDirectory) {
  let names;
  try {
    names = (await fs.readdir(packageDirectory)).filter((name) => LICENSE_FILE.test(name)).sort();
  } catch {
    return [];
  }
  return Promise.all(names.map(async (name) => (await fs.readFile(path.join(packageDirectory, name), 'utf8')).trim()));
}

// The text of THIRD_PARTY_NOTICES.txt: every shipped npm package with its licence, and the licence
// texts the package itself carries, read from node_modules.
export async function thirdPartyNotices(projectRoot) {
  const sections = [
    'GNU Radio 4 Studio bundles the following third-party npm packages.',
    'The Electron runtime it runs on carries its own notices, in LICENSE and LICENSES.chromium.html beside the\n' +
      'Electron executable.',
  ];
  for (const pkg of await shippedPackages(projectRoot)) {
    const texts = await licenseTexts(path.join(projectRoot, pkg.location));
    sections.push(
      [
        '='.repeat(78),
        `${pkg.name} ${pkg.version} (${pkg.license})`,
        '='.repeat(78),
        texts.length ? texts.join('\n\n') : `No licence file is included in the package; it declares ${pkg.license}.`,
      ].join('\n'),
    );
  }
  return `${sections.join('\n\n')}\n`;
}
