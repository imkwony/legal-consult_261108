// 실제 키로 BAZE / korean-law-mcp 기능을 확인한다. 키 값은 출력하지 않는다.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BAZE = 'https://api.baze.co/v1/gateway';
const KEY = env.BAZE_API_KEY;
const OC = env.LAW_OC;
if (!KEY || !OC) throw new Error('.env에 BAZE_API_KEY, LAW_OC가 필요합니다');

const auth = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function baze(path, body) {
  const res = await fetch(BAZE + path, body ? { method: 'POST', headers: auth, body: JSON.stringify(body) } : { headers: auth });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

// 1. 모델 목록
const models = await baze('/models/');
const list = (models.json?.data || models.json?.models || models.json || []);
const ids = (Array.isArray(list) ? list : []).map((m) => m.id || m.name || m.model).filter(Boolean);
console.log('## 1. models (status', models.status + ')');
console.log(ids.join('\n') || models.text.slice(0, 500));

// 2. 기본 모델 선택
const pick = ids.includes('claude-sonnet-5') ? 'claude-sonnet-5'
  : ids.filter((i) => i.includes('sonnet')).sort().pop()
  || ids.filter((i) => i.includes('gemini') && i.includes('flash')).sort().pop();
console.log('## 2. default model:', pick);

// 3. tool calling
const tc = await baze('/chat/completions/', {
  model: pick,
  messages: [{ role: 'user', content: '서울 날씨 알려줘' }],
  tools: [{ type: 'function', function: { name: 'get_weather', description: '도시 날씨 조회', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
});
const calls = tc.json?.choices?.[0]?.message?.tool_calls;
console.log('## 3. tool calling:', calls ? 'SUPPORTED ' + JSON.stringify(calls[0].function) : 'NOT SUPPORTED (status ' + tc.status + ') ' + tc.text.slice(0, 300));

// 4. 이미지 입력
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img = await baze('/chat/completions/', {
  model: pick,
  messages: [{ role: 'user', content: [{ type: 'text', text: '이 이미지의 색을 한 단어로.' }, { type: 'image_url', image_url: { url: png } }] }],
});
console.log('## 4. image input:', img.json?.choices?.[0]?.message?.content ? 'SUPPORTED: ' + img.json.choices[0].message.content.slice(0, 60) : 'NOT SUPPORTED (status ' + img.status + ') ' + img.text.slice(0, 300));

// 5~6. MCP
const MCP = `https://mcp.gomdori.app/law?oc=${encodeURIComponent(OC)}`;
let rid = 0;
async function mcp(method, params) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }),
  });
  let t = await res.text();
  if (!t.trim().startsWith('{')) t = t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('');
  return JSON.parse(t);
}
await mcp('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'verify', version: '0.1' } });
const tools = await mcp('tools/list', {});
console.log('## 5. MCP tools:', tools.result.tools.map((t) => t.name).join(', '));
const dec = await mcp('tools/call', { name: 'search_decisions', arguments: { domain: 'precedent', query: '대여금', display: 3 } });
const txt = (dec.result?.content || []).map((c) => c.text).join('\n');
console.log('## 6. search_decisions with OC:', dec.result?.isError ? 'ERROR' : 'OK', '\n' + txt.slice(0, 600));
