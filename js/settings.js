// 설정: 각 기기 브라우저(localStorage)에만 저장된다. 구글 스크립트 주소는 코드에 고정.
export const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxadNTT98T70D8edllu7GIoj8zyiBa2e1r_4naSfDhaSOcpEvo1UIqzKP-s3mL4569O/exec';
export const DEFAULT_MODEL = 'claude-sonnet-5-5';
const KEY = 'legalConsult.settings';

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

export function loadSettings(storage = defaultStorage()) {
  let raw = {};
  try { raw = JSON.parse(storage?.getItem(KEY) || '{}') || {}; } catch { raw = {}; }
  return {
    scriptUrl: SCRIPT_URL,
    useDefaultKey: raw.useDefaultKey !== false,
    bazeKey: (raw.bazeKey || '').trim(),
    model: (raw.model || '').trim() || DEFAULT_MODEL,
  };
}

export function saveSettings(s, storage = defaultStorage()) {
  const clean = {
    useDefaultKey: s.useDefaultKey !== false,
    bazeKey: (s.bazeKey || '').trim(),
    model: (s.model || '').trim(),
  };
  try { storage?.setItem(KEY, JSON.stringify(clean)); } catch { /* 저장 불가(사생활 보호 모드 등) */ }
}

export function isConfigured(s) {
  return s.useDefaultKey !== false || Boolean(s.bazeKey);
}
