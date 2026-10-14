import { appendFileSync, readFileSync } from 'node:fs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const version = readJson('src-tauri/tauri.conf.json').version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error('Test installer releases require a numeric major.minor.patch version.');
}

const workspace = readFileSync('Cargo.toml', 'utf8')
  .match(/\[workspace\.package\]([^]*?)(?=\n\[|$)/)?.[1];
const rustVersion = workspace?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const lockedPackages = readFileSync('Cargo.lock', 'utf8').split('[[package]]');
const lockVersionsMatch = ['skilldock', 'skilldock-core'].every((name) =>
  lockedPackages.some((block) => block.match(/^name\s*=\s*"([^"]+)"/m)?.[1] === name
    && block.match(/^version\s*=\s*"([^"]+)"/m)?.[1] === version));
if (readJson('package.json').version !== version
    || readJson('package-lock.json').version !== version
    || readJson('package-lock.json').packages[''].version !== version
    || rustVersion !== version || !lockVersionsMatch) {
  throw new Error('Keep package.json, package-lock.json, Cargo.toml, Cargo.lock and tauri.conf.json versions in sync.');
}

const tag = `v${version}`;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== tag) {
  throw new Error(`The pushed tag must match the app version: ${tag}`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
}
console.log(`Installer version: ${version}; release tag: ${tag}`);
