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
  const fam = findFamily(req.code);
  if (!fam) return out({ ok: false, code: 'bad_code', message: '邀請碼不正確或已停用' });
  try {
    switch (req.action) {
      case 'ping':
        return out({ ok: true, family: fam.name, remaining: remaining(fam) });
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
  const fam = ensure(SHEET_FAMILY, ['邀請碼', '家庭名稱', '每日 AI 上限', '啟用', '備註']);
  ensure(SHEET_BANK, ['邀請碼', '題庫ID', '題庫名稱', '更新時間', '題數', '題目雜湊', 'JSON 分段數', 'JSON1']);
  ensure(SHEET_QUESTION, ['邀請碼', '題庫名稱', '觀念', '題型', '難度', '題目', '選項', '答案', '解說', '來源']);
  ensure(SHEET_USAGE, ['時間', '邀請碼', '家庭', '模型', '照片數', '輸入 token', '輸出 token', '估計美元']);
  if (fam.getLastRow() === 1) fam.appendRow(['TEST-0000', '測試家庭', 10, true, '測試用，可刪除']);
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
    if (String(r[0]).trim() === code && (r[3] === true || String(r[3]).toUpperCase() === 'TRUE')) {
      return { code, name: String(r[1] || code), limit: Number(r[2]) || 10 };
    }
  }
  return null;
}
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
  let left;
  try {
    left = remaining(fam);
    if (left <= 0) return { ok: false, code: 'daily_limit', message: '今天的 AI 使用次數已用完' };
    bumpCount(fam); // 先扣次數，避免同時送出多次
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
    refundCount(fam); // 失敗不算次數
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
  const json = JSON.stringify(bank);
  if (json.length > MAX_BANK_CHARS) return { ok: false, code: 'too_large', message: '題庫太大' };
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  const qHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(bank.questions || [])));
  const title = String(bank.title || [bank.grade, bank.subject, bank.unit].filter(Boolean).join(' ') || '未命名');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
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
  } finally {
    lock.releaseLock();
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
  const rows = (bank.questions || []).map(q => [
    fam.code, title + '｜' + bank.id, con[q.c] || '', q.t === 'tf' ? '是非' : '選擇', LV[q.lv] || '',
    q.q, (q.o || []).join(' / '), q.t === 'tf' ? (q.a === 'O' ? '對' : '錯') : q.a, q.why || '', q.src || '',
  ]);
  if (rows.length) qsh.getRange(qsh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}
function removeQuestionRows(fam, id) {
  const qsh = SpreadsheetApp.getActive().getSheetByName(SHEET_QUESTION);
  const data = qsh.getDataRange().getValues();
  const suffix = '｜' + id;
  const keep = data.filter((r, i) => i === 0 || !(String(r[0]) === fam.code && String(r[1]).slice(-suffix.length) === suffix));
  if (keep.length === data.length) return;
  qsh.clearContents();
  qsh.getRange(1, 1, keep.length, keep[0].length).setValues(keep);
}
