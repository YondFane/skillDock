import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function generateManifest(directory, version, repository, notes, date = new Date().toISOString()) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Invalid release version or repository.');
  }
  const files = readdirSync(directory);
  const one = (pattern) => {
    const matches = files.filter((name) => pattern.test(name));
    if (matches.length !== 1) throw new Error(`Expected exactly one artifact matching ${pattern}`);
    return matches[0];
  };
  const windows = one(/_x64-setup\.exe$/);
  const mac = one(/\.app\.tar\.gz$/);
  const dmg = one(/_universal\.dmg$/);
  for (const installer of [windows, dmg]) {
    if (!installer.includes(`_${version}_`)) throw new Error('Installer version mismatch.');
  }
  const entry = (name) => {
    const signature = readFileSync(join(directory, `${name}.sig`), 'utf8').trim();
    if (!signature) throw new Error(`Missing signature for ${name}`);
    return { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(name)}` };
  };
  const macEntry = entry(mac);
  const manifest = {
    version, notes, pub_date: date,
    platforms: { 'windows-x86_64': entry(windows), 'darwin-aarch64': macEntry, 'darwin-x86_64': macEntry },
  };
  writeFileSync(join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const checksums = files.filter((name) => /\.(exe|dmg|tar\.gz|sig)$/.test(name)).sort()
    .map((name) => `${createHash('sha256').update(readFileSync(join(directory, name))).digest('hex')}  ${name}`);
  writeFileSync(join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, version, repository, notesFile] = process.argv.slice(2);
  generateManifest(directory, version, repository, readFileSync(notesFile, 'utf8'));
  console.log('Signed update manifest and checksums generated for Windows x64 and both macOS architectures.');
}
