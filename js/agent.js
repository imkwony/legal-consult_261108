// 상담 엔진: AI가 법률 MCP 도구로 자료를 찾게 한 뒤 답하고, 답변 속 인용을 검증한다.
import { chat as defaultChat } from './llm.js';
import { gasCall as defaultGasCall } from './gas.js';
import { toOpenAITools, truncate } from './tools.js';
import { toLlmMessages } from './consultation.js';
import { SYSTEM_PROMPT } from './prompt.js';

export const MAX_TOOL_ROUNDS = 8;
const toolsCache = new WeakMap(); // gasCall 함수별 도구 목록 (세션당 1회 조회)

export function statusLabel(name, args = {}) {
  switch (name) {
    case 'search_decisions': return '판례 검색 중…';
    case 'get_decision_text': return '판결문 읽는 중…';
    case 'search_law': return '법령 검색 중…';
    case 'get_law_text': return args.jo ? `${args.jo} 확인 중…` : '법 조문 확인 중…';
    case 'legal_research': return '종합 리서치 중…';
    default: return '자료 확인 중…';
  }
}

function getTools(gasCall, scriptUrl) {
  if (!toolsCache.has(gasCall)) {
    const p = gasCall(scriptUrl, 'mcp_tools').then(toOpenAITools);
    p.catch(() => toolsCache.delete(gasCall));
    toolsCache.set(gasCall, p);
  }
  return toolsCache.get(gasCall);
}

function parseArgs(s) {
  try { return JSON.parse(s || '{}') || {}; } catch { return {}; }
}

export async function answer({ consultation, settings, onStatus = () => {} }, deps = {}) {
  const chat = deps.chat || defaultChat;
  const gasCall = deps.gasCall || defaultGasCall;
  const mcp = (name, args) => gasCall(settings.scriptUrl, 'mcp_call', { name, arguments: args });

  onStatus('준비 중…');
  const tools = await getTools(gasCall, settings.scriptUrl);
  const today = new Date().toISOString().slice(0, 10);
  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n오늘 날짜: ${today}` },
    ...toLlmMessages(consultation),
  ];

  let content = '';
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const toolChoice = round === MAX_TOOL_ROUNDS ? 'none' : undefined;
    onStatus(round === 0 ? '질문을 살펴보는 중…' : '자료를 정리하는 중…');
    const { message } = await chat({ settings, messages, tools, toolChoice });
    const calls = message.tool_calls || [];
    if (!calls.length || toolChoice) {
      content = message.content || '';
      break;
    }
    messages.push(message);
    // 한 번에 요청된 도구들은 동시에 조회한다 (결과 순서는 요청 순서 유지)
    const results = await Promise.all(calls.map(async (call) => {
      const args = parseArgs(call.function.arguments);
      onStatus(statusLabel(call.function.name, args));
      try {
        return truncate((await mcp(call.function.name, args)).text);
      } catch (err) {
        return `자료 조회 실패: ${err.message}`;
      }
    }));
    calls.forEach((call, i) => messages.push({ role: 'tool', tool_call_id: call.id, content: results[i] }));
  }
  if (!content) content = '죄송합니다. 답변을 만들지 못했어요. 다시 한 번 질문해 주세요.';

  onStatus('인용 확인 중…');
  let verification;
  try {
    verification = (await mcp('legal_analysis', { mode: 'verify_citations', text: content })).text || '인용 확인을 하지 못했습니다.';
  } catch {
    verification = '인용 확인을 하지 못했습니다.';
  }
  return { content, verification };
}
