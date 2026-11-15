import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('.');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') { response.writeHead(302, { Location: '/studio/index.html' }); response.end(); return; }
    const requested = decodeURIComponent(url.pathname);
    const path = resolve(root, '.' + requested);
    if (!path.startsWith(root + sep) || requested.includes('/.git') || requested.includes('/node_modules/')) { response.writeHead(403); response.end('Forbidden'); return; }
    if (!(await stat(path)).isFile()) throw new Error('Not a file');
    response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(await readFile(path));
  } catch { response.writeHead(404); response.end('Not found. Run npm run build first.'); }
}).listen(port, '0.0.0.0', () => console.log(`Poiesis Painter studio: http://localhost:${port}`));
