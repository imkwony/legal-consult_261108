/**
 * 법률 상담 사이트 — Apps Script 중계 서버
 *
 * 스크립트 속성(프로젝트 설정 → 스크립트 속성):
 *   BAZE_API_KEY  소유자 BAZE 키 (필수)
 *   LAW_OC        국가법령정보 Open API 인증키 OC (필수)
 *   SHEET_ID      상담을 저장할 스프레드시트 ID (시트에 붙은 스크립트면 생략 가능)
 *
 * 브라우저는 POST(text/plain) 본문에 {action, ...} JSON을 보낸다.
 * 응답: {ok:true, data} 또는 {ok:false, error}
 */

var BAZE_CHAT_URL = 'https://api.baze.co/v1/gateway/chat/completions/';
var MCP_URLS = ['https://mcp.gomdori.app/law', 'https://korean-law-mcp.fly.dev/mcp'];
var SHEET_NAME = '상담기록';
var HEADER = ['id', 'title', 'createdAt', 'updatedAt', 'json'];
var CHUNK = 44999; // 셀 한도 50,000자 — 앞에 붙이는 ' 포함 45,000자 이하
var TOOLS_CACHE_KEY = 'mcp_tools_v1';

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = { ok: true, data: handle_(req) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  switch (req.action) {
    case 'mcp_tools': return mcpTools_();
    case 'mcp_call': return mcpCall_(req.name, req.arguments || {});
    case 'chat': return chat_(req.body);
    case 'models': return models_();
    case 'save': return saveConsultation_(req.consultation);
    case 'list': return listConsultations_();
    case 'load': return loadConsultation_(req.id);
    default: throw new Error('알 수 없는 요청: ' + req.action);
  }
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

// ---------- BAZE ----------

function chat_(body) {
  var key = prop_('BAZE_API_KEY');
  if (!key) throw new Error('스크립트 속성에 BAZE_API_KEY가 없습니다');
  var res = UrlFetchApp.fetch(BAZE_CHAT_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code >= 400) throw new Error('BAZE 오류 ' + code + ': ' + text.slice(0, 300));
  return JSON.parse(text);
}

function models_() {
  var key = prop_('BAZE_API_KEY');
  if (!key) throw new Error('스크립트 속성에 BAZE_API_KEY가 없습니다');
  var res = UrlFetchApp.fetch('https://api.baze.co/v1/gateway/models/?type=llm', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + key },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 400) throw new Error('BAZE 오류 ' + res.getResponseCode());
  return (JSON.parse(res.getContentText()).data || []).map(function (m) {
    return { id: m.id, owned_by: m.owned_by, lifecycle: m.lifecycle, endpoints: m.endpoints || [] };
  });
}

// ---------- MCP ----------

function parseMcpBody_(text) {
  var t = String(text || '').trim();
  if (t.charAt(0) !== '{') {
    t = t.split('\n').filter(function (l) { return l.indexOf('data:') === 0; })
      .map(function (l) { return l.slice(5); }).join('');
  }
  return JSON.parse(t);
}

function mcpPost_(url, msg) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Accept: 'application/json, text/event-stream' },
    payload: JSON.stringify(msg),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code >= 400) throw new Error('법률 서버 오류 ' + code);
  return res.getContentText();
}

function mcpRequest_(method, params) {
  var oc = prop_('LAW_OC');
  if (!oc) throw new Error('스크립트 속성에 LAW_OC가 없습니다');
  var lastErr;
  for (var i = 0; i < MCP_URLS.length; i++) {
    var url = MCP_URLS[i] + '?oc=' + encodeURIComponent(oc);
    try {
      mcpPost_(url, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legal-consult', version: '1.0' } } });
      mcpPost_(url, { jsonrpc: '2.0', method: 'notifications/initialized' });
      var msg = parseMcpBody_(mcpPost_(url, { jsonrpc: '2.0', id: 2, method: method, params: params }));
      if (msg.error) throw new Error('법률 서버 오류: ' + (msg.error.message || JSON.stringify(msg.error)));
      return msg.result;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function mcpTools_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(TOOLS_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  var tools = mcpRequest_('tools/list', {}).tools.map(function (t) {
    return { name: t.name, title: t.title || t.name, description: t.description || '', inputSchema: t.inputSchema || { type: 'object' } };
  });
  try { cache.put(TOOLS_CACHE_KEY, JSON.stringify(tools), 21600); } catch (e) { /* 캐시 용량 초과는 무시 */ }
  return tools;
}

function mcpCall_(name, args) {
  var result = mcpRequest_('tools/call', { name: name, arguments: args });
  var text = (result.content || [])
    .filter(function (c) { return c.type === 'text'; })
    .map(function (c) { return c.text; })
    .join('\n');
  return { text: text, isError: !!result.isError };
}

// ---------- 시트 ----------

function sheet_() {
  var id = prop_('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADER);
  }
  return sh;
}

// 앞에 ' 를 붙여 수식·날짜 자동 변환을 막는다. 시트는 이 ' 를 값에 넣지 않으므로 읽을 때는 그대로 쓴다.
function txt_(s) { return "'" + s; }

function findRow_(values, id) {
  for (var r = 1; r < values.length; r++) if (String(values[r][0]) === id) return r + 1;
  return -1;
}

function saveConsultation_(c) {
  if (!c || !c.id) throw new Error('상담 id가 없습니다');
  var sh = sheet_();
  var json = JSON.stringify(c);
  var row = [txt_(c.id), txt_(c.title || ''), txt_(c.createdAt || ''), txt_(c.updatedAt || '')];
  for (var i = 0; i < json.length; i += CHUNK) row.push(txt_(json.slice(i, i + CHUNK)));
  var r = findRow_(sh.getDataRange().getValues(), c.id);
  if (r === -1) {
    sh.appendRow(row);
  } else {
    var lastCol = sh.getLastColumn();
    if (lastCol > 0) sh.getRange(r, 1, 1, lastCol).clearContent();
    sh.getRange(r, 1, 1, row.length).setValues([row]);
  }
  return { id: c.id };
}

function listConsultations_() {
  var values = sheet_().getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (!values[r][0]) continue;
    out.push({ id: String(values[r][0]), title: String(values[r][1]), updatedAt: String(values[r][3]) });
  }
  out.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0; });
  return out;
}

function loadConsultation_(id) {
  var values = sheet_().getDataRange().getValues();
  var r = findRow_(values, id);
  if (r === -1) throw new Error('저장된 상담을 찾을 수 없습니다');
  var json = values[r - 1].slice(4).map(function (v) { return String(v); }).join('');
  return JSON.parse(json);
}
