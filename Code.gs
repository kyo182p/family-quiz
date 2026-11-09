/**
 * 家庭題庫練習 後端（Google Apps Script，綁定在 Google 試算表）
 *
 * 功能：
 *   1. 驗證家庭邀請碼、控管每天的 AI 使用次數
 *   2. 代替網頁呼叫 Claude API（API 金鑰只存在指令碼屬性，網頁看不到）
 *   3. 把各家庭的題庫存在試算表
 *   4. 記錄每次 AI 呼叫的 token 用量與估計費用
 *
 * 第一次使用：在編輯器選擇函式 setup 並執行一次，建立需要的工作表。
 * API 金鑰：專案設定 → 指令碼屬性 → 新增 ANTHROPIC_API_KEY。
 */

const SHEET_FAMILY = '家庭';
const SHEET_BANK = '題庫';
const SHEET_QUESTION = '題目';
const SHEET_USAGE = '用量';
const QUESTION_HEADER = ['邀請碼', '題庫名稱', '觀念', '題型', '難度', '題目', '選項', '答案', '解說', '來源', '題目ID', '判讀狀態', '判讀意見', '判讀時間', '回報'];
const SHEET_READER = '閱讀碼';
const SHEET_PUBLIC = '公開題庫';
const READER_LIMIT = 2;        // 每個家庭最多幾組有效的閱讀碼
const LIB_CACHE_SEC = 600;     // 公開題庫清單快取秒數
const SHEET_REPORT = '回報';
const SHEET_HANDOUT = '講義';
const SHEET_BADGE = '徽章';     // 書架題庫與植物小學堂的徽章（自己的題庫的徽章存在題庫裡）
const MAX_HANDOUT_CHARS = 200000; // 單份講義 JSON 上限
const REPORT_DAILY_LIMIT = 10; // 每組代碼每天最多回報幾題
const REWARD_PER_REPORT = 3;   // 回報經 AI 確認成立，邀請碼家庭可得的 AI 次數

// 照片判讀用 Sonnet，產生更多題目用 Haiku
const MODELS = {
  default: 'claude-sonnet-5-5',
  quick: 'claude-haiku-4-5-20251001',
};
// 每百萬 token 的美元價格（輸入, 輸出），只用來估算費用，請依官方價格頁調整
const PRICE = {
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-4-5-20251001': [1, 5],
};
const MAX_TOKENS = 12000;
// Sonnet 5.5 預設會先思考（adaptive thinking），思考也算在 max_tokens 裡，長文章會思考到上限、沒有輸出文字。
// 出題不需要先思考，改用 between_tools（這個模型最低的思考設定；沒有工具時只回文字）
const NO_THINK = /^claude-(sonnet|opus)-5-5/;
const MAX_IMAGES = 5;
const MAX_PROMPT_CHARS = 150000;
const CHUNK = 45000;          // 試算表單一儲存格上限 50,000 字元，保留緩衝
const MAX_BANK_CHARS = 900000;
const TIMEZONE = 'Asia/Taipei';
const MAX_PLAYERS = 12;
const DAILY_BADGE_CAP = 10;
const PLAYER_ICONS = ['🌱','🦊','🐢','🐳','🦄','🚀','🐼','🐰','🦖','🐝','🌈','⭐'];
const PLAYER_HEADER = ['邀請碼','玩家ID','暱稱','圖示','排序','狀態','建立時間','更新時間','停用時間'];
const REWARD_HEADER = ['獎勵ID','家庭','名稱','銀價','金價','金可抵銀','每週上限','啟用','更新時間'];
const REDEEM_HEADER = ['ID','requestId','家庭','玩家','獎勵ID','名稱快照','銀價快照','金價快照','金可抵銀快照','實扣銀','實扣金','週鍵','狀態','拒絕原因','申請時間','決定時間','版本'];
const REDEEM_LOG_HEADER = ['時間','兌換ID','舊狀態','新狀態','操作者'];
const LEDGER_HEADER = ['家庭','玩家','徽章鍵','at','顏色','入帳時間','異常','數量','來源'];

/* ===== 進入點 ===== */
function doGet() {
  return out({ ok: true, service: 'family-quiz' });
}

let TIMING = null;
function doPost(e) {
  const previous = TIMING;
  TIMING = {start:Date.now(), opened:false, open:0, lock:0, read:0, reads:0, sync:0, write:0, cache:0};
  try {
    let req;
    try { req = JSON.parse(e.postData.contents); }
    catch (err) { return out({ ok: false, code: 'bad_request', message: '請求格式錯誤' }); }
    const code = String(req.code || '').trim(), pid = req.playerId || 'p1';
    const cache = CacheService.getScriptCache();
    let key;
    if (['rewardList','myRedeems'].indexOf(req.action) >= 0 &&
        !Object.prototype.hasOwnProperty.call(req,'session') && /^p[a-z0-9]{1,12}$/.test(String(pid))) {
      let generation = cache.get('rg:' + code);
      if (!generation) { generation = Utilities.getUuid(); cache.put('rg:' + code,generation,21600); }
      key = 'rc:' + code + ':' + generation + ':' + pid + ':' + req.action + ':' + (req.withRedeems === true ? 1 : 0);
      const hit = cache.get(key);
      if (hit) { TIMING.cache = 1; return out(JSON.parse(hit)); }
    }
    const result = doPostBody(req);
    if (TIMING.family && ['pingLite','ping','rewardList','myRedeems','redeemList','parentLog','balance','playerList','parentStatus','listBanks','handoutList','handoutGet','readerList','libList','libGet','libHandouts','libHandoutGet','flags'].indexOf(req.action) < 0) {
      cache.put('rg:' + TIMING.family,Utilities.getUuid(),21600);
    }
    if (key) {
      const value = JSON.parse(result.getContent());
      delete value.timing;
      const json = JSON.stringify(value);
      if (value.ok === true && json.length < 90000) cache.put(key,json,60);
    }
    return result;
  } finally { TIMING = previous; }
}
function doPostBody(req) {
  if (req.action === 'pingLite') return out({ok:true});
  // 題庫書架：閱讀碼或邀請碼都可以使用（只能讀，不能寫、不能用 AI）
  // 定期掃題（管理者金鑰）
  if (['adminPending', 'adminVerdict', 'adminIssueSetupCode', 'adminResetPin'].indexOf(req.action) >= 0) {
    const token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
    if (!token || String(req.token || '') !== token) return out({ ok: false, code: 'bad_token', message: '管理者金鑰錯誤' });
    try {
      if (req.action === 'adminIssueSetupCode' || req.action === 'adminResetPin') return out(adminParent(req));
      return out(req.action === 'adminPending' ? adminPending(Number(req.limit) || 60) : adminVerdict(req));
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }
  // 回報與回報狀態：閱讀碼或邀請碼都可以使用
  if (req.action === 'report' || req.action === 'flags') {
    const fam1 = findFamily(req.code);
    if (fam1) TIMING.family = fam1.code;
    const reader1 = fam1 ? null : findReader(req.code);
    if (!fam1 && !reader1) return out({ ok: false, code: 'bad_code', message: '代碼不正確或已停用' });
    try {
      if (req.action === 'flags') return out({ ok: true, flags: flagsFor([].concat(req.ids || []).map(String)) });
      return out(reportQuestion(fam1 ? { code: fam1.code, role: '家庭' } : { code: String(req.code).trim().toUpperCase(), role: '閱讀碼' }, req));
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }
  // 公開題庫的重點講義：閱讀碼或邀請碼都可以看（不能產生）
  if (req.action === 'libHandouts' || req.action === 'libHandoutGet') {
    const famH = findFamily(req.code);
    const readerH = famH ? null : findReader(req.code);
    if (!famH && !readerH) return out({ ok: false, code: 'bad_code', message: '代碼不正確或已停用' });
    try {
      if (req.action === 'libHandouts') return out({ ok: true, handouts: libHandouts(String(req.bankId || '')) });
      const h = libHandoutGet(String(req.id || ''));
      return out(h ? { ok: true, handout: h } : { ok: false, code: 'not_found', message: '講義不存在' });
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }
  // 徽章同步：送上這台裝置的徽章，伺服器合併後回傳完整的一份（邀請碼或閱讀碼都可以）
  if (req.action === 'badges') {
    const famB = findFamily(req.code);
    if (famB) TIMING.family = famB.code;
    const readerB = famB ? null : findReader(req.code);
    if (!famB && !readerB) return out({ ok: false, code: 'bad_code', message: '代碼不正確或已停用' });
    try {
      return out(badgeSync(famB ? famB.code : readerB.code, famB ? '家庭' : '閱讀碼', req.badges, req.playerId));
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }
  if (req.action === 'libList' || req.action === 'libGet') {
    const fam0 = findFamily(req.code);
    const reader = fam0 ? null : findReader(req.code);
    if (!fam0 && !reader) return out({ ok: false, code: 'bad_code', message: '閱讀碼不正確或已停用' });
    try {
      if (req.action === 'libList') {
        if (reader) touchReader(reader);
        return out({ ok: true, banks: libList() });
      }
      const bank = libGet(String(req.id || ''));
      return out(bank ? { ok: true, bank } : { ok: false, code: 'not_found', message: '題庫不存在或已取消公開' });
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }

  const fam = findFamily(req.code);
  if (!fam) return out({ ok: false, code: 'bad_code', message: '邀請碼不正確或已停用' });
  TIMING.family = fam.code;
  try {
    if (['parentStatus','parentSetPin','parentLogin','parentLogout'].indexOf(req.action) >= 0) return out(parentAction(fam, req));
    if (['playerDisable','playerRestore','playerPurge'].indexOf(req.action) >= 0) return out(managePlayer(fam, req));
    if (['rewardList','rewardSave','redeemRequest','redeemCancel','myRedeems','redeemList','redeemDecide','parentLog'].indexOf(req.action) >= 0) return out(rewardAction(fam, req));
    switch (req.action) {
      case 'playerList':
        return out(readOnlyRun(() => missingP1(fam.code) || (req.withBalance === true && readPlayers(fam.code).some(p => ledgerUninitialized(fam.code,p.id))), () => { ensureP1(fam.code); return {ok:true, players:readPlayers(fam.code).map(p => { if(req.withBalance === true) { syncLedger(fam.code,p.id,{}); p.balance=playerBalance(fam.code,p.id); } return p; }).sort((a,b) => (a.status === '停用') - (b.status === '停用') || a.order-b.order)}; }));
      case 'playerSave':
        return out(playerSave(fam.code, req));
      case 'balance':
        return out(readOnlyRun(() => {
          const pid = req.playerId || 'p1';
          if (!/^p[a-z0-9]{1,12}$/.test(String(pid))) return false;
          return (pid === 'p1' && missingP1(fam.code)) || ledgerUninitialized(fam.code,pid);
        }, () => {
          const pid = req.playerId || 'p1', err = checkPlayer(fam.code, pid);
          if (err) return err;
          syncLedger(fam.code, pid, {});
          return playerBalance(fam.code, pid);
        }));
      case 'ping':
        return out({ ok: true, family: fam.name, remaining: remaining(fam), bonus: fam.bonus, canPublish: fam.canPublish });
      case 'setPublish':
        return out(setPublish(fam, String(req.id || ''), !!req.published));
      case 'readerList':
        return out({ ok: true, readers: readerList(fam), limit: READER_LIMIT });
      case 'readerCreate':
        return out(readerCreate(fam, String(req.note || '')));
      case 'readerDisable':
        return out(readerDisable(fam, String(req.reader || '')));
      case 'ai':
        return out(aiCall(fam, req));
      case 'listBanks':
        return out({ ok: true, banks: listBanks(fam) });
      case 'saveBank':
        return out(saveBank(fam, req.bank, req.playerId));
      case 'handoutList':
        return out({ ok: true, handouts: handoutList(fam, String(req.bankId || '')) });
      case 'handoutGet': {
        const h = handoutGet(String(req.id || ''), fam.code);
        return out(h ? { ok: true, handout: h } : { ok: false, code: 'not_found', message: '講義不存在' });
      }
      case 'handoutSave':
        return out(handoutSave(fam, req.handout));
      case 'handoutDelete':
        return out(handoutDelete(fam, String(req.id || '')));
      case 'deleteBank':
        deleteBank(fam, String(req.id || ''));
        return out({ ok: true });
      default:
        return out({ ok: false, code: 'bad_request', message: '未知的動作' });
    }
  } catch (err) {
    console.error(err);
    return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
  }
}

function out(obj) {
  if (TIMING !== null) {
    const total = Date.now() - TIMING.start;
    const {open, lock, read, reads, sync, write} = TIMING;
    obj.timing = {open, lock, read, reads, sync, write,
      compute:Math.max(0,total-open-lock-read-write), cache:TIMING.cache || 0, total};
  }
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function timed(key, fn) {
  const timing = TIMING, start = Date.now();
  try { return fn(); }
  finally { if (timing !== null) timing[key] += Date.now() - start; }
}
function book() {
  if (TIMING === null || TIMING.opened) return SpreadsheetApp.getActive();
  TIMING.opened = true;
  return timed('open', () => SpreadsheetApp.getActive());
}
function readAll(sh) {
  if (TIMING !== null) TIMING.reads++;
  return timed('read', () => sh.getDataRange().getValues());
}
function timedWrite(fn) {
  try { return timed('write', fn); }
  finally { if (LOCK_READS !== null) LOCK_READS = {}; }
}
function keepWarm() { CacheService.getScriptCache().get('warm'); }
function ensureKeepWarmTrigger() {
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'keepWarm')) {
    ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(10).create();
  }
}

/* ===== 初始化 ===== */
function setup() {
  const ss = book();
  const ensure = (name, header) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      timedWrite(() => sh.appendRow(header));
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    }
    return sh;
  };
  const fam = ensure(SHEET_FAMILY, ['邀請碼', '家庭名稱', '每日 AI 上限', '啟用', '備註', '可發布']);
  if (String(fam.getRange(1, 6).getValue()) === '') timedWrite(() => fam.getRange(1, 6).setValue('可發布').setFontWeight('bold'));
  ensure(SHEET_READER, ['閱讀碼', '建立的邀請碼', '建立的家庭', '建立時間', '啟用', '給誰（備註）', '最後使用時間', '使用次數']);
  ensure(SHEET_PUBLIC, ['題庫ID', '邀請碼', '題庫名稱', '年級', '學期', '科目', '版本', '單元', '題數', '公開時間', '公開的家庭']);
  ensure(SHEET_BANK, ['邀請碼', '題庫ID', '題庫名稱', '更新時間', '題數', '題目雜湊', 'JSON 分段數', 'JSON1']);
  const qsh = ensure(SHEET_QUESTION, QUESTION_HEADER);
  QUESTION_HEADER.forEach((h, i) => { if (String(qsh.getRange(1, i + 1).getValue()) === '') timedWrite(() => qsh.getRange(1, i + 1).setValue(h).setFontWeight('bold')); });
  if (String(fam.getRange(1, 7).getValue()) === '') timedWrite(() => fam.getRange(1, 7).setValue('獎勵 AI 次數').setFontWeight('bold'));
  ensure(SHEET_REPORT, ['回報ID', '時間', '題庫ID', '題目ID', '題目快照', '回報者代碼', '身分', '原因', '說明', '狀態', 'AI 判讀意見', '判讀時間', '獎勵']);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PEPPER')) props.setProperty('PEPPER', parentRandom());
  if (!props.getProperty('ADMIN_TOKEN')) props.setProperty('ADMIN_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  ensure(SHEET_HANDOUT, ['講義ID', '邀請碼', '題庫ID', '標題', '觀念', '建立時間', '狀態', '驗算意見', '驗算時間', 'JSON 分段數', 'JSON1']);
  const badge = ensure(SHEET_BADGE, ['代碼', '身分', '更新時間', '徽章 JSON', '玩家ID']);
  if (String(badge.getRange(1,5).getValue()) === '') timedWrite(() => badge.getRange(1,5).setValue('玩家ID'));
  ensure('玩家', PLAYER_HEADER);
  ensure('徽章入帳', LEDGER_HEADER);
  ensure('獎勵', REWARD_HEADER);
  ensure('兌換', REDEEM_HEADER);
  ensure('兌換紀錄', REDEEM_LOG_HEADER);
  ensure(SHEET_USAGE, ['時間', '邀請碼', '家庭', '模型', '照片數', '輸入 token', '輸出 token', '估計美元']);
  if (fam.getLastRow() === 1) timedWrite(() => fam.appendRow(['TEST-0000', '測試家庭', 10, true, '測試用，可刪除', false]));
  ensureKeepWarmTrigger();
}

/* ===== 家庭與次數 ===== */
function findFamily(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const sh = book().getSheetByName(SHEET_FAMILY);
  if (!sh) return null;
  const rows = readAll(sh);
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]).trim() === code && isTrue(r[3])) {
      return { code, name: String(r[1] || code), limit: Number(r[2]) || 10, canPublish: isTrue(r[5]), bonus: Number(r[6]) || 0, row: i + 1 };
    }
  }
  return null;
}
function isTrue(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function countKey(fam) {
  return 'cnt_' + Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd') + '_' + fam.code;
}
function remaining(fam) {
  const used = Number(PropertiesService.getScriptProperties().getProperty(countKey(fam)) || 0);
  return Math.max(0, fam.limit - used);
}
function bumpCount(fam) {
  const props = PropertiesService.getScriptProperties();
  const k = countKey(fam);
  props.setProperty(k, String(Number(props.getProperty(k) || 0) + 1));
}
/** 可以設定每天執行一次的觸發條件，清掉前幾天的計數 */
function cleanupCounters() {
  const props = PropertiesService.getScriptProperties();
  const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd');
  Object.keys(props.getProperties()).forEach(k => {
    if (k.indexOf('cnt_') === 0 && k.slice(4, 12) !== today) props.deleteProperty(k);
  });
}

/* ===== 呼叫 Claude API ===== */
function aiCall(fam, req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let left, usedBonus = false;
  try {
    const daily = remaining(fam);
    const bonus = currentBonus(fam);
    left = daily + bonus;
    if (left <= 0) return { ok: false, code: 'daily_limit', message: '今天的 AI 使用次數已用完' };
    // 先扣次數，避免同時送出多次；每日次數用完才扣獎勵次數
    if (daily > 0) bumpCount(fam); else { setBonus(fam, bonus - 1); usedBonus = true; }
  } finally {
    lock.releaseLock();
  }

  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, code: 'server_error', message: '尚未設定 ANTHROPIC_API_KEY' };

  const model = req.tier === 'quick' ? MODELS.quick : MODELS.default;
  const images = Array.isArray(req.images) ? req.images.slice(0, MAX_IMAGES) : [];
  const content = images.map(b64 => ({
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: String(b64) },
  }));
  content.push({ type: 'text', text: String(req.prompt || '').slice(0, MAX_PROMPT_CHARS) });

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(Object.assign({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content }] },
      NO_THINK.test(model) ? { thinking: { type: 'between_tools' } } : {})),
    muteHttpExceptions: true,
  });
  const status = res.getResponseCode();
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}

  if (status !== 200) {
    if (usedBonus) setBonus(fam, currentBonus(fam) + 1); else refundCount(fam); // 失敗不算次數
    const msg = String(body && body.error && body.error.message || '');
    console.error('Claude API ' + status + ': ' + msg);
    if (status === 429 || status === 529) return { ok: false, code: 'rate_limited', message: msg };
    if (/credit balance/i.test(msg)) return { ok: false, code: 'no_credit', message: msg };
    return { ok: false, code: 'server_error', message: 'Claude API ' + status };
  }

  const text = (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  logUsage(fam, model, images.length, body.usage || {});
  if (!text.trim()) {   // 沒有輸出任何文字（例如思考用完 max_tokens、或被拒絕）：不算次數
    if (usedBonus) setBonus(fam, currentBonus(fam) + 1); else refundCount(fam);
    return { ok: false, code: 'empty_reply', message: 'Claude 沒有回傳內容（' + String(body.stop_reason || '') + '）' };
  }
  return { ok: true, text, truncated: body.stop_reason === 'max_tokens', remaining: Math.max(0, left - 1) };
}
function refundCount(fam) {
  const props = PropertiesService.getScriptProperties();
  const k = countKey(fam);
  props.setProperty(k, String(Math.max(0, Number(props.getProperty(k) || 0) - 1)));
}
function logUsage(fam, model, nImages, usage) {
  const inT = Number(usage.input_tokens || 0), outT = Number(usage.output_tokens || 0);
  const p = PRICE[model] || [0, 0];
  const usd = (inT * p[0] + outT * p[1]) / 1e6;
  timedWrite(() => book().getSheetByName(SHEET_USAGE)
    .appendRow([new Date(), fam.code, fam.name, model, nImages, inT, outT, Math.round(usd * 10000) / 10000]));
}

/* ===== 題庫儲存 ===== */
function bankSheet() { return book().getSheetByName(SHEET_BANK); }

function listBanks(fam) {
  const rows = readAll(bankSheet());
  const banks = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[0]) !== fam.code) continue;
    const n = Number(r[6]) || 1;
    const json = r.slice(7, 7 + n).join('');
    try { banks.push(JSON.parse(json)); } catch (e) { console.error('題庫 JSON 損壞：' + r[1]); }
  }
  return banks;
}

function saveBank(fam, bank, pid) {
  if (!bank || !/^[\w-]{1,80}$/.test(String(bank.id || ''))) return {ok:false, code:'bad_request'};
  return withLock(() => {
    const err = checkPlayer(fam.code, pid);
    if (err) return err;
    const old = listBanks(fam).find(b => String(b.id) === String(bank.id)) || {};
    const modern = Object.prototype.hasOwnProperty.call(bank, 'players');
    const incomingPlayers = bank.players || {};
    const players = Object.assign({}, old.players || {});
    const valid = readPlayers(fam.code).filter(p => p.status === '啟用').map(p => p.id);
    const sync = [{pid:'p1', badge:bank.badge}];
    if (modern) {
      const at = Number(bank.p1At === undefined ? bank.updatedAt : bank.p1At) || 0;
      const oldAt = Number(old.p1At === undefined ? old.updatedAt : old.p1At) || 0;
      if (at < oldAt) ['rec','days','summary'].forEach(k => { if (k in old) bank[k] = old[k]; else delete bank[k]; });
      bank.p1At = Math.max(at, oldAt);
      bank.badge = mergeBadgeRec(old.badge, bank.badge);
      if (bank.badge === undefined) delete bank.badge;
      Object.keys(incomingPlayers).forEach(id => {
        if (id === 'p1' || valid.indexOf(id) < 0) return;
        const inc = incomingPlayers[id];
        if (!inc || typeof inc !== 'object') return;
        const prev = players[id] || {};
        if (JSON.stringify(inc) === JSON.stringify(prev)) return;
        const progress = (Number(inc.updatedAt)||0) >= (Number(prev.updatedAt)||0) ? inc : prev;
        players[id] = Object.assign({}, progress, {badge:mergeBadgeRec(prev.badge, inc.badge)});
        sync.push({pid:id, badge:inc.badge});
      });
    } else bank.p1At = Number(bank.updatedAt) || 0;
    if (Object.keys(players).length || modern || old.players) bank.players = players;
    else delete bank.players;
    const changed = mergeChecks(old, bank);
    if (JSON.stringify(bank).length > MAX_BANK_CHARS) return {ok:false, code:'too_large', message:'題庫太大'};
    sync.forEach(x => syncLedger(fam.code, x.pid, {[bank.id]:x.badge}));
    if (changed.length) closeReports(String(bank.id), changed);
    return putBank(fam, bank, true);
  });
}

// 寫入題庫（不做合併），定期掃題寫回判讀結果時也用這個
function putBank(fam, bank, noLock) {
  const json = JSON.stringify(bank);
  if (json.length > MAX_BANK_CHARS) return { ok: false, code: 'too_large', message: '題庫太大' };
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  const qHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(bank.questions || [])));
  const title = String(bank.title || [bank.grade, bank.subject, bank.unit].filter(Boolean).join(' ') || '未命名');

  const lock = noLock ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(20000);
  try {
    const sh = bankSheet();
    const rows = readAll(sh);
    let rowIdx = -1, oldHash = '';
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === fam.code && String(rows[i][1]) === String(bank.id)) { rowIdx = i + 1; oldHash = String(rows[i][5]); break; }
    }
    const values = [fam.code, String(bank.id), title, new Date(), (bank.questions || []).length, qHash, parts.length].concat(parts);
    if (rowIdx < 0) rowIdx = sh.getLastRow() + 1;
    // 清掉舊的多餘分段
    const lastCol = sh.getLastColumn();
    if (lastCol > values.length) timedWrite(() => sh.getRange(rowIdx, values.length + 1, 1, lastCol - values.length).clearContent());
    timedWrite(() => sh.getRange(rowIdx, 1, 1, values.length).setValues([values.map(v => typeof v === 'string' ? safeCell(v) : v)]));
    // 題目有變才重寫「題目」工作表（只改作答紀錄時不重寫）
    if (oldHash !== qHash) writeQuestionRows(fam, bank, title);
    updatePublicMeta(fam, bank, title);
  } finally {
    if (lock) lock.releaseLock();
  }
  return { ok: true };
}

function deleteBank(fam, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = bankSheet();
    const rows = readAll(sh);
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === fam.code && String(rows[i][1]) === id) timedWrite(() => sh.deleteRow(i + 1));
    }
    removeQuestionRows(fam, id);
    removePublicRow(fam, id);
  } finally {
    lock.releaseLock();
  }
}

/* 「題目」工作表：每題一列，方便用試算表查看（以題庫 JSON 為準，這裡的修改不會回寫） */
function writeQuestionRows(fam, bank, title) {
  removeQuestionRows(fam, String(bank.id));
  const qsh = book().getSheetByName(SHEET_QUESTION);
  const con = {};
  (bank.concepts || []).forEach(c => { con[c.id] = c.text; });
  const LV = { 1: '基礎', 2: '標準', 3: '挑戰' };
  const flagMap = (flagsFor([String(bank.id)])[String(bank.id)]) || {};
  Object.keys(flagMap).forEach(k => { flagMap[k] = flagMap[k] === 'reported' ? '已提報' : '回報成立'; });
  const rows = (bank.questions || []).map(q => [
    fam.code, title + '｜' + bank.id, con[q.c] || '', q.t === 'tf' ? '是非' : '選擇', LV[q.lv] || '',
    q.q, (q.o || []).join(' / '), q.t === 'tf' ? (q.a === 'O' ? '對' : '錯') : q.a, q.why || '', q.src || '',
    q.id, q.check ? (q.check.s === 'pass' ? '通過' : '有問題') : '未判斷', q.check ? (q.check.note || '') : '',
    q.check && q.check.at ? new Date(q.check.at) : '', flagMap[q.id] || '',
  ]);
  if (rows.length) {
    const rg = qsh.getRange(qsh.getLastRow() + 1, 1, rows.length, rows[0].length);
    // 題目、選項、答案以純文字顯示，避免「0123」「3125」被試算表轉成數字
    qsh.getRange(rg.getRow(), 6, rows.length, 3).setNumberFormat('@');
    timedWrite(() => rg.setValues(rows));
  }
}
function removeQuestionRows(fam, id) {
  const qsh = book().getSheetByName(SHEET_QUESTION);
  const data = readAll(qsh);
  const suffix = '｜' + id;
  const keep = data.filter((r, i) => i === 0 || !(String(r[0]) === fam.code && String(r[1]).slice(-suffix.length) === suffix));
  if (keep.length === data.length) return;
  timedWrite(() => qsh.clearContents());
  const w = Math.max.apply(null, keep.map(r => r.length));
  timedWrite(() => qsh.getRange(1, 1, keep.length, w).setValues(keep.map(r => r.concat(Array(w - r.length).fill('')))));
}

/* ===== 題庫書架（公開題庫） ===== */
function publicSheet() { return book().getSheetByName(SHEET_PUBLIC); }

function libList() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('libList');
  if (hit) return JSON.parse(hit);
  const rows = readAll(publicSheet());
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;
    list.push({ id: String(r[0]), title: String(r[2]), grade: String(r[3]), term: String(r[4]), subject: String(r[5]),
      publisher: String(r[6]), unit: String(r[7]), count: Number(r[8]) || 0 });
  }
  try { cache.put('libList', JSON.stringify(list), LIB_CACHE_SEC); } catch (e) {}
  return list;
}
function clearLibCache() { CacheService.getScriptCache().remove('libList'); }

function libGet(id) {
  const rows = readAll(publicSheet());
  let owner = '';
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === id) { owner = String(rows[i][1]); break; }
  if (!owner) return null;
  const bank = listBanks({ code: owner }).filter(b => String(b.id) === id)[0];
  if (!bank) return null;
  // 只提供練習需要的內容，不含作答紀錄、待確認題目、摘要
  return {
    id: bank.id, title: bank.title, grade: bank.grade, term: bank.term, subject: bank.subject,
    publisher: bank.publisher, unit: bank.unit, concepts: bank.concepts || [], questions: bank.questions || [],
    updatedAt: bank.updatedAt,
  };
}

function setPublish(fam, id, published) {
  if (!fam.canPublish) return { ok: false, code: 'no_permission', message: '這個家庭沒有發布權限' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!published) { removePublicRow(fam, id); return { ok: true }; }
    const bank = listBanks(fam).filter(b => String(b.id) === id)[0];
    if (!bank) return { ok: false, code: 'not_found', message: '找不到題庫' };
    const title = String(bank.title || [bank.grade, bank.subject, bank.unit].filter(Boolean).join(' ') || '未命名');
    removePublicRow(fam, id);
    timedWrite(() => publicSheet().appendRow([id, fam.code, title, bank.grade || '', bank.term || '', bank.subject || '', bank.publisher || '',
      bank.unit || '', (bank.questions || []).length, new Date(), fam.name].map(v => typeof v === 'string' ? safeCell(v) : v)));
    clearLibCache();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
function updatePublicMeta(fam, bank, title) {
  const sh = publicSheet();
  const rows = readAll(sh);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(bank.id) && String(rows[i][1]) === fam.code) {
      timedWrite(() => sh.getRange(i + 1, 3, 1, 7).setValues([[title, bank.grade || '', bank.term || '', bank.subject || '', bank.publisher || '',
        bank.unit || '', (bank.questions || []).length].map(v => typeof v === 'string' ? safeCell(v) : v)]));
      clearLibCache();
      return;
    }
  }
}
function removePublicRow(fam, id) {
  const sh = publicSheet();
  const rows = readAll(sh);
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === id && String(rows[i][1]) === fam.code) timedWrite(() => sh.deleteRow(i + 1));
  }
  clearLibCache();
}

/* ===== 親友閱讀碼 ===== */
function readerSheet() { return book().getSheetByName(SHEET_READER); }

function findReader(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return null;
  const rows = readAll(readerSheet());
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toUpperCase() === code && isTrue(rows[i][4])) {
      // 建立閱讀碼的家庭被停用時，閱讀碼也一併失效
      if (!findFamily(rows[i][1])) return null;
      return { code, row: i + 1 };
    }
  }
  return null;
}
function touchReader(reader) {
  const sh = readerSheet();
  const n = Number(sh.getRange(reader.row, 8).getValue()) || 0;
  timedWrite(() => sh.getRange(reader.row, 7, 1, 2).setValues([[new Date(), n + 1]]));
}
function readerList(fam) {
  const rows = readAll(readerSheet());
  const fmt = d => d instanceof Date ? Utilities.formatDate(d, TIMEZONE, 'yyyy/MM/dd HH:mm') : String(d || '');
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (String(r[1]) !== fam.code) continue;
    list.push({ code: String(r[0]), created: fmt(r[3]), enabled: isTrue(r[4]), note: String(r[5] || ''), lastUsed: fmt(r[6]), uses: Number(r[7]) || 0 });
  }
  return list.reverse();
}
function readerCreate(fam, note) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (readerList(fam).filter(r => r.enabled).length >= READER_LIMIT) {
      return { ok: false, code: 'reader_limit', message: '已達閱讀碼上限' };
    }
    const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 去掉容易混淆的 0/O、1/I
    let code;
    do {
      code = 'R-';
      for (let i = 0; i < 6; i++) code += ABC[Math.floor(Math.random() * ABC.length)];
    } while (findReaderAny(code));
    timedWrite(() => readerSheet().appendRow([code, fam.code, fam.name, new Date(), true, note.slice(0, 40), '', 0]));
    return { ok: true, reader: code };
  } finally {
    lock.releaseLock();
  }
}
function findReaderAny(code) {
  return readAll(readerSheet()).some((r, i) => i > 0 && String(r[0]) === code);
}
function readerDisable(fam, code) {
  const sh = readerSheet();
  const rows = readAll(sh);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === code && String(rows[i][1]) === fam.code) {
      timedWrite(() => sh.getRange(i + 1, 5).setValue(false));
      return { ok: true };
    }
  }
  return { ok: false, code: 'not_found', message: '找不到這組閱讀碼' };
}

/* ===== 獎勵次數 ===== */
function familySheet() { return book().getSheetByName(SHEET_FAMILY); }
function currentBonus(fam) { return Number(familySheet().getRange(fam.row, 7).getValue()) || 0; }
function setBonus(fam, n) { timedWrite(() => familySheet().getRange(fam.row, 7).setValue(Math.max(0, n))); }

/* ===== 判讀結果合併 ===== */
function qSig(q) { return JSON.stringify([q.t, q.q, q.o || [], q.a, q.why || '', q.tpl || null]); }   // 換數字題改了題型也算修改
// 用戶端的題庫不一定有最新的判讀結果：題目內容沒變就沿用伺服器上的判讀，內容變了就清除（等重新判讀）
function mergeChecks(old, bank) {
  const changed = [];
  if (!old) return changed;
  const map = {};
  (old.questions || []).forEach(q => { map[q.id] = q; });
  (bank.questions || []).forEach(q => {
    const o = map[q.id];
    if (!o) return;
    // 詳解也算題目內容：家長改了詳解就要重新判讀。
    // 例外：用戶端的舊資料沒有詳解、伺服器上的詳解是排程補的，視為沒有修改。
    const fromScan = !q.detail && o.detail && o.detailBy;
    const detailSame = (q.detail || '') === (o.detail || '') || fromScan;
    if (qSig(o) === qSig(q) && detailSame) {
      if (o.check) q.check = o.check; else delete q.check;
      if (fromScan) { q.detail = o.detail; q.detailBy = o.detailBy; }
    }
    else { delete q.check; changed.push(String(q.id)); }
  });
  return changed;
}

/* ===== 回報 ===== */
function reportSheet() { return book().getSheetByName(SHEET_REPORT); }
const OPEN_STATUS = { '待複審': 1, '成立': 1 };

function flagsFor(ids) {
  const want = {};
  ids.forEach(id => { want[id] = {}; });
  const sh = reportSheet();
  if (sh) {
    const rows = readAll(sh);
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i], b = String(r[2]), st = String(r[9]);
      if (!want[b] || !OPEN_STATUS[st]) continue;
      want[b][String(r[3])] = st === '成立' ? 'issue' : (want[b][String(r[3])] || 'reported');
    }
  }
  return want;
}

function reportQuestion(who, req) {
  const bankId = String(req.bankId || ''), qId = String(req.qId || '');
  const reasons = ['答案錯誤', '題目缺條件或看不懂', '兩個以上答案都對', '錯字', '其他'];
  const reason = reasons.indexOf(req.reason) >= 0 ? req.reason : '其他';
  if (!bankId || !qId) return { ok: false, code: 'bad_request', message: '缺少題目' };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sh = reportSheet();
    const rows = readAll(sh);
    const today = Utilities.formatDate(new Date(), TIMEZONE, 'yyyyMMdd');
    let todayCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (String(r[2]) === bankId && String(r[3]) === qId && OPEN_STATUS[String(r[9])]) {
        return { ok: false, code: 'already_reported', message: '這題已經有人回報了' };
      }
      if (String(r[5]) === who.code && r[1] instanceof Date && Utilities.formatDate(r[1], TIMEZONE, 'yyyyMMdd') === today) todayCount++;
    }
    if (todayCount >= REPORT_DAILY_LIMIT) return { ok: false, code: 'report_limit', message: '今天的回報次數已達上限' };
    let snap = String(req.snapshot || '').slice(0, 2000);
    if (bankId !== '__plant') {
      const q = findQuestion(bankId, qId);
      if (!q) return { ok: false, code: 'not_found', message: '找不到這題' };
      snap = JSON.stringify({ q: q.q.q, o: q.q.o, a: q.q.a, why: q.q.why });
    }
    timedWrite(() => sh.appendRow(['R' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), new Date(), bankId, qId, snap, who.code, who.role,
      reason, String(req.note || '').slice(0, 200), '待複審', '', '', '']));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// 題目被修改後，原本的回報結案
function closeReports(bankId, qIds) {
  const sh = reportSheet();
  if (!sh) return;
  const set = {};
  qIds.forEach(id => { set[id] = 1; });
  const rows = readAll(sh);
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === bankId && set[String(rows[i][3])] && OPEN_STATUS[String(rows[i][9])]) {
      timedWrite(() => sh.getRange(i + 1, 10).setValue(String(rows[i][9]) === '成立' ? '已修正' : '題目已修改'));
    }
  }
}

// 在所有家庭的題庫中找題目
function findQuestion(bankId, qId) {
  const rows = readAll(bankSheet());
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][1]) !== bankId) continue;
    const n = Number(rows[i][6]) || 1;
    try {
      const b = JSON.parse(rows[i].slice(7, 7 + n).join(''));
      const q = (b.questions || []).filter(x => String(x.id) === qId)[0];
      if (q) return { owner: String(rows[i][0]), bank: b, q };
    } catch (e) {}
  }
  return null;
}

/* ===== 重點講義 =====
   一份講義一列；內容 JSON 分段放在 K 欄之後。狀態：待驗算 → 已驗算／已修正（由定期掃題寫回） */
function handoutSheet() { return book().getSheetByName(SHEET_HANDOUT); }
function hoMeta(r, i) {
  return { row: i + 1, id: String(r[0]), owner: String(r[1]), bankId: String(r[2]), title: String(r[3]), concepts: String(r[4]),
    createdAt: r[5] instanceof Date ? r[5].getTime() : Number(r[5]) || 0, status: String(r[6] || '待驗算'), note: String(r[7] || ''),
    verifiedAt: r[8] instanceof Date ? r[8].getTime() : 0 };
}
function hoRows() {
  const sh = handoutSheet();
  if (!sh) return [];
  const rows = readAll(sh);
  const list = [];
  for (let i = 1; i < rows.length; i++) if (rows[i][0]) list.push({ meta: hoMeta(rows[i], i), raw: rows[i] });
  return list;
}
function hoParse(x) {
  const n = Number(x.raw[9]) || 1;
  try {
    const h = JSON.parse(x.raw.slice(10, 10 + n).join(''));
    h.id = x.meta.id; h.bankId = x.meta.bankId; h.status = x.meta.status; h.note = x.meta.note; h.verifiedAt = x.meta.verifiedAt;
    return h;
  } catch (e) { return null; }
}
const hoPublic = m => ({ id: m.id, bankId: m.bankId, title: m.title, concepts: m.concepts, createdAt: m.createdAt, status: m.status });
function handoutList(fam, bankId) {
  return hoRows().filter(x => x.meta.owner === fam.code && x.meta.bankId === bankId).map(x => hoPublic(x.meta))
    .sort((a, b) => b.createdAt - a.createdAt);
}
function handoutGet(id, owner) {
  const x = hoRows().filter(r => r.meta.id === id && (!owner || r.meta.owner === owner))[0];
  return x ? hoParse(x) : null;
}
function hoWrite(rowIdx, meta, h) {
  const body = Object.assign({}, h);
  ['id', 'bankId', 'status', 'note', 'verifiedAt'].forEach(k => delete body[k]);
  const json = JSON.stringify(body);
  if (json.length > MAX_HANDOUT_CHARS) return { ok: false, code: 'too_large', message: '講義太大' };
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  const sh = handoutSheet();
  const values = [meta.id, meta.owner, meta.bankId, meta.title, meta.concepts, meta.createdAt ? new Date(meta.createdAt) : new Date(),
    meta.status, meta.note || '', meta.verifiedAt ? new Date(meta.verifiedAt) : '', parts.length].concat(parts);
  const lastCol = sh.getLastColumn();
  if (lastCol > values.length) timedWrite(() => sh.getRange(rowIdx, values.length + 1, 1, lastCol - values.length).clearContent());
  timedWrite(() => sh.getRange(rowIdx, 1, 1, values.length).setValues([values]));
  return { ok: true };
}
function handoutSave(fam, h) {
  if (!h || !h.id || !h.bankId) return { ok: false, code: 'bad_request', message: '缺少講義' };
  if (!handoutSheet()) return { ok: false, code: 'server_error', message: '後端還沒建立「講義」工作表，請管理者執行一次 setup' };
  if (!listBanks(fam).some(b => String(b.id) === String(h.bankId))) return { ok: false, code: 'not_found', message: '找不到題庫' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const old = hoRows().filter(x => x.meta.id === String(h.id))[0];
    if (old && old.meta.owner !== fam.code) return { ok: false, code: 'not_found', message: '找不到講義' };
    const meta = { id: String(h.id), owner: fam.code, bankId: String(h.bankId), title: String(h.title || '重點講義').slice(0, 100),
      concepts: [].concat(h.conceptTexts || []).join('、').slice(0, 300), createdAt: Number(h.createdAt) || Date.now(),
      status: '待驗算', note: '', verifiedAt: 0 };
    return hoWrite(old ? old.meta.row : handoutSheet().getLastRow() + 1, meta, h);
  } finally {
    lock.releaseLock();
  }
}
function handoutDelete(fam, id) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const x = hoRows().filter(r => r.meta.id === id && r.meta.owner === fam.code)[0];
    if (x) timedWrite(() => handoutSheet().deleteRow(x.meta.row));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
function publicOwner(bankId) {
  const rows = readAll(publicSheet());
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === bankId) return String(rows[i][1]);
  return '';
}
function libHandouts(bankId) {
  const owner = publicOwner(bankId);
  if (!owner) return [];
  return hoRows().filter(x => x.meta.owner === owner && x.meta.bankId === bankId).map(x => hoPublic(x.meta))
    .sort((a, b) => b.createdAt - a.createdAt);
}
function libHandoutGet(id) {
  const x = hoRows().filter(r => r.meta.id === id)[0];
  if (!x || publicOwner(x.meta.bankId) !== x.meta.owner) return null;
  return hoParse(x);
}

/* ===== 定期掃題（由排程工作呼叫） ===== */
function allBanks() {
  const rows = readAll(bankSheet());
  const list = [];
  for (let i = 1; i < rows.length; i++) {
    const n = Number(rows[i][6]) || 1;
    try { list.push({ owner: String(rows[i][0]), bank: JSON.parse(rows[i].slice(7, 7 + n).join('')) }); } catch (e) {}
  }
  return list;
}

// 取得要判讀的項目：待複審的回報（優先）＋還沒判讀過的題目
function adminPending(limit) {
  const banks = allBanks();
  const byId = {};
  banks.forEach(x => { byId[String(x.bank.id)] = x; });
  const conText = (b, c) => ((b.concepts || []).filter(k => k.id === c)[0] || {}).text || '';
  const pack = (x, q) => ({ bankId: String(x.bank.id), bankInfo: [x.bank.grade, x.bank.term, x.bank.subject, x.bank.publisher, x.bank.unit].filter(Boolean).join(' '),
    qId: String(q.id), concept: conText(x.bank, q.c), t: q.t, q: q.q, o: q.o || null, a: q.a, why: q.why || '', detail: q.detail || '',
    ...(q.tpl ? { tpl: q.tpl } : {}),
    ...(q.p ? { passage: ((x.bank.passages || []).filter(p => p.id === q.p)[0] || {}) } : {}) });   // 閱讀測驗：附上文章   // 換數字題：q / o / a 只是一組範例，排程要檢查模板
  const reports = [];
  const rows = readAll(reportSheet());
  for (let i = 1; i < rows.length && reports.length < limit; i++) {
    const r = rows[i];
    if (String(r[9]) !== '待複審') continue;
    const x = byId[String(r[2])];
    const q = x && (x.bank.questions || []).filter(k => String(k.id) === String(r[3]))[0];
    reports.push({ reportId: String(r[0]), bankId: String(r[2]), qId: String(r[3]), reason: String(r[7]), note: String(r[8]),
      snapshot: String(r[4]), current: q ? pack(x, q) : null });
  }
  // 換數字題只判讀過範例（後端升級前判的）也要重判模板
  const unjudged = q => !q.check || (q.tpl && !q.check.tpl);
  const questions = [];
  banks.forEach(x => (x.bank.questions || []).forEach(q => {
    if (unjudged(q) && questions.length < Math.max(0, limit - reports.length)) questions.push(pack(x, q));
  }));
  const total = banks.reduce((n, x) => n + (x.bank.questions || []).filter(unjudged).length, 0);
  // 已判讀通過、但還沒有詳細解題的題目（判讀完再補，避免替有問題的題目寫詳解）
  const needDetail = [];
  banks.forEach(x => (x.bank.questions || []).forEach(q => {
    if (!q.detail && !q.tpl && q.check && q.check.s === 'pass' && needDetail.length < limit) needDetail.push(pack(x, q));
  }));
  const detailTotal = banks.reduce((n, x) => n + (x.bank.questions || []).filter(q => !q.detail && !q.tpl && q.check && q.check.s === 'pass').length, 0);
  // 待驗算的重點講義（內容較大，每輪最多 2 份）
  const hoAll = hoRows().filter(x => x.meta.status === '待驗算');
  const handouts = hoAll.slice(0, 2).map(x => {
    const h = hoParse(x);
    const b = byId[x.meta.bankId];
    return h && { id: x.meta.id, bankId: x.meta.bankId,
      bankInfo: b ? [b.bank.grade, b.bank.term, b.bank.subject, b.bank.publisher, b.bank.unit].filter(Boolean).join(' ') : '',
      subject: b ? String(b.bank.subject || '') : '', handout: h };
  }).filter(Boolean);
  return { ok: true, reports, questions, unjudgedTotal: total, needDetail, needDetailTotal: detailTotal, handouts, handoutsTotal: hoAll.length };
}

// 寫回判讀結果。items：題目判讀；reports：回報是否成立
function adminVerdict(req) {
  const items = [].concat(req.items || []), reps = [].concat(req.reports || []), details = [].concat(req.details || []);
  const hos = [].concat(req.handouts || []);
  const model = String(req.model || '').slice(0, 40);
  const now = Date.now();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const result = { ok: true, judged: 0, reportsDone: 0, rewards: 0, detailsAdded: 0, handoutsDone: 0 };
  try {
    const banks = allBanks();
    const byId = {};
    banks.forEach(x => { byId[String(x.bank.id)] = x; });
    const dirty = {};
    const setCheck = (bankId, qId, s, note, fix) => {
      const x = byId[bankId];
      const q = x && (x.bank.questions || []).filter(k => String(k.id) === qId)[0];
      if (!q) return false;
      q.check = { s: s === 'issue' ? 'issue' : 'pass', note: String(note || '').slice(0, 300), at: now, by: model, ...(q.tpl ? { tpl: 1 } : {}) };
      if (fix && typeof fix === 'object') q.check.fix = { q: fix.q, o: fix.o, a: fix.a, why: fix.why, detail: fix.detail };
      dirty[bankId] = 1;
      return true;
    };
    items.forEach(it => { if (setCheck(String(it.bankId), String(it.qId), it.status, it.note, it.fix)) result.judged++; });
    // 補上詳細解題（只補還沒有詳解的題目，不覆蓋家長寫的）
    details.forEach(d => {
      const x = byId[String(d.bankId)];
      const q = x && (x.bank.questions || []).filter(k => String(k.id) === String(d.qId))[0];
      const text = String(d.detail || '').trim().slice(0, 400);
      if (!q || q.detail || !text) return;
      q.detail = text; q.detailBy = model || 'scan';
      dirty[String(d.bankId)] = 1; result.detailsAdded++;
    });

    const sh = reportSheet();
    const rows = readAll(sh);
    const rewarded = {};
    rows.forEach((r, i) => { if (i && String(r[12]).indexOf('+') === 0) rewarded[String(r[2]) + '|' + String(r[3])] = 1; });
    reps.forEach(v => {
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (String(r[0]) !== String(v.reportId) || String(r[9]) !== '待複審') continue;
        const ok = v.verdict === '成立';
        const key = String(r[2]) + '|' + String(r[3]);
        let reward = '';
        if (ok) {
          if (String(r[6]) !== '家庭') reward = '不適用（閱讀碼）';
          else if (rewarded[key]) reward = '同題已發放';
          else {
            const fam = findFamily(String(r[5]));
            if (fam) { setBonus(fam, currentBonus(fam) + REWARD_PER_REPORT); reward = '+' + REWARD_PER_REPORT; rewarded[key] = 1; result.rewards++; }
            else reward = '家庭已停用';
          }
          setCheck(String(r[2]), String(r[3]), 'issue', v.note, v.fix);
        }
        timedWrite(() => sh.getRange(i + 1, 10, 1, 4).setValues([[ok ? '成立' : '不成立', String(v.note || '').slice(0, 300), new Date(), reward]]));
        result.reportsDone++;
      }
    });
    Object.keys(dirty).forEach(id => { const x = byId[id]; putBank({ code: x.owner }, x.bank, true); });
    // 講義驗算結果：data 有給就用修正後的內容取代
    if (hos.length) {
      const all = hoRows();
      hos.forEach(v => {
        const x = all.filter(r => r.meta.id === String(v.id))[0];
        if (!x) return;
        const cur = hoParse(x);
        if (!cur) return;
        const fixed = v.data && typeof v.data === 'object';
        const h = fixed ? Object.assign({}, cur, v.data) : cur;
        const meta = Object.assign({}, x.meta, { status: fixed ? '已修正' : '已驗算', note: String(v.note || '').slice(0, 500), verifiedAt: now });
        h.verifiedBy = model || 'scan';
        if (hoWrite(x.meta.row, meta, h).ok) result.handoutsDone++;
      });
    }
  } finally {
    lock.releaseLock();
  }
  return result;
}

/* ===== 徽章同步 ===== */
function badgeSheet() {
  const ss = book();
  let sh = ss.getSheetByName(SHEET_BADGE);
  if (!sh) {   // 沒重新跑 setup 也能用
    sh = ss.insertSheet(SHEET_BADGE);
    timedWrite(() => sh.appendRow(['代碼', '身分', '更新時間', '徽章 JSON']));
    sh.setFrozenRows(1);
  }
  return sh;
}
// 同一個徽章在兩台裝置都有紀錄時：得到過的次數取聯集（用得到的時間去重），
// 收集中的格子取「最近得到徽章」較晚的那台；一樣晚就取格子較多的那台
function mergeBadgeRec(a, b) {
  if (!a || typeof a !== 'object') return b;
  if (!b || typeof b !== 'object') return a;
  const seen = {}, earned = [];
  [].concat(a.earned || [], b.earned || []).forEach(e => {
    const k = String(e && e.at);
    if (e && !seen[k]) { seen[k] = 1; earned.push({ at: Number(e.at) || 0, dark: !!e.dark }); }
  });
  earned.sort((x, y) => x.at - y.at);
  const last = r => (r.earned || []).reduce((m, e) => Math.max(m, Number(e && e.at) || 0), 0);
  const la = last(a), lb = last(b);
  const cur = la !== lb ? (la > lb ? a : b) : ((b.cells || []).length >= (a.cells || []).length ? b : a);
  return { cells: (cur.cells || []).slice(0, 400), ok: cur.ok || [0, 0, 0], earned: earned.slice(-500), meta: b.meta || a.meta || null };
}
function badgeSync(code, role, incoming, pid) {
  return withLock(() => {
    pid = pid || 'p1';
    const inc = incoming && typeof incoming === 'object' ? incoming : {};
    if (role === '家庭') { const err = checkPlayer(code, pid); if (err) return err; }
    const sh = badgeSheet(), rows = sheetRows(SHEET_BADGE);
    let row = 0, stored = {};
    for (let i=1; i<rows.length; i++) {
      if (String(rows[i][0]) === code && (role !== '家庭' || String(rows[i][4] || 'p1') === pid)) {
        row = i+1; try { stored = JSON.parse(String(rows[i][3] || '{}')) || {}; } catch(e) {}
        break;
      }
    }
    const merged = {};
    Object.keys(stored).concat(Object.keys(inc)).forEach(k => {
      if (Object.prototype.hasOwnProperty.call(merged,k) || !/^[\w-]{1,80}$/.test(k)) return;
      Object.defineProperty(merged,k,{value:mergeBadgeRec(stored[k],inc[k]), enumerable:true});
    });
    const json = JSON.stringify(merged);
    if (json.length > 49000) return {ok:false, code:'too_large', message:'徽章資料太大'};
    if (role === '家庭') syncLedger(code, pid, inc);
    if (json !== JSON.stringify(stored)) {
      const values = [safeCell(code),safeCell(role),new Date(),safeCell(json)];
      if (role === '家庭') values.push(safeCell(pid));
      if (row) timedWrite(() => sh.getRange(row,1,1,values.length).setValues([values])); else timedWrite(() => sh.appendRow(values));
    }
    return {ok:true, badges:merged};
  });
}
/* ===== 家長憑證與玩家管理 ===== */
function parentRandom() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function parentHex(bytes) { return bytes.map(b => ('0' + (b & 255).toString(16)).slice(-2)).join(''); }
function parentHash(value) { return parentHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)); }
function parentPinHash(salt, pin, pepper) { return parentHex(Utilities.computeHmacSha256Signature(salt + pin, pepper)); }
function adminParent(req) {
  return withLock(() => {
    const fam = findFamily(req.family);
    if (!fam) return {ok:false, code:'not_found'};
    const props = PropertiesService.getScriptProperties();
    if (req.action === 'adminResetPin') {
      ['pin:','pinfail:','pinsetup:'].forEach(prefix => props.deleteProperty(prefix + fam.code));
      return {ok:true};
    }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    // Fresh UUID's first eight bytes avoid its fixed version/variant bits.
    const bytes = Utilities.getUuid().replace(/-/g,'').slice(0,16).match(/../g);
    const setupCode = bytes.map(b => alphabet[parseInt(b,16) % alphabet.length]).join('');
    props.setProperty('pinsetup:' + fam.code, parentHash(setupCode));
    return {ok:true, setupCode};
  });
}
function parentAction(fam, req) {
  return withLock(() => {
    const props = PropertiesService.getScriptProperties(), code = fam.code;
    const pepper = props.getProperty('PEPPER');
    if (!pepper) return {ok:false, code:'server_error', message:'請管理者執行 setup'};
    const pin = JSON.parse(props.getProperty('pin:' + code) || 'null');
    const failKey = 'pinfail:' + code;
    let fail = JSON.parse(props.getProperty(failKey) || '{"n":0,"until":0}');
    if (fail.until && fail.until <= Date.now()) {
      fail = {n:0, until:0}; props.setProperty(failKey, JSON.stringify(fail));
    }
    const minutes = Math.max(0, Math.ceil((fail.until - Date.now()) / 60000));
    if (req.action === 'parentStatus') return Object.assign({ok:true, hasPin:!!pin, locked:minutes > 0, minutes}, pin ? {} : {needSetup:true});
    if (req.action === 'parentLogout') {
      if (typeof req.session === 'string' && !requireSession(fam, req)) CacheService.getScriptCache().remove('ps:' + parentHash(req.session));
      return {ok:true};
    }
    if (minutes) return {ok:false, code:'locked', minutes};
    const failed = code => {
      fail.n++; fail.until = fail.n >= 5 ? Date.now() + 900000 : 0;
      props.setProperty(failKey, JSON.stringify(fail));
      return {ok:false, code, left:Math.max(0, 5-fail.n)};
    };
    let credential = pin;
    if (req.action === 'parentSetPin') {
      if (pin) return {ok:false, code:'pin_exists'};
      const setupHash = props.getProperty('pinsetup:' + code);
      if (!setupHash || typeof req.setupCode !== 'string' || parentHash(req.setupCode) !== setupHash) return failed('bad_setup_code');
      if (typeof req.pin !== 'string' || !/^\d{4,6}$/.test(req.pin)) return {ok:false, code:'bad_pin_format'};
      const salt = parentRandom();
      credential = {salt, h:parentPinHash(salt, req.pin, pepper)};
      props.setProperty('pin:' + code, JSON.stringify(credential));
      props.deleteProperty('pinsetup:' + code);
    } else {
      if (!pin) return {ok:false, code:'no_pin'};
      if (typeof req.pin !== 'string' || !/^\d{4,6}$/.test(req.pin) || parentPinHash(pin.salt, req.pin, pepper) !== pin.h) return failed('bad_pin');
    }
    props.setProperty(failKey, JSON.stringify({n:0, until:0}));
    const session = parentRandom();
    CacheService.getScriptCache().put('ps:' + parentHash(session), code + '|' + credential.salt, 1800);
    return {ok:true, session};
  });
}
function requireSession(fam, req) {
  const pin = JSON.parse(PropertiesService.getScriptProperties().getProperty('pin:' + fam.code) || 'null');
  if (pin && typeof req.session === 'string' && CacheService.getScriptCache().get('ps:' + parentHash(req.session)) === fam.code + '|' + pin.salt) return null;
  return {ok:false, code:'no_session', message:'請重新輸入家長 PIN'};
}
// Callers already hold the script lock.
function cancelPendingFor(code, pid) {
  readRedeems(code).filter(r => r.playerId === pid && r.status === '待核准').forEach(r => changeRedeem(r,'取消','','parent'));
}
function purgeRedeemsFor(code, pid) {
  const rows = readRedeems(code).filter(r => r.playerId === pid), ids = new Set(rows.map(r => r.id));
  const logs = book().getSheetByName('兌換紀錄');
  if (logs) {
    const data = readAll(logs);
    for (let i=data.length-1; i>0; i--) if (ids.has(String(data[i][1]))) timedWrite(() => logs.deleteRow(i+1));
  }
  const sh = book().getSheetByName('兌換');
  rows.reverse().forEach(r => timedWrite(() => sh.deleteRow(r.row)));
}
function managePlayer(fam, req) {
  return withLock(() => {
    const err = requireSession(fam, req);
    if (err) return err;
    const pid = req.playerId;
    if (typeof pid !== 'string' || !/^p[a-z0-9]{1,12}$/.test(pid) || (pid === 'p1' && req.action !== 'playerRestore')) return {ok:false, code:'bad_request'};
    const sh = book().getSheetByName('玩家');
    const rows = sheetRows('玩家') || [];
    const row = rows.findIndex((r,i) => i > 0 && String(r[0]) === fam.code && String(r[1]) === pid);
    if (row < 1) return {ok:false, code:'bad_player'};
    if (req.action === 'playerPurge') {
      listBanks(fam).forEach(bank => {
        if (bank.players && Object.prototype.hasOwnProperty.call(bank.players,pid)) {
          delete bank.players[pid];
          const result = putBank(fam, bank, true);
          if (!result.ok) throw new Error('玩家資料清除失敗');
        }
      });
      const remove = (name, matches) => {
        const sheet = book().getSheetByName(name);
        if (!sheet) return;
        const data = sheetRows(name);
        for (let i=data.length-1; i>0; i--) if (String(data[i][0]) === fam.code && matches(data[i])) timedWrite(() => sheet.deleteRow(i+1));
      };
      remove('徽章', r => String(r[1]) === '家庭' && String(r[4] || 'p1') === pid);
      remove('徽章入帳', r => String(r[1]) === pid);
      purgeRedeemsFor(fam.code, pid);
      PropertiesService.getScriptProperties().deleteProperty('ledgerinit:' + fam.code + ':' + pid);
      timedWrite(() => sh.deleteRow(row+1));
    } else {
      const disabled = req.action === 'playerDisable';
      timedWrite(() => sh.getRange(row+1,6).setValue(safeCell(disabled ? '停用' : '啟用')));
      timedWrite(() => sh.getRange(row+1,8,1,2).setValues([[new Date(),disabled ? new Date() : '']]));
      if (disabled) cancelPendingFor(fam.code, pid);
    }
    return {ok:true};
  });
}
function safeCell(s) { s = String(s == null ? '' : s); return s === '' ? '' : "'" + s; }
function withLock(fn) {
  const lock = LockService.getScriptLock();
  try { timed('lock', () => lock.waitLock(10000)); } catch(e) { return {ok:false, code:'busy', message:'系統忙碌，請再試一次'}; }
  const memo = READ_MEMO, lockReads = LOCK_READS; READ_MEMO = null; LOCK_READS = {};
  try {
    try { return fn(); } finally { try { timedWrite(() => SpreadsheetApp.flush()); } finally { lock.releaseLock(); } }
  } finally { READ_MEMO = memo; LOCK_READS = lockReads; }
}
let READ_MEMO = null;
let LOCK_READS = null;
function sheetRows(name) {
  const memo = READ_MEMO !== null ? READ_MEMO : LOCK_READS;
  if (memo !== null && Object.prototype.hasOwnProperty.call(memo,name)) return memo[name];
  const sh = book().getSheetByName(name);
  const rows = sh ? readAll(sh) : null;
  if (memo !== null) memo[name] = rows;
  return rows;
}
function readOnlyRun(needsWrite, fn) {
  const prev = READ_MEMO; READ_MEMO = {};
  try { if (!needsWrite()) return fn(); }
  finally { READ_MEMO = prev; }
  return withLock(fn);
}
function missingP1(code) { return !readPlayers(code).some(p => p.id === 'p1'); }
function ledgerUninitialized(code, pid) {
  return !PropertiesService.getScriptProperties().getProperty('ledgerinit:' + code + ':' + pid);
}
function rewardSheet(name, header) {
  const ss = book();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); timedWrite(() => sh.appendRow(header)); sh.setFrozenRows(1); }
  return sh;
}
function readPlayers(code) {
  const rows = sheetRows('玩家');
  if (!rows) return [];
  return rows.slice(1).filter(r => String(r[0]) === code).map(r => ({id:String(r[1]),name:String(r[2]),icon:String(r[3]),order:Number(r[4])||0,status:String(r[5])}));
}
function ensureP1(code) {
  if (!readPlayers(code).some(p => p.id === 'p1')) {
    const sh = rewardSheet('玩家',PLAYER_HEADER);
    timedWrite(() => sh.appendRow([safeCell(code),safeCell('p1'),safeCell('玩家 1'),safeCell('🌱'),0,safeCell('啟用'),new Date(),new Date(),'']));
  }
}
function checkPlayer(code, pid) {
  pid = pid || 'p1';
  if (!/^p[a-z0-9]{1,12}$/.test(String(pid))) return {ok:false, code:'bad_request'};
  if (pid === 'p1') ensureP1(code);
  const p = readPlayers(code).find(p => p.id === pid);
  if (!p) return {ok:false, code:'bad_player'};
  if (p.status !== '啟用') return {ok:false, code:'player_disabled'};
  return null;
}
function playerSave(code, req) {
  const name = String(req.name || '').trim(), icon = String(req.icon || '');
  if (!name || Array.from(name).length > 12 || PLAYER_ICONS.indexOf(icon) < 0 || (req.playerId && !/^p[a-z0-9]{1,12}$/.test(String(req.playerId)))) return {ok:false, code:'bad_request'};
  return withLock(() => {
    ensureP1(code);
    const sh = rewardSheet('玩家',PLAYER_HEADER), rows = sheetRows('玩家');
    let pid = req.playerId, row = 0;
    if (pid) {
      row = rows.findIndex((r,i) => i > 0 && String(r[0]) === code && String(r[1]) === pid) + 1;
      if (!row) return {ok:false, code:'bad_player'};
      timedWrite(() => sh.getRange(row,3,1,2).setValues([[safeCell(name),safeCell(icon)]]));
      timedWrite(() => sh.getRange(row,8).setValue(new Date()));
    } else {
      const players = readPlayers(code);
      if (players.length >= MAX_PLAYERS) return {ok:false, code:'player_limit'};
      do { pid = 'p' + Utilities.getUuid().replace(/-/g,'').slice(0,8).toLowerCase(); } while (rows.some(r => String(r[1]) === pid));
      timedWrite(() => sh.appendRow([safeCell(code),safeCell(pid),safeCell(name),safeCell(icon),Math.max(...players.map(p => p.order))+1,safeCell('啟用'),new Date(),new Date(),'']));
    }
    return {ok:true, player:readPlayers(code).find(p => p.id === pid)};
  });
}
// Writes only under withLock, before either cloud snapshot is overwritten.
// 只讀模式絕不寫入;補入帳只在鎖內(READ_MEMO 為 null)進行。
function syncLedger(code, pid, incoming) {
  return timed('sync', () => syncLedgerBody(code, pid, incoming));
}
function syncLedgerBody(code, pid, incoming) {
  if (READ_MEMO !== null) return;
  const props = PropertiesService.getScriptProperties(), initKey = 'ledgerinit:' + code + ':' + pid;
  const initial = !props.getProperty(initKey);
  if (!initial && Object.keys(incoming || {}).length === 0) return;
  const sh = rewardSheet('徽章入帳',LEDGER_HEADER), rows = sheetRows('徽章入帳').slice(1);
  const now = new Date();
  const day = d => Utilities.formatDate(new Date(d),TIMEZONE,'yyyy-MM-dd');
  const seen = new Set(rows.filter(r => String(r[0]) === code && String(r[1]) === pid).map(r => JSON.stringify([String(r[2]),Number(r[3])])));
  let count = rows.filter(r => String(r[0]) === code && String(r[1]) === pid && !r[6] && String(r[8]) === '同步' && day(r[5]) === day(now)).length;
  const add = (key, rec, source) => {
    if (!/^[\w-]{1,80}$/.test(key)) return;
    (rec && Array.isArray(rec.earned) ? rec.earned : []).forEach(e => {
      const at = Number(e && e.at);
      // Malformed timestamps cannot create spendable credit.
      if (!Number.isFinite(at) || at <= 0) return;
      const unique = JSON.stringify([key,at]);
      if (seen.has(unique)) return;
      seen.add(unique);
      const anomaly = at > now.getTime()+300000 ? '時間異常' : source === '同步' && count >= DAILY_BADGE_CAP ? '超過每日上限' : '';
      if (!anomaly && source === '同步') count++;
      timedWrite(() => sh.appendRow([safeCell(code),safeCell(pid),safeCell(key),at,safeCell(e.dark ? '金' : '銀'),now,safeCell(anomaly),1,safeCell(source)]));
    });
  };
  if (initial) {
    listBanks({code}).forEach(b => add(String(b.id),pid === 'p1' ? b.badge : (b.players || {})[pid] && b.players[pid].badge,'補入'));
    badgeSheet();
    sheetRows(SHEET_BADGE).slice(1).filter(r => String(r[0]) === code && String(r[4] || 'p1') === pid).forEach(r => {
      let badges = {}; try { badges = JSON.parse(String(r[3] || '{}')) || {}; } catch(e) {}
      Object.keys(badges).forEach(k => add(k,badges[k],'補入'));
    });
  }
  Object.keys(incoming || {}).forEach(k => add(k,incoming[k],initial && pid === 'p1' ? '補入' : '同步'));
  if (initial) props.setProperty(initKey,'1');
}
function playerBalance(code, pid) {
  const rows = sheetRows('徽章入帳');
  const result = {ok:true,silver:{available:0,held:0,total:0},gold:{available:0,held:0,total:0}};
  if (rows) rows.slice(1).forEach(r => {
    if (String(r[0]) !== code || String(r[1]) !== pid || r[6]) return;
    const color = String(r[4]) === '金' ? result.gold : String(r[4]) === '銀' ? result.silver : null;
    if (color) color.total += r[7] === '' ? 1 : Number(r[7]) || 0;
  });
  result.silver.available = result.silver.total;
  result.gold.available = result.gold.total;
  readRedeems(code).filter(r => r.playerId === pid && (r.status === '核准' || r.status === '待核准')).forEach(r => {
    result.silver.available -= r.pay.silver;
    result.gold.available -= r.pay.gold;
    if (r.status === '待核准') { result.silver.held += r.pay.silver; result.gold.held += r.pay.gold; }
  });
  return result;
}

/* ===== 獎勵與兌換：寫入由 rewardAction 持鎖 ===== */
function rewardIdValid(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id); }
function weekKey(time) {
  const d = new Date(Number(time) + 8*3600000);
  d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7);
  return d.toISOString().slice(0,10);
}
function normalizeWeek(value) {
  return value instanceof Date ? Utilities.formatDate(value,TIMEZONE,'yyyy-MM-dd') : String(value);
}
function readRewards(code) {
  const rows = sheetRows('獎勵');
  return rows ? rows.slice(1).map((r,i) => ({row:i+2,id:String(r[0]),family:String(r[1]),name:String(r[2]),silver:Number(r[3]),gold:Number(r[4]),goldForSilver:isTrue(r[5]),weeklyLimit:Number(r[6]),enabled:isTrue(r[7])})).filter(r => r.family === code) : [];
}
function readRedeems(code) {
  const rows = sheetRows('兌換');
  return rows ? rows.slice(1).map((r,i) => ({row:i+2,id:String(r[0]),requestId:String(r[1]),family:String(r[2]),playerId:String(r[3]),rewardId:String(r[4]),name:String(r[5]),silver:Number(r[6]),gold:Number(r[7]),goldForSilver:isTrue(r[8]),pay:{silver:Number(r[9]),gold:Number(r[10])},weekKey:normalizeWeek(r[11]),status:String(r[12]),reason:String(r[13] || ''),requestedAt:r[14],decidedAt:r[15],version:Number(r[16])})).filter(r => r.family === code) : [];
}
// requestId globally unique; callers must not expose foreign records.
function findRedeemRequest(requestId) {
  const rows = sheetRows('兌換');
  if (!rows) return null;
  const r = rows.slice(1).find(r => String(r[1]) === requestId);
  return r ? {family:String(r[2]),playerId:String(r[3]),id:String(r[0])} : null;
}
function publicReward(r) { const {row,family,...value} = r; return value; }
function publicRedeem(r) { const {row,family,...value} = r; return value; }
function weekUsed(code, pid, rewardId) {
  const week = weekKey(Date.now());
  return readRedeems(code).filter(r => r.playerId === pid && r.rewardId === rewardId && r.weekKey === week && (r.status === '核准' || r.status === '待核准')).length;
}
function rewardOffer(reward, bal, used) {
  const silver = Math.max(0,bal.silver.available), gold = Math.max(0,bal.gold.available);
  const paySilver = Math.min(silver,reward.silver), gap = reward.silver-paySilver;
  const missingGold = Math.max(0,reward.gold-gold);
  const missingSilver = Math.max(0,gap-(reward.goldForSilver ? Math.max(0,gold-reward.gold) : 0));
  let reason = [missingSilver ? '銀 '+missingSilver : '',missingGold ? '金 '+missingGold : ''].filter(Boolean).join('、');
  if (reason) reason = '還差'+reason;
  if (!reason && (bal.silver.available < 0 || bal.gold.available < 0)) reason = '還差'+(bal.silver.available < 0 ? '銀 '+(-bal.silver.available) : '金 '+(-bal.gold.available));
  let code = reason ? 'insufficient' : '';
  if (reward.weeklyLimit && used >= reward.weeklyLimit) { code = 'quota'; reason = '本週額度用完，下週一再來'; }
  if (!reward.enabled) { code = 'reward_disabled'; reason = 'reward_disabled'; }
  return {weekUsed:used,weekLeft:reward.weeklyLimit ? Math.max(0,reward.weeklyLimit-used) : null,canRedeem:!code,reason,pay:{silver:paySilver,gold:reward.gold+(reward.goldForSilver ? gap : 0)},code};
}
function appendRedeemLog(id, oldStatus, status, actor) {
  const sh = rewardSheet('兌換紀錄',REDEEM_LOG_HEADER);
  timedWrite(() => sh.appendRow([new Date(),safeCell(id),safeCell(oldStatus),safeCell(status),safeCell(actor)]));
}
function changeRedeem(r, status, reason, actor) {
  const sh = rewardSheet('兌換',REDEEM_HEADER);
  timedWrite(() => sh.getRange(r.row,13,1,5).setValues([[safeCell(status),safeCell(reason),r.requestedAt,new Date(),r.version+1]]));
  appendRedeemLog(r.id,r.status,status,actor);
}
function rewardAction(fam, req) {
  const code = fam.code, action = req.action;
  function body() {
    if (['rewardSave','redeemList','redeemDecide','parentLog'].indexOf(action) >= 0) {
      const err = requireSession(fam,req); if (err) return err;
    }
    if (action === 'rewardSave') {
      const r = req.reward || {}, name = typeof r.name === 'string' ? r.name.trim() : '';
      if (!name || Array.from(name).length > 20 || ![r.silver,r.gold].every(n => Number.isInteger(n) && n >= 0 && n <= 99) || r.silver+r.gold < 1 || !Number.isInteger(r.weeklyLimit) || r.weeklyLimit < 0 || r.weeklyLimit > 14 || (r.id !== undefined && !rewardIdValid(r.id))) return {ok:false,code:'bad_request'};
      const sh = rewardSheet('獎勵',REWARD_HEADER), old = r.id === undefined ? null : readRewards(code).find(w => w.id === r.id);
      if (r.id !== undefined && !old) return {ok:false,code:'not_found'};
      const id = old ? old.id : 'w'+Utilities.getUuid().replace(/-/g,'').slice(0,12);
      const values = [safeCell(id),safeCell(code),safeCell(name),r.silver,r.gold,r.goldForSilver === undefined ? true : isTrue(r.goldForSilver),r.weeklyLimit,r.enabled === undefined ? true : isTrue(r.enabled),new Date()];
      if (old) timedWrite(() => sh.getRange(old.row,1,1,values.length).setValues([values])); else timedWrite(() => sh.appendRow(values));
      return {ok:true,reward:publicReward(readRewards(code).find(w => w.id === id))};
    }
    if (action === 'parentLog') {
      const redeems = readRedeems(code), byId = new Map(redeems.map(r => [r.id,r])), players = readPlayers(code);
      const log = sheetRows('兌換紀錄');
      const entries = (log ? log.slice(1) : []).filter(r => byId.has(String(r[1])) && ['核准','拒絕'].indexOf(String(r[3])) >= 0).map(r => {
        const redeem = byId.get(String(r[1])), player = players.find(p => p.id === redeem.playerId);
        return {type:'decision',at:r[0],id:redeem.id,playerId:redeem.playerId,playerName:player ? player.name : '',name:redeem.name,oldStatus:String(r[2]),status:String(r[3]),actor:String(r[4]),reason:redeem.reason};
      }).reverse().sort((a,b) => new Date(b.at)-new Date(a.at)).slice(0,50);
      const ledger = sheetRows('徽章入帳');
      const anomalies = (ledger ? ledger.slice(1) : []).filter(r => String(r[0]) === code && r[6]).map(r => ({type:'anomaly',playerId:String(r[1]),playerName:(players.find(p => p.id === String(r[1])) || {}).name || '',badgeKey:String(r[2]),at:r[3],color:String(r[4]),reason:String(r[6]),creditedAt:r[5]})).reverse().sort((a,b) => new Date(b.creditedAt)-new Date(a.creditedAt));
      return {ok:true,entries:entries.concat(anomalies)};
    }
    if (action === 'redeemList') {
      const all = readRedeems(code), players = readPlayers(code), balances = {};
      const redeems = all.filter(r => !req.status ? r.status === '待核准' : req.status === 'all' || r.status === req.status).reverse().map(r => {
        const p = players.find(p => p.id === r.playerId) || {};
        if (!balances[r.playerId]) { syncLedger(code,r.playerId,{}); balances[r.playerId] = playerBalance(code,r.playerId); }
        return Object.assign(publicRedeem(r),{playerName:p.name || '',playerIcon:p.icon || '',balance:balances[r.playerId],weekUsed:weekUsed(code,r.playerId,r.rewardId)});
      });
      return {ok:true,redeems,pendingCount:all.filter(r => r.status === '待核准').length};
    }
    if (action === 'redeemDecide') {
      if (!rewardIdValid(req.id) || ['approve','reject'].indexOf(req.decision) < 0) return {ok:false,code:'bad_request'};
      const r = readRedeems(code).find(r => r.id === req.id);
      if (!r) return {ok:false,code:'not_found'};
      const status = req.decision === 'approve' ? '核准' : '拒絕';
      if (r.status === status) return {ok:true,already:true};
      if (r.status !== '待核准') return {ok:false,code:'conflict',status:r.status};
      syncLedger(code,r.playerId,{});
      const bal = playerBalance(code,r.playerId);
      if (status === '核准' && (bal.silver.available < 0 || bal.gold.available < 0)) return {ok:false,code:'insufficient'};
      changeRedeem(r,status,status === '拒絕' ? Array.from(String(req.reason || '').trim()).slice(0,40).join('') : '','parent');
      return {ok:true,redeem:publicRedeem(readRedeems(code).find(x => x.id === r.id)),balance:playerBalance(code,r.playerId)};
    }
    const pid = req.playerId || 'p1';
    if (typeof pid !== 'string' || !/^p[a-z0-9]{1,12}$/.test(pid)) return {ok:false,code:'bad_request'};
    if (action === 'redeemRequest') {
      if (!rewardIdValid(req.rewardId) || typeof req.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(req.requestId)) return {ok:false,code:'bad_request'};
    }
    const err = checkPlayer(code,pid);
    if (err && !(err.code === 'player_disabled' && action !== 'redeemRequest')) return err;
    if (action === 'redeemRequest') {
      const duplicate = findRedeemRequest(req.requestId);
      if (duplicate) {
        if (duplicate.family !== code || duplicate.playerId !== pid) return {ok:false,code:'bad_request'};
        return {ok:true,duplicate:true,redeem:publicRedeem(readRedeems(code).find(r => r.id === duplicate.id)),balance:playerBalance(code,pid)};
      }
    }
    if (action === 'myRedeems') return {ok:true,redeems:readRedeems(code).filter(r => r.playerId === pid).reverse().map(publicRedeem)};
    if (action === 'redeemCancel') {
      if (!rewardIdValid(req.id)) return {ok:false,code:'bad_request'};
      const r = readRedeems(code).find(r => r.id === req.id && r.playerId === pid);
      if (!r) return {ok:false,code:'not_found'};
      if (r.status === '取消') return {ok:true,already:true};
      if (r.status !== '待核准') return {ok:false,code:'conflict',status:r.status};
      changeRedeem(r,'取消','','child');
      return {ok:true,redeem:publicRedeem(readRedeems(code).find(x => x.id === r.id)),balance:playerBalance(code,pid)};
    }
    syncLedger(code,pid,{});
    const bal = playerBalance(code,pid), rewards = readRewards(code);
    if (action === 'rewardList') {
      const parent = !requireSession(fam,req);
      return {ok:true,rewards:rewards.filter(r => parent || r.enabled).map(r => {
        const {code:unused,...offer} = rewardOffer(r,bal,weekUsed(code,pid,r.id));
        return Object.assign(publicReward(r),offer);
      }),balance:bal,...(req.withRedeems === true ? {redeems:readRedeems(code).filter(r => r.playerId === pid).reverse().map(publicRedeem)} : {})};
    }
    const reward = rewards.find(r => r.id === req.rewardId);
    if (!reward) return {ok:false,code:'not_found'};
    const offer = rewardOffer(reward,bal,weekUsed(code,pid,reward.id));
    if (!offer.canRedeem) return {ok:false,code:offer.code,reason:offer.reason};
    const id = 'r'+Utilities.getUuid().replace(/-/g,'').slice(0,12), now = new Date();
    const sh = rewardSheet('兌換',REDEEM_HEADER);
    timedWrite(() => sh.appendRow([safeCell(id),safeCell(req.requestId),safeCell(code),safeCell(pid),safeCell(reward.id),safeCell(reward.name),reward.silver,reward.gold,reward.goldForSilver,offer.pay.silver,offer.pay.gold,safeCell(weekKey(now.getTime())),safeCell('待核准'),'',now,'',1]));
    appendRedeemLog(id,'','待核准','child');
    return {ok:true,redeem:publicRedeem(readRedeems(code).find(r => r.id === id)),balance:playerBalance(code,pid)};
  }
  function needsWrite() {
    if (action === 'parentLog') return false;
    if (action === 'redeemList') return readRedeems(code)
      .filter(r => !req.status ? r.status === '待核准' : req.status === 'all' || r.status === req.status)
      .some(r => ledgerUninitialized(code,r.playerId));
    const pid = req.playerId || 'p1';
    if (typeof pid !== 'string' || !/^p[a-z0-9]{1,12}$/.test(pid)) return false;
    return (pid === 'p1' && missingP1(code)) || (action === 'rewardList' && ledgerUninitialized(code,pid));
  }
  return ['rewardList','myRedeems','redeemList','parentLog'].indexOf(action) >= 0
    ? readOnlyRun(needsWrite,body) : withLock(body);
}
