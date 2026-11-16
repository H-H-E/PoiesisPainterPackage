import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/index.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/painter.browser.js', minify: true, sourcemap: true, legalComments: 'eof' });
await build({ entryPoints: ['studio/main.ts'], bundle: true, format: 'iife', target: 'es2022', outfile: 'studio/studio.js', minify: true, legalComments: 'eof' });
const [html, css, javascript, core] = await Promise.all(['studio/index.html', 'studio/style.css', 'studio/studio.js', 'dist/painter.browser.js'].map(path => readFile(path, 'utf8')));
await mkdir('release', { recursive: true });
const standalone = html.replace(/<link\s+rel="stylesheet"\s+href="\.\/style\.css"\s*\/?\s*>/, `<style>${css}</style>`).replace(/<script[^>]*src="\.\/studio\.js"[^>]*><\/script>/, `<script>${javascript.replaceAll('</script', '<\\/script')}</script>`);
if (standalone === html || standalone.includes('src="./studio.js"')) throw new Error('Standalone studio embedding failed; check script/link tags.');
await writeFile('release/poiesis-studio.html', standalone);
await writeFile('dist/bundle-size.json', JSON.stringify({ runtimeBytes: Buffer.byteLength(core), gzipBytes: gzipSync(core).length, standaloneBytes: Buffer.byteLength(standalone), runtimeDependencies: 0 }, null, 2) + '\n');
console.log(`Built browser core ${Buffer.byteLength(core)} bytes / ${gzipSync(core).length} gzip; standalone studio ${Buffer.byteLength(standalone)} bytes.`);
