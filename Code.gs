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
const MAX_TOKENS = 8000;
const MAX_IMAGES = 5;
const MAX_PROMPT_CHARS = 150000;
const CHUNK = 45000;          // 試算表單一儲存格上限 50,000 字元，保留緩衝
const MAX_BANK_CHARS = 900000;
const TIMEZONE = 'Asia/Taipei';

/* ===== 進入點 ===== */
function doGet() {
  return out({ ok: true, service: 'family-quiz' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, code: 'bad_request', message: '請求格式錯誤' });
  }
  // 題庫書架：閱讀碼或邀請碼都可以使用（只能讀，不能寫、不能用 AI）
  // 定期掃題（管理者金鑰）
  if (req.action === 'adminPending' || req.action === 'adminVerdict') {
    const token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
    if (!token || String(req.token || '') !== token) return out({ ok: false, code: 'bad_token', message: '管理者金鑰錯誤' });
    try {
      return out(req.action === 'adminPending' ? adminPending(Number(req.limit) || 60) : adminVerdict(req));
    } catch (err) {
      console.error(err);
      return out({ ok: false, code: 'server_error', message: String(err && err.message || err) });
    }
  }
  // 回報與回報狀態：閱讀碼或邀請碼都可以使用
  if (req.action === 'report' || req.action === 'flags') {
    const fam1 = findFamily(req.code);
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
  try {
    switch (req.action) {
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
        return out(saveBank(fam, req.bank));
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
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ===== 初始化 ===== */
function setup() {
  const ss = SpreadsheetApp.getActive();
  const ensure = (name, header) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(header);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    }
    return sh;
  };
  const fam = ensure(SHEET_FAMILY, ['邀請碼', '家庭名稱', '每日 AI 上限', '啟用', '備註', '可發布']);
  if (String(fam.getRange(1, 6).getValue()) === '') fam.getRange(1, 6).setValue('可發布').setFontWeight('bold');
  ensure(SHEET_READER, ['閱讀碼', '建立的邀請碼', '建立的家庭', '建立時間', '啟用', '給誰（備註）', '最後使用時間', '使用次數']);
  ensure(SHEET_PUBLIC, ['題庫ID', '邀請碼', '題庫名稱', '年級', '學期', '科目', '版本', '單元', '題數', '公開時間', '公開的家庭']);
  ensure(SHEET_BANK, ['邀請碼', '題庫ID', '題庫名稱', '更新時間', '題數', '題目雜湊', 'JSON 分段數', 'JSON1']);
  const qsh = ensure(SHEET_QUESTION, QUESTION_HEADER);
  QUESTION_HEADER.forEach((h, i) => { if (String(qsh.getRange(1, i + 1).getValue()) === '') qsh.getRange(1, i + 1).setValue(h).setFontWeight('bold'); });
  if (String(fam.getRange(1, 7).getValue()) === '') fam.getRange(1, 7).setValue('獎勵 AI 次數').setFontWeight('bold');
  ensure(SHEET_REPORT, ['回報ID', '時間', '題庫ID', '題目ID', '題目快照', '回報者代碼', '身分', '原因', '說明', '狀態', 'AI 判讀意見', '判讀時間', '獎勵']);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_TOKEN')) props.setProperty('ADMIN_TOKEN', Utilities.getUuid().replace(/-/g, ''));
  ensure(SHEET_USAGE, ['時間', '邀請碼', '家庭', '模型', '照片數', '輸入 token', '輸出 token', '估計美元']);
  if (fam.getLastRow() === 1) fam.appendRow(['TEST-0000', '測試家庭', 10, true, '測試用，可刪除', false]);
}

/* ===== 家庭與次數 ===== */
function findFamily(code) {
  code = String(code || '').trim();
  if (!code) return null;
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_FAMILY);
  if (!sh) return null;
  const rows = sh.getDataRange().getValues();
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
    payload: JSON.stringify({ model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content }] }),
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
  SpreadsheetApp.getActive().getSheetByName(SHEET_USAGE)
    .appendRow([new Date(), fam.code, fam.name, model, nImages, inT, outT, Math.round(usd * 10000) / 10000]);
}

/* ===== 題庫儲存 ===== */
function bankSheet() { return SpreadsheetApp.getActive().getSheetByName(SHEET_BANK); }

function listBanks(fam) {
  const rows = bankSheet().getDataRange().getValues();
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

function saveBank(fam, bank) {
  if (!bank || !bank.id) return { ok: false, code: 'bad_request', message: '缺少題庫' };
  const old = listBanks(fam).filter(b => String(b.id) === String(bank.id))[0];
  const changed = mergeChecks(old, bank);
  if (changed.length) closeReports(String(bank.id), changed);
  return putBank(fam, bank);
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
    const rows = sh.getDataRange().getValues();
    let rowIdx = -1, oldHash = '';
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === fam.code && String(rows[i][1]) === String(bank.id)) { rowIdx = i + 1; oldHash = String(rows[i][5]); break; }
    }
    const values = [fam.code, String(bank.id), title, new Date(), (bank.questions || []).length, qHash, parts.length].concat(parts);
    if (rowIdx < 0) rowIdx = sh.getLastRow() + 1;
    // 清掉舊的多餘分段
    const lastCol = sh.getLastColumn();
    if (lastCol > values.length) sh.getRange(rowIdx, values.length + 1, 1, lastCol - values.length).clearContent();
    sh.getRange(rowIdx, 1, 1, values.length).setValues([values]);
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
    const rows = sh.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (String(rows[i][0]) === fam.code && String(rows[i][1]) === id) sh.deleteRow(i + 1);
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
  const qsh = SpreadsheetApp.getActive().getSheetByName(SHEET_QUESTION);
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
    rg.setValues(rows);
  }
}
function removeQuestionRows(fam, id) {
  const qsh = SpreadsheetApp.getActive().getSheetByName(SHEET_QUESTION);
  const data = qsh.getDataRange().getValues();
  const suffix = '｜' + id;
  const keep = data.filter((r, i) => i === 0 || !(String(r[0]) === fam.code && String(r[1]).slice(-suffix.length) === suffix));
  if (keep.length === data.length) return;
  qsh.clearContents();
  const w = Math.max.apply(null, keep.map(r => r.length));
  qsh.getRange(1, 1, keep.length, w).setValues(keep.map(r => r.concat(Array(w - r.length).fill(''))));
}

/* ===== 題庫書架（公開題庫） ===== */
function publicSheet() { return SpreadsheetApp.getActive().getSheetByName(SHEET_PUBLIC); }

function libList() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('libList');
  if (hit) return JSON.parse(hit);
  const rows = publicSheet().getDataRange().getValues();
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
  const rows = publicSheet().getDataRange().getValues();
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
    publicSheet().appendRow([id, fam.code, title, bank.grade || '', bank.term || '', bank.subject || '', bank.publisher || '',
      bank.unit || '', (bank.questions || []).length, new Date(), fam.name]);
    clearLibCache();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
function updatePublicMeta(fam, bank, title) {
  const sh = publicSheet();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(bank.id) && String(rows[i][1]) === fam.code) {
      sh.getRange(i + 1, 3, 1, 7).setValues([[title, bank.grade || '', bank.term || '', bank.subject || '', bank.publisher || '',
        bank.unit || '', (bank.questions || []).length]]);
      clearLibCache();
      return;
    }
  }
}
function removePublicRow(fam, id) {
  const sh = publicSheet();
  const rows = sh.getDataRange().getValues();
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === id && String(rows[i][1]) === fam.code) sh.deleteRow(i + 1);
  }
  clearLibCache();
}

/* ===== 親友閱讀碼 ===== */
function readerSheet() { return SpreadsheetApp.getActive().getSheetByName(SHEET_READER); }

function findReader(code) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return null;
  const rows = readerSheet().getDataRange().getValues();
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
  sh.getRange(reader.row, 7, 1, 2).setValues([[new Date(), n + 1]]);
}
function readerList(fam) {
  const rows = readerSheet().getDataRange().getValues();
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
    readerSheet().appendRow([code, fam.code, fam.name, new Date(), true, note.slice(0, 40), '', 0]);
    return { ok: true, reader: code };
  } finally {
    lock.releaseLock();
  }
}
function findReaderAny(code) {
  return readerSheet().getDataRange().getValues().some((r, i) => i > 0 && String(r[0]) === code);
}
function readerDisable(fam, code) {
  const sh = readerSheet();
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === code && String(rows[i][1]) === fam.code) {
      sh.getRange(i + 1, 5).setValue(false);
      return { ok: true };
    }
  }
  return { ok: false, code: 'not_found', message: '找不到這組閱讀碼' };
}

/* ===== 獎勵次數 ===== */
function familySheet() { return SpreadsheetApp.getActive().getSheetByName(SHEET_FAMILY); }
function currentBonus(fam) { return Number(familySheet().getRange(fam.row, 7).getValue()) || 0; }
function setBonus(fam, n) { familySheet().getRange(fam.row, 7).setValue(Math.max(0, n)); }

/* ===== 判讀結果合併 ===== */
function qSig(q) { return JSON.stringify([q.t, q.q, q.o || [], q.a, q.why || '']); }
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
function reportSheet() { return SpreadsheetApp.getActive().getSheetByName(SHEET_REPORT); }
const OPEN_STATUS = { '待複審': 1, '成立': 1 };

function flagsFor(ids) {
  const want = {};
  ids.forEach(id => { want[id] = {}; });
  const sh = reportSheet();
  if (sh) {
    const rows = sh.getDataRange().getValues();
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
    const rows = sh.getDataRange().getValues();
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
    sh.appendRow(['R' + Date.now().toString(36) + Math.floor(Math.random() * 1e4), new Date(), bankId, qId, snap, who.code, who.role,
      reason, String(req.note || '').slice(0, 200), '待複審', '', '', '']);
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
  const rows = sh.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) === bankId && set[String(rows[i][3])] && OPEN_STATUS[String(rows[i][9])]) {
      sh.getRange(i + 1, 10).setValue(String(rows[i][9]) === '成立' ? '已修正' : '題目已修改');
    }
  }
}

// 在所有家庭的題庫中找題目
function findQuestion(bankId, qId) {
  const rows = bankSheet().getDataRange().getValues();
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

/* ===== 定期掃題（由排程工作呼叫） ===== */
function allBanks() {
  const rows = bankSheet().getDataRange().getValues();
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
    qId: String(q.id), concept: conText(x.bank, q.c), t: q.t, q: q.q, o: q.o || null, a: q.a, why: q.why || '', detail: q.detail || '' });
  const reports = [];
  const rows = reportSheet().getDataRange().getValues();
  for (let i = 1; i < rows.length && reports.length < limit; i++) {
    const r = rows[i];
    if (String(r[9]) !== '待複審') continue;
    const x = byId[String(r[2])];
    const q = x && (x.bank.questions || []).filter(k => String(k.id) === String(r[3]))[0];
    reports.push({ reportId: String(r[0]), bankId: String(r[2]), qId: String(r[3]), reason: String(r[7]), note: String(r[8]),
      snapshot: String(r[4]), current: q ? pack(x, q) : null });
  }
  const questions = [];
  banks.forEach(x => (x.bank.questions || []).forEach(q => {
    if (!q.check && questions.length < Math.max(0, limit - reports.length)) questions.push(pack(x, q));
  }));
  const total = banks.reduce((n, x) => n + (x.bank.questions || []).filter(q => !q.check).length, 0);
  // 已判讀通過、但還沒有詳細解題的題目（判讀完再補，避免替有問題的題目寫詳解）
  const needDetail = [];
  banks.forEach(x => (x.bank.questions || []).forEach(q => {
    if (!q.detail && q.check && q.check.s === 'pass' && needDetail.length < limit) needDetail.push(pack(x, q));
  }));
  const detailTotal = banks.reduce((n, x) => n + (x.bank.questions || []).filter(q => !q.detail && q.check && q.check.s === 'pass').length, 0);
  return { ok: true, reports, questions, unjudgedTotal: total, needDetail, needDetailTotal: detailTotal };
}

// 寫回判讀結果。items：題目判讀；reports：回報是否成立
function adminVerdict(req) {
  const items = [].concat(req.items || []), reps = [].concat(req.reports || []), details = [].concat(req.details || []);
  const model = String(req.model || '').slice(0, 40);
  const now = Date.now();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const result = { ok: true, judged: 0, reportsDone: 0, rewards: 0, detailsAdded: 0 };
  try {
    const banks = allBanks();
    const byId = {};
    banks.forEach(x => { byId[String(x.bank.id)] = x; });
    const dirty = {};
    const setCheck = (bankId, qId, s, note, fix) => {
      const x = byId[bankId];
      const q = x && (x.bank.questions || []).filter(k => String(k.id) === qId)[0];
      if (!q) return false;
      q.check = { s: s === 'issue' ? 'issue' : 'pass', note: String(note || '').slice(0, 300), at: now, by: model };
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
    const rows = sh.getDataRange().getValues();
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
        sh.getRange(i + 1, 10, 1, 4).setValues([[ok ? '成立' : '不成立', String(v.note || '').slice(0, 300), new Date(), reward]]);
        result.reportsDone++;
      }
    });
    Object.keys(dirty).forEach(id => { const x = byId[id]; putBank({ code: x.owner }, x.bank, true); });
  } finally {
    lock.releaseLock();
  }
  return result;
}
