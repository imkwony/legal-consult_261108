// PDF 읽기: 글자가 있는 PDF는 바로 추출하고, 스캔본은 페이지 이미지를 AI가 받아 적게 한다.
import { chat as defaultChat } from './llm.js';

export const MAX_OCR_PAGES = 20;
export const MAX_ATTACH_CHARS = 60000;
const CUT_NOTE = '\n…(문서가 길어 앞부분 6만 자만 사용했습니다)';

// 너무 긴 문서는 AI가 한 번에 받을 수 있는 양을 넘으므로 앞부분만 쓴다
function capped(name, text) {
  if (text.length <= MAX_ATTACH_CHARS) return { name, text, truncated: false };
  return { name, text: text.slice(0, MAX_ATTACH_CHARS) + CUT_NOTE, truncated: true };
}
const OCR_PROMPT = '이 문서의 글자를 빠짐없이 그대로 받아 적어 주세요. 설명은 쓰지 마세요.';

export function looksScanned(pageTexts) {
  const chars = pageTexts.reduce((n, t) => n + String(t).replace(/\s/g, '').length, 0);
  return chars / Math.max(1, pageTexts.length) < 30;
}

async function defaultRenderPage(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.8);
}

export async function readPdf(file, { settings, onStatus = () => {} }, deps = {}) {
  const pdfjs = deps.pdfjs || globalThis.pdfjsLib;
  const chat = deps.chat || defaultChat;
  const renderPage = deps.renderPage || defaultRenderPage;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push(await doc.getPage(i));
  const texts = [];
  for (const p of pages) texts.push((await p.getTextContent()).items.map((it) => it.str).join(' '));

  if (!looksScanned(texts)) return capped(file.name, texts.join('\n\n').trim());

  if (pages.length > MAX_OCR_PAGES) throw new Error(`스캔한 PDF는 ${MAX_OCR_PAGES}쪽 이하로 나눠서 올려 주세요.`);
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    onStatus(`${pages.length}쪽 중 ${i + 1}쪽 읽는 중…`);
    const url = await renderPage(pages[i]);
    const { message } = await chat({
      settings,
      messages: [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url } }] }],
    });
    out.push(String(message?.content || '').trim());
  }
  return capped(file.name, out.join('\n\n'));
}
