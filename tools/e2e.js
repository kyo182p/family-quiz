'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {startStaticServer} = require('./e2e-server');

async function runE2e({distFile, command, args, shell}) {
  try {
    if (!(await fs.stat(distFile)).isFile()) throw new Error('Not a file');
  } catch {
    throw new Error(`找不到 ${distFile}，請先執行 npm run build`);
  }
  const server = await startStaticServer(path.dirname(distFile));
  let child;
  const stop = signal => { if (child) child.kill(signal); };
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  try {
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', terminate);
    return await new Promise(resolve => {
      child = spawn(command, args, {
        shell,
        stdio: 'inherit',
        env: {...process.env, FQ_BASE: server.url + '/' + encodeURIComponent(path.basename(distFile))}
      });
      child.once('error', () => resolve(1));
      child.once('close', code => resolve(code === null ? 1 : code));
    });
  } catch {
    return 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    await server.close();
  }
}

module.exports = {runE2e};

if (require.main === module) {
  try {
    require.resolve('@playwright/test');
  } catch {
    console.error('沒有安裝 Playwright。雲端請先執行：');
    console.error('npm i --no-save @playwright/test && npx playwright install chromium');
    process.exitCode = 1;
    return;
  }
  runE2e({
    distFile: path.resolve(process.env.FQ_DIST || 'dist/index.html'),
    command: 'npx',
    args: ['playwright', 'test', 'test/e2e/reward.spec.js', ...process.argv.slice(2)],
    shell: process.platform === 'win32'
  }).then(code => { process.exitCode = code; }, error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
