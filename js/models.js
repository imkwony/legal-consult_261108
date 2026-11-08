// AI 모델 목록: 처음엔 추천 7개, "더 많은 모델 불러오기"로 BAZE 전체 대화 모델을 붙인다.
const LABELS = {
  'claude-sonnet-5-5': 'Claude Sonnet 5.5 (기본·추천)',
  'gpt-6.1-sol': 'GPT-6.1 Sol',
  'gpt-6.1-terra': 'GPT-6.1 Terra',
  'claude-haiku-5-5': 'Claude Haiku 5.5 (빠름)',
  'claude-opus-5-5': 'Claude Opus 5.5 (가장 꼼꼼함)',
  'gemini-4-argon': 'Gemini 4 Argon',
  'gemini-3.8-flash': 'Gemini 3.8 Flash (빠름)',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview (매우 느림)',
};

export function modelLabel(id) {
  return LABELS[id] || id;
}

export const INITIAL_MODELS = [
  'claude-sonnet-5-5', 'gpt-6.1-sol', 'gpt-6.1-terra', 'claude-haiku-5-5', 'claude-opus-5-5',
  'gemini-4-argon', 'gemini-3.8-flash',
].map((id) => ({ id, label: modelLabel(id) }));

// BAZE /models/?type=llm 응답 → 대화(chat/completions)가 되는 현재 모델만
export function chatModelsFrom(raw) {
  return (raw || [])
    .filter((m) => m.lifecycle !== 'legacy')
    .filter((m) => (m.endpoints || []).some((e) => e.includes('chat/completions')))
    .filter((m) => !/audio|realtime/i.test(m.id))
    .map((m) => ({ id: m.id, provider: m.owned_by }));
}

export function mergeModels(initial, fetched) {
  const seen = new Set(initial.map((m) => m.id));
  const extra = fetched
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => (a.provider || '').localeCompare(b.provider || '') || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: modelLabel(m.id), provider: m.provider }));
  return [...initial, ...extra];
}
