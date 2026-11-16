import { readFile, mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const lock = JSON.parse(await readFile(new URL('../references.lock.json', import.meta.url), 'utf8'));
const root = resolve(process.env.POIESIS_REFERENCE_DIR || lock.directory);
await mkdir(root, { recursive: true });
for (const repository of lock.repositories) {
  const directory = resolve(root, repository.name);
  let exists = true;
  try { await access(directory); } catch { exists = false; }
  if (!exists) execFileSync('git', ['clone', '--no-checkout', repository.url, directory], { stdio: 'inherit' });
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: directory, encoding: 'utf8' });
  if (status.trim()) throw new Error(`Reference ${repository.name} has local changes. Preserve them before checking out the pin.`);
  execFileSync('git', ['fetch', 'origin', repository.commit], { cwd: directory, stdio: 'inherit' });
  execFileSync('git', ['checkout', '--detach', repository.commit], { cwd: directory, stdio: 'inherit' });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim();
  if (head !== repository.commit) throw new Error(`Pin mismatch for ${repository.name}`);
  console.log(`${repository.name}: ${head}`);
}
