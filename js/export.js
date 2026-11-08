// 상담 기록 내려받기: Markdown / Word(docx) / PDF(브라우저 인쇄)
const DISCLAIMER = '※ 이 기록은 참고용입니다. 중요한 결정 전에는 변호사와 확인하세요.';

const pad = (n) => String(n).padStart(2, '0');
function localDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function localDateTime(iso) {
  const d = new Date(iso);
  return `${localDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fileBaseName(c) {
  const title = String(c.title || '상담').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return `법률상담_${localDate(c.createdAt)}_${title}`;
}

export function toMarkdown(c) {
  const lines = ['# 법률 상담 기록', '', `- 제목: ${c.title || ''}`, `- 상담 일시: ${localDateTime(c.createdAt)}`, ''];
  let q = 0;
  let a = 0;
  for (const m of c.messages) {
    if (m.role === 'user') {
      lines.push(`## 질문 ${++q}`, '');
      for (const att of m.attachments || []) lines.push(`(첨부: ${att.name})`, '');
      lines.push(m.content, '');
    } else {
      lines.push(`## 답변 ${++a}`, '', m.content, '');
      if (m.verification) lines.push(...m.verification.split('\n').map((l, i) => (i === 0 ? `> 인용 확인: ${l}` : `> ${l}`)), '');
    }
  }
  lines.push('---', '', DISCLAIMER, '');
  return lines.join('\n');
}

// **굵게** 만 처리한 TextRun 목록
function runs(text, lib) {
  return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) => (
    part.startsWith('**') && part.endsWith('**')
      ? new lib.TextRun({ text: part.slice(2, -2), bold: true })
      : new lib.TextRun({ text: part })
  ));
}

export async function toDocxBlob(c, lib) {
  const paragraphs = toMarkdown(c).split('\n').map((line) => {
    if (line.startsWith('# ')) return new lib.Paragraph({ heading: lib.HeadingLevel.HEADING_1, children: runs(line.slice(2), lib) });
    if (line.startsWith('## ')) return new lib.Paragraph({ heading: lib.HeadingLevel.HEADING_2, children: runs(line.slice(3), lib) });
    if (/^[-*] /.test(line)) return new lib.Paragraph({ bullet: { level: 0 }, children: runs(line.slice(2), lib) });
    const plain = line.replace(/^#{3,6} /, '').replace(/^> /, '').replace(/^---$/, '');
    return new lib.Paragraph({ children: runs(plain, lib) });
  });
  const doc = new lib.Document({ sections: [{ children: paragraphs }] });
  return lib.Packer.toBlob(doc);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printConsultation() {
  window.print();
}
