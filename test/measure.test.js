'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGasEnv } = require('./fake-gas');
const { measure } = require('../tools/measure-reward');

test('T018 counts getValues calls once per range, preserving cell hooks and values', () => {
  const env = createGasEnv();
  env.run('setup');
  const sheet = env.sheets.get('家庭');
  env.stats.reset();
  let hooks = 0;
  env.onSheetOp(() => hooks++);
  const first = sheet.getDataRange().getValues();
  assert.deepEqual(sheet.getDataRange().getValues(), first);
  assert.equal(env.stats.reads['家庭'], 2);
  assert.equal(hooks, 2 * first.length * first[0].length);
});

test('T018 counts getScriptLock calls', () => {
  const env = createGasEnv({ source: 'function takeLock() { return LockService.getScriptLock(); }' });
  const lock = env.run('takeLock');
  assert.equal(env.stats.locks, 1);
  assert.equal(lock.tryLock(0), true);
  lock.releaseLock();
});

test('T018 excludes getValue and reset clears reads and locks', () => {
  const env = createGasEnv({ source: 'function takeLock() { LockService.getScriptLock(); }' });
  // Use setup from the real environment for a sheet without requiring product changes.
  const real = createGasEnv();
  real.run('setup');
  env.restore(real.snapshot());
  const sheet = env.sheets.get('家庭');
  sheet.getDataRange().getValues();
  env.run('takeLock');
  const before = { ...env.stats.reads };
  sheet.getRange(1, 1).getValue();
  assert.deepEqual(env.stats.reads, before);
  env.stats.reset();
  assert.deepEqual(env.stats.reads, {});
  assert.equal(env.stats.locks, 0);
  assert.equal(env.stats.opens, 0);
  sheet.getRange(1, 1).getValue();
  assert.deepEqual(env.stats.reads, {});
});

test('T018/T023 measure returns all twelve successful cases with unchanged baseline reads', () => {
  const results = measure();
  assert.deepEqual(results.map(r => r.action), [
    'rewardList', 'myRedeems', 'redeemList', 'balance', 'playerList', 'parentLog', 'redeemRequest', 'redeemDecide',
    'pingLite', 'badges', 'redeemCancel', 'redeemDecide',
  ]);
  for (const result of results) {
    assert.equal(result.ok, true, result.action);
    assert.ok(Number.isFinite(result.medianMs) && result.medianMs >= 0);
    assert.equal(result.totalReads, Object.values(result.reads).reduce((a, b) => a + b, 0));
    if (result.action === 'pingLite') assert.equal(result.totalReads, 0);
    else assert.ok(result.totalReads > 0);
    assert.ok(Number.isInteger(result.locks) && result.locks >= 0);
    assert.ok(Number.isInteger(result.opens) && result.opens >= 0);
  }
  assert.deepEqual(results.slice(0,8).map(r => r.totalReads), [5,3,4,4,4,5,11,7]);
  assert.deepEqual(results.filter(r => r.action === 'redeemDecide').map(r => r.decision), ['approve','reject']);
  assert.equal(results.find(r => r.action === 'pingLite').opens, 0);
});
