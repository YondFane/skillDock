// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { generateManifest } from './update-manifest.mjs';

let directory;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'skilldock-manifest-'));
  for (const name of ['SkillDock_0.1.1_x64-setup.exe', 'SkillDock_0.1.1_universal.dmg', 'SkillDock.app.tar.gz']) {
    writeFileSync(join(directory, name), 'test artifact');
    if (!name.endsWith('.dmg')) writeFileSync(join(directory, `${name}.sig`), 'test signature\n');
  }
});
afterEach(() => {
  if (!resolve(directory).startsWith(resolve(join(tmpdir(), 'skilldock-manifest-')))) throw new Error('Unsafe fixture path');
  rmSync(directory, { recursive: true });
});

it('uses the same signed universal archive for Intel and Apple Silicon', () => {
  const manifest = generateManifest(directory, '0.1.1', 'YondFane/skillDock', 'release notes');
  expect(manifest.platforms['darwin-aarch64']).toEqual(manifest.platforms['darwin-x86_64']);
  expect(manifest.platforms['darwin-aarch64'].url).toBe('https://github.com/YondFane/skillDock/releases/download/v0.1.1/SkillDock.app.tar.gz');
  expect(manifest.platforms['windows-x86_64'].signature).toBe('test signature');
  expect(manifest.notes).toBe('release notes');
  expect(readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n')).toHaveLength(5);
});

it('rejects an unsigned platform instead of publishing a partial manifest', () => {
  rmSync(join(directory, 'SkillDock.app.tar.gz.sig'));
  expect(() => generateManifest(directory, '0.1.1', 'YondFane/skillDock', '')).toThrow();
});

it('rejects installers from a different version', () => {
  expect(() => generateManifest(directory, '0.2.0', 'YondFane/skillDock', '')).toThrow('Installer version mismatch');
});
