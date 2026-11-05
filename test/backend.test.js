'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createGasEnv } = require('./fake-gas');

const code = 'TEST-0000';
const plain = value => JSON.parse(JSON.stringify(value));
function setup(options) {
  const env = createGasEnv(options);
  env.run('setup');
  return env;
}
function post(env, action, extra = {}) { return env.doPost({ code, action, ...extra }); }
function bank(id = 'bank-test') {
  return { id, title: '測試題庫', concepts: [{ id: 'c1', text: '加法' }], questions: [
    { id: 'q1', c: 'c1', t: 'mc', lv: 1, q: '一加一？', o: ['一', '二'], a: '二', why: '測試解說' },
  ] };
}

test('baseline: setup is idempotent; ping accepts TEST-0000 and rejects a bad code', () => {
  const env = setup();
  env.run('setup');
  assert.equal(env.sheets.get('家庭').getLastRow(), 2);
  assert.equal(post(env, 'ping').ok, true);
  assert.equal(post(env, 'ping', { code: 'INVALID-TEST' }).code, 'bad_code');
});

test('baseline: saveBank/listBanks preserve content and split JSON above 45000 characters', () => {
  const env = setup();
  const small = bank();
  assert.deepEqual(post(env, 'saveBank', { bank: small }), { ok: true });
  assert.deepEqual(post(env, 'listBanks').banks, [small]);
  const large = { ...bank('large-test'), notes: '測'.repeat(95000) };
  const json = JSON.stringify(large);
  assert.ok(json.length > 90000);
  assert.deepEqual(post(env, 'saveBank', { bank: large }), { ok: true });
  const row = env.sheets.get('題庫').getRange(3, 1, 1, 10).getValues()[0];
  assert.equal(row[6], Math.ceil(json.length / 45000));
  assert.equal(row[7].length, 45000);
  assert.equal(row[8].length, 45000);
  assert.equal(row.slice(7).join(''), json);
  assert.deepEqual(post(env, 'listBanks').banks, [small, large]);
  // Replacing with fewer chunks must remove the old tail rather than corrupt JSON.
  const replacement = bank('large-test');
  assert.equal(post(env, 'saveBank', { bank: replacement }).ok, true);
  assert.equal(env.sheets.get('題庫').getRange(3, 9, 1, 2).getValues()[0].join(''), '');
  assert.deepEqual(post(env, 'listBanks').banks, [small, replacement]);
});

test('baseline: badges union earned timestamps across syncs and deduplicate repeats', () => {
  const env = setup();
  const first = { cells: ['a'], ok: [1, 0, 0], earned: [{ at: 100, dark: false }] };
  const second = { cells: ['b'], ok: [0, 1, 0], earned: [{ at: 200, dark: true }] };
  assert.equal(post(env, 'badges', { badges: { demo: first } }).ok, true);
  const result = post(env, 'badges', { badges: { demo: second } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.badges.demo.earned, [{ at: 100, dark: false }, { at: 200, dark: true }]);
  assert.deepEqual(post(env, 'badges', { badges: { demo: first } }).badges.demo.earned, result.badges.demo.earned);
  assert.equal(env.sheets.get('徽章').getLastRow(), 2);
});

for (const method of ['appendRow', 'setValues', 'setValue']) {
  test(`storage bait: ${method} coerces dates/numbers/booleans and records formulas, including headers`, () => {
    // Use the injected service through a source function, without exposing the vm context.
    const probe = createGasEnv({ source: 'function sheet() { return SpreadsheetApp.getActive().insertSheet("bait"); }' });
    const sh = probe.run('sheet');
    const values = ['2026-11-02', "'2026-11-02", '=1+1', "'=1+1", '123', 'abc', 'TRUE', 'false', "''abc", '2026/11/02'];
    if (method === 'appendRow') sh.appendRow(values);
    else if (method === 'setValues') sh.getRange(1, 1, 1, values.length).setValues([values]);
    else values.forEach((v, i) => sh.getRange(1, i + 1).setValue(v));
    const row = sh.getRange(1, 1, 1, values.length + 1).getValues()[0];
    assert.ok(row[0] instanceof Date);
    assert.equal(row[0].getTime(), Date.parse('2026-11-02T00:00:00+08:00'));
    assert.equal(row[1], '2026-11-02');
    assert.deepEqual(row[2], { formula: '=1+1' });
    assert.equal(row[3], '=1+1');
    assert.equal(row[4], 123);
    assert.equal(row[5], 'abc');
    assert.equal(row[6], true);
    assert.equal(row[7], false);
    assert.equal(row[8], "'abc");
    assert.ok(row[9] instanceof Date);
    assert.equal(row[10], '');
    assert.deepEqual(probe.formulaCells, [{ sheet: 'bait', row: 1, col: 3, formula: '=1+1' }]);
  });
}

test('storage: text format, rectangular reads, defensive copies, deleteRow and clear preserve formats', () => {
  const env = createGasEnv({ source: 'function sheet() { return SpreadsheetApp.getActive().insertSheet("text"); }' });
  const sh = env.run('sheet');
  sh.getRange(1, 1, 2, 4).setNumberFormat('@').setFontWeight('bold');
  sh.appendRow(['2026-11-02', '123', 'TRUE', '=1+1']);
  assert.deepEqual(sh.getDataRange().getValues(), [['2026-11-02', '123', 'TRUE', '=1+1']]);
  assert.equal(env.formulaCells.length, 0);
  sh.getRange(2, 1, 1, 4).setValues([['a', 'b', 'c', 'd']]);
  sh.deleteRow(1);
  assert.equal(sh.getLastRow(), 1);
  sh.getRange(1, 2).setValue('123');
  assert.equal(sh.getRange(1, 2).getValue(), '123');
  sh.clearContents();
  assert.equal(sh.getLastRow(), 0);
  assert.equal(sh.getLastColumn(), 0);
  sh.getRange(5, 3).setValue(new Date(100));
  const result = sh.getRange(4, 2, 2, 2).getValues();
  assert.deepEqual(result[0], ['', '']);
  result[1][1].setTime(200);
  assert.equal(sh.getRange(5, 3).getValue().getTime(), 100);
  sh.clearContents();
  assert.equal(sh.getLastRow(), 0);
  assert.deepEqual(sh.getDataRange().getValues(), [['']]);
  assert.throws(() => sh.getRange(0, 1), /Invalid range/);
  assert.throws(() => sh.getRange(1, 1, 2, 2).setValues([['x']]), /dimensions/);
});

test('clock bait: vm Date constructors, Date.now, instanceof and cache TTL use the same clock', () => {
  const source = `function probe(x) { return [new Date().getTime(), Date.now(), new Date(x).getTime(), new Date() instanceof Date]; }`;
  const env = createGasEnv({ source });
  const time = Date.parse('2026-11-05T16:00:00Z');
  env.clock.set(time);
  assert.deepEqual(plain(env.run('probe', 123)), [time, time, 123, true]);
  env.cache.put('test', 'value', 2);
  env.clock.advance(1999);
  assert.equal(env.cache.get('test'), 'value');
  env.clock.advance(1);
  assert.equal(env.cache.get('test'), null);
  env.clock.advance(1);
  assert.equal(env.cache.get('test'), null);
  assert.equal(env.run('probe', 123)[1], time + 2001);
});

test('clock integration: existing backend daily keys and stored Dates follow Taipei midnight', () => {
  const env = setup();
  env.clock.set(Date.parse('2026-11-01T15:59:59Z'));
  assert.equal(env.run('countKey', { code }), 'cnt_20261101_TEST-0000');
  env.clock.advance(1000);
  assert.equal(env.run('countKey', { code }), 'cnt_20261102_TEST-0000');
  assert.equal(post(env, 'saveBank', { bank: bank() }).ok, true);
  const stored = env.sheets.get('題庫').getRange(2, 4).getValue();
  assert.ok(stored instanceof Date);
  assert.equal(stored.getTime(), Date.parse('2026-11-01T16:00:00Z'));
});

test('utilities: timezone tokens, UTF-8 base64, signed digest/HMAC bytes and UUID', () => {
  const env = createGasEnv({ source: `function probe() {
    return { taipei: Utilities.formatDate(new Date('2026-11-01T16:02:03Z'), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
      utc: Utilities.formatDate(new Date('2026-11-01T16:02:03Z'), 'UTC', 'yyyy/MM/dd HH:mm:ss'),
      md5: Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, 'abc'),
      sha: Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc')),
      hmac: Utilities.computeHmacSha256Signature('The quick brown fox jumps over the lazy dog', 'key'),
      text: Utilities.base64Encode('你好'), uuid: Utilities.getUuid() };
  }` });
  const r = plain(env.run('probe'));
  const hex = bytes => Buffer.from(bytes.map(n => n & 255)).toString('hex');
  assert.equal(r.taipei, '2026-11-02 00:02:03');
  assert.equal(r.utc, '2026/11/01 16:02:03');
  assert.equal(hex(r.md5), '900150983cd24fb0d6963f7d28e17f72');
  assert.ok(r.md5.some(n => n < 0));
  assert.ok(r.hmac.every(n => n >= -128 && n <= 127));
  assert.equal(r.sha, 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
  assert.equal(hex(r.hmac), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.equal(r.text, '5L2g5aW9');
  assert.match(r.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('utilities: injected hash adapter receives inputs and its bytes are signed', () => {
  const calls = [];
  const env = createGasEnv({
    source: `function probe() { return [Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc'), Utilities.computeHmacSha256Signature('value', 'key')]; }`,
    hash: {
      digest(...args) { calls.push(args); return [0, 127, 128, 255]; },
      hmac(...args) { calls.push(args); return [255]; },
    },
  });
  assert.deepEqual(plain(env.run('probe')), [[0, 127, -128, -1], [-1]]);
  assert.deepEqual(calls, [['sha256', 'abc'], ['value', 'key']]);
});

for (const lockMode of ['real', 'none']) {
  test(`concurrency bait: ${lockMode} lock ${lockMode === 'real' ? 'defers until runDeferred' : 'allows immediate nested execution'}`, () => {
    const env = setup({ lockMode });
    const events = [];
    let fired = false;
    env.onSheetOp(op => {
      if (fired || op.sheet !== '題庫' || op.op !== 'write') return;
      fired = true;
      // putBank holds its script lock at this write.
      events.push(post(env, 'saveBank', { bank: bank('nested-one') }));
      events.push(post(env, 'saveBank', { bank: bank('nested-two') }));
    });
    assert.equal(post(env, 'saveBank', { bank: bank('outer') }).ok, true);
    assert.ok(fired);
    env.onSheetOp(null);
    if (lockMode === 'real') {
      assert.deepEqual(events, [{ deferred: true }, { deferred: true }]);
      assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer']);
      assert.deepEqual(env.runDeferred(), [{ ok: true }, { ok: true }]);
      assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer', 'nested-one', 'nested-two']);
    } else {
      assert.deepEqual(events, [{ ok: true }, { ok: true }]);
      assert.deepEqual(env.runDeferred(), []);
      // With no lock, the nested first write and outer write chose the same row.
      assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer', 'nested-two']);
    }
    assert.deepEqual(env.runDeferred(), []);
  });
}

test('hooks run before both reads and writes; real mode does not defer unlocked requests', () => {
  const env = setup();
  let fired = false;
  env.onSheetOp(op => {
    if (fired || op.op !== 'read') return;
    fired = true;
    assert.equal(post(env, 'ping').ok, true);
  });
  assert.equal(post(env, 'ping').ok, true);
  assert.ok(fired);
});

test('busy bait: saveBank returns ok:false without throwing, and error text is searchable in logs', () => {
  const env = setup({ lockMode: 'busy' });
  const result = post(env, 'saveBank', { bank: bank() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'server_error');
  assert.match(env.logs.join('\n'), /Lock busy/);
  assert.deepEqual(post(env, 'listBanks').banks, []);
});

test('source injection: tryLock busy result, property strings and all console levels are observable', () => {
  const env = createGasEnv({ lockMode: 'busy', source: `function probe() {
    const p = PropertiesService.getScriptProperties(); p.setProperty('fake', 123);
    console.log('log bait'); console.warn('warn bait'); console.error(new Error('error bait'));
    return [LockService.getScriptLock().tryLock(1), p.getProperty('fake')];
  }` });
  assert.deepEqual(plain(env.run('probe')), [false, '123']);
  for (const text of ['log bait', 'warn bait', 'error bait']) assert.ok(env.logs.join('\n').includes(text));
  env.props.deleteProperty('fake');
  assert.equal(env.props.getProperty('fake'), null);
});

test('source injection: removing the lock exposes an interleaving that the real lock prevents', () => {
  const source = readFileSync(join(__dirname, '..', 'Code.gs'), 'utf8');
  const mutated = source.replace('if (lock) lock.waitLock(20000);', '/* deliberately removed for harness counterexample */');
  assert.notEqual(mutated, source);
  const env = setup({ source: mutated });
  let fired = false, nested;
  env.onSheetOp(op => {
    if (fired || op.sheet !== '題庫' || op.op !== 'write') return;
    fired = true;
    nested = post(env, 'saveBank', { bank: bank('nested') });
  });
  assert.equal(post(env, 'saveBank', { bank: bank('outer') }).ok, true);
  assert.deepEqual(nested, { ok: true });
  env.onSheetOp(null);
  assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer']);
});
