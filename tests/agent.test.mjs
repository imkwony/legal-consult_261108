import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, statusLabel } from '../js/agent.js';
import { toOpenAITools, truncate } from '../js/tools.js';
import { newConsultation, makeTitle, toLlmMessages } from '../js/consultation.js';
import { SYSTEM_PROMPT } from '../js/prompt.js';

const settings = { scriptUrl: 'https://gas/exec', bazeKey: '', model: 'm' };
const mcpTools = [{ name: 'search_decisions', description: '판례 검색', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }];

function consultationWith(text) {
  const c = newConsultation();
  c.messages.push({ role: 'user', content: text });
  return c;
}
const toolCall = (name, args, id = 'call1') => ({
  message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
  finishReason: 'tool_calls',
});
const final = (content) => ({ message: { role: 'assistant', content }, finishReason: 'stop' });

function fakes({ chatReplies, mcp }) {
  const chats = [];
  const gas = [];
  return {
    chats, gas,
    deps: {
      chat: async (args) => { chats.push(structuredClone(args)); return chatReplies(chats.length); },
      gasCall: async (url, action, payload) => {
        gas.push({ action, payload });
        if (action === 'mcp_tools') return mcpTools;
        return mcp(payload);
      },
    },
  };
}

test('runs tool call then returns final answer with verification', async () => {
  const status = [];
  const f = fakes({
    chatReplies: (n) => (n === 1 ? toolCall('search_decisions', { domain: 'precedent', query: '보증금' }) : final('결론: 돌려받을 수 있어요. (대법원 2013다61381)')),
    mcp: (p) => ({ text: p.name === 'legal_analysis' ? '✓ 2013다61381 확인됨' : '판례 목록', isError: false }),
  });
  const r = await answer({ consultation: consultationWith('보증금 소송'), settings, onStatus: (s) => status.push(s) }, f.deps);
  assert.equal(r.content, '결론: 돌려받을 수 있어요. (대법원 2013다61381)');
  assert.equal(r.verification, '✓ 2013다61381 확인됨');
  assert.deepEqual(status, ['준비 중…', '질문을 살펴보는 중…', '판례 검색 중…', '자료를 정리하는 중…', '인용 확인 중…']);
  assert.equal(f.chats[0].messages[0].role, 'system');
  assert.equal(f.chats[0].tools[0].function.name, 'search_decisions');
  const toolMsg = f.chats[1].messages.at(-1);
  assert.deepEqual(toolMsg, { role: 'tool', tool_call_id: 'call1', content: '판례 목록' });
  const verify = f.gas.find((g) => g.payload?.name === 'legal_analysis');
  assert.deepEqual(verify.payload.arguments, { mode: 'verify_citations', text: r.content });
});

test('stops after 8 tool rounds and forces final answer', async () => {
  const f = fakes({
    chatReplies: (n) => (n <= 8 ? toolCall('search_decisions', { query: 'x' }, 'c' + n) : final('최종')),
    mcp: () => ({ text: 'r', isError: false }),
  });
  const r = await answer({ consultation: consultationWith('q'), settings }, f.deps);
  assert.equal(f.chats.length, 9);
  assert.equal(f.chats[8].toolChoice, 'none');
  assert.equal(f.chats[7].toolChoice, undefined);
  assert.equal(r.content, '최종');
});

test('mcp failure becomes tool message, answer still returned', async () => {
  const f = fakes({
    chatReplies: (n) => (n === 1 ? toolCall('search_decisions', { query: 'x' }) : final('답')),
    mcp: (p) => { if (p.name === 'search_decisions') throw new Error('법률 서버 오류 503'); return { text: 'v', isError: false }; },
  });
  const r = await answer({ consultation: consultationWith('q'), settings }, f.deps);
  assert.equal(r.content, '답');
  assert.match(f.chats[1].messages.at(-1).content, /^자료 조회 실패: 법률 서버 오류 503/);
});

test('invalid tool arguments JSON does not crash', async () => {
  const f = fakes({
    chatReplies: (n) => (n === 1
      ? { message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'search_decisions', arguments: '{bad' } }] }, finishReason: 'tool_calls' }
      : final('답')),
    mcp: () => ({ text: 'ok', isError: false }),
  });
  const r = await answer({ consultation: consultationWith('q'), settings }, f.deps);
  assert.equal(r.content, '답');
  assert.deepEqual(f.gas.find((g) => g.payload?.name === 'search_decisions').payload.arguments, {});
});

test('verification failure yields fallback text', async () => {
  const f = fakes({
    chatReplies: () => final('답'),
    mcp: () => { throw new Error('down'); },
  });
  const r = await answer({ consultation: consultationWith('q'), settings }, f.deps);
  assert.equal(r.verification, '인용 확인을 하지 못했습니다.');
});

test('truncates large tool results', () => {
  const t = truncate('가'.repeat(50000));
  assert.ok(t.length <= 12020);
  assert.ok(t.includes('(이하 생략)'));
  assert.equal(truncate('짧음'), '짧음');
});

test('toOpenAITools converts MCP tool schema', () => {
  assert.deepEqual(toOpenAITools(mcpTools), [{
    type: 'function',
    function: { name: 'search_decisions', description: '판례 검색', parameters: mcpTools[0].inputSchema },
  }]);
});

test('statusLabel maps tools to Korean progress text', () => {
  assert.equal(statusLabel('search_decisions', {}), '판례 검색 중…');
  assert.equal(statusLabel('get_decision_text', {}), '판결문 읽는 중…');
  assert.equal(statusLabel('search_law', {}), '법령 검색 중…');
  assert.equal(statusLabel('get_law_text', {}), '법 조문 확인 중…');
  assert.equal(statusLabel('get_law_text', { jo: '제750조' }), '제750조 확인 중…');
  assert.equal(statusLabel('legal_research', {}), '종합 리서치 중…');
  assert.equal(statusLabel('discover_tools', {}), '자료 확인 중…');
});

test('toLlmMessages prepends attachments and drops verification', () => {
  const c = newConsultation();
  c.messages.push({ role: 'user', content: '이거 어떻게 해요?', attachments: [{ name: '소장.pdf', text: '원고 홍길동' }] });
  c.messages.push({ role: 'assistant', content: '답', verification: 'v' });
  assert.deepEqual(toLlmMessages(c), [
    { role: 'user', content: '[첨부: 소장.pdf]\n원고 홍길동\n\n이거 어떻게 해요?' },
    { role: 'assistant', content: '답' },
  ]);
});

test('makeTitle collapses whitespace and cuts at 40 chars', () => {
  assert.equal(makeTitle('  전세   보증금\n문제  '), '전세 보증금 문제');
  assert.equal(makeTitle('가'.repeat(60)).length, 40);
});

test('newConsultation has id, timestamps and empty messages', () => {
  const c = newConsultation();
  assert.ok(c.id && c.createdAt && c.updatedAt);
  assert.deepEqual(c.messages, []);
});

test('system prompt carries the core rules', () => {
  for (const s of ['변호사와 확인하세요', '사건번호', '확인하지 못했습니다', '답변서', 'search_law']) assert.ok(SYSTEM_PROMPT.includes(s), s);
});

test('featureSummary gives Korean title and short description', async () => {
  const { featureSummary } = await import('../js/tools.js');
  const s = featureSummary({ name: 'search_law', title: '법령 검색', description: 'Korean-law-mcp — [법령검색] 법령명·조례명 키워드검색 → lawId, mst 획득. 지자체 조례도 검색 — 0건 시 폴백' });
  assert.equal(s.title, '법령 검색');
  assert.equal(s.name, 'search_law');
  assert.equal(s.summary, '법령명·조례명 키워드검색 → lawId, mst 획득.');
  const long = featureSummary({ name: 'x', description: '가'.repeat(300) });
  assert.equal(long.title, 'x');
  assert.ok(long.summary.length <= 141);
});
