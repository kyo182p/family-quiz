'use strict';

const { createGasEnv } = require('../test/fake-gas');

function measure() {
  const env = createGasEnv(); // Default lockMode is 'real'.
  env.run('setup');
  const code = 'TEST-0000';
  function post(action, extra = {}) {
    const result = env.doPost({ code, action, ...extra });
    if (result.ok !== true) throw new Error(`${action}: ${JSON.stringify(result)}`);
    return result;
  }
  // Follow backend.test.js's seedP2 and parentSession helpers.
  post('playerList');
  env.sheets.get('玩家').appendRow([code, 'p2', '測試二', '🐢', 1, '啟用', new Date(env.clock.now()), new Date(env.clock.now()), '']);
  const { setupCode } = post('adminIssueSetupCode', {
    token: env.props.getProperty('ADMIN_TOKEN'), family: code,
  });
  const { session } = post('parentSetPin', { setupCode, pin: '123456' });
  for (const playerId of ['p1', 'p2']) {
    post('badges', { playerId, badges: { fixture: {
      earned: Array.from({ length: 10 }, (_, i) => ({ at: env.clock.now() - i, dark: i >= 5 })),
    } } });
  }
  const rewards = Array.from({ length: 3 }, (_, i) => post('rewardSave', {
    session, reward: { name: `測試獎項${i + 1}`, silver: 1, gold: 1,
      goldForSilver: false, weeklyLimit: 0, enabled: true },
  }).reward);
  const pendingIds = [];
  for (const playerId of ['p1', 'p2']) {
    for (let i = 0; i < 2; i++) {
      const { redeem } = post('redeemRequest', {
        playerId, rewardId: rewards[i].id, requestId: `seed-${playerId}-${i}`,
      });
      if (playerId === 'p1') pendingIds.push(redeem.id);
    }
  }
  const requests = [
    ['rewardList', { playerId: 'p1' }],
    ['myRedeems', { playerId: 'p1' }],
    ['redeemList', { session }],
    ['balance', { playerId: 'p1' }],
    ['playerList', { withBalance: true }],
    ['parentLog', { session }],
    ['redeemRequest', { playerId: 'p1', rewardId: rewards[2].id, requestId: 'measure-new-request' }],
    ['redeemDecide', { session, id: pendingIds[0], decision: 'approve' }],
    ['pingLite', {}],
    ['badges', { playerId: 'p1', badges: {} }],
    ['redeemCancel', { playerId: 'p1', id: pendingIds[0] }],
    ['redeemDecide', { session, id: pendingIds[1], decision: 'reject' }],
  ];
  const baseline = env.snapshot();
  return requests.map(([action, extra]) => {
    const times = [];
    let reads, locks, opens;
    let ok = true;
    for (let i = 0; i < 20; i++) {
      env.restore(baseline);
      env.stats.reset();
      const start = process.hrtime.bigint();
      const result = env.doPost({ code, action, ...extra });
      times.push(Number(process.hrtime.bigint() - start) / 1e6);
      ok = ok && result.ok === true;
      reads = { ...env.stats.reads };
      locks = env.stats.locks;
      opens = env.stats.opens;
    }
    times.sort((a, b) => a - b);
    return { action, ...(extra.decision ? {decision:extra.decision} : {}), ok, reads, locks, opens, totalReads: Object.values(reads).reduce((a, b) => a + b, 0),
      medianMs: (times[9] + times[10]) / 2 };
  });
}

function markdown(results) {
  return [
    '| 動作 | 鎖 | 開表次數 | 讀表次數(各表) | 讀表總次數 | 耗時中位數 ms |',
    '| --- | --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${r.action}${r.decision ? ' ('+r.decision+')' : ''} | ${r.locks} | ${r.opens} | ${Object.keys(r.reads).sort().map(name => `${name}×${r.reads[name]}`).join(', ')} | ${r.totalReads} | ${r.medianMs.toFixed(3)} |`),
  ].join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--json')) {
    throw new Error('Usage: node tools/measure-reward.js [--json <檔名>]');
  }
  const results = measure();
  console.log(markdown(results));
  if (args.length) require('node:fs').writeFileSync(args[1], JSON.stringify(results, null, 2) + '\n');
  if (results.some(r => !r.ok)) process.exitCode = 1;
}

module.exports = { measure };
