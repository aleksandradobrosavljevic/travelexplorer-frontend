import { createServer } from 'node:https';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const port = Number(process.env.PORT ?? 10102);
const host = process.env.HOST ?? '0.0.0.0';
const distRoot = resolve(process.env.FRONTEND_DIST_DIR ?? join(process.cwd(), 'dist/frontend-app/browser'));
const pfxPath = process.env.HTTPS_PFX_PATH;
const pfxPassword = process.env.HTTPS_PFX_PASSWORD;

if (!pfxPath) {
  throw new Error('HTTPS_PFX_PATH must point to the .pfx certificate file.');
}

if (!existsSync(distRoot)) {
  throw new Error(`Frontend build folder does not exist: ${distRoot}`);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function getFilePath(urlPath) {
  const decodedPath = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relativePath = normalize(decodedPath).replace(/^([/\\])+/, '');
  const candidatePath = resolve(join(distRoot, relativePath));

  if (candidatePath !== distRoot && !candidatePath.startsWith(`${distRoot}${sep}`)) {
    return null;
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    return candidatePath;
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
    const directoryIndex = join(candidatePath, 'index.html');
    return existsSync(directoryIndex) ? directoryIndex : null;
  }

  return join(distRoot, 'index.html');
}

const server = createServer(
  {
    pfx: readFileSync(resolve(pfxPath)),
    passphrase: pfxPassword
  },
  (request, response) => {
    try {
      const filePath = getFilePath(request.url ?? '/');

      if (!filePath || !existsSync(filePath)) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const extension = extname(filePath).toLowerCase();
      const fileName = filePath.split(/[\\/]/).pop() ?? '';
      const shouldCache = extension !== '.html' && !fileName.startsWith('favicon.');

      response.writeHead(200, {
        'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
        'Cache-Control': shouldCache ? 'public, max-age=31536000, immutable' : 'no-cache'
      });
      response.end(readFileSync(filePath));
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Server error');
    }
  }
);

server.listen(port, host, () => {
  console.log(`TravelExplorer frontend listening at https://${host}:${port}`);
  console.log(`Serving ${distRoot}`);
});
