'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createGasEnv } = require('./fake-gas');

const code = 'TEST-0000';
const plain = value => JSON.parse(JSON.stringify(value));
const earned = (...ats) => ({earned:ats.map(at => ({at,dark:false}))});
function newPlayer(env) { return post(env,'playerSave',{name:'測試玩家',icon:'🦊'}).player.id; }
function seedP2(env) {
  post(env,'playerList');
  env.sheets.get('玩家').appendRow([code,'p2','測試二','🐢',1,'啟用',new Date(),new Date(),'']);
}
const balance = (env, playerId='p1') => post(env,'balance',{playerId});
const ledger = env => env.sheets.get('徽章入帳').getDataRange().getValues().slice(1);
function setup(options) {
  const env = createGasEnv(options);
  env.run('setup');
  return env;
}
function withoutTiming(value) { const {timing, ...result} = value; return result; }
function post(env, action, extra = {}) { return withoutTiming(env.doPost({ code, action, ...extra })); }

function assertTiming(result) {
  assert.deepEqual(Object.keys(result.timing).sort(), ['open','lock','read','reads','sync','write','compute','cache','total'].sort());
  for (const value of Object.values(result.timing)) {
    assert.equal(typeof value, 'number');
    assert.ok(Number.isFinite(value) && Number.isInteger(value) && value >= 0);
  }
  const t = result.timing;
  assert.equal(t.compute, Math.max(0,t.total-t.open-t.lock-t.read-t.write));
  assert.equal(t.cache, 0);
}

test('T023 responses carry exactly nine numeric timing fields including bad_code and malformed JSON', () => {
  const env = setup(), session = parentSession(env);
  fund(env);
  const reward = saveReward(env,session);
  for (const [action, extra] of [
    ['rewardList', {}], ['myRedeems', {}],
    ['redeemRequest', {rewardId:reward.id, requestId:'timing-request-01'}],
    ['badges', {playerId:'p1', badges:{}}], ['pingLite', {}],
    ['rewardList', {code:'INVALID'}],
  ]) {
    const result = env.doPost({code, action, ...extra});
    assert.equal(result.ok, extra.code !== 'INVALID', action);
    if (extra.code) assert.equal(result.code, 'bad_code');
    assertTiming(result);
  }
  const malformed = JSON.parse(env.run('doPost', {postData:{contents:'{'}}).getContent());
  assert.equal(malformed.code, 'bad_request');
  assertTiming(malformed);
});

test('T023 pingLite never opens or reads sheets; rewardList timing counts actual reads per request', () => {
  const env = setup();
  post(env,'rewardList');
  env.stats.reset();
  const result = env.doPost({code, action:'rewardList'});
  assertTiming(result);
  assert.equal(result.timing.reads, Object.values(env.stats.reads).reduce((a,b) => a+b,0));
  assert.ok(result.timing.reads > 0);
  env.stats.reset();
  const ping = env.doPost({action:'pingLite'});
  assertTiming(ping);
  assert.equal(ping.ok, true);
  assert.equal(env.stats.opens, 0);
  assert.deepEqual(env.stats.reads, {});
  assert.equal(ping.timing.reads, 0);
  assert.equal(ping.timing.open, 0);
  assert.equal(env.stats.locks, 0);
});

test('T023 setup creates one ten-minute keepWarm trigger and keepWarm never opens sheets', () => {
  const env = setup();
  env.run('setup');
  assert.deepEqual(env.triggers.filter(t => t.handler === 'keepWarm'), [{handler:'keepWarm', minutes:10}]);
  env.stats.reset();
  env.run('keepWarm');
  assert.equal(env.stats.opens, 0);
  assert.deepEqual(env.stats.reads, {});
});
function bank(id = 'bank-test') {
  return { id, p1At: 0, title: '測試題庫', concepts: [{ id: 'c1', text: '加法' }], questions: [
    { id: 'q1', c: 'c1', t: 'mc', lv: 1, q: '一加一？', o: ['一', '二'], a: '二', why: '測試解說' },
  ] };
}

test('T002 setup: adds sheets and fifth badge header without overwriting old data', () => {
  const env = setup();
  const sh = env.sheets.get('徽章');
  sh.getRange(1,5).clearContent();
  sh.appendRow([code,'家庭',new Date(),'{}']);
  env.run('setup'); env.run('setup');
  assert.equal(sh.getRange(1,5).getValue(),'玩家ID');
  assert.equal(sh.getLastRow(),2);
  assert.equal(env.sheets.get('玩家').getLastRow(),1);
  assert.equal(env.sheets.get('徽章入帳').getLastColumn(),9);
  env.sheets.delete('玩家'); env.sheets.delete('徽章入帳');
  assert.equal(post(env,'ping').ok,true);
  assert.equal(post(env,'saveBank',{bank:bank()}).ok,true);
  assert.equal(post(env,'playerList').players.length,1);
  assert.equal(post(env,'playerList').players.length,1);
});

test('A1: legacy saves preserve all p2 progress and badge fields', () => {
  const env = setup(); seedP2(env);
  const p2 = {rec:{q1:2},days:['day'],summary:'keep',badge:earned(100),updatedAt:200};
  assert.equal(post(env,'saveBank',{bank:{...bank(),players:{p2}}}).ok,true);
  assert.equal(post(env,'saveBank',{bank:{...bank(),rec:{q1:1},updatedAt:900}}).ok,true);
  const saved = post(env,'listBanks').banks[0];
  assert.deepEqual(saved.players.p2,p2);
  assert.equal(saved.p1At,900);
});

test('T002 R2: legacy frontend echoes cloud players unchanged while saving new p1 answers', () => {
  const env = setup(); seedP2(env);
  const p2 = {rec:{q1:2},days:['day'],summary:'keep',badge:earned(100),updatedAt:200};
  post(env,'saveBank',{bank:{...bank(),p1At:200,updatedAt:200,rec:{q1:0},players:{p2}}});
  const echoed = post(env,'listBanks').banks[0];
  const before = plain(echoed.players);
  // Existing bsSave only updates updatedAt; it has no players/p1At logic.
  echoed.rec = {q1:1}; echoed.days = ['new-day']; echoed.summary = 'new-p1'; echoed.updatedAt = 900;
  assert.equal(post(env,'saveBank',{bank:echoed}).ok,true);
  const saved = post(env,'listBanks').banks[0];
  assert.deepEqual(saved.players,before);
  assert.deepEqual(saved.rec,{q1:1}); assert.deepEqual(saved.days,['new-day']);
  assert.equal(saved.summary,'new-p1');
});

test('T002 R2: empty safeCell values stay empty and normal ledger anomalies read as empty', () => {
  const env = setup();
  for (const value of ['',null,undefined]) assert.equal(env.run('safeCell',value),'');
  assert.equal(env.run('safeCell',0),"'0");
  assert.equal(env.run('safeCell',false),"'false");
  assert.equal(post(env,'playerSave',{playerId:'p1',name:'測試',icon:'🌱'}).ok,true);
  assert.equal(post(env,'saveBank',{bank:bank()}).ok,true);
  assert.equal(post(env,'badges',{badges:{demo:earned(100)}}).ok,true);
  assert.equal(ledger(env).length,1);
  assert.equal(ledger(env)[0][6],'');
  assert.equal(balance(env).silver.total,1);
  for (const [name,sh] of env.sheets) {
    for (const [i,row] of sh.getDataRange().getValues().entries()) {
      for (const [j,value] of row.entries()) assert.notEqual(value,"'",`${name} R${i+1}C${j+1}`);
    }
  }
  // Verify the stricter fake independently after scanning application writes.
  env.sheets.get('玩家').getRange(2,3).setValue("'");
  assert.equal(env.sheets.get('玩家').getRange(2,3).getValue(),"'");
});

test('T002 R2: invalid badge key is skipped while valid key is stored and credited', () => {
  const env = setup();
  const result = post(env,'badges',{badges:{valid:earned(100),'bad:key':earned(200)}});
  assert.equal(result.ok,true);
  assert.deepEqual(Object.keys(result.badges),['valid']);
  const stored = JSON.parse(env.sheets.get('徽章').getRange(2,4).getValue());
  assert.deepEqual(Object.keys(stored),['valid']);
  assert.deepEqual(ledger(env).map(r=>r[2]),['valid']);
  assert.equal(balance(env).silver.total,1);
});

test('T002 R2: first balance backfills cloud p1 bank and legacy badges exactly once', () => {
  const env = setup();
  env.run('putBank',{code},{...bank(),badge:earned(100,101)});
  env.sheets.get('徽章').appendRow([code,'家庭',new Date(),JSON.stringify({old:{earned:[{at:200,dark:true}]}})]);
  assert.equal(env.props.getProperty('ledgerinit:'+code+':p1'),null);
  assert.equal(ledger(env).length,0);
  const first = balance(env);
  assert.deepEqual(first,{ok:true,silver:{available:2,held:0,total:2},gold:{available:1,held:0,total:1}});
  assert.deepEqual(balance(env),first);
  assert.equal(ledger(env).length,3);
  assert.ok(ledger(env).every(r=>r[8]==='補入' && r[6]===''));
});

test('A1 merge: player clocks beat bank updatedAt; earned unions; unknown/disabled pids discarded', () => {
  const env = setup(); seedP2(env);
  post(env,'saveBank',{bank:{...bank(),p1At:500,rec:'p1-cloud',days:[1],summary:'cloud',badge:earned(100),players:{p2:{rec:'p2-cloud',days:[2],summary:'p2',updatedAt:500,badge:earned(200)}}}});
  post(env,'saveBank',{bank:{...bank(),updatedAt:900,p1At:1,rec:'stale',players:{p2:{rec:'stale',updatedAt:1,badge:earned(300)},pbad:{rec:'bad',badge:earned(400)}}}});
  let saved = post(env,'listBanks').banks[0];
  assert.equal(saved.rec,'p1-cloud'); assert.deepEqual(saved.days,[1]); assert.equal(saved.summary,'cloud');
  assert.equal(saved.players.p2.rec,'p2-cloud'); assert.deepEqual(saved.players.p2.days,[2]);
  assert.deepEqual(saved.players.p2.badge.earned.map(e => e.at),[200,300]);
  assert.equal(saved.players.pbad,undefined);
  post(env,'saveBank',{bank:{...bank(),p1At:0,players:{p2:{rec:'new-p2',updatedAt:501}}}});
  saved = post(env,'listBanks').banks[0];
  assert.equal(saved.rec,'p1-cloud'); assert.equal(saved.players.p2.rec,'new-p2');
  env.sheets.get('玩家').getRange(3,6).setValue('停用');
  post(env,'saveBank',{bank:{...bank(),players:{p2:{rec:'disabled',updatedAt:999}}}});
  assert.equal(post(env,'listBanks').banks[0].players.p2.rec,'new-p2');
  assert.equal(post(env,'badges',{playerId:'p2',badges:{}}).code,'player_disabled');
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:bank()}).code,'player_disabled');
});

test('T002 badges: player isolation, blank legacy player ID, reader remains ledger-free, keys independent', () => {
  const env = setup(); seedP2(env);
  env.sheets.get('徽章').appendRow([code,'家庭',new Date(),JSON.stringify({old:earned(100)})]);
  assert.deepEqual(post(env,'badges',{badges:{}}).badges.old,earned(100));
  post(env,'badges',{playerId:'p2',badges:{old:earned(200),another:earned(200)}});
  assert.deepEqual(post(env,'badges',{badges:{}}).badges.old,earned(100));
  assert.equal(balance(env,'p2').silver.total,2);
  assert.equal(env.sheets.get('徽章').getLastRow(),3);
  post(env,'readerCreate');
  // Read the generated reader code directly; its action response shape is unrelated.
  const readerCode = env.sheets.get('閱讀碼').getRange(2,1).getValue();
  const before = ledger(env).length;
  assert.equal(post(env,'badges',{code:readerCode,playerId:'invalid',badges:{demo:earned(300)}}).ok,true);
  assert.equal(ledger(env).length,before);
});

test('F1: cap, exact five-minute boundary, future anomalies stay rejected next day, Taipei midnight', () => {
  const env = setup(); const pid = newPlayer(env), now = env.clock.now();
  post(env,'badges',{playerId:pid,badges:{demo:earned(now+300000)}});
  post(env,'badges',{playerId:pid,badges:{demo:earned(now+300001)}});
  post(env,'badges',{playerId:pid,badges:{demo:earned(...Array.from({length:10},(_,i)=>now-i))}});
  assert.equal(balance(env,pid).silver.total,10);
  assert.equal(ledger(env).filter(r=>r[6]==='時間異常').length,1);
  assert.equal(ledger(env).filter(r=>r[6]==='超過每日上限').length,1);
  env.clock.set(Date.parse('2026-11-05T15:59:59Z'));
  post(env,'badges',{playerId:pid,badges:{demo:earned(now-20)}});
  assert.equal(balance(env,pid).silver.total,10);
  env.clock.advance(1000);
  post(env,'badges',{playerId:pid,badges:{demo:earned(now+300001,now-20,now-21)}});
  assert.equal(balance(env,pid).silver.total,11);
  assert.equal(ledger(env).filter(r=>r[6]==='時間異常').length,1);
});

test('F2: cloud bank plus badge table backfill 7 silver/5 gold once; p1 incoming exempt, p2 incoming capped', () => {
  const env = setup();
  const rec = {earned:Array.from({length:6},(_,i)=>({at:100+i,dark:i>=4}))};
  env.run('putBank',{code},{...bank(),badge:rec});
  env.sheets.get('徽章').appendRow([code,'家庭',new Date(),JSON.stringify({other:{earned:Array.from({length:6},(_,i)=>({at:200+i,dark:i>=3}))}})]);
  for(let i=0;i<2;i++) {
    post(env,'badges',{badges:{}});
    assert.equal(balance(env).silver.total,7); assert.equal(balance(env).gold.total,5);
  }
  assert.ok(ledger(env).every(r=>r[8]==='補入' && !r[6]));
  const pid = newPlayer(env);
  post(env,'badges',{playerId:pid,badges:{fresh:earned(...Array.from({length:15},(_,i)=>300+i))}});
  assert.equal(balance(env,pid).silver.total,10);
  const fresh = setup();
  post(fresh,'saveBank',{bank:{...bank(),badge:earned(...Array.from({length:15},(_,i)=>100+i))}});
  assert.equal(balance(fresh).silver.total,15);
});

test('F2 ledger: dark is immutable; new and legacy bank writes credit; deletions and truncation cannot erase credit', () => {
  const env = setup(); seedP2(env);
  post(env,'saveBank',{bank:{...bank(),badge:earned(100),players:{p2:{updatedAt:1,badge:{earned:[{at:200,dark:true}]}}}}});
  assert.equal(balance(env).silver.total,1); assert.equal(balance(env,'p2').gold.total,1);
  post(env,'badges',{badges:{'bank-test':{earned:[{at:100,dark:true}]}}});
  assert.equal(balance(env).silver.total,1); assert.equal(balance(env).gold.total,0);
  post(env,'saveBank',{bank:{...bank(),badge:earned(300)}});
  assert.equal(balance(env).silver.total,2);
  post(env,'deleteBank',{id:'bank-test'});
  assert.equal(balance(env).silver.total,2);
  assert.equal(balance(env,'p2').gold.total,1);
});

test('T002 adversarial: literal nickname, family ownership, ID/icon/name/player limits and ordering', () => {
  const env = setup();
  // The long injection also exercises the required 12-character rejection.
  assert.equal(post(env,'playerSave',{playerId:'p1',name:'=IMPORTXML("x","y")',icon:'🌱'}).code,'bad_request');
  for(const name of ['=1+1','+1','@a','1/2','TRUE',"'abc",'-cmd']) {
    assert.equal(post(env,'playerSave',{playerId:'p1',name,icon:'🌱'}).ok,true);
    assert.equal(post(env,'playerList').players[0].name,name);
  }
  assert.deepEqual(env.formulaCells,[]);
  env.sheets.get('家庭').appendRow(['OTHER-TEST','測試家庭二',10,true,'',false]);
  const pid = newPlayer(env);
  assert.equal(post(env,'playerSave',{code:'OTHER-TEST',playerId:pid,name:'測試',icon:'🌱'}).code,'bad_player');
  assert.equal(post(env,'playerSave',{code:'OTHER-TEST',playerId:'p1',name:'另一位',icon:'🌱'}).ok,true);
  assert.equal(post(env,'playerList').players[0].name,'-cmd');
  assert.equal(post(env,'playerSave',{playerId:'p1',name:'1234567890123',icon:'🌱'}).code,'bad_request');
  assert.equal(post(env,'playerSave',{name:'測試',icon:'👻'}).code,'bad_request');
  assert.equal(post(env,'badges',{playerId:'=x',badges:{}}).code,'bad_request');
  assert.equal(post(env,'badges',{playerId:'pabsent',badges:{}}).code,'bad_player');
  const skipped = post(env,'badges',{badges:{'=x':earned(100)}});
  assert.equal(skipped.ok,true); assert.deepEqual(skipped.badges,{});
  for(let i=2;i<12;i++) assert.equal(post(env,'playerSave',{name:'測試',icon:'🌱'}).ok,true);
  assert.equal(post(env,'playerSave',{name:'測試',icon:'🌱'}).code,'player_limit');
  env.sheets.get('玩家').getRange(3,6).setValue('停用');
  const players = post(env,'playerList').players;
  assert.equal(players.at(-1).id,pid); assert.equal(players[0].id,'p1');
});

test('T002 busy: saveBank/playerList/badges return busy without writes', () => {
  const env = setup({lockMode:'busy'});
  for (const action of ['saveBank','playerList','badges','balance','playerSave']) {
    assert.equal(post(env,action,{bank:bank(),badges:{},name:'測試',icon:'🌱'}).code,'busy');
  }
  assert.equal(env.sheets.get('玩家').getLastRow(),1);
  assert.equal(env.sheets.get('徽章入帳').getLastRow(),1);
  assert.deepEqual(env.logs,[]);
});

test('T002 privacy/checks: libGet whitelist and mergeChecks still preserves unchanged question check', () => {
  const env = setup(); seedP2(env);
  const b = {...bank(),p1At:200,players:{p2:{rec:'private',updatedAt:200}}};
  b.questions[0].check = {ok:true};
  env.run('putBank',{code},b);
  post(env,'saveBank',{bank:{...bank(),p1At:0,players:{}}});
  assert.deepEqual(post(env,'listBanks').banks[0].questions[0].check,{ok:true});
  env.sheets.get('家庭').getRange(2,6).setValue(true);
  post(env,'setPublish',{id:b.id,published:true});
  const publicBank = post(env,'libGet',{id:b.id}).bank;
  assert.ok(publicBank); assert.equal('players' in publicBank,false); assert.equal('p1At' in publicBank,false);
});

test('T002 fake formula bait: nonnumeric + - @ recorded; signed numbers remain numbers', () => {
  const env = createGasEnv({source:'function probe(){ const s=SpreadsheetApp.getActive().insertSheet("bait"); s.appendRow(["+cmd","-cmd","@a","+1","-2"]); return s.getDataRange().getValues(); }'});
  const rows = env.run('probe');
  assert.equal(env.formulaCells.length,3); assert.equal(rows[0][3],1); assert.equal(rows[0][4],-2);
});

test('T002 adversarial: safeCell preserves full injection text and stored bank title stays literal', () => {
  const env = setup(), literal = '=IMPORTXML("x","y")';
  post(env,'playerList');
  const sh = env.sheets.get('玩家');
  sh.getRange(2,3).setValue(env.run('safeCell',literal));
  assert.equal(sh.getRange(2,3).getValue(),literal);
  assert.equal(post(env,'playerList').players[0].name,literal);
  sh.deleteRow(2);
  const b = bank(); b.title = '+cmd';
  assert.equal(post(env,'saveBank',{bank:b}).ok,true);
  assert.equal(post(env,'listBanks').banks[0].title,'+cmd');
  assert.deepEqual(env.formulaCells.filter(cell=>cell.sheet!=='題目'),[]);
});

test('T002 concurrency: lock covers player creation, bank merge and ledger deduplication', () => {
  const env = setup(); seedP2(env);
  let nested, fired = false;
  env.onSheetOp(op => {
    if (fired || op.sheet !== '徽章入帳' || op.op !== 'write') return;
    fired = true;
    nested = post(env,'badges',{playerId:'p2',badges:{'bank-test':earned(100)}});
  });
  assert.equal(post(env,'saveBank',{bank:{...bank(),players:{p2:{updatedAt:1,badge:earned(100)}}}}).ok,true);
  assert.deepEqual(nested,{deferred:true});
  env.onSheetOp(null);
  assert.equal(env.runDeferred().map(withoutTiming)[0].ok,true);
  assert.equal(balance(env,'p2').silver.total,1);
  assert.equal(ledger(env).filter(r=>r[1]==='p2').length,1);
});

test('F2 ledger: earned truncation at 500 does not truncate balance; adjustment quantity remains usable by T004', () => {
  const env = setup();
  const badges = {many:earned(...Array.from({length:501},(_,i)=>100+i))};
  post(env,'badges',{badges});
  const response = post(env,'badges',{badges});
  assert.equal(response.badges.many.earned.length,500);
  assert.equal(balance(env).silver.total,501);
  env.sheets.get('徽章入帳').appendRow([code,'p1','adjust',1,'銀',new Date(),'','-2','調整']);
  assert.deepEqual(balance(env).silver,{available:499,held:0,total:499});
});

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
      assert.deepEqual(env.runDeferred().map(withoutTiming), [{ ok: true }, { ok: true }]);
      assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer', 'nested-one', 'nested-two']);
    } else {
      assert.deepEqual(events, [{ ok: true }, { ok: true }]);
      assert.deepEqual(env.runDeferred().map(withoutTiming), []);
      // With no lock, the nested first write and outer write chose the same row.
      assert.deepEqual(post(env, 'listBanks').banks.map(b => b.id), ['outer', 'nested-two']);
    }
    assert.deepEqual(env.runDeferred().map(withoutTiming), []);
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

test('busy bait: saveBank returns busy without throwing or logging', () => {
  const env = setup({ lockMode: 'busy' });
  const result = post(env, 'saveBank', { bank: bank() });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'busy');
  assert.deepEqual(env.logs, []);
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
  const mutated = source.replace("try { timed('lock', () => lock.waitLock(10000)); }", 'try { /* deliberately removed for harness counterexample */ }');
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

// T-003 credentials use deliberately fake PINs and the fake environment's clock only.
const fakePin = '907314';
const otherCode = 'OTHER-HOME';
const admin = (env, action, extra={}) => post(env,action,{token:env.props.getProperty('ADMIN_TOKEN'),family:code,...extra});
function issue(env, family=code) { return admin(env,'adminIssueSetupCode',{family}).setupCode; }
function parentSession(env, family=code) {
  return post(env,'parentSetPin',{code:family,setupCode:issue(env,family),pin:fakePin}).session;
}
function addOtherFamily(env) { env.sheets.get('家庭').appendRow([otherCode,'另一家庭',10,true,'',false]); }
test('T008 docs: 編輯器暫時函式可以發設定碼', () => {
  const env = setup();
  const issued = env.run('adminParent', {action:'adminIssueSetupCode',family:'TEST-0000'});
  assert.equal(issued.ok,true);
  assert.equal(typeof issued.setupCode,'string');
  assert.ok(issued.setupCode.length > 0);
  const result = post(env,'parentSetPin',{setupCode:issued.setupCode,pin:fakePin});
  assert.equal(result.ok,true);
  assert.ok(result.session);
});
const snapshot = env => JSON.stringify({sheets:[...env.sheets].map(([k,s])=>[k,s.getDataRange().getValues()]),props:env.props.getProperties()});

test('T003 B1: setup codes are required, hashed, replaced, single-use and invalidated by reset', () => {
  const env = setup();
  const pepper = env.props.getProperty('PEPPER');
  assert.match(pepper,/^[a-f0-9]{64}$/);
  env.run('setup'); assert.equal(env.props.getProperty('PEPPER'),pepper);
  assert.deepEqual(post(env,'parentStatus'),{ok:true,hasPin:false,locked:false,minutes:0,needSetup:true});
  assert.equal(post(env,'parentLogin',{pin:fakePin}).code,'no_pin');
  assert.equal(env.props.getProperty('pinfail:'+code),null);
  assert.equal(post(env,'parentSetPin',{setupCode:'MISSING!',pin:fakePin}).code,'bad_setup_code');
  const old = issue(env), current = issue(env);
  assert.match(current,/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  assert.equal(env.props.getProperty('pinsetup:'+code),env.run('parentHash',current));
  assert.equal(post(env,'parentSetPin',{setupCode:old,pin:fakePin}).code,'bad_setup_code');
  const fails = env.props.getProperty('pinfail:'+code);
  for (const pin of ['abc','123','1234567',123456,'１２３４']) {
    assert.equal(post(env,'parentSetPin',{setupCode:current,pin}).code,'bad_pin_format');
    assert.equal(env.props.getProperty('pinfail:'+code),fails);
  }
  const result = post(env,'parentSetPin',{setupCode:current,pin:fakePin});
  assert.ok(result.session); assert.equal(env.props.getProperty('pinsetup:'+code),null);
  assert.equal(post(env,'parentSetPin',{setupCode:current,pin:fakePin}).code,'pin_exists');
  admin(env,'adminResetPin');
  assert.equal(post(env,'parentSetPin',{setupCode:current,pin:fakePin}).code,'bad_setup_code');
  const unused = issue(env); admin(env,'adminResetPin');
  assert.equal(post(env,'parentSetPin',{setupCode:unused,pin:fakePin}).code,'bad_setup_code');
});

test('T003 B2: fifth wrong PIN locks the family through 14:59; unlock at exactly 15:00', () => {
  const env = setup(); parentSession(env);
  for (let i=1;i<=5;i++) assert.deepEqual(post(env,'parentLogin',{pin:'000000'}),{ok:false,code:'bad_pin',left:5-i});
  assert.deepEqual(post(env,'parentLogin',{pin:fakePin}),{ok:false,code:'locked',minutes:15});
  assert.deepEqual(post(env,'parentStatus'),{ok:true,hasPin:true,locked:true,minutes:15});
  env.clock.advance(899000);
  assert.deepEqual(post(env,'parentLogin',{pin:fakePin}),{ok:false,code:'locked',minutes:1});
  env.clock.advance(1000);
  assert.equal(post(env,'parentLogin',{pin:fakePin}).ok,true);
  assert.deepEqual(JSON.parse(env.props.getProperty('pinfail:'+code)),{n:0,until:0});
});

test('T003 B2 extension: wrong or absent setup code shares family lock; correct setup cannot bypass it', () => {
  const env = setup(); const setupCode = issue(env);
  for(let i=1;i<=5;i++) assert.deepEqual(post(env,'parentSetPin',{setupCode:'WRONG!!!',pin:fakePin}),{ok:false,code:'bad_setup_code',left:5-i});
  assert.deepEqual(post(env,'parentSetPin',{setupCode,pin:fakePin}),{ok:false,code:'locked',minutes:15});
  assert.equal(post(env,'parentLogin',{pin:fakePin}).code,'locked');
  env.clock.advance(900000);
  assert.equal(post(env,'parentSetPin',{setupCode,pin:fakePin}).ok,true);
});

test('T003 B3: secrets stay out of sheets, logs, responses and non-secret properties; cache uses hashes', () => {
  const env = setup(), responses = [], secrets = [fakePin, env.props.getProperty('PEPPER'),env.props.getProperty('ADMIN_TOKEN')];
  const record = result => {
    const copy = {...result};
    if (copy.session) { secrets.push(copy.session); delete copy.session; }
    if (copy.setupCode) { secrets.push(copy.setupCode); delete copy.setupCode; }
    responses.push(copy); return result;
  };
  const setupCode = record(admin(env,'adminIssueSetupCode')).setupCode;
  const session = record(post(env,'parentSetPin',{setupCode,pin:fakePin})).session;
  record(post(env,'parentStatus')); record(post(env,'playerList'));
  record(post(env,'parentLogout',{session}));
  record(post(env,'playerPurge',{session,playerId:'p2'}));
  record(post(env,'parentLogin',{pin:'000000'}));
  const login = record(post(env,'parentLogin',{pin:fakePin}));
  record(post(env,'parentLogout',{session:login.session}));
  const properties = env.props.getProperties(); delete properties.PEPPER; delete properties.ADMIN_TOKEN;
  const haystack = JSON.stringify({properties,logs:env.logs,sheets:[...env.sheets].map(([k,s])=>[k,s.getDataRange().getValues()]),responses});
  for(const secret of secrets) assert.equal(haystack.includes(secret),false,'secret escaped its designated field');
  const credential = JSON.parse(env.props.getProperty('pin:'+code));
  assert.deepEqual(Object.keys(credential).sort(),['h','salt']);
  assert.match(credential.h,/^[a-f0-9]{64}$/);
  assert.match(credential.salt,/^[a-f0-9]{64}$/);
  assert.equal(env.cache.get('ps:'+session),null);
  // Independent crypto oracle also checks signed-byte-to-hex conversion and HMAC construction.
  const crypto = require('node:crypto');
  assert.equal(credential.h,crypto.createHmac('sha256',env.props.getProperty('PEPPER')).update(credential.salt+fakePin).digest('hex'));
});

test('T003 B3 bait: equal PINs have different family hashes; changing PEPPER breaks old PIN', () => {
  const env = setup(); addOtherFamily(env); parentSession(env); parentSession(env,otherCode);
  assert.notEqual(JSON.parse(env.props.getProperty('pin:'+code)).h,JSON.parse(env.props.getProperty('pin:'+otherCode)).h);
  env.props.setProperty('PEPPER','fake-replacement-pepper');
  assert.equal(post(env,'parentLogin',{pin:fakePin}).code,'bad_pin');
});

test('T003 B4: missing, random and foreign sessions reject every player mutation without data changes', () => {
  const env = setup(); seedP2(env); addOtherFamily(env);
  const foreign = parentSession(env,otherCode); parentSession(env);
  for(const action of ['playerDisable','playerRestore','playerPurge']) for(const session of [undefined,'fake-random-session',foreign]) {
    const before = snapshot(env);
    assert.deepEqual(post(env,action,{playerId:'p2',session}),{ok:false,code:'no_session',message:'請重新輸入家長 PIN'});
    assert.equal(snapshot(env),before);
  }
});

test('T003 session: fixed TTL accepts 29:59, expires 30:00; logout and reset invalidate immediately', () => {
  const env = setup(); seedP2(env); let session = parentSession(env);
  const hash = require('node:crypto').createHash('sha256').update(session).digest('hex');
  const salt = JSON.parse(env.props.getProperty('pin:'+code)).salt;
  assert.equal(env.cache.get('ps:'+hash),code+'|'+salt);
  env.clock.advance(1799000);
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
  env.clock.advance(1000);
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).code,'no_session');
  session = post(env,'parentLogin',{pin:fakePin}).session;
  assert.deepEqual(post(env,'parentLogout',{session}),{ok:true});
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).code,'no_session');
  assert.deepEqual(post(env,'parentLogout',{session:'invalid'}),{ok:true});
  session = post(env,'parentLogin',{pin:fakePin}).session;
  admin(env,'adminResetPin');
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).code,'no_session');
  parentSession(env);
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).code,'no_session');
});

test('T003 A3: disable sorts last and blocks writes, restore clears timestamp; p1 is protected', () => {
  const env = setup(); seedP2(env); const session = parentSession(env); newPlayer(env);
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  assert.equal(post(env,'playerList').players.at(-1).id,'p2');
  let row = env.sheets.get('玩家').getDataRange().getValues().find(r=>r[1]==='p2');
  assert.ok(row[8] instanceof Date);
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:bank()}).code,'player_disabled');
  assert.equal(post(env,'badges',{playerId:'p2',badges:{demo:earned(100)}}).code,'player_disabled');
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
  row = env.sheets.get('玩家').getDataRange().getValues().find(r=>r[1]==='p2');
  assert.equal(row[8],'');
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:bank()}).ok,true);
  assert.equal(post(env,'badges',{playerId:'p2',badges:{demo:earned(100)}}).ok,true);
  for(const action of ['playerDisable','playerPurge']) assert.equal(post(env,action,{session,playerId:'p1'}).code,'bad_request');
  assert.equal(post(env,'playerPurge',{session,playerId:'punknown'}).code,'bad_player');
  assert.equal(post(env,'playerRestore',{session,playerId:'bad:id'}).code,'bad_request');
});

test('T003 A4: purge removes only target family player everywhere and stale saves cannot resurrect', () => {
  const env = setup(); seedP2(env); addOtherFamily(env); const session = parentSession(env); const other = newPlayer(env);
  env.sheets.get('玩家').appendRow([otherCode,'p2','同名','🐢',1,'啟用',new Date(),new Date(),'']);
  for(const family of [code,otherCode]) {
    for(const id of ['bank-one','bank-two']) post(env,'saveBank',{code:family,bank:{...bank(id),players:{p2:{rec:'p2-data',updatedAt:100},...(family===code ? {[other]:{rec:'keep',updatedAt:100}} : {})}}});
    for(const playerId of ['p1','p2',...(family===code ? [other] : [])]) post(env,'badges',{code:family,playerId,badges:{demo:earned(100)}});
  }
  const stale = post(env,'listBanks').banks[0];
  const otherBefore = snapshotFamily(env,otherCode);
  const keepRows = name => env.sheets.get(name).getDataRange().getValues().filter((r,i)=>i>0 && r[0]===code && r[name==='徽章'?4:1]!=='p2');
  const playersBefore = keepRows('玩家'), badgesBefore = keepRows('徽章'), ledgerBefore = keepRows('徽章入帳');
  const banksBefore = post(env,'listBanks').banks.map(b=>{ const copy=plain(b); delete copy.players.p2; return copy; });
  assert.equal(post(env,'playerPurge',{session,playerId:'p2'}).ok,true);
  assert.deepEqual(keepRows('玩家'),playersBefore); assert.deepEqual(keepRows('徽章'),badgesBefore); assert.deepEqual(keepRows('徽章入帳'),ledgerBefore);
  assert.equal(snapshotFamily(env,otherCode),otherBefore);
  assert.deepEqual(post(env,'listBanks').banks,banksBefore);
  for(const name of ['玩家','徽章','徽章入帳']) {
    const target = env.sheets.get(name).getDataRange().getValues().filter(r=>r[0]===code);
    assert.equal(target.some(r=>r[name==='徽章'?4:1]==='p2'),false);
  }
  assert.equal(Object.keys(env.props.getProperties()).some(k=>k==='ledgerinit:'+code+':p2'),false);
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:stale}).code,'bad_player');
  assert.equal(post(env,'saveBank',{bank:stale}).ok,true);
  assert.equal(post(env,'listBanks').banks.some(b=>b.players && b.players.p2),false);
});
function snapshotFamily(env, family) {
  return JSON.stringify({sheets:[...env.sheets].map(([name,s])=>[name,s.getDataRange().getValues().filter(r=>r[0]===family)]),props:Object.entries(env.props.getProperties()).filter(([k])=>k.includes(family))});
}

test('T003 configuration: missing PEPPER rejects parent actions without regeneration; legacy ping works', () => {
  const env = setup(); env.props.deleteProperty('PEPPER');
  for(const action of ['parentLogin','parentStatus','parentSetPin','parentLogout']) assert.deepEqual(post(env,action,{pin:fakePin}),{ok:false,code:'server_error',message:'請管理者執行 setup'});
  assert.equal(env.props.getProperty('PEPPER'),null);
  assert.equal(post(env,'ping').ok,true);
});

test('T003 admin: bad tokens do not issue/reset credentials; absent families return not_found', () => {
  const env = setup();
  for(const action of ['adminIssueSetupCode','adminResetPin']) {
    const before = snapshot(env);
    assert.equal(admin(env,action,{token:'fake-bad-admin-token'}).code,'bad_token');
    assert.equal(snapshot(env),before);
    assert.equal(admin(env,action,{family:'missing-family'}).code,'not_found');
  }
});

test('T003 lock: parent/admin/player mutations return busy without changes; concurrent failures serialize', () => {
  const env = setup(); seedP2(env); const session = parentSession(env);
  let injected = false;
  env.onSheetOp(({sheet}) => {
    if(sheet !== '玩家' || injected) return;
    injected = true;
    // This hook runs in managePlayer after the session is checked under its lock.
    assert.deepEqual(post(env,'parentLogin',{pin:'000000'}),{deferred:true});
  });
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  env.onSheetOp(null);
  assert.equal(injected,true);
  assert.deepEqual(env.runDeferred().map(withoutTiming),[{ok:false,code:'bad_pin',left:4}]);
  const busy = setup({lockMode:'busy'});
  for(const action of ['parentStatus','parentLogin','parentSetPin','parentLogout','playerDisable','playerRestore','playerPurge','adminIssueSetupCode','adminResetPin']) {
    const before = snapshot(busy);
    const result = action.startsWith('admin') ? admin(busy,action) : post(busy,action,{session:'fake-session',playerId:'p2',pin:fakePin});
    assert.equal(result.code,'busy'); assert.equal(snapshot(busy),before);
  }
});

test('T003 session isolation: foreign-family logout cannot revoke the owning family session', () => {
  const env = setup(); seedP2(env); addOtherFamily(env); const session = parentSession(env);
  assert.deepEqual(post(env,'parentLogout',{code:otherCode,session}),{ok:true});
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
});

// T004 fixtures: only fake sheets/properties, never real services.
function fund(env, pid='p1', silver=10, gold=10, family=code) {
  post(env,'playerList',{code:family});
  for (const [color,qty] of [['銀',silver],['金',gold]]) if (qty) env.sheets.get('徽章入帳').appendRow([family,pid,'fixture-'+color,1,color,new Date(env.clock.now()),'',qty,'調整']);
  env.props.setProperty('ledgerinit:'+family+':'+pid,'1');
}
function saveReward(env, session, changes={}) {
  const result = post(env,'rewardSave',{session,reward:{name:'獎勵',silver:1,gold:0,goldForSilver:true,weeklyLimit:0,enabled:true,...changes}});
  assert.equal(result.ok,true,JSON.stringify(result)); return result.reward;
}
let requestSerial = 0;
function requestReward(env, rewardId, playerId='p1', requestId='request-'+(++requestSerial)) {
  return post(env,'redeemRequest',{rewardId,playerId,requestId});
}
function decide(env, session, id, decision='approve', reason='') { return post(env,'redeemDecide',{session,id,decision,reason}); }
function redeemRows(env) { return env.sheets.get('兌換').getDataRange().getValues().slice(1); }
function redeemLogs(env) { return env.sheets.get('兌換紀錄').getDataRange().getValues().slice(1); }

test('T010 A3: disabled p2 rejects writes without adding sheet rows', () => {
  const env = setup(); seedP2(env); const session = parentSession(env);
  const reward = saveReward(env,session);
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  const before = snapshot(env);
  const rows = [...env.sheets].map(([name,sh])=>[name,sh.getLastRow()]);
  for (const [action,extra] of [
    ['saveBank',{bank:bank()}],
    ['badges',{badges:{demo:earned(100)}}],
    ['redeemRequest',{rewardId:reward.id,requestId:'disabled-new-request'}],
  ]) assert.deepEqual(post(env,action,{playerId:'p2',...extra}),{ok:false,code:'player_disabled'});
  assert.deepEqual([...env.sheets].map(([name,sh])=>[name,sh.getLastRow()]),rows);
  assert.equal(snapshot(env),before);
  for (const extra of [{rewardId:'bad:id'},{requestId:'short'}]) {
    assert.deepEqual(post(env,'redeemRequest',{playerId:'p2',rewardId:reward.id,requestId:'disabled-new-request',...extra}),{ok:false,code:'bad_request'});
  }
});

test('T010 A3: disabled p2 replay of old requestId returns player_disabled', () => {
  const env = setup(); seedP2(env); const session = parentSession(env); fund(env,'p2');
  const reward = saveReward(env,session), requestId = 'p2-old-request';
  const first = requestReward(env,reward.id,'p2',requestId);
  assert.equal(first.ok,true);
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  const before = snapshot(env);
  assert.deepEqual(requestReward(env,reward.id,'p2',requestId),{ok:false,code:'player_disabled'});
  assert.equal(snapshot(env),before);
  assert.equal(post(env,'myRedeems',{playerId:'p2'}).redeems[0].status,'取消');
  assert.equal(post(env,'rewardList',{playerId:'p2'}).ok,true);
  assert.deepEqual(post(env,'redeemCancel',{playerId:'p2',id:first.redeem.id}),{ok:true,already:true});
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
  const duplicate = requestReward(env,reward.id,'p2',requestId);
  assert.equal(duplicate.ok,true); assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.redeem.id,first.redeem.id);
  assert.equal(redeemRows(env).length,1);
});

test('T010 A3: restore retains rec, earned, approved and cancelled requests with refunded balance', () => {
  const env = setup(); seedP2(env); const session = parentSession(env);
  const badge = {earned:[{at:100,dark:false},{at:101,dark:false},{at:102,dark:false},{at:103,dark:true},{at:104,dark:true},{at:105,dark:true}]};
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:{...bank(),players:{p2:{rec:{q1:2},days:['fake-day'],summary:'測試紀錄',updatedAt:100,badge}}}}).ok,true);
  const playerBefore = post(env,'listBanks').banks[0].players.p2;
  assert.deepEqual(playerBefore.rec,{q1:2});
  assert.deepEqual(playerBefore.badge.earned,badge.earned);
  const ledgerBefore = plain(ledger(env));
  const reward = saveReward(env,session,{silver:1,gold:1});
  const approved = requestReward(env,reward.id,'p2').redeem;
  assert.equal(decide(env,session,approved.id).redeem.status,'核准');
  const pending = requestReward(env,reward.id,'p2').redeem;
  assert.deepEqual(balance(env,'p2'),{ok:true,silver:{available:1,held:1,total:3},gold:{available:1,held:1,total:3}});
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  // An active sibling's device carries newer but untrusted progress for disabled p2.
  assert.equal(post(env,'saveBank',{playerId:'p1',bank:{...bank(),p1At:999,rec:{q1:1},players:{p2:{rec:{q1:999},updatedAt:999,badge:earned(999)}}}}).ok,true);
  let saved = post(env,'listBanks').banks[0];
  assert.deepEqual(saved.rec,{q1:1});
  assert.deepEqual(saved.players.p2,playerBefore);
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
  assert.deepEqual(balance(env,'p2'),{ok:true,silver:{available:2,held:0,total:3},gold:{available:2,held:0,total:3}});
  assert.deepEqual(post(env,'listBanks').banks[0].players.p2,playerBefore);
  assert.deepEqual(plain(ledger(env)),ledgerBefore);
  const redeems = post(env,'myRedeems',{playerId:'p2'}).redeems;
  assert.equal(redeems.length,2);
  assert.equal(redeems.find(r=>r.id===approved.id).status,'核准');
  assert.equal(redeems.find(r=>r.id===pending.id).status,'取消');
  assert.equal(requestReward(env,reward.id,'p2').ok,true);
  assert.equal(post(env,'saveBank',{playerId:'p2',bank:{...bank(),players:{p2:{...playerBefore,rec:{q1:3},updatedAt:1000}}}}).ok,true);
  saved = post(env,'listBanks').banks[0];
  assert.deepEqual(saved.players.p2.rec,{q1:3});
  assert.deepEqual(saved.players.p2.badge.earned,playerBefore.badge.earned);
});

test('T010 A3: reader code with playerId p2 cannot credit p2 ledger', () => {
  const env = setup(); seedP2(env);
  assert.equal(post(env,'readerCreate').ok,true);
  const readerCode = env.sheets.get('閱讀碼').getRange(2,1).getValue();
  const before = plain(ledger(env));
  assert.equal(post(env,'badges',{code:readerCode,playerId:'p2',badges:{demo:earned(100)}}).ok,true);
  assert.deepEqual(plain(ledger(env)),before);
});

test('T004 setup/B4: exact headers, idempotence; missing/random/foreign sessions never write', () => {
  const env = setup(); seedP2(env); addOtherFamily(env); const foreign = parentSession(env,otherCode);
  const expected = {
    '獎勵':['獎勵ID','家庭','名稱','銀價','金價','金可抵銀','每週上限','啟用','更新時間'],
    '兌換':['ID','requestId','家庭','玩家','獎勵ID','名稱快照','銀價快照','金價快照','金可抵銀快照','實扣銀','實扣金','週鍵','狀態','拒絕原因','申請時間','決定時間','版本'],
    '兌換紀錄':['時間','兌換ID','舊狀態','新狀態','操作者'],
  };
  env.run('setup');
  for (const [name,header] of Object.entries(expected)) assert.deepEqual(env.sheets.get(name).getDataRange().getValues(),[header]);
  for (const action of ['rewardSave','redeemDecide','redeemList','parentLog']) for (const session of [undefined,'invalid',foreign]) {
    const before = snapshot(env);
    assert.equal(post(env,action,{session}).code,'no_session'); assert.equal(snapshot(env),before);
  }
});

test('T004 reward validation/C1: IDs, name, price, default flags; disabled rewards only visible to parents', () => {
  const env = setup(), session = parentSession(env); fund(env);
  const base = {name:'測試',silver:1,gold:0,weeklyLimit:0};
  for (const bad of [{silver:0},{silver:100},{gold:-1},{silver:1.5},{weeklyLimit:15},{weeklyLimit:-1},{weeklyLimit:1.5},{name:'字'.repeat(21)},{name:'   '},{id:''},{id:'bad:id'},{silver:'1'}]) {
    const before = snapshot(env);
    assert.equal(post(env,'rewardSave',{session,reward:{...base,...bad}}).code,'bad_request'); assert.equal(snapshot(env),before);
  }
  const reward = post(env,'rewardSave',{session,reward:{...base,name:'  原名  '}}).reward;
  assert.match(reward.id,/^w[a-f0-9]{12}$/); assert.equal(reward.name,'原名'); assert.equal(reward.goldForSilver,true); assert.equal(reward.enabled,true);
  saveReward(env,session,{...reward,name:'改名',enabled:false});
  assert.deepEqual(post(env,'rewardList').rewards,[]);
  const parent = post(env,'rewardList',{session}).rewards[0];
  assert.equal(parent.name,'改名'); assert.equal(parent.canRedeem,false); assert.equal(parent.weekLeft,null);
  assert.equal(requestReward(env,reward.id).code,'reward_disabled');
});

test('T004 C2/week boundary: Taipei Monday, quota two, Date readback and approval never moves request week', () => {
  const env = setup(), session0 = parentSession(env); fund(env);
  const reward = saveReward(env,session0,{weeklyLimit:2});
  for (const [date,key] of [['2026-11-08T23:59:59+08:00','2026-11-02'],['2026-11-09T00:00:00+08:00','2026-11-09'],['2026-11-08T16:00:00Z','2026-11-09']]) assert.equal(env.run('weekKey',Date.parse(date)),key);
  env.clock.set(Date.parse('2026-11-08T23:59:59+08:00'));
  const first = requestReward(env,reward.id).redeem, second = requestReward(env,reward.id).redeem;
  assert.equal(first.weekKey,'2026-11-02'); assert.equal(first.version,1);
  assert.equal(env.sheets.get('兌換').getRange(2,12).getValue(),'2026-11-02');
  // Deliberately reproduce legacy Sheets date coercion, then compare through the API.
  env.sheets.get('兌換').getRange(2,12).setValue('2026-11-02');
  assert.ok(env.sheets.get('兌換').getRange(2,12).getValue() instanceof Date);
  assert.equal(post(env,'rewardList').rewards[0].weekUsed,2);
  assert.deepEqual(requestReward(env,reward.id),{ok:false,code:'quota',reason:'本週額度用完，下週一再來'});
  env.clock.advance(1000); const session = post(env,'parentLogin',{pin:fakePin}).session;
  assert.equal(decide(env,session,second.id).redeem.weekKey,'2026-11-02');
  assert.equal(post(env,'rewardList').rewards[0].weekUsed,0);
  assert.equal(post(env,'redeemList',{session}).redeems[0].weekUsed,0);
  assert.equal(requestReward(env,reward.id).ok,true);
});

test('T004 D2/D9: hold, reject, cancel, approve use immutable silver/gold snapshots after price edits', () => {
  const env = setup(), session = parentSession(env); fund(env,'p1',1,5);
  const reward = saveReward(env,session,{silver:2,gold:1});
  const first = requestReward(env,reward.id).redeem;
  assert.deepEqual(first.pay,{silver:1,gold:2}); assert.equal(first.status,'待核准');
  assert.deepEqual(balance(env),{ok:true,silver:{available:0,held:1,total:1},gold:{available:3,held:2,total:5}});
  saveReward(env,session,{...reward,silver:99,gold:99,goldForSilver:false,enabled:false});
  const rejected = decide(env,session,first.id,'reject','  不'.repeat(50)+'  ').redeem;
  assert.equal(rejected.reason.length,40); assert.equal(rejected.version,2);
  assert.equal(balance(env).gold.available,5); assert.equal(balance(env).silver.available,1);
  saveReward(env,session,reward);
  const second = requestReward(env,reward.id).redeem;
  saveReward(env,session,{...reward,silver:99,goldForSilver:false});
  assert.equal(post(env,'redeemCancel',{id:second.id}).ok,true);
  assert.deepEqual(post(env,'redeemCancel',{id:second.id}),{ok:true,already:true});
  assert.equal(decide(env,session,second.id).code,'conflict');
  assert.equal(balance(env).gold.available,5);
  saveReward(env,session,reward); const third = requestReward(env,reward.id).redeem;
  saveReward(env,session,{...reward,silver:99,gold:99,goldForSilver:false});
  assert.deepEqual(decide(env,session,third.id).redeem.pay,third.pay);
  saveReward(env,session,{...reward,silver:3,gold:0});
  assert.equal(balance(env).gold.available,3); assert.equal(balance(env).gold.held,0);
  assert.equal(post(env,'redeemCancel',{id:third.id}).code,'conflict');
  assert.deepEqual(post(env,'myRedeems').redeems.map(r=>r.status),['核准','取消','拒絕']);
  assert.deepEqual(redeemLogs(env).map(r=>r[4]),['child','parent','child','child','child','parent']);
});

function verifyDuplicate(env, rewardId) {
  const first = requestReward(env,rewardId,'p1','same-request'), second = requestReward(env,rewardId,'p1','same-request');
  assert.equal(first.ok,true); assert.equal(second.duplicate,true,'D3 missing duplicate marker');
  assert.deepEqual(second.redeem,first.redeem); assert.equal(redeemRows(env).length,1,'D3 duplicate request created two rows');
}
test('T004 D3: idempotency and cross-player/family requestId secrecy, validated IDs', () => {
  const env = setup(), session = parentSession(env); seedP2(env); fund(env); addOtherFamily(env); fund(env,'p1',5,5,otherCode);
  const reward = saveReward(env,session); verifyDuplicate(env,reward.id);
  for (const extra of [{playerId:'p2'},{code:otherCode}]) {
    const result = post(env,'redeemRequest',{rewardId:reward.id,requestId:'same-request',...extra});
    assert.deepEqual(result,{ok:false,code:'bad_request'});
  }
  for (const extra of [{playerId:'bad:id'},{rewardId:'bad:id'},{requestId:'short'},{requestId:'x'.repeat(65)}]) {
    const before = snapshot(env); assert.equal(post(env,'redeemRequest',{rewardId:reward.id,requestId:'valid-request',...extra}).code,'bad_request'); assert.equal(snapshot(env),before);
  }
});
test('T004 H1/D3 counterexample: removing requestId lookup must fail the original D3 assertion', () => {
  const source = readFileSync(join(__dirname,'..','Code.gs'),'utf8')+'\nfindRedeemRequest = function() { return null; };';
  const env = setup({source}), session = parentSession(env); fund(env);
  const reward = saveReward(env,session);
  assert.throws(()=>verifyDuplicate(env,reward.id),{code:'ERR_ASSERTION',message:/D3 missing duplicate marker/});
  assert.equal(redeemRows(env).length,2);
});

test('T004 D7: silver-only, gold-only, mixed prices and snapshots agree across child/parent lists', () => {
  const env = setup(), session = parentSession(env); fund(env);
  const prices = [[2,0],[0,3],[1,2]], rewards = prices.map(([silver,gold])=>saveReward(env,session,{silver,gold}));
  for (const reward of rewards) assert.equal(requestReward(env,reward.id).ok,true);
  const child = post(env,'rewardList').rewards, parent = post(env,'redeemList',{session});
  assert.equal(parent.pendingCount,3);
  for (const reward of child) {
    const r = parent.redeems.find(r=>r.rewardId===reward.id);
    assert.deepEqual([r.silver,r.gold],[reward.silver,reward.gold]);
    assert.equal(r.playerName,'玩家 1'); assert.equal(r.playerIcon,'🌱');
    assert.deepEqual(r.balance,balance(env)); assert.equal(r.weekUsed,1);
  }
});

test('T004 D8: exact shortage text, gold substitutes silver only after gold price, TRUE strings read as booleans', () => {
  const cases = [
    [1,2,2,0,true,'',{silver:1,gold:1}],
    [1,2,2,0,false,'還差銀 1'],[5,0,0,1,true,'還差金 1'],
    [0,1,2,0,true,'還差銀 1'],[0,0,1,1,true,'還差銀 1、金 1'],[0,2,2,1,true,'還差銀 1'],
  ];
  for (const [silver,gold,priceS,priceG,convert,reason,pay] of cases) {
    const env = setup(), session = parentSession(env); fund(env,'p1',silver,gold);
    const reward = saveReward(env,session,{silver:priceS,gold:priceG,goldForSilver:convert});
    env.sheets.get('獎勵').getRange(2,6).setValue("'"+String(convert).toUpperCase());
    const offer = post(env,'rewardList').rewards[0];
    assert.equal(offer.goldForSilver,convert); assert.equal(offer.reason,reason); assert.equal(offer.canRedeem,!reason);
    const result = requestReward(env,reward.id);
    if (reason) assert.deepEqual(result,{ok:false,code:'insufficient',reason});
    else { assert.deepEqual(offer.pay,pay); assert.deepEqual(result.redeem.pay,pay); }
  }
});

test('T004 A3/A4: disable cancels pending with parent log; restore stays cancelled; purge removes only target IDs/logs', () => {
  const env = setup(), session = parentSession(env); seedP2(env); addOtherFamily(env); fund(env); fund(env,'p2');
  const foreignSession = parentSession(env,otherCode); fund(env,'p1',10,10,otherCode);
  const reward = saveReward(env,session), foreignReward = post(env,'rewardSave',{code:otherCode,session:foreignSession,reward:{...reward,id:undefined}}).reward;
  const own = requestReward(env,reward.id).redeem, target = requestReward(env,reward.id,'p2').redeem;
  const foreign = post(env,'redeemRequest',{code:otherCode,rewardId:foreignReward.id,requestId:'foreign-request'}).redeem;
  assert.equal(post(env,'playerDisable',{session,playerId:'p2'}).ok,true);
  const cancelled = post(env,'myRedeems',{playerId:'p2'}).redeems[0];
  assert.equal(cancelled.status,'取消'); assert.equal(env.run('playerBalance',code,'p2').silver.available,10);
  assert.equal(redeemLogs(env).find(r=>r[1]===target.id && r[3]==='取消')[4],'parent');
  assert.equal(requestReward(env,reward.id,'p2').code,'player_disabled');
  assert.equal(post(env,'playerRestore',{session,playerId:'p2'}).ok,true);
  assert.equal(post(env,'myRedeems',{playerId:'p2'}).redeems[0].status,'取消');
  const pending = requestReward(env,reward.id,'p2').redeem;
  assert.equal(post(env,'playerPurge',{session,playerId:'p2'}).ok,true);
  assert.equal(redeemRows(env).some(r=>r[2]===code && r[3]==='p2'),false);
  assert.equal(redeemLogs(env).some(r=>[target.id,pending.id].includes(r[1])),false);
  assert.deepEqual(redeemRows(env).map(r=>r[0]),[own.id,foreign.id]);
  assert.ok(redeemLogs(env).some(r=>r[1]===own.id)); assert.ok(redeemLogs(env).some(r=>r[1]===foreign.id));
});

test('T004 adversarial: formula-safe snapshots/reasons; foreign rewards/redemptions and player ownership isolated', () => {
  const env = setup(), session = parentSession(env); seedP2(env); addOtherFamily(env); fund(env);
  const foreignSession = parentSession(env,otherCode);
  const reward = saveReward(env,session,{name:'=HYPERLINK("x")'});
  assert.equal(reward.name,'=HYPERLINK("x")');
  for (const reason of ['+cmd','@a']) {
    const r = requestReward(env,reward.id).redeem;
    assert.equal(r.name,reward.name); assert.equal(decide(env,session,r.id,'reject',reason).redeem.reason,reason);
    assert.equal(post(env,'parentLog',{session}).entries[0].reason,reason);
    assert.equal(post(env,'redeemCancel',{id:r.id,playerId:'p2'}).code,'not_found');
    assert.equal(post(env,'redeemCancel',{code:otherCode,id:r.id}).code,'not_found');
    assert.equal(post(env,'redeemDecide',{code:otherCode,session:foreignSession,id:r.id,decision:'approve'}).code,'not_found');
  }
  assert.equal(post(env,'redeemRequest',{code:otherCode,rewardId:reward.id,requestId:'foreign-reward'}).code,'not_found');
  assert.equal(post(env,'rewardSave',{code:otherCode,session:foreignSession,reward}).code,'not_found');
  assert.deepEqual(env.formulaCells,[]);
});

test('T004 negative adjustment: real negative available is reported, approval and new requests refused', () => {
  const env = setup(), session = parentSession(env); fund(env,'p1',2,2);
  const reward = saveReward(env,session), r = requestReward(env,reward.id).redeem;
  fund(env,'p1',-3,0);
  assert.equal(balance(env).silver.available,-2);
  assert.equal(decide(env,session,r.id).code,'insufficient');
  assert.equal(requestReward(env,reward.id).code,'insufficient');
  assert.equal(post(env,'myRedeems').redeems[0].status,'待核准');
  assert.equal(post(env,'rewardList').rewards[0].canRedeem,false);
  assert.equal(decide(env,session,r.id,'reject').ok,true);
  assert.equal(balance(env).silver.available,-1);
});

test('T004 busy: redeemRequest/redeemDecide return busy without any sheet/property changes', () => {
  const env = setup({lockMode:'busy'});
  for (const action of ['redeemRequest','redeemDecide']) {
    const before = snapshot(env); assert.equal(post(env,action,{rewardId:'w1',requestId:'busy-request',session:'invalid',id:'r1',decision:'approve'}).code,'busy'); assert.equal(snapshot(env),before);
  }
});

function assertRedeemInvariants(env, players, rewards) {
  for (const pid of players) {
    const bal = balance(env,pid);
    assert.ok(bal.silver.available>=0,'D4 silver available must be nonnegative');
    assert.ok(bal.gold.available>=0,'D4 gold available must be nonnegative');
    for (const reward of rewards) {
      const active = redeemRows(env).filter(r=>r[2]===code && r[3]===pid && r[4]===reward.id && env.run('normalizeWeek',r[11])===env.run('weekKey',env.clock.now()) && ['核准','待核准'].includes(r[12]));
      if (reward.weeklyLimit) assert.ok(active.length<=reward.weeklyLimit,'D4 weekly quota exceeded');
    }
  }
  const rows = redeemRows(env), logs = redeemLogs(env);
  assert.equal(new Set(rows.map(r=>r[1])).size,rows.length,'D3 requestIds unique');
  assert.ok(logs.every(l=>rows.some(r=>r[0]===l[1])),'D4 no orphan log');
  for (const r of rows) {
    const history = logs.filter(l=>l[1]===r[0]);
    assert.deepEqual(history[0].slice(2),['','待核准','child']);
    assert.equal(history.length,r[16],'D4 version equals transition count');
    assert.equal(history.length,r[12]==='待核准' ? 1 : 2,'D4 terminal transition only once');
    if (history.length===2) {
      assert.equal(history[1][2],'待核准'); assert.ok(['核准','拒絕','取消'].includes(history[1][3]));
    }
    assert.equal(history.at(-1)[3],r[12],'D4 current status agrees with audit trail');
  }
}
function seededRandom(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value,1664525)+1013904223)>>>0; return value/4294967296; };
}
function randomizedRedeemInterleavings(lockMode, outer = 'redeemRequest') {
  const env = setup({lockMode}), session = parentSession(env); seedP2(env);
  const players = ['p1','p2']; for (const pid of players) fund(env,pid,8,5);
  const rewards = [saveReward(env,session,{silver:2,gold:1,weeklyLimit:2}),saveReward(env,session,{silver:1,gold:0,weeklyLimit:3})];
  const random = seededRandom(0x004d45), counts = {request:0,approve:0,reject:0,cancel:0,deferred:0,injections:0};
  const choose = items => items[Math.floor(random()*items.length)];
  const operation = kind => {
    const rows = redeemRows(env);
    if (kind===0 || rows.length===0) {
      counts.request++; return requestReward(env,choose(rewards).id,choose(players));
    }
    const row = choose(rows);
    if (kind===3) { counts.cancel++; return post(env,'redeemCancel',{id:row[0],playerId:row[3]}); }
    counts[kind===1?'approve':'reject']++;
    return decide(env,session,row[0],kind===1?'approve':'reject');
  };
  for (let round=0;round<200;round++) {
    let injected = false;
    env.onSheetOp(({sheet}) => {
      // Lock-holding redeemRequest reads players inside the lock; family lookups are outside it.
      if (sheet!=='玩家' || injected) return;
      injected = true; counts.injections++;
      const kinds = [0,1,2,3].sort(()=>random()-.5).slice(0,2+Math.floor(random()*3));
      for (const kind of kinds) {
        const result = operation(kind);
        if (result.deferred) counts.deferred++;
      }
    });
    // redeemRequest takes the lock even when quota or balance rejects it.
    if (outer === 'redeemRequest') {
      const result = requestReward(env,choose(rewards).id,choose(players));
      assert.ok(result.ok === true || ['insufficient','quota'].includes(result.code));
    } else {
      const result = post(env,'rewardList',{playerId:choose(players)});
      assert.equal(result.ok,true);
    }
    env.onSheetOp(null); env.runDeferred().map(withoutTiming);
    operation(Math.floor(random()*4));
    assertRedeemInvariants(env,players,rewards);
    env.clock.advance(1);
  }
  assert.equal(counts.injections,200);
  for (const kind of ['request','approve','reject','cancel']) assert.ok(counts[kind]>0);
  if (lockMode==='real' && outer==='redeemRequest') assert.ok(counts.deferred>=400);
  return counts;
}
test('T004 D4: seeded 200 interleavings inject multiple requests/approvals/rejections/cancellations at sheet operations', t => {
  const counts = randomizedRedeemInterleavings('real');
  t.diagnostic('seed=0x004d45; rounds=200; '+JSON.stringify(counts));
});

function overspendInterleaving(lockMode) {
  const env = setup({lockMode}), session = parentSession(env); fund(env,'p1',2,0);
  const reward = saveReward(env,session,{weeklyLimit:3});
  let injected = false;
  env.onSheetOp(({sheet,op,row,col}) => {
    // reward reads occur after playerBalance has captured the balance, before append.
    if (sheet!=='獎勵' || op!=='read' || row!==2 || col!==9 || injected) return;
    injected = true;
    requestReward(env,reward.id); requestReward(env,reward.id);
  });
  requestReward(env,reward.id); env.onSheetOp(null); env.runDeferred().map(withoutTiming);
  assert.ok(injected);
  assertRedeemInvariants(env,['p1'],[reward]);
}
test('T004 D4 targeted: simultaneous requests recompute balance inside lock', () => overspendInterleaving('real'));
test('T004 H1/D4 counterexample: same interleaving without lock must violate nonnegative silver', () => {
  assert.throws(()=>overspendInterleaving('none'),{code:'ERR_ASSERTION',message:/D4 silver available must be nonnegative/});
});

function concurrentDecisions(lockMode, laterDecision) {
  const env = setup({lockMode}), firstSession = parentSession(env), secondSession = post(env,'parentLogin',{pin:fakePin}).session;
  fund(env,'p1',2,0); const reward = saveReward(env,firstSession), r = requestReward(env,reward.id).redeem;
  let injected = false, later;
  env.onSheetOp(({sheet,op,row,col}) => {
    if (sheet!=='兌換' || op!=='write' || row!==2 || col!==13 || injected) return;
    injected = true; later = decide(env,secondSession,r.id,laterDecision);
  });
  assert.equal(decide(env,firstSession,r.id).ok,true);
  env.onSheetOp(null); const deferred = env.runDeferred().map(withoutTiming);
  assert.ok(injected);
  const decisions = redeemLogs(env).filter(l=>l[1]===r.id && ['核准','拒絕'].includes(l[3]));
  assert.equal(decisions.length,1,'D5 exactly one decision log');
  assert.equal(balance(env).silver.available,1,'D5 charged once');
  assert.equal(balance(env).silver.held,0);
  const result = later.deferred ? deferred[0] : later;
  if (laterDecision==='approve') assert.deepEqual(result,{ok:true,already:true});
  else assert.deepEqual(result,{ok:false,code:'conflict',status:'核准'});
}
test('T004 D5: two parent sessions approve once; same decision already, different decision conflict', () => {
  concurrentDecisions('real','approve'); concurrentDecisions('real','reject');
});
test('T004 H1/D5 counterexample: no lock duplicates decision logs for both parent outcomes', () => {
  for (const decision of ['approve','reject']) assert.throws(()=>concurrentDecisions('none',decision),{code:'ERR_ASSERTION',message:/D5 exactly one decision log/});
});

test('T004 parentLog: latest 50 decisions with names/snapshots, separate newest anomalies, family isolation', () => {
  const env = setup(), session = parentSession(env); fund(env,'p1',100,0); addOtherFamily(env);
  const reward = saveReward(env,session,{name:'快照'});
  for (let i=0;i<53;i++) {
    const r = requestReward(env,reward.id).redeem;
    assert.equal(decide(env,session,r.id,i%2?'approve':'reject').ok,true); env.clock.advance(1);
  }
  saveReward(env,session,{...reward,name:'新名稱'});
  for (const [family,at,reason] of [[code,2,'時間異常'],[code,3,'超過每日上限'],[otherCode,4,'foreign-anomaly']]) {
    env.sheets.get('徽章入帳').appendRow([family,'p1','bad',at,'金',new Date(env.clock.now()),reason,1,'同步']); env.clock.advance(1);
  }
  const result = post(env,'parentLog',{session}), decisions = result.entries.filter(e=>e.type==='decision'), anomalies = result.entries.filter(e=>e.type==='anomaly');
  assert.equal(decisions.length,50); assert.equal(anomalies.length,2);
  assert.ok(decisions.every(e=>e.name==='快照' && e.playerName==='玩家 1'));
  assert.equal(decisions[0].id,redeemRows(env).at(-1)[0]);
  assert.ok(decisions.every((e,i)=>!i || Date.parse(decisions[i-1].at)>=Date.parse(e.at)));
  assert.deepEqual(anomalies.map(e=>[e.badgeKey,e.at,e.color,e.reason]),[['bad',3,'金','超過每日上限'],['bad',2,'金','時間異常']]);
  assert.equal(post(env,'redeemList',{session}).pendingCount,0);
  assert.equal(post(env,'redeemList',{session,status:'all'}).redeems.length,53);
});

test('T004 F2 integration: rewardList/request/approval backfill cloud earnings before calculating', () => {
  for (const action of ['rewardList','redeemRequest','redeemDecide']) {
    const env = setup(), session = parentSession(env), reward = saveReward(env,session);
    let r;
    if (action==='redeemDecide') { fund(env,'p1',1,0); r = requestReward(env,reward.id).redeem; fund(env,'p1',-1,0); }
    env.run('putBank',{code},{...bank(),badge:earned(100,101)});
    env.props.deleteProperty('ledgerinit:'+code+':p1');
    const result = action==='redeemDecide' ? decide(env,session,r.id) : action==='redeemRequest' ? requestReward(env,reward.id) : post(env,'rewardList');
    assert.equal(result.ok,true); assert.equal(result.balance.silver.total,2);
    assert.equal(env.props.getProperty('ledgerinit:'+code+':p1'),'1');
  }
});

test('T004 A4 exact IDs: purge p2 preserves p2abcdef0 and its redemption/audit rows', () => {
  const env = setup(), session = parentSession(env); seedP2(env);
  env.sheets.get('玩家').appendRow([code,'p2abcdef0','保留','🦊',2,'啟用']);
  fund(env,'p2'); fund(env,'p2abcdef0');
  const reward = saveReward(env,session), target = requestReward(env,reward.id,'p2').redeem, sibling = requestReward(env,reward.id,'p2abcdef0').redeem;
  assert.equal(post(env,'playerPurge',{session,playerId:'p2'}).ok,true);
  assert.equal(post(env,'playerList').players.some(p=>p.id==='p2'),false);
  assert.ok(post(env,'playerList').players.some(p=>p.id==='p2abcdef0'));
  assert.equal(redeemRows(env).some(r=>r[0]===target.id),false);
  assert.equal(redeemLogs(env).some(r=>r[1]===target.id),false);
  assert.equal(post(env,'myRedeems',{playerId:'p2abcdef0'}).redeems[0].id,sibling.id);
  assert.ok(redeemLogs(env).some(r=>r[1]===sibling.id));
});

test('T004 negative gold adjustment: approval cannot consume held gold when adjusted balance is negative', () => {
  const env = setup(), session = parentSession(env); fund(env,'p1',5,1);
  const reward = saveReward(env,session,{silver:0,gold:1}), r = requestReward(env,reward.id).redeem;
  fund(env,'p1',0,-2);
  assert.equal(balance(env).gold.available,-2);
  assert.equal(decide(env,session,r.id).code,'insufficient');
  assert.equal(requestReward(env,reward.id).code,'insufficient');
  assert.equal(post(env,'myRedeems').redeems[0].status,'待核准');
});

function t019Fixture() {
  const env = setup(), session = parentSession(env);
  seedP2(env); fund(env,'p1',8,8); fund(env,'p2',8,8);
  const reward = saveReward(env,session,{silver:1,gold:1});
  const pending = ['p1','p2'].map(pid => {
    const result = requestReward(env,reward.id,pid);
    assert.equal(result.ok,true); return result.redeem;
  });
  return {env,session,reward,pending};
}
function t019Read(env, action, extra={}) {
  env.stats.reset();
  const result = post(env,action,extra);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(env.stats.locks,0,action);
  assert.ok(Object.values(env.stats.reads).every(n => n <= 1),JSON.stringify(env.stats.reads));
  return result;
}

test('T019 R1/R2: six read actions use no lock and read each sheet at most once', () => {
  const {env,session} = t019Fixture();
  for (const [action,extra] of [
    ['rewardList',{withRedeems:true}],['myRedeems',{}],['redeemList',{session}],
    ['balance',{}],['playerList',{withBalance:true}],['parentLog',{session}],
  ]) t019Read(env,action,extra);
  const results = require('../tools/measure-reward').measure();
  assert.equal(results.length,12);
  for (const r of results.slice(0,6)) {
    assert.equal(r.ok,true); assert.equal(r.locks,0,r.action);
    assert.ok(Object.values(r.reads).every(n => n <= 1),JSON.stringify(r));
  }
});

test('T019 write decoys: requests and decisions retain the lock', () => {
  const {env,session,reward,pending} = t019Fixture();
  env.stats.reset(); assert.equal(requestReward(env,reward.id).ok,true);
  assert.ok(env.stats.locks >= 1);
  env.stats.reset(); assert.equal(decide(env,session,pending[0].id).ok,true);
  assert.ok(env.stats.locks >= 1);
});

test('T019 backfill: first ledger initialization and missing p1 take the lock', () => {
  const env = setup();
  env.run('putBank',{code},{...bank(),badge:earned(100,101)});
  env.sheets.get('徽章').appendRow([code,'家庭',new Date(env.clock.now()),JSON.stringify({legacy:earned(102)}),'p1']);
  env.props.deleteProperty('ledgerinit:'+code+':p1');
  env.stats.reset();
  const first = post(env,'rewardList');
  assert.equal(first.ok,true); assert.ok(env.stats.locks >= 1);
  assert.equal(env.props.getProperty('ledgerinit:'+code+':p1'),'1');
  assert.equal(first.balance.silver.total,3);
  assert.deepEqual(t019Read(env,'rewardList').balance,first.balance);
  const fresh = setup(); fresh.stats.reset();
  const players = post(fresh,'playerList');
  assert.equal(players.ok,true); assert.ok(fresh.stats.locks >= 1);
  assert.ok(players.players.some(p => p.id === 'p1'));
});

test('T019 R4: read-write-read reflects holds, rejection, and cancellation immediately', () => {
  const {env,session,reward} = t019Fixture();
  const original = t019Read(env,'rewardList').balance;
  for (const outcome of ['reject','cancel']) {
    const request = requestReward(env,reward.id);
    assert.equal(request.ok,true);
    const held = t019Read(env,'rewardList').balance;
    for (const color of ['silver','gold']) {
      assert.equal(held[color].available,original[color].available-1);
      assert.equal(held[color].held,original[color].held+1);
    }
    const result = outcome === 'reject' ? decide(env,session,request.redeem.id,'reject')
      : post(env,'redeemCancel',{id:request.redeem.id});
    assert.equal(result.ok,true);
    assert.deepEqual(t019Read(env,'balance'),original);
  }
});

test('T019 exception cleanup: failed read does not leave memo data for writes or later reads', () => {
  const {env,reward} = t019Fixture();
  const original = t019Read(env,'rewardList').balance;
  let thrown = false;
  env.onSheetOp(({sheet,op}) => {
    if (!thrown && sheet === '兌換' && op === 'read') { thrown = true; throw new Error('T019 read failure'); }
  });
  env.stats.reset();
  const failure = post(env,'rewardList');
  env.onSheetOp(null);
  assert.equal(thrown,true); assert.equal(failure.code,'server_error'); assert.equal(env.stats.locks,0);
  const request = requestReward(env,reward.id);
  assert.equal(request.ok,true);
  for (const color of ['silver','gold']) {
    assert.equal(request.balance[color].available,original[color].available-1);
    assert.equal(request.balance[color].held,original[color].held+1);
  }
  assert.deepEqual(t019Read(env,'rewardList').balance,request.balance);
});

test('T019 withRedeems: optional field matches myRedeems and preserves the default response', () => {
  const {env} = t019Fixture();
  assert.equal(Object.hasOwn(t019Read(env,'rewardList'),'redeems'),false);
  assert.deepEqual(t019Read(env,'rewardList',{withRedeems:true}).redeems,t019Read(env,'myRedeems').redeems);
});

test('T019 D4 lock-free rewardList with injected writes keeps invariants', () => {
  randomizedRedeemInterleavings('real','rewardList');
});

test('T019 purge race: read-only request never writes ledger', () => {
  const {env} = t019Fixture();
  const key = 'ledgerinit:'+code+':p2';
  assert.equal(env.props.getProperty(key),'1');
  const rows = env.sheets.get('徽章入帳').getLastRow();
  let injected = false;
  env.onSheetOp(({sheet,op}) => {
    if (injected || sheet !== '玩家' || op !== 'read') return;
    injected = true;
    env.props.deleteProperty(key);
  });
  env.stats.reset();
  const result = post(env,'rewardList',{playerId:'p2'});
  env.onSheetOp(null);
  assert.equal(result.ok,true);
  assert.equal(injected,true);
  assert.equal(env.stats.locks,0);
  assert.equal(env.sheets.get('徽章入帳').getLastRow(),rows);
  assert.equal(env.props.getProperty(key),null);
});

test('T019 nested read inside write does not leak memo', () => {
  // real mode defers the nested request before it enters the read-only body.
  const env = setup({lockMode:'none'}), session = parentSession(env);
  fund(env,'p1',8,8);
  const reward = saveReward(env,session,{silver:1,gold:1});
  assert.equal(post(env,'rewardList').ok,true);
  let injected = false, nested;
  env.onSheetOp(({sheet,op}) => {
    if (injected || sheet !== '兌換' || op !== 'read') return;
    injected = true;
    nested = post(env,'rewardList');
  });
  const result = requestReward(env,reward.id);
  env.onSheetOp(null);
  assert.equal(injected,true);
  assert.equal(nested.ok,true);
  assert.equal(result.ok,true);
  assert.deepEqual(result.balance,balance(env));
});
