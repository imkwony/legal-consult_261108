import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPdf, looksScanned } from '../js/pdf.js';

const file = (name = '소장.pdf') => ({ name, arrayBuffer: async () => new ArrayBuffer(8) });
const fakePdfjs = (pageTexts) => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pageTexts.length,
      getPage: async (i) => ({ i, getTextContent: async () => ({ items: pageTexts[i - 1].split(' ').map((str) => ({ str })) }) }),
    }),
  }),
});
const settings = { model: 'm' };

test('looksScanned true for empty pages', () => {
  assert.equal(looksScanned(['', '  ', '1']), true);
});

test('looksScanned false for text pages', () => {
  assert.equal(looksScanned(['원고 홍길동은 피고에게 금 30,000,000원을 지급하라는 판결을 구합니다.']), false);
});

test('readPdf returns extracted text for text PDFs without calling chat', async () => {
  let chats = 0;
  const longText = '원고 홍길동은 피고 김철수에게 대여금 3천만원의 반환을 청구합니다 청구원인은 다음과 같습니다';
  const r = await readPdf(file(), { settings }, { pdfjs: fakePdfjs([longText, longText]), chat: async () => { chats++; }, renderPage: async () => '' });
  assert.equal(r.name, '소장.pdf');
  assert.ok(r.text.includes('대여금'));
  assert.equal(chats, 0);
});

test('readPdf uses OCR chat per page when scanned', async () => {
  const seen = [];
  const status = [];
  const r = await readPdf(file(), { settings, onStatus: (s) => status.push(s) }, {
    pdfjs: fakePdfjs(['', '']),
    renderPage: async (page) => `data:image/jpeg;base64,PAGE${page.i}`,
    chat: async ({ messages }) => { seen.push(messages[0].content); return { message: { content: `${seen.length}쪽 내용` } }; },
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0][1].image_url.url, 'data:image/jpeg;base64,PAGE1');
  assert.equal(seen[0][1].type, 'image_url');
  assert.equal(r.text, '1쪽 내용\n\n2쪽 내용');
  assert.deepEqual(status, ['2쪽 중 1쪽 읽는 중…', '2쪽 중 2쪽 읽는 중…']);
});

test('readPdf rejects over 20 pages', async () => {
  await assert.rejects(
    readPdf(file(), { settings }, { pdfjs: fakePdfjs(Array(21).fill('')), chat: async () => ({}), renderPage: async () => '' }),
    /20쪽 이하로 나눠서 올려 주세요/,
  );
});

test('readPdf caps very long text and marks it', async () => {
  const page = '가'.repeat(10000);
  const r = await readPdf(file(), { settings }, { pdfjs: fakePdfjs(Array(10).fill(page)), chat: async () => ({}), renderPage: async () => '' });
  assert.ok(r.text.length <= 60100);
  assert.ok(r.text.endsWith('(문서가 길어 앞부분 6만 자만 사용했습니다)'));
  assert.equal(r.truncated, true);
});
