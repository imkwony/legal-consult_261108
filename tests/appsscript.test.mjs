import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');

// 실제 시트처럼 문자열 앞의 ' 는 '텍스트로 저장' 표시로 쓰이고 값에서는 빠진다
const cellVal = (v) => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);
function makeSheet() {
  const data = [];
  const width = () => Math.max(0, ...data.map((r) => r.length));
  return {
    data,
    getLastRow: () => data.length,
    getLastColumn: () => width(),
    appendRow: (row) => { data.push(row.map(cellVal)); },
    getDataRange: () => ({ getValues: () => data.map((r) => { const c = [...r]; while (c.length < width()) c.push(''); return c; }) }),
    getRange: (r, c, nr = 1, nc = 1) => ({
      setValues: (vals) => {
        for (let i = 0; i < nr; i++) {
          data[r - 1 + i] = data[r - 1 + i] || [];
          for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = cellVal(vals[i][j]);
        }
      },
      clearContent: () => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = '';
      },
    }),
  };
}

function load({ fetchImpl, props = {} } = {}) {
  const opened = [];
  const sheets = {};
  const fetches = [];
  const cache = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet()),
  };
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: (id) => { opened.push(id); return ss; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => ({ BAZE_API_KEY: 'OWNER', LAW_OC: 'OCKEY', ...props })[k] ?? null }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; } }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetches.push({ url, opts });
        return (fetchImpl || defaultFetch)(url, opts, fetches.length);
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  const call = (req) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).content);
  return { call, sheets, fetches, opened };
}

const resp = (code, text) => ({ getResponseCode: () => code, getContentText: () => text });
function defaultFetch(url, opts) {
  const body = JSON.parse(opts.payload);
  if (body.method === 'initialize') return resp(200, '{"jsonrpc":"2.0","id":1,"result":{}}');
  if (body.method === 'notifications/initialized') return resp(202, '');
  return resp(200, JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'ok' }] } }));
}

const consultation = (id, title, text) => ({
  id, title, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T01:00:00Z',
  messages: [{ role: 'user', content: text }],
});

test('save then load round-trips a 100,000-char consultation', () => {
  const { call, sheets } = load();
  const c = consultation('a1', '보증금', '가'.repeat(100000));
  assert.deepEqual(call({ action: 'save', consultation: c }), { ok: true, data: { id: 'a1' } });
  const row = sheets['상담기록'].data[1];
  for (const cell of row.slice(4)) assert.ok(String(cell).length <= 45000);
  assert.ok(row.slice(4).filter(Boolean).length >= 3);
  assert.deepEqual(call({ action: 'load', id: 'a1' }).data, c);
});

test('save twice with same id updates one row', () => {
  const { call, sheets } = load();
  call({ action: 'save', consultation: consultation('a1', '처음', 'x'.repeat(100000)) });
  call({ action: 'save', consultation: consultation('a1', '수정', '짧음') });
  const rows = sheets['상담기록'].data.slice(1).filter((r) => r[0]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], '수정');
  assert.deepEqual(call({ action: 'load', id: 'a1' }).data.messages[0].content, '짧음');
});

test('list returns newest first without messages', () => {
  const { call } = load();
  call({ action: 'save', consultation: { ...consultation('old', '옛날', 'a'), updatedAt: '2026-01-01T00:00:00Z' } });
  call({ action: 'save', consultation: { ...consultation('new', '최근', 'b'), updatedAt: '2026-11-01T00:00:00Z' } });
  const list = call({ action: 'list' }).data;
  assert.deepEqual(list.map((x) => x.id), ['new', 'old']);
  assert.ok(!('messages' in list[0]));
  assert.equal(list[0].title, '최근');
});

test('load unknown id returns ok:false', () => {
  const { call } = load();
  assert.equal(call({ action: 'load', id: 'nope' }).ok, false);
});

test('mcp_call parses SSE body', () => {
  const { call } = load({
    fetchImpl: (url, opts) => {
      const b = JSON.parse(opts.payload);
      if (b.method !== 'tools/call') return resp(200, '{"jsonrpc":"2.0","id":1,"result":{}}');
      return resp(200, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"판례A"}]}}\n\n');
    },
  });
  const r = call({ action: 'mcp_call', name: 'search_decisions', arguments: { domain: 'precedent', query: 'x' } });
  assert.deepEqual(r, { ok: true, data: { text: '판례A', isError: false } });
});

test('mcp requests carry OC key and no Origin header', () => {
  const { call, fetches } = load();
  call({ action: 'mcp_call', name: 'search_law', arguments: { query: '민법' } });
  assert.ok(fetches[0].url.startsWith('https://mcp.gomdori.app/law?oc=OCKEY'));
  assert.equal(fetches[0].opts.headers.Accept, 'application/json, text/event-stream');
  assert.ok(!('Origin' in fetches[0].opts.headers));
});

test('mcp_call falls back to secondary URL on 403', () => {
  const { call, fetches } = load({
    fetchImpl: (url, opts) => (url.includes('gomdori') ? resp(403, '{"error":"forbidden"}') : defaultFetch(url, opts)),
  });
  const r = call({ action: 'mcp_call', name: 'search_law', arguments: { query: '민법' } });
  assert.equal(r.ok, true);
  assert.ok(fetches.some((f) => f.url.startsWith('https://korean-law-mcp.fly.dev/mcp?oc=OCKEY')));
});

test('mcp_tools returns tool list and caches it', () => {
  const tools = [{ name: 'search_law', description: 'd', inputSchema: { type: 'object' } }];
  const { call, fetches } = load({
    fetchImpl: (url, opts) => {
      const b = JSON.parse(opts.payload);
      if (b.method === 'tools/list') return resp(200, JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { tools } }));
      return defaultFetch(url, opts);
    },
  });
  assert.deepEqual(call({ action: 'mcp_tools' }).data, tools);
  const n = fetches.length;
  assert.deepEqual(call({ action: 'mcp_tools' }).data, tools);
  assert.equal(fetches.length, n);
});

test('chat forwards body with owner key', () => {
  const { call, fetches } = load({ fetchImpl: () => resp(200, '{"choices":[{"message":{"content":"hi"}}]}') });
  const r = call({ action: 'chat', body: { model: 'm', messages: [] } });
  assert.equal(r.data.choices[0].message.content, 'hi');
  assert.equal(fetches[0].url, 'https://api.baze.co/v1/gateway/chat/completions/');
  assert.equal(fetches[0].opts.headers.Authorization, 'Bearer OWNER');
  assert.deepEqual(JSON.parse(fetches[0].opts.payload), { model: 'm', messages: [] });
});

test('chat surfaces BAZE error status', () => {
  const { call } = load({ fetchImpl: () => resp(429, '{"detail":"rate limit"}') });
  const r = call({ action: 'chat', body: { model: 'm', messages: [] } });
  assert.equal(r.ok, false);
  assert.match(r.error, /429/);
});

test('unknown action returns ok:false', () => {
  const { call } = load();
  assert.equal(call({ action: 'zzz' }).ok, false);
});

test('opens spreadsheet by SHEET_ID property when set', () => {
  const { call, opened } = load({ props: { SHEET_ID: 'SID123' } });
  call({ action: 'list' });
  assert.deepEqual(opened, ['SID123']);
});
