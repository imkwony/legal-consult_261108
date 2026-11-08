import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSettings, saveSettings, isConfigured, DEFAULT_MODEL, SCRIPT_URL } from '../js/settings.js';
import { gasCall } from '../js/gas.js';
import { chat } from '../js/llm.js';

const memStorage = () => { const m = {}; return { getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); } }; };
const fakeFetch = (text, calls = []) => {
  const f = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, text: async () => text }; };
  f.calls = calls;
  return f;
};

test('DEFAULT_MODEL is the verified model', () => {
  assert.equal(DEFAULT_MODEL, 'claude-sonnet-5-5');
});

test('script URL is fixed in code', () => {
  assert.ok(SCRIPT_URL.startsWith("https://script.google.com/macros/s/") && SCRIPT_URL.endsWith("/exec"));
});

test('loadSettings returns defaults when storage throws', () => {
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(loadSettings(bad), { scriptUrl: SCRIPT_URL, useDefaultKey: true, bazeKey: '', model: DEFAULT_MODEL });
  assert.doesNotThrow(() => saveSettings({ bazeKey: 'x' }, bad));
});

test('saved scriptUrl is ignored; fixed URL always wins', () => {
  const s = memStorage();
  s.setItem('legalConsult.settings', JSON.stringify({ scriptUrl: 'https://docs.google.com/spreadsheets/d/X/edit' }));
  assert.equal(loadSettings(s).scriptUrl, SCRIPT_URL);
});

test('saveSettings then loadSettings round-trips and trims', () => {
  const s = memStorage();
  saveSettings({ useDefaultKey: false, bazeKey: ' k ', model: ' gpt-6.1-sol ' }, s);
  assert.deepEqual(loadSettings(s), { scriptUrl: SCRIPT_URL, useDefaultKey: false, bazeKey: 'k', model: 'gpt-6.1-sol' });
});

test('isConfigured needs own key unless default key is used', () => {
  assert.equal(isConfigured({ useDefaultKey: true, bazeKey: '' }), true);
  assert.equal(isConfigured({ useDefaultKey: false, bazeKey: '' }), false);
  assert.equal(isConfigured({ useDefaultKey: false, bazeKey: 'k' }), true);
});

test('gasCall sends text/plain POST and returns data', async () => {
  const f = fakeFetch('{"ok":true,"data":[1,2]}');
  const data = await gasCall('https://gas/exec', 'list', {}, f);
  assert.deepEqual(data, [1, 2]);
  assert.equal(f.calls[0].opts.method, 'POST');
  assert.equal(f.calls[0].opts.headers['Content-Type'], 'text/plain;charset=utf-8');
  assert.deepEqual(JSON.parse(f.calls[0].opts.body), { action: 'list' });
});

test('gasCall throws Korean hint when response is HTML', async () => {
  const f = fakeFetch('<!DOCTYPE html><html>Sign in</html>');
  await assert.rejects(gasCall('https://gas/exec', 'list', {}, f), /설정의 주소를 확인해 주세요/);
});

test('gasCall throws server error message on ok:false', async () => {
  const f = fakeFetch('{"ok":false,"error":"저장된 상담을 찾을 수 없습니다"}');
  await assert.rejects(gasCall('https://gas/exec', 'load', { id: 'x' }, f), /저장된 상담을 찾을 수 없습니다/);
});

const reply = { choices: [{ message: { role: 'assistant', content: '답' }, finish_reason: 'stop' }] };

test('chat uses direct BAZE when bazeKey set', async () => {
  const f = fakeFetch(JSON.stringify(reply));
  let gasUsed = false;
  const r = await chat(
    { settings: { scriptUrl: 'u', useDefaultKey: false, bazeKey: 'MYKEY', model: 'm1' }, messages: [{ role: 'user', content: 'q' }] },
    { fetchFn: f, gasCall: async () => { gasUsed = true; } },
  );
  assert.deepEqual(r, { message: { role: 'assistant', content: '답' }, finishReason: 'stop' });
  assert.equal(f.calls[0].url, 'https://api.baze.co/v1/gateway/chat/completions/');
  assert.equal(f.calls[0].opts.headers.Authorization, 'Bearer MYKEY');
  assert.equal(JSON.parse(f.calls[0].opts.body).model, 'm1');
  assert.equal(gasUsed, false);
});

test('chat proxies via gas when default key is used', async () => {
  const seen = [];
  const r = await chat(
    { settings: { scriptUrl: 'https://gas/exec', useDefaultKey: true, bazeKey: 'IGNORED', model: 'm2' }, messages: [], tools: [{ type: 'function' }] },
    { fetchFn: fakeFetch('{}'), gasCall: async (...a) => { seen.push(a); return reply; } },
  );
  assert.equal(r.message.content, '답');
  assert.equal(seen[0][0], 'https://gas/exec');
  assert.equal(seen[0][1], 'chat');
  assert.equal(seen[0][2].body.model, 'm2');
  assert.deepEqual(seen[0][2].body.tools, [{ type: 'function' }]);
});

test('chat passes tool_choice none when toolChoice is none', async () => {
  const seen = [];
  await chat(
    { settings: { scriptUrl: 'u', bazeKey: '', model: 'm' }, messages: [], tools: [{ type: 'function' }], toolChoice: 'none' },
    { gasCall: async (...a) => { seen.push(a); return reply; } },
  );
  assert.equal(seen[0][2].body.tool_choice, 'none');
});

test('chat throws readable error on BAZE http error', async () => {
  const f = async () => ({ ok: false, status: 401, text: async () => '{"detail":"invalid key"}' });
  await assert.rejects(
    chat({ settings: { useDefaultKey: false, bazeKey: 'bad', model: 'm' }, messages: [] }, { fetchFn: f }),
    /401/,
  );
});

test('gasCall HTML response suggests retry before changing settings', async () => {
  const f = fakeFetch('<html>Exceeded maximum execution time</html>');
  await assert.rejects(gasCall('https://gas/exec', 'chat', {}, f), /잠시 후 다시/);
});
