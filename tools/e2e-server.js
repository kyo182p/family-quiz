'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

async function startStaticServer(root) {
  root = await fs.realpath(path.resolve(root));
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png'
  };
  const outside = file => {
    const relative = path.relative(root, file);
    return relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, {Allow: 'GET, HEAD'}).end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(req.url.split(/[?#]/, 1)[0]).replace(/\\/g, '/');
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (pathname.includes('\0')) {
      res.writeHead(400).end();
      return;
    }
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(root, pathname.replace(/^\/+/, ''));
    if (outside(file)) {
      res.writeHead(403).end();
      return;
    }
    try {
      // Resolve symlinks too, so they cannot expose files outside the served root.
      const realFile = await fs.realpath(file);
      if (outside(realFile)) {
        res.writeHead(403).end();
        return;
      }
      if (!(await fs.stat(realFile)).isFile()) {
        res.writeHead(404).end();
        return;
      }
      const body = req.method === 'HEAD' ? undefined : await fs.readFile(realFile);
      res.writeHead(200, {'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream'});
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  let closing;
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() {
      if (!closing) {
        closing = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
      return closing;
    }
  };
}

module.exports = {startStaticServer};
