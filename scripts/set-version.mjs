import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const version = process.argv[2];
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '')) {
  throw new Error('Usage: npm run release:version -- <major.minor.patch>');
}
for (const path of ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.version = version;
  if (path === 'package-lock.json') json.packages[''].version = version;
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
}
const cargo = readFileSync('Cargo.toml', 'utf8');
const updated = cargo.replace(/(\[workspace\.package\][\s\S]*?^version\s*=\s*)"[^"]+"/m, `$1"${version}"`);
if (updated === cargo && !cargo.includes(`version = "${version}"`)) {
  throw new Error('Could not find the Rust workspace version.');
}
writeFileSync('Cargo.toml', updated);
const result = spawnSync('cargo', ['update', '--workspace', '--offline'], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
if (result.error || result.status !== 0) throw result.error ?? new Error('Could not update Cargo.lock.');
console.log(`Version set to ${version}. Commit the changes, then push tag v${version} to build and publish.`);
