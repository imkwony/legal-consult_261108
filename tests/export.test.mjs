import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, fileBaseName, toDocxBlob } from '../js/export.js';

const c = {
  id: '1', title: '전세 보증금: 반환/소송?', createdAt: '2026-11-08T03:00:00.000Z', updatedAt: '2026-11-08T04:00:00.000Z',
  messages: [
    { role: 'user', content: '보증금을 못 받았어요', attachments: [{ name: '소장.pdf', text: '비밀 원문 내용' }] },
    { role: 'assistant', content: '**결론**: 받을 수 있어요.\n- 민법 제618조', verification: '✓ 민법 제618조 확인' },
  ],
};

test('toMarkdown includes questions, answers, verification and disclaimer', () => {
  const md = toMarkdown(c);
  assert.ok(md.startsWith('# 법률 상담 기록'));
  assert.ok(md.includes('2026-11-08'));
  assert.ok(md.includes('## 질문 1'));
  assert.ok(md.includes('보증금을 못 받았어요'));
  assert.ok(md.includes('## 답변 1'));
  assert.ok(md.includes('**결론**: 받을 수 있어요.'));
  assert.ok(md.includes('> 인용 확인: ✓ 민법 제618조 확인'));
  assert.ok(md.trimEnd().endsWith('중요한 결정 전에는 변호사와 확인하세요.'));
});

test('toMarkdown omits attachment text but names the file', () => {
  const md = toMarkdown(c);
  assert.ok(md.includes('첨부: 소장.pdf'));
  assert.ok(!md.includes('비밀 원문 내용'));
});

test('fileBaseName strips forbidden filename characters', () => {
  assert.equal(fileBaseName(c), '법률상담_2026-11-08_전세 보증금 반환소송');
  assert.doesNotMatch(fileBaseName(c), /[\\/:*?"<>|]/);
});

test('toDocxBlob maps headings, bullets and bold runs', async () => {
  const made = [];
  const lib = {
    HeadingLevel: { HEADING_1: 'H1', HEADING_2: 'H2' },
    TextRun: class { constructor(o) { this.o = o; } },
    Paragraph: class { constructor(o) { this.o = o; made.push(o); } },
    Document: class { constructor(o) { this.o = o; } },
    Packer: { toBlob: async (doc) => ({ blob: true, doc }) },
  };
  const out = await toDocxBlob(c, lib);
  assert.equal(out.blob, true);
  assert.equal(made[0].heading, 'H1');
  assert.equal(made[0].children[0].o.text, '법률 상담 기록');
  assert.ok(made.some((p) => p.heading === 'H2' && p.children[0].o.text === '질문 1'));
  assert.ok(made.some((p) => p.bullet && p.children[0].o.text === '민법 제618조'));
  const boldPara = made.find((p) => p.children?.some((r) => r.o.bold));
  assert.equal(boldPara.children.find((r) => r.o.bold).o.text, '결론');
});
