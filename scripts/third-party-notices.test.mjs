import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { thirdPartyNotices } from './third-party-notices.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('third-party notices', () => {
  it('lists the shipped npm packages with their licence texts, and no development ones', async () => {
    const notices = await thirdPartyNotices(projectRoot);

    expect(notices).toMatch(/^react \d+\.\d+\.\d+ \(MIT\)$/m);
    expect(notices).toContain('Permission is hereby granted');
    // a build tool, not shipped
    expect(notices).not.toMatch(/^vite \d/m);
  });
});
