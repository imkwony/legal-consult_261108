export function newConsultation() {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', createdAt: now, updatedAt: now, messages: [] };
}

export function makeTitle(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// 저장된 상담 → AI에게 보낼 대화. 첨부 원문은 질문 앞에 붙이고, 검증 결과는 보내지 않는다.
export function toLlmMessages(c) {
  return c.messages.map((m) => {
    if (m.role === 'user' && m.attachments?.length) {
      const att = m.attachments.map((a) => `[첨부: ${a.name}]\n${a.text}`).join('\n\n');
      return { role: 'user', content: `${att}\n\n${m.content}` };
    }
    return { role: m.role, content: m.content };
  });
}
