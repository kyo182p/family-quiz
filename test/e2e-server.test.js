'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {startStaticServer} = require('../tools/e2e-server');
const {runE2e} = require('../tools/e2e');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fq-e2e-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const root = path.join(dir, 'dist');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'index.html'), '<h1>fake build</h1>');
  await fs.writeFile(path.join(root, 'sample.txt'), 'sample text');
  await fs.writeFile(path.join(dir, 'secret.txt'), 'outside-secret-marker');
  return root;
}

function request(base, pathname = '/', options = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    // Keep the request path raw: URL/fetch would normalize traversal attempts.
    const req = http.request({hostname: url.hostname, port: url.port, path: pathname, ...options}, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({status: res.statusCode, headers: res.headers, body}));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('T015 static server serves HTML, query paths, HEAD and content types', async t => {
  const root = await fixture(t);
  const server = await startStaticServer(root);
  t.after(() => server.close());
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const pathname of ['/', '/index.html', '/index.html?mock=slow']) {
    const res = await request(server.url, pathname);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body, '<h1>fake build</h1>');
  }
  const head = await request(server.url, '/', {method: 'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(head.headers['content-type'], 'text/html; charset=utf-8');
  for (const [extension, type] of Object.entries({
    txt: 'text/plain; charset=utf-8', js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', bin: 'application/octet-stream'
  })) {
    await fs.writeFile(path.join(root, 'asset.' + extension), 'fake asset');
    const res = await request(server.url, '/asset.' + extension);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], type);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('T015 static server rejects missing files, directories, methods and malformed paths', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'folder'));
  const server = await startStaticServer(root);
  t.after(() => server.close());
  for (const [pathname, method, status] of [
    ['/missing', 'GET', 404], ['/folder', 'GET', 404],
    ['/', 'POST', 405], ['/%E0%A4%A', 'GET', 400]
  ]) {
    const res = await request(server.url, pathname, {method});
    assert.equal(res.status, status);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('T015 raw traversal paths cannot read outside root', async t => {
  const server = await startStaticServer(await fixture(t));
  t.after(() => server.close());
  for (const pathname of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt']) {
    const res = await request(server.url, pathname);
    assert.equal(res.status, 403);
    assert.ok(!res.body.includes('outside-secret-marker'));
  }
});

test('T015 static server serves a junction root and rejects a missing root', async t => {
  const root = await fixture(t);
  await assert.rejects(startStaticServer(path.join(root, 'missing-root')), {code: 'ENOENT'});
  const link = path.join(path.dirname(root), 'linked-dist');
  await fs.symlink(root, link, 'junction');
  const server = await startStaticServer(link);
  t.after(() => server.close());
  const res = await request(server.url, '/index.html');
  assert.equal(res.status, 200);
  assert.equal(res.body, '<h1>fake build</h1>');
});

test('T015 a junction inside root cannot expose an outside directory', async t => {
  const root = await fixture(t);
  await fs.symlink(path.dirname(root), path.join(root, 'outside'), 'junction');
  const server = await startStaticServer(root);
  t.after(() => server.close());
  const res = await request(server.url, '/outside/secret.txt');
  assert.notEqual(res.status, 200);
  assert.ok(!res.body.includes('outside-secret-marker'));
});

test('T015 close terminates keep-alive connections within two seconds and is repeatable', async t => {
  const server = await startStaticServer(await fixture(t));
  t.after(() => server.close());
  const agent = new http.Agent({keepAlive: true});
  t.after(() => agent.destroy());
  assert.equal((await request(server.url, '/', {agent})).status, 200);
  let timer;
  try {
    await Promise.race([
      Promise.all([server.close(), server.close()]),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('close exceeded 2 seconds')), 2000); })
    ]);
  } finally {
    clearTimeout(timer);
  }
  await server.close();
  await assert.rejects(request(server.url));
});

test('T015 runE2e passes FQ_BASE, preserves exit code and closes server', async t => {
  const root = await fixture(t);
  const distFile = path.join(root, 'custom build.html');
  const resultFile = path.join(root, 'observed-url.txt');
  await fs.writeFile(distFile, 'child fixture');
  const counts = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  const code = await runE2e({distFile, command: process.execPath, shell: false, args: ['-e', `
    const fs = require('node:fs');
    const http = require('node:http');
    fs.writeFileSync(${JSON.stringify(resultFile)}, process.env.FQ_BASE);
    http.get(process.env.FQ_BASE, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => process.exit(res.statusCode === 200 && body === 'child fixture' ? 3 : 9));
    }).on('error', () => process.exit(8));
  `]});
  assert.equal(code, 3);
  const base = await fs.readFile(resultFile, 'utf8');
  assert.equal(new URL(base).pathname, '/custom%20build.html');
  await assert.rejects(request(base));
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), counts);
});

test('T015 runE2e spawn failure returns one, closes server and removes listeners', async t => {
  const root = await fixture(t);
  let url;
  const originalListen = http.Server.prototype.listen;
  t.mock.method(http.Server.prototype, 'listen', function (...args) {
    this.once('listening', () => { url = 'http://127.0.0.1:' + this.address().port; });
    return originalListen.apply(this, args);
  });
  const counts = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  assert.equal(await runE2e({distFile: path.join(root, 'index.html'), command: path.join(root, 'missing-command'), args: [], shell: false}), 1);
  assert.ok(url);
  await assert.rejects(request(url));
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), counts);
});

test('T015 runE2e rejects missing dist with the required message', async t => {
  const distFile = path.join(await fixture(t), 'missing.html');
  await assert.rejects(runE2e({distFile, command: process.execPath, args: []}), {
    message: `找不到 ${distFile}，請先執行 npm run build`
  });
});

test('T015 spec uses FQ_BASE and package exposes the exact e2e command', async () => {
  const spec = await fs.readFile(path.join(__dirname, 'e2e/reward.spec.js'), 'utf8');
  assert.ok(!spec.includes('pathToFileURL'));
  assert.ok(spec.includes('process.env.FQ_BASE'));
  assert.ok(!spec.includes('route=>route.abort())'));
  const pkg = JSON.parse(await fs.readFile(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.scripts.e2e, 'node tools/build.js && node tools/e2e.js');
});
