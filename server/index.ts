import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { createGameApi } from './api.ts';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'dist');
const port = Number(process.env.PORT ?? 5173);
const isDev = process.argv.includes('--dev');
const dataDir = join(root, '.data');
const apiKey = process.env.OPENAI_API_KEY?.trim();
const namedModel = process.env.OPENAI_MODEL?.trim();
const localHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
if (!isDev && !existsSync(join(dist, 'index.html'))) {
  throw new Error('Run npm run build before npm start.');
}
if (Boolean(apiKey) !== Boolean(namedModel)) {
  console.warn('Set both OPENAI_API_KEY and OPENAI_MODEL to enable live dialogue. Using scripted replies.');
}

mkdirSync(dataDir, { recursive: true });
const api = createGameApi({
  filename: join(dataDir, 'save.sqlite'),
  model: apiKey && namedModel ? { apiKey, model: namedModel } : undefined,
});

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.jpg', 'image/jpeg'], ['.woff2', 'font/woff2'],
]);

function serveFile(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let requested: string;
  try {
    requested = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolve(dist, '.' + (requested === '/' ? '/index.html' : requested));
  const contentType = mime.get(extname(file));
  if (!file.startsWith(dist + sep) || !contentType || !statSync(file, { throwIfNoEntry: false })?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', contentType);
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
const server = createServer((req, res) => {
  if (!localHosts.has(req.headers.host ?? '')) {
    res.writeHead(403).end();
  } else if (req.url?.startsWith('/api/')) {
    void api.handle(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else res.writeHead(500).end();
    });
  } else if (vite) {
    vite.middlewares(req, res, () => res.writeHead(404).end());
  } else {
    serveFile(req, res);
  }
});

if (isDev) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ root, server: { middlewareMode: true, hmr: { server } } });
}
server.requestTimeout = 15_000;
server.on('close', () => {
  api.close();
  void vite?.close();
});
server.listen(port, '127.0.0.1', () => console.log(`Echoes of the Realm: http://127.0.0.1:${port}`));
