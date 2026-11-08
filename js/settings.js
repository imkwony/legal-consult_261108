// 설정: 각 기기 브라우저(localStorage)에만 저장된다.
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const KEY = 'legalConsult.settings';

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadSettings(storage = defaultStorage()) {
  let raw = {};
  try { raw = JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { raw = {}; }
  return {
    scriptUrl: (raw.scriptUrl || '').trim(),
    bazeKey: (raw.bazeKey || '').trim(),
    model: (raw.model || '').trim() || DEFAULT_MODEL,
  };
}

export function saveSettings(s, storage = defaultStorage()) {
  const clean = {
    scriptUrl: (s.scriptUrl || '').trim(),
    bazeKey: (s.bazeKey || '').trim(),
    model: (s.model || '').trim(),
  };
  try { storage?.setItem(KEY, JSON.stringify(clean)); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
}

export function isConfigured(s) {
  return Boolean(s.scriptUrl);
}
