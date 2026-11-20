import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { loadPickerTypography } from './typography.mjs';
import { startDesktopAppServer } from './app-server.mjs';

const temporary = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir,{recursive:true,force:true}))); });

describe('Bundled typography assets', () => {
  it('ships the licensed upstream variable WOFF2 and records its exact source', async () => {
    const font = await fs.readFile('public/fonts/InterVariable.woff2');
    const source = JSON.parse(await fs.readFile('public/fonts/source.json','utf8'));
    expect(font.subarray(0,4).toString()).toBe('wOF2');
    expect(createHash('sha256').update(font).digest('hex')).toBe(source.sha256);
    expect(source.axes.wght).toEqual([100,900]);
    expect(await fs.readFile('public/fonts/LICENSE-Inter.txt','utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1');
  });

  it('embeds the same font and scale in the pre-server desktop picker', async () => {
    const css = await loadPickerTypography(process.cwd());
    const embedded = /data:font\/woff2;base64,([^']+)/.exec(css)?.[1];
    expect(Buffer.from(embedded,'base64')).toEqual(await fs.readFile('public/fonts/InterVariable.woff2'));
    expect(css).toContain('--font-size-sm: 13px');
    expect(css).not.toMatch(/url\(['"]?(?:https?:|file:)/);
  });

  it('loads from the installed layout without referring to the source repository', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(),'studio-font-package-'));
    temporary.push(dir);
    await fs.cp('public/fonts',path.join(dir,'fonts'),{recursive:true});
    await fs.copyFile('public/typography.css',path.join(dir,'typography.css'));
    expect(await loadPickerTypography(dir)).toBe(await loadPickerTypography(process.cwd()));
  });

  it('serves the packaged font with its MIME type through the native application server', async () => {
    const server = await startDesktopAppServer({staticRoot:path.resolve('public'),backendBaseUrl:'http://127.0.0.1:8080'});
    try {
      const css = await fetch(server.origin+'/typography.css');
      expect(css.headers.get('content-type')).toContain('text/css');
      expect(await css.text()).toContain("url('./fonts/InterVariable.woff2')");
      const font = await fetch(server.origin+'/fonts/InterVariable.woff2');
      expect(font.headers.get('content-type')).toBe('font/woff2');
      expect(Buffer.from(await font.arrayBuffer())).toEqual(await fs.readFile('public/fonts/InterVariable.woff2'));
    } finally { await server.close(); }
  });
});
