// Zero-dependency static server for local preview of ../vibe-a1.
//   node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../vibe-a1');
const PORT = Number(process.argv[2] ?? 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // dev-only: save a rendered image into ../vibe-a1/assets/ (used to make the social share image)
    if (req.method === 'POST' && url.startsWith('/__save/assets/')) {
      const out = path.join(ROOT, url.slice('/__save/'.length));
      if (!out.startsWith(path.join(ROOT, 'assets'))) return res.writeHead(403).end();
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        fs.writeFileSync(out, Buffer.concat(chunks));
        res.writeHead(200).end('saved ' + out);
      });
      return;
    }
    let file = path.join(ROOT, url);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
