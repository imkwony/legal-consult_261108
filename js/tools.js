export const MAX_TOOL_TEXT = 12000;

export function toOpenAITools(mcpTools) {
  return mcpTools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description || '', parameters: t.inputSchema || { type: 'object', properties: {} } },
  }));
}

export function truncate(text, max = MAX_TOOL_TEXT) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '\n…(이하 생략)' : s;
}

// 기능 안내용: "Korean-law-mcp — [분류] 설명. 나머지…" → 첫 문장만
export function featureSummary(tool) {
  let d = String(tool.description || '').replace(/^Korean-law-mcp\s*—\s*/, '').replace(/^\[[^\]]*\]\s*/, '');
  const end = d.search(/[.。](\s|$)/);
  if (end !== -1) d = d.slice(0, end + 1);
  if (d.length > 140) d = d.slice(0, 140) + '…';
  return { name: tool.name, title: tool.title || tool.name, summary: d };
}

// 인용 검증 결과에서 실패(✗로 시작하는 줄)만 뽑는다
export function verificationWarnings(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('✗')).map((l) => l.replace(/^✗\s*/, ''));
}
