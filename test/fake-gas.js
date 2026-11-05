'use strict';

// Importing this helper does not load Code.gs, create an environment, or load crypto.
const vm = require('node:vm');

function createGasEnv(options = {}) {
  let now = options.now === undefined ? Date.UTC(2026, 10, 5) : Number(options.now);
  const clock = {
    set(ms) { now = Number(ms); return now; },
    advance(ms) { now += Number(ms); return now; },
    now() { return now; },
  };
  function ClockDate(...args) {
    if (!new.target) return new Date(now).toString();
    return new Date(...(args.length ? args : [now]));
  }
  ClockDate.prototype = Date.prototype;
  Object.setPrototypeOf(ClockDate, Date);
  ClockDate.now = () => now;

  const sheets = new Map(), logs = [], formulaCells = [];
  let hook, insideHook = false, currentRequest = null, lockOwner = null;
  const pending = [];
  const lockMode = options.lockMode || 'real';
  if (!['real', 'none', 'busy'].includes(lockMode)) throw new Error('Invalid lockMode');
  function before(sheet, op, row, col) {
    if (!hook || insideHook) return;
    insideHook = true;
    try { hook({ sheet: sheet.name, op, row, col }); }
    finally { insideHook = false; }
  }
  function clone(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (value && typeof value === 'object') return { ...value };
    return value;
  }
  function convert(value, text, sheet, row, col) {
    if (typeof value !== 'string') return clone(value == null ? '' : value);
    if (value.startsWith("'")) return value.slice(1);
    if (text) return value;
    if (value.startsWith('=')) {
      formulaCells.push({ sheet: sheet.name, row, col, formula: value });
      return { formula: value };
    }
    if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value)) return new Date(value.replaceAll('/', '-') + 'T00:00:00+08:00');
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return Number(value);
    if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
    return value;
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.formats = new Map(); this.frozenRows = 0; }
    getLastRow() {
      for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i]?.some(v => v !== '' && v != null)) return i + 1;
      return 0;
    }
    getLastColumn() {
      return this.data.reduce((max, row) => Math.max(max, row.reduce((n, v, i) => v !== '' && v != null ? i + 1 : n, 0)), 0);
    }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
    getRange(row, col, rows = 1, cols = 1) {
      if (![row, col, rows, cols].every(n => Number.isInteger(n) && n > 0)) throw new Error('Invalid range');
      const sheet = this;
      const visit = fn => {
        for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) fn(r, c);
      };
      const range = {
        getRow: () => row,
        getValues() {
          return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => {
            before(sheet, 'read', row + i, col + j);
            return clone(sheet.data[row + i - 1]?.[col + j - 1] ?? '');
          }));
        },
        getValue() {
          before(sheet, 'read', row, col);
          return clone(sheet.data[row - 1]?.[col - 1] ?? '');
        },
        setValues(values) {
          if (values.length !== rows || values.some(r => !Array.isArray(r) || r.length !== cols)) throw new Error('Range dimensions do not match');
          visit((r, c) => {
            before(sheet, 'write', r, c);
            sheet.data[r - 1] ||= [];
            sheet.data[r - 1][c - 1] = convert(values[r - row][c - col], sheet.formats.get(`${r},${c}`) === '@', sheet, r, c);
          });
          return range;
        },
        setValue(value) { return range.setValues(Array.from({ length: rows }, () => Array(cols).fill(value))); },
        clearContent() {
          visit((r, c) => {
            before(sheet, 'clear', r, c);
            if (sheet.data[r - 1]) sheet.data[r - 1][c - 1] = '';
          });
          return range;
        },
        setFontWeight() { return range; },
        setNumberFormat(format) { visit((r, c) => sheet.formats.set(`${r},${c}`, format)); return range; },
      };
      return range;
    }
    appendRow(values) { this.getRange(this.getLastRow() + 1, 1, 1, values.length).setValues([values]); return this; }
    deleteRow(row) {
      if (!Number.isInteger(row) || row < 1) throw new Error('Invalid row');
      this.getRange(row, 1, 1, Math.max(1, this.getLastColumn())).clearContent();
      this.data.splice(row - 1, 1);
      const formats = new Map();
      for (const [key, format] of this.formats) {
        const [r, c] = key.split(',').map(Number);
        if (r !== row) formats.set(`${r > row ? r - 1 : r},${c}`, format);
      }
      this.formats = formats;
      return this;
    }
    setFrozenRows(rows) { this.frozenRows = rows; return this; }
    clearContents() { this.getDataRange().clearContent(); return this; }
  }
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) {
      if (sheets.has(name)) throw new Error('Duplicate sheet');
      const sheet = new Sheet(name); sheets.set(name, sheet); return sheet;
    },
  };
  const propertyData = new Map();
  const props = {
    getProperty: key => propertyData.get(String(key)) ?? null,
    setProperty(key, value) { propertyData.set(String(key), String(value)); return props; },
    getProperties: () => Object.fromEntries(propertyData),
    deleteProperty(key) { propertyData.delete(String(key)); return props; },
    setProperties(values, deleteAll = false) {
      if (deleteAll) propertyData.clear();
      for (const [key, value] of Object.entries(values)) props.setProperty(key, value);
      return props;
    },
    deleteAllProperties() { propertyData.clear(); return props; },
  };
  const cacheData = new Map();
  const cache = {
    get(key) {
      const entry = cacheData.get(String(key));
      if (!entry) return null;
      if (entry.until <= now) { cacheData.delete(String(key)); return null; }
      return entry.value;
    },
    put(key, value, seconds = 600) { cacheData.set(String(key), { value: String(value), until: now + seconds * 1000 }); },
    remove(key) { cacheData.delete(String(key)); },
  };
  // options.hash: { digest(algorithm, value), hmac(value, key) }, returning byte iterables.
  // Only the default adapter needs Node crypto; injected adapters do not load it.
  let defaultHash;
  function hash() {
    if (options.hash) return options.hash;
    if (!defaultHash) {
      const crypto = require('node:crypto');
      const bytes = value => typeof value === 'string' ? value : Buffer.from(value.map(n => n & 255));
      defaultHash = {
        digest: (algorithm, value) => crypto.createHash(algorithm).update(bytes(value)).digest(),
        hmac: (value, key) => crypto.createHmac('sha256', bytes(key)).update(bytes(value)).digest(),
      };
    }
    return defaultHash;
  }
  const signed = values => Array.from(values, n => (n & 255) > 127 ? (n & 255) - 256 : n & 255);
  const Utilities = {
    DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
    getUuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : (n & 3) | 8).toString(16);
    }),
    formatDate(date, timezone, format) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(date).map(p => [p.type, p.value]));
      const tokens = { yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second };
      return format.replace(/yyyy|MM|dd|HH|mm|ss/g, token => tokens[token]);
    },
    base64Encode: value => (typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(Array.from(value, n => n & 255))).toString('base64'),
    computeDigest: (algorithm, value) => signed(hash().digest(algorithm, value)),
    computeHmacSha256Signature: (value, key) => signed(hash().hmac(value, key)),
  };
  const consoleProxy = new Proxy({}, { get: (_, level) => (...args) => logs.push(`[${String(level)}] ` + args.map(a => a && typeof a.stack === 'string' ? a.stack : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')) });
  const context = vm.createContext({
    Date: ClockDate, console: consoleProxy, Utilities,
    SpreadsheetApp: { getActive: () => spreadsheet, flush() {} },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(content) { return { getContent: () => content, setMimeType() { return this; } }; },
    },
    LockService: {
      getScriptLock() {
        const owner = currentRequest;
        const lock = {
          waitLock() {
            if (lockMode === 'busy' || (lockMode === 'real' && lockOwner !== null && lockOwner !== owner)) throw new Error('Lock busy');
            if (lockMode === 'real') lockOwner = owner;
          },
          tryLock(ms) { try { lock.waitLock(ms); return true; } catch { return false; } },
          releaseLock() { if (lockOwner === owner) lockOwner = null; },
        };
        return lock;
      },
    },
  });
  const source = options.source === undefined ? require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'Code.gs'), 'utf8') : options.source;
  vm.runInContext(source, context, { filename: 'Code.gs' });
  function run(fnName, ...args) {
    if (!/^[A-Za-z_$][\w$]*$/.test(fnName)) throw new Error('Invalid function name');
    const fn = vm.runInContext(fnName, context);
    const previous = currentRequest;
    currentRequest = Symbol(fnName);
    try { return fn(...args); }
    finally {
      if (lockOwner === currentRequest) lockOwner = null;
      currentRequest = previous;
    }
  }
  function doPost(obj) {
    const contents = JSON.stringify(obj);
    if (lockMode === 'real' && lockOwner !== null) {
      pending.push(contents);
      return { deferred: true };
    }
    return JSON.parse(run('doPost', { postData: { contents } }).getContent());
  }
  return {
    doPost, run, clock, sheets, props, cache, logs, formulaCells,
    onSheetOp(cb) { hook = cb; },
    runDeferred() {
      if (currentRequest !== null || lockOwner !== null) throw new Error('Requests still active');
      const results = [];
      while (pending.length) results.push(doPost(JSON.parse(pending.shift())));
      return results;
    },
  };
}

module.exports = { createGasEnv };
