import { marked } from 'https://cdn.jsdelivr.net/npm/marked@12.0.2/lib/marked.esm.js';
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs';
import { loadSettings, saveSettings, isConfigured, DEFAULT_MODEL } from './settings.js';
import { gasCall } from './gas.js';
import { answer } from './agent.js';
import { newConsultation, makeTitle } from './consultation.js';
import { readPdf } from './pdf.js';
import { toMarkdown, toDocxBlob, fileBaseName, downloadBlob, printConsultation } from './export.js';
import { featureSummary, verificationWarnings } from './tools.js';

const PDFJS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.mjs';

// 기능 안내에 보여줄 쉬운 설명 (없는 도구는 서버 설명 첫 문장 사용)
const FRIENDLY = {
  search_law: '법 이름이나 키워드로 법령을 찾습니다. (예: 민법, 주택임대차보호법)',
  get_law_text: '찾은 법령의 조문 원문을 그대로 가져옵니다. (예: 민법 제750조)',
  search_decisions: '비슷한 사건의 판례를 찾습니다. 대법원·각급 법원 판례, 헌법재판소 결정, 법령해석례 등 23종류를 검색할 수 있습니다.',
  get_decision_text: '찾은 판례의 판결문 전문(사건 내용, 법원의 판단 이유)을 읽습니다.',
  legal_research: '여러 자료를 한꺼번에 엮어 조사합니다. 소송 준비(분쟁 대비) 조사도 여기서 합니다.',
  legal_analysis: '답변에 인용한 조문·판례가 실제로 존재하는지 검증하고, 판례가 지금도 유효한지 확인합니다.',
  get_annexes: '법령에 딸린 별표와 서식(금액 기준표, 신청서 양식 등)을 가져옵니다.',
  ordinance_radar: '지방자치단체 조례가 상위 법령 개정을 제대로 반영했는지 점검합니다.',
  discover_tools: '조세심판·노동위원회·공정위 등 80여 개 전문 기능 중 필요한 것을 찾아냅니다.',
  execute_tool: '찾아낸 전문 기능을 실행합니다.',
};

const $ = (id) => document.getElementById(id);
const state = { settings: loadSettings(), c: newConsultation(), busy: false, pending: [] };

// ---------- 화면 그리기 ----------

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function renderMessages() {
  $('welcome').hidden = state.c.messages.length > 0;
  $('messages').innerHTML = state.c.messages.map((m) => {
    if (m.role === 'user') {
      const att = (m.attachments || []).map((a) => `<div class="att">📎 ${esc(a.name)}</div>`).join('');
      return `<div class="msg user"><div class="who">질문</div>${att}${esc(m.content)}</div>`;
    }
    const verify = m.verification
      ? `<details><summary>인용 확인 결과 (판례·조문이 실제로 있는지 확인)</summary><pre>${esc(m.verification)}</pre></details>`
      : '';
    const warns = verificationWarnings(m.verification);
    const warnBox = warns.length
      ? `<div class="warnbox"><strong>⚠ 확인되지 않은 인용이 있어요.</strong> 아래 내용은 법령·판례 데이터베이스에서 찾지 못했습니다. 이 부분은 믿지 마시고 변호사에게 꼭 확인하세요.<ul>${warns.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
      : '';
    return `<div class="msg assistant"><div class="who">상담 답변</div>${DOMPurify.sanitize(marked.parse(m.content || ''))}${warnBox}${verify}</div>`;
  }).join('');
}

function setStatus(text) {
  $('status').hidden = !text;
  $('status').textContent = text || '';
}

function setBusy(b) {
  state.busy = b;
  $('send').disabled = b;
  $('file').disabled = b;
  $('btn-new').disabled = b;
  $('btn-load').disabled = b;
}

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function renderPending() {
  $('attachments').innerHTML = state.pending.map((a, i) => `<span class="chip">📎 ${esc(a.name)} <button type="button" data-remove="${i}" aria-label="첨부 삭제">✕</button></span>`).join('');
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function requireSettings() {
  if (isConfigured(state.settings)) return true;
  openSettings();
  toast('먼저 설정에서 구글 스크립트 주소를 넣어 주세요.');
  return false;
}

// ---------- 상담 ----------

async function send() {
  const text = $('input').value.trim();
  if (state.busy || (!text && !state.pending.length)) return;
  if (!requireSettings()) return;

  const msg = { role: 'user', content: text || '첨부한 서류를 보고 상담해 주세요.' };
  if (state.pending.length) msg.attachments = state.pending;
  state.c.messages.push(msg);
  if (!state.c.title) state.c.title = makeTitle(text || state.pending[0].name);
  state.pending = [];
  renderPending();
  $('input').value = '';
  renderMessages();
  scrollToBottom();

  setBusy(true);
  try {
    const r = await answer({ consultation: state.c, settings: state.settings, onStatus: setStatus });
    state.c.messages.push({ role: 'assistant', content: r.content, verification: r.verification });
    state.c.updatedAt = new Date().toISOString();
    renderMessages();
    scrollToBottom();
    setStatus('상담 내용 저장 중…');
    try {
      await gasCall(state.settings.scriptUrl, 'save', { consultation: state.c });
    } catch (err) {
      toast(`저장하지 못했어요: ${err.message}`);
    }
  } catch (err) {
    // 실패한 질문은 대화에서 빼고 입력창에 되돌려 다시 보낼 수 있게 한다
    state.c.messages.pop();
    $('input').value = msg.content;
    if (msg.attachments) { state.pending = msg.attachments; renderPending(); }
    renderMessages();
    toast(`답변을 받지 못했어요: ${err.message}`);
  } finally {
    setStatus('');
    setBusy(false);
  }
}

async function attachPdf(file) {
  if (!file) return;
  if (!requireSettings()) return;
  setBusy(true);
  try {
    setStatus('PDF 읽는 중…');
    if (!globalThis.pdfjsLib) {
      const lib = await import(PDFJS_URL);
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      globalThis.pdfjsLib = lib;
    }
    const att = await readPdf(file, { settings: state.settings, onStatus: setStatus });
    if (!att.text.trim()) throw new Error('글자를 찾지 못했어요.');
    state.pending.push(att);
    renderPending();
    toast(`"${file.name}"을(를) 읽었어요. 질문과 함께 보내 주세요.`);
  } catch (err) {
    toast(`PDF를 읽지 못했어요: ${err.message}`);
  } finally {
    $('file').value = '';
    setStatus('');
    setBusy(false);
  }
}

function newChat() {
  if (state.busy) return;
  state.c = newConsultation();
  state.pending = [];
  renderPending();
  renderMessages();
  $('input').focus();
}

// ---------- 불러오기 ----------

async function openLoad() {
  if (!requireSettings()) return;
  const list = $('load-list');
  list.textContent = '불러오는 중…';
  $('dlg-load').showModal();
  try {
    const items = await gasCall(state.settings.scriptUrl, 'list');
    if (!items.length) { list.textContent = '저장된 상담이 없어요.'; return; }
    list.innerHTML = items.map((it) => `<button type="button" data-id="${esc(it.id)}">${esc(it.title || '(제목 없음)')}<span class="date">${esc(new Date(it.updatedAt).toLocaleString('ko-KR'))}</span></button>`).join('');
  } catch (err) {
    list.textContent = `목록을 가져오지 못했어요: ${err.message}`;
  }
}

async function loadOne(id) {
  $('load-list').textContent = '상담을 여는 중…';
  try {
    state.c = await gasCall(state.settings.scriptUrl, 'load', { id });
    renderMessages();
    $('dlg-load').close();
    scrollToBottom();
  } catch (err) {
    $('load-list').textContent = `열지 못했어요: ${err.message}`;
  }
}

// ---------- 기능 안내 ----------

async function openFeatures() {
  const list = $('features-list');
  $('dlg-features').showModal();
  if (!isConfigured(state.settings)) { list.textContent = '설정에서 구글 스크립트 주소를 넣으면 기능 목록이 보여요.'; return; }
  list.textContent = '불러오는 중…';
  try {
    const tools = await gasCall(state.settings.scriptUrl, 'mcp_tools');
    list.innerHTML = tools.map(featureSummary).map((f) => `
      <div class="feature"><strong>${esc(f.title)}</strong>${esc(FRIENDLY[f.name] || f.summary)} <code>${esc(f.name)}</code></div>`).join('');
  } catch (err) {
    list.textContent = `기능 목록을 가져오지 못했어요: ${err.message}`;
  }
}

// ---------- 다운로드 ----------

async function download(format) {
  $('download-menu').hidden = true;
  $('btn-download').setAttribute('aria-expanded', 'false');
  if (!state.c.messages.length) { toast('내려받을 상담 내용이 없어요.'); return; }
  const base = fileBaseName(state.c);
  try {
    if (format === 'md') {
      downloadBlob(new Blob([toMarkdown(state.c)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`);
    } else if (format === 'docx') {
      const lib = await import(DOCX_URL);
      downloadBlob(await toDocxBlob(state.c, lib), `${base}.docx`);
    } else {
      document.querySelectorAll('.msg details').forEach((d) => { d.open = true; });
      const prevTitle = document.title;
      document.title = base; // 'PDF로 저장' 시 기본 파일 이름
      printConsultation();
      document.title = prevTitle;
    }
  } catch (err) {
    toast(`내려받지 못했어요: ${err.message}`);
  }
}

// ---------- 설정 ----------

function openSettings() {
  $('set-script').value = state.settings.scriptUrl;
  $('set-key').value = state.settings.bazeKey;
  $('set-model').value = state.settings.model;
  $('set-model').placeholder = DEFAULT_MODEL;
  if (!$('dlg-settings').open) $('dlg-settings').showModal();
}

function saveSettingsFromForm() {
  saveSettings({ scriptUrl: $('set-script').value, bazeKey: $('set-key').value, model: $('set-model').value });
  state.settings = loadSettings();
  toast('설정을 저장했어요.');
}

// ---------- 이벤트 ----------

$('form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
$('file').addEventListener('change', (e) => attachPdf(e.target.files[0]));
$('attachments').addEventListener('click', (e) => {
  const i = e.target.dataset.remove;
  if (i !== undefined) { state.pending.splice(Number(i), 1); renderPending(); }
});
document.querySelectorAll('.example').forEach((b) => b.addEventListener('click', () => { $('input').value = b.textContent; $('input').focus(); }));

$('btn-new').addEventListener('click', newChat);
$('btn-load').addEventListener('click', openLoad);
$('load-list').addEventListener('click', (e) => { const b = e.target.closest('[data-id]'); if (b) loadOne(b.dataset.id); });
$('btn-features').addEventListener('click', openFeatures);
$('btn-settings').addEventListener('click', openSettings);
$('settings-cancel').addEventListener('click', () => $('dlg-settings').close());
$('settings-form').addEventListener('submit', (e) => {
  if (e.submitter?.value === 'save') {
    if (!$('set-script').value.trim()) { e.preventDefault(); toast('구글 스크립트 주소는 꼭 필요해요.'); return; }
    saveSettingsFromForm();
  }
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('btn-download').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = $('download-menu');
  menu.hidden = !menu.hidden;
  $('btn-download').setAttribute('aria-expanded', String(!menu.hidden));
});
$('download-menu').addEventListener('click', (e) => { const f = e.target.dataset.format; if (f) download(f); });
document.addEventListener('click', () => { $('download-menu').hidden = true; });

renderMessages();
if (!isConfigured(state.settings)) openSettings();
