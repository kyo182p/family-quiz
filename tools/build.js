'use strict';
const fs = require('node:fs');
const path = require('node:path');
function build(options = {}) {
  const root = path.join(__dirname, '..');
  const outDir = options.outDir || path.join(root, 'dist');
  let html = options.html === undefined ? fs.readFileSync(path.join(root, 'index.html'), 'utf8') : options.html;
  const config = /^const CONFIG=\{API_URL:'[^']*'\};\r?$/m;
  if (!config.test(html)) throw new Error('Missing CONFIG API_URL line');
  html = html.replace(config, "const CONFIG={API_URL:'mock://gas'};");
  if (html.includes('script.google.com')) throw new Error('Production endpoint remains');
  const main = /<main id="app">[\s\S]*?<\/main>/;
  if (!main.test(html)) throw new Error('Missing app container');
  const fake = fs.readFileSync(path.join(root, 'test/fake-gas.js'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
  const mock = fs.readFileSync(path.join(root, 'tools/mock-backend.js'), 'utf8');
  const fixtures = Object.fromEntries(['page','check'].map(name => [name,JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/diag-'+name+'.json'),'utf8'))]));
  const boot = `${fake}\nwindow.MOCK_GAS_SOURCE=${JSON.stringify(source)};\nwindow.MOCK_DIAG_FIXTURES=${JSON.stringify(fixtures)};\n${mock}`.replace(/<\/script/gi, '<\\/script');
  const banner = '<div style="padding:8px 12px;background:var(--sun-soft);color:var(--sun-ink);text-align:center">假後端示範。家長設定碼：MOCK2345</div>';
  html = html.replace(main, match => `${banner}\n${match}\n<script>${boot}</script>`);
  if (html.includes('script.google.com')) throw new Error('Production endpoint remains');
  fs.mkdirSync(outDir, {recursive:true});
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.copyFileSync(path.join(root, 'zhuyin-tw.txt'), path.join(outDir, 'zhuyin-tw.txt'));
  return outDir;
}
module.exports = {build};
if (require.main === module) {build(); console.log('Built dist with mock backend');}
