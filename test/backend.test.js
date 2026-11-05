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
function post(env, action, extra = {}) { return env.doPost({ code, action, ...extra }); }
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
  assert.equal(env.runDeferred()[0].ok,true);
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
  const mutated = source.replace('try { lock.waitLock(10000); }', 'try { /* deliberately removed for harness counterexample */ }');
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
    assert.equal(JSON.stringify(target).includes('p2'),false);
  }
  assert.equal(JSON.stringify(Object.entries(env.props.getProperties()).filter(([k])=>k.includes(code))).includes('p2'),false);
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
  assert.deepEqual(env.runDeferred(),[{ok:false,code:'bad_pin',left:4}]);
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
