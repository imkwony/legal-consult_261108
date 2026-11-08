// BAZE Chat Completions 호출. 내 키를 쓰면 직접, '기본키 사용'이면 Apps Script가 소유자 키로 대신 호출.
import { gasCall as defaultGasCall } from './gas.js';

const BAZE_CHAT_URL = 'https://api.baze.co/v1/gateway/chat/completions/';

export async function chat({ settings, messages, tools, toolChoice }, deps = {}) {
  const fetchFn = deps.fetchFn || fetch;
  const gasCall = deps.gasCall || defaultGasCall;
  const body = { model: settings.model, messages };
  if (tools?.length) body.tools = tools;
  if (toolChoice) body.tool_choice = toolChoice;

  let json;
  if (settings.useDefaultKey === false && settings.bazeKey) {
    const res = await fetchFn(BAZE_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.bazeKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`AI 서버 오류 ${res.status}: ${text.slice(0, 200)}`);
    json = JSON.parse(text);
  } else {
    json = await gasCall(settings.scriptUrl, 'chat', { body });
  }
  const choice = json.choices?.[0];
  if (!choice) throw new Error('AI 응답이 비어 있어요.');
  return { message: choice.message, finishReason: choice.finish_reason };
}
