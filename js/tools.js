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
