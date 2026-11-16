import { build } from 'esbuild';
import { mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
process.chdir(root);
await rm('site/dist', { recursive: true, force: true });
await mkdir('site/dist', { recursive: true });
const result = await build({
  entryPoints: ['site/app.ts'], outdir: 'site/dist',
  entryNames: 'assets/[name]-[hash]', chunkNames: 'assets/[name]-[hash]',
  format: 'esm', platform: 'browser', target: ['es2022'],
  bundle: true, splitting: true, minify: true,
  sourcemap: false, metafile: true, legalComments: 'eof', logLevel: 'warning'
});
const entry = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint === 'site/app.ts');
if (!entry) throw new Error('No bundled site entrypoint was produced');
const jsPath = '/' + relative('site/dist', entry[0]).replaceAll('\\', '/');
const html = (await readFile('site/index.html', 'utf8')).replace('__APP_SCRIPT__', jsPath);
if (html.includes('__APP_SCRIPT__')) throw new Error('Unreplaced site script');
await writeFile('site/dist/index.html', html);
await copyFile('site/style.css', 'site/dist/style.css');
await copyFile('site/favicon.svg', 'site/dist/favicon.svg');
const totalBytes = Object.entries(result.metafile.outputs).reduce((sum, [, o]) => sum + o.bytes, 0);
console.log('Static site built: ' + jsPath + ', total lazy JavaScript bytes: ' + totalBytes);
