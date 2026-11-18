import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const base = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
export function createSiteServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      const route = url.pathname === '/compare/' || url.pathname === '/compare' ? '/compare/index.html' : url.pathname;
      const requested = decodeURIComponent(route === '/' ? '/index.html' : route);
      const file = resolve(base, '.' + requested);
      if (!file.startsWith(base + sep)) { response.writeHead(403); response.end('Forbidden'); return; }
      if (!(await stat(file)).isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end('Not found. Run node site/build.mjs first.'); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4174);
  createSiteServer().listen(port, '127.0.0.1', () => console.log('Poiesis site at http://127.0.0.1:' + port));
}
