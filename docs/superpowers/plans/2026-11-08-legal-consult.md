# 법률 상담 사이트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 국가법령정보(korean-law-mcp)의 실제 법령·판례를 근거로 쉽게 답하는 개인용 법률 상담 챗봇을 GitHub Pages 정적 사이트 + Google Apps Script 중계로 만든다.

**Architecture:** 브라우저(순수 HTML/ES modules, 빌드 없음)가 tool-calling 루프를 돌린다. AI는 BAZE Chat Completions(본인 키면 직접, 없으면 Apps Script가 소유자 키로 대리). 법률 MCP 호출과 상담 저장/불러오기는 시트에 바인딩된 Apps Script 웹앱 하나가 맡는다.

**Tech Stack:** HTML/CSS/JS(ES modules), Node 24 `node --test`(의존성 없음), Google Apps Script(V8), CDN: pdf.js, docx, marked, DOMPurify(정확한 버전 고정, cdnjs/jsdelivr).

**Spec:** `docs/superpowers/specs/2026-11-08-legal-consult-design.md`

## Global Constraints

- 호스팅은 GitHub Pages(정적). 빌드 단계 없음 — `index.html`을 그대로 연다.
- 소유자 BAZE 키·OC 키는 Apps Script **Script Properties**(`BAZE_API_KEY`, `LAW_OC`)에만. 사이트 코드·저장소에 절대 없음. `.env`는 `.gitignore`.
- BAZE Base URL `https://api.baze.co/v1/gateway`, 엔드포인트 `/chat/completions/`(끝 슬래시 포함), 헤더 `Authorization: Bearer <키>`.
- MCP 엔드포인트 `https://mcp.gomdori.app/law?oc=<OC>`(대체 `https://korean-law-mcp.fly.dev/mcp?oc=<OC>`), 헤더 `Accept: application/json, text/event-stream`. 무상태(세션 ID 헤더 없음 — 2026-11-08 확인). 응답은 JSON 또는 SSE `data:` 줄.
- 브라우저 → Apps Script 요청은 `POST`, `Content-Type: text/plain;charset=utf-8`(프리플라이트 회피), 본문 JSON `{action, ...}`. 응답 `{ok:true,data}` | `{ok:false,error}`.
- 도구 호출 반복 최대 **8회**, 도구 결과는 **12,000자**에서 자름.
- 접속 비밀번호 없음(사용자 결정).
- UI 문구·답변은 한국어, 쉽고 명료하게. 답변마다 "중요한 결정 전에는 변호사와 확인하세요".
- 설정(localStorage 키 `legalConsult.settings`): `{scriptUrl, bazeKey, model}`.
- 글자 크게(본문 18px 이상), 대비 높게, 휴대폰 폭에서 가로 스크롤 없음.

## Review Focus

1. 긴 상담(소장 PDF 원문 10만 자 포함) 저장 → 시트 셀 한도 50,000자에 걸려 실패하면 안 됨 — Task 2에서 청크 분할 테스트.
2. 상담 도중 MCP가 오류/시간초과 → 무한 대기 없이 "자료 조회 실패"를 모델에 전달하고 답변은 나와야 함 — Task 4 테스트.
3. 모델이 계속 도구만 부름 → 8회 후 `tool_choice:"none"`으로 최종 답변 강제 — Task 4 테스트.
4. 설정의 Apps Script 주소가 틀림(구글 로그인 HTML이 돌아옴) → "설정의 주소를 확인해 주세요" 한국어 오류 — Task 3 테스트.
5. 판결문 전문처럼 거대한 도구 결과 → 12,000자로 잘리고 "(이하 생략)" 표시 — Task 4 테스트.

## File Structure

```
index.html                 화면 뼈대, CDN 스크립트
styles.css                 반응형·큰 글자 스타일, 인쇄 스타일(@media print)
js/settings.js             설정 로드/저장
js/gas.js                  Apps Script 호출 래퍼
js/llm.js                  BAZE 호출(직접/대리 선택)
js/tools.js                MCP 도구 → OpenAI tools 변환, 결과 자르기
js/prompt.js               시스템 프롬프트
js/agent.js                tool-calling 루프 + 인용 검증
js/consultation.js         상담 데이터 모델, 제목 생성
js/pdf.js                  PDF 텍스트 추출 / 스캔본 OCR
js/export.js               md / docx / 인쇄(PDF)
js/app.js                  UI 연결
apps-script/Code.gs        doPost: mcp_tools, mcp_call, chat, save, list, load
scripts/verify.mjs         실제 키로 BAZE·MCP 기능 확인
tests/*.test.mjs           node --test
docs/setup-guide.md        초기 설정 안내서(아들용)
package.json               {"type":"module","scripts":{"test":"node --test tests/"}}
```

**공유 데이터 모델 (`js/consultation.js`)**

```js
// Consultation
{ id: string,            // crypto.randomUUID()
  title: string,         // 첫 질문 앞 40자
  createdAt: string, updatedAt: string,   // ISO
  messages: Array<{
    role: 'user'|'assistant',
    content: string,                       // assistant는 markdown
    attachments?: Array<{name: string, text: string}>,   // user만
    verification?: string                  // assistant만, verify_citations 결과 원문
  }> }
```

---

### Task 1: 프로젝트 초기화 + 실제 키로 기능 확인

**Files:**
- Create: `package.json`, `scripts/verify.mjs`, `docs/superpowers/verify-results.md`

**Interfaces:**
- Produces: `docs/superpowers/verify-results.md`에 ① BAZE 모델 목록 ② 선택한 기본 모델 ID ③ tool calling 지원 여부 ④ 이미지 입력 지원 여부 ⑤ MCP `tools/list` 도구 이름 ⑥ OC 키로 `search_decisions` 1회 성공 여부. Task 3의 `DEFAULT_MODEL`, Task 4b 실행 여부가 이것으로 정해진다.

- [ ] **Step 1:** `git init`, `package.json` 작성(위 File Structure 내용). `.env`에 두 키가 채워졌는지 확인 — 비었으면 사용자에게 요청하고 멈춤.
- [ ] **Step 2:** `scripts/verify.mjs` 작성 — `.env`를 직접 파싱(의존성 없이), 키 값은 절대 출력하지 않음. 순서대로:
  1. `GET /models/` → 모델 ID 출력.
  2. 기본 모델 선택 규칙: 목록에 `claude-sonnet-5`가 있으면 그것, 없으면 이름에 `sonnet` 포함 최신, 없으면 `gemini`+`flash` 포함 최신.
  3. 그 모델로 `get_weather(city)` 더미 도구를 주고 "서울 날씨 알려줘" → 응답에 `choices[0].message.tool_calls`가 있으면 지원.
  4. 1×1 PNG data URI를 `{"type":"image_url","image_url":{"url":...}}`로 보내 오류 없이 답하면 이미지 지원.
  5. MCP `initialize` → `tools/list` → `tools/call search_decisions {domain:"precedent", query:"대여금", display:3}`(OC 포함 URL).
- [ ] **Step 3:** `node scripts/verify.mjs` 실행. Expected: 6개 항목 모두 출력, 예외 없음.
- [ ] **Step 4:** 결과를 `docs/superpowers/verify-results.md`에 기록. tool calling 미지원이면 사용자에게 알리고 Task 4b를 실행 대상으로 표시.
- [ ] **Step 5:** Commit `chore: init project and verify BAZE/MCP capabilities`

---

### Task 2: Apps Script 백엔드

**Files:**
- Create: `apps-script/Code.gs`, `tests/appsscript.test.mjs`

**Interfaces:**
- Produces (doPost actions, 응답 envelope은 Global Constraints):
  - `{action:'mcp_tools'}` → `data: Array<{name, description, inputSchema}>` (CacheService 6시간 캐시)
  - `{action:'mcp_call', name, arguments}` → `data: {text: string, isError: boolean}` (result.content의 text 항목들을 `\n`으로 합침)
  - `{action:'chat', body}` → `data`: BAZE 응답 JSON 그대로 (소유자 키 사용)
  - `{action:'save', consultation}` → `data: {id}` (id로 upsert)
  - `{action:'list'}` → `data: Array<{id, title, updatedAt}>` (updatedAt 내림차순)
  - `{action:'load', id}` → `data: Consultation`
- 시트 `상담기록`: A `id` | B `title` | C `createdAt` | D `updatedAt` | E 이후 JSON 청크(각 최대 45,000자). 없으면 헤더와 함께 생성.
- MCP: 기본 URL 실패(HTTP ≥ 400 또는 예외) 시 대체 URL로 1회 재시도. `UrlFetchApp.fetch(..., {muteHttpExceptions:true})`. SSE 응답이면 `data:` 줄을 이어 JSON 파싱.

테스트는 `node:vm`에 `Code.gs`를 로드하고 `UrlFetchApp`, `SpreadsheetApp`(메모리 2차원 배열), `PropertiesService`, `CacheService`, `ContentService`를 가짜로 주입한다.

- [ ] **Step 1: 실패 테스트 작성** — `tests/appsscript.test.mjs`
  - `save then load round-trips a 100,000-char consultation` — 저장 후 시트 행의 E·F·G 셀이 각각 ≤ 45,000자, `load`가 원본과 deepEqual.
  - `save twice with same id updates one row` — 행 수 1, title 갱신.
  - `list returns newest first without messages` — 항목에 `messages` 키 없음.
  - `mcp_call parses SSE body` — 가짜 응답 `event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"판례A"}]}}` → `data.text === '판례A'`.
  - `mcp_call falls back to secondary URL on 403` — 첫 fetch 403, 두 번째 URL이 `korean-law-mcp.fly.dev` 포함.
  - `chat forwards body with owner key` — fetch 헤더 `Authorization === 'Bearer OWNER'`.
  - `unknown action returns ok:false`.
- [ ] **Step 2:** `npm test` → FAIL(Code.gs 없음).
- [ ] **Step 3:** `apps-script/Code.gs` 구현 — `doPost(e)`, `handle_(req)`, `mcpRequest_(method, params)`, `parseMcpBody_(text)`, `saveConsultation_(c)`, `listConsultations_()`, `loadConsultation_(id)`. MCP 요청 순서: `initialize` → `notifications/initialized` → 본 요청(무상태라 매 호출마다 수행, 실패 시만 대체 URL).
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: apps script relay for MCP, BAZE and sheet storage`

---

### Task 3: 설정 · Apps Script 래퍼 · LLM 호출

**Files:**
- Create: `js/settings.js`, `js/gas.js`, `js/llm.js`, `tests/frontcore.test.mjs`

**Interfaces:**
- Produces:
  - `settings.js`: `DEFAULT_MODEL: string`(Task 1 결과), `loadSettings(storage=localStorage) → {scriptUrl, bazeKey, model}`, `saveSettings(s, storage=localStorage)`, `isConfigured(s) → boolean`(scriptUrl 있음)
  - `gas.js`: `gasCall(scriptUrl, action, payload={}, fetchFn=fetch) → Promise<any>` — `data` 반환, `ok:false`면 `Error(error)` throw
  - `llm.js`: `chat({settings, messages, tools?, toolChoice?}, deps={fetchFn, gasCall}) → Promise<{message, finishReason}>` — `bazeKey` 있으면 BAZE 직접, 없으면 `gasCall(..., 'chat', {body})`
- localStorage 접근은 try/catch, 실패 시 기본값.

- [ ] **Step 1: 실패 테스트 작성**
  - `loadSettings returns defaults when storage throws`.
  - `gasCall throws Korean hint when response is HTML` — 가짜 fetch가 `<!DOCTYPE html>...` 반환 → 메시지에 `설정의 주소를 확인해 주세요` 포함.
  - `gasCall sends text/plain POST` — headers `Content-Type` 가 `text/plain;charset=utf-8`.
  - `chat uses direct BAZE when bazeKey set` — fetch URL `https://api.baze.co/v1/gateway/chat/completions/`, gasCall 미호출.
  - `chat proxies via gas when bazeKey empty` — gasCall action `'chat'`, body.model === settings.model.
  - `chat passes tool_choice none when toolChoice='none'`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 세 모듈 구현.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: settings, apps script client, BAZE chat client`

---

### Task 4: 상담 엔진 (tool-calling 루프 + 인용 검증)

**Files:**
- Create: `js/tools.js`, `js/prompt.js`, `js/agent.js`, `js/consultation.js`, `tests/agent.test.mjs`

**Interfaces:**
- Consumes: `chat(...)`(Task 3), `gasCall(...)`(Task 3)
- Produces:
  - `tools.js`: `toOpenAITools(mcpTools) → Array<{type:'function', function:{name, description, parameters}}>`; `truncate(text, max=12000) → string`(넘으면 앞 12,000자 + `\n…(이하 생략)`)
  - `prompt.js`: `SYSTEM_PROMPT: string`
  - `consultation.js`: `newConsultation() → Consultation`, `makeTitle(text) → string`(공백 정리, 40자), `toLlmMessages(c) → Array` (첨부는 `[첨부: 이름]\n원문`으로 user content 앞에 붙임)
  - `agent.js`: `answer({consultation, settings, onStatus}, deps={chat, gasCall}) → Promise<{content: string, verification: string}>`
- 루프: `mcp_tools`로 도구 획득(세션 내 1회 메모이즈) → `chat` 반복. `tool_calls`마다 `onStatus(statusLabel(name, args))` 후 `mcp_call`, 결과는 `truncate` 해서 `role:'tool'` 메시지로. 예외 시 내용 `자료 조회 실패: <메시지>`. 8회 도달 시 `toolChoice:'none'`으로 마지막 호출. 최종 답변 후 `onStatus('인용 확인 중…')` → `mcp_call legal_analysis {mode:'verify_citations', text: content}` → `verification`(실패 시 `'인용 확인을 하지 못했습니다.'`).
- `statusLabel`: `search_decisions`→`판례 검색 중…`, `get_decision_text`→`판결문 읽는 중…`, `search_law`→`법령 검색 중…`, `get_law_text`→`법 조문 확인 중…`(args.jo 있으면 `제○조 확인 중…`), `legal_research`→`종합 리서치 중…`, 그 외 `자료 확인 중…`.

**SYSTEM_PROMPT 필수 내용(정확한 문구는 구현자):** 아버지 같은 비전문가 대상, 결론 먼저 → 이유 → 해야 할 일 순서; 법률 용어는 괄호로 풀이; **도구로 확인한 자료만 근거로 인용**하고 인용마다 법령명·조문 또는 법원·선고일·사건번호 표기; 확인 못 한 것은 "확인하지 못했습니다"라고 말함; 소송 관련 질문은 (1) 답변서 작성 요령 (2) 변호사 선임 필요성 판단 기준 (3) 예상 전개·결과 (4) 유사 판례 결과를 다룸; 끝에 "중요한 결정 전에는 변호사와 확인하세요."; MCP 서버 `instructions`의 도구 사용 순서(search_law로 mst 획득 → get_law_text 등) 반영.

- [ ] **Step 1: 실패 테스트 작성** (가짜 `chat`/`gasCall` 스크립트)
  - `runs tool call then returns final answer` — 1회차 tool_calls(search_decisions), 2회차 텍스트 → content 반환, onStatus에 `판례 검색 중…`, `인용 확인 중…` 순서.
  - `stops after 8 tool rounds and forces final answer` — chat이 항상 tool_calls → chat 총 9회, 마지막 호출 toolChoice `'none'`.
  - `mcp failure becomes tool message, answer still returned` — mcp_call throw → 다음 chat의 messages 마지막이 `자료 조회 실패:` 로 시작.
  - `truncates large tool results` — 50,000자 → 길이 ≤ 12,020, `(이하 생략)` 포함.
  - `verification failure yields fallback text`.
  - `toLlmMessages prepends attachments`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** 구현.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: consultation agent with MCP tool loop and citation check`

### Task 4b (조건부 — Task 1에서 tool calling 미지원일 때만): 고정 파이프라인

**Files:** Modify `js/agent.js`, `tests/agent.test.mjs`
- `answer`의 내부 구현을 교체(시그니처 동일): ① chat에 "검색어 JSON `{"precedent":[...],"law":[...]}`만 출력" 요청 → ② 각 검색어로 `search_decisions`(precedent, display 5)·`search_law` → ③ 상위 판례 3건 `get_decision_text`, 법령 2건 `get_law_text` → ④ 자료를 user 메시지에 붙여 최종 답변 → ⑤ 인용 검증.
- 테스트: `pipeline calls search then text then final chat`, JSON 파싱 실패 시 질문 원문을 검색어로 사용.
- Commit `feat: fixed retrieval pipeline fallback`

---

### Task 5: PDF 입력

**Files:**
- Create: `js/pdf.js`, `tests/pdf.test.mjs`

**Interfaces:**
- Consumes: `chat(...)`(Task 3)
- Produces: `readPdf(file, {settings, onStatus}, deps={pdfjs, chat}) → Promise<{name, text}>`; 순수 함수 `looksScanned(pageTexts: string[]) → boolean`(페이지당 평균 비공백 문자 < 30)
- 스캔본이면 페이지별 canvas 렌더(scale 2) → JPEG data URI → chat(image_url + "이 문서의 글자를 빠짐없이 그대로 받아 적어 주세요. 설명은 쓰지 마세요.") → 페이지 순서대로 합침. `onStatus('3쪽 중 1쪽 읽는 중…')`. 최대 20쪽, 넘으면 오류 "20쪽 이하로 나눠서 올려 주세요".
- pdf.js는 CDN ESM(`pdfjs-dist` 고정 버전, worker 경로 지정)을 `app.js`에서 주입.

- [ ] **Step 1:** 테스트 — `looksScanned true for empty pages`, `looksScanned false for text pages`, `readPdf uses OCR chat per page when scanned`(가짜 pdfjs 2쪽, chat 2회), `readPdf rejects over 20 pages`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** 구현. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: PDF text extraction with OCR fallback`

---

### Task 6: 다운로드 (md / Word / PDF)

**Files:**
- Create: `js/export.js`, `tests/export.test.mjs`

**Interfaces:**
- Produces: `toMarkdown(c: Consultation) → string`; `toDocxBlob(c, docxLib) → Promise<Blob>`; `printConsultation()`(window.print); `fileBaseName(c) → string` (`법률상담_YYYY-MM-DD_<제목 앞 20자, 파일명 금지문자 제거>`)
- Markdown 형식: `# 법률 상담 기록` / 날짜 / `## 질문 N`, `## 답변 N`, 첨부는 이름만(원문 제외), 검증 결과는 `> 인용 확인:` 인용블록, 맨 끝 `---` + 변호사 확인 안내.
- docx: Markdown을 줄 단위로 단락화(제목 `#`→Heading, `- `→bullet, 그 외 일반 단락; 굵게 `**`만 처리). `docx` 라이브러리는 CDN ESM으로 주입.
- PDF: `@media print`에서 상단 바·입력창 숨기고 대화만 출력.

- [ ] **Step 1:** 테스트 — `toMarkdown includes questions, answers, verification and disclaimer`, `toMarkdown omits attachment text`, `fileBaseName strips \\/:*?"<>|`.
- [ ] **Step 2:** FAIL. **Step 3:** 구현. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: export consultation as md, docx, print`

---

### Task 7: 화면 (UI 연결)

**Files:**
- Create: `index.html`, `styles.css`, `js/app.js`

**Interfaces:**
- Consumes: Task 3~6의 모든 Produces.
- 화면: 상단 바(왼쪽 "법률 상담", 오른쪽 **새 상담** · **불러오기** · **다운로드▾**(Markdown/Word/PDF) · **설정**), 대화 영역(답변은 marked → DOMPurify 렌더, 검증 결과는 `<details>인용 확인 결과</details>`), 하단 입력(여러 줄 textarea, 📎 PDF 첨부, 보내기). 진행 상태 한 줄 표시. 설정 창 항목: Apps Script 주소(필수), 본인 BAZE 키(선택, "비워두면 기본 키 사용"), 모델(기본 `DEFAULT_MODEL`). 설정 미입력 시 설정 창 자동 오픈.
- 답변이 끝날 때마다 `save` 자동 호출(실패 시 "저장하지 못했어요" 토스트, 대화는 유지).
- 불러오기: `list` → 목록 모달(제목·날짜) → `load` 후 화면 교체.
- 처리 중엔 보내기 버튼 비활성.

- [ ] **Step 1:** 구현.
- [ ] **Step 2:** `.claude/launch.json`에 정적 서버(`npx --yes http-server -p 8000 -c-1`) 등록 후 브라우저 미리보기로 확인: 375px 폭에서 가로 스크롤 없음, 설정 저장 후 새로고침해도 유지, 콘솔 오류 없음.
- [ ] **Step 3: 실제 종단 확인** — Task 8 설정 안내서 순서대로 테스트 시트에 Code.gs 배포(사용자 협조 필요) 후: "전세 보증금을 안 돌려줘서 소송하려는데 상대가 답변서를 써야 한대요. 어떻게 하나요?" → 상태 문구 표시, 답변에 사건번호/조문 포함, 인용 확인 결과 표시, 시트에 행 생성, 불러오기로 복원, md/docx/PDF 다운로드 열림.
- [ ] **Step 4:** Commit `feat: chat UI with settings, load, download`

---

### Task 8: 설정 안내서 · 배포

**Files:**
- Create: `docs/setup-guide.md`, `README.md`

- [ ] **Step 1:** `docs/setup-guide.md`(아들용, 스크린샷 없이 번호 단계): ① 구글 시트 새로 만들기 ② 확장 프로그램 → Apps Script, `Code.gs` 붙여넣기 ③ 프로젝트 설정 → 스크립트 속성 `BAZE_API_KEY`, `LAW_OC` ④ 배포 → 새 배포 → 웹 앱, 실행: 나, 액세스: 모든 사용자 → 권한 승인 → URL 복사 ⑤ GitHub 저장소 생성·push, Settings → Pages → main/root ⑥ 아버지 컴퓨터·휴대폰에서 사이트 열고 설정에 URL 입력 ⑦ Code.gs 수정 시 "배포 관리 → 새 버전" 필요 ⑧ 문제 해결(주소 오류, 저장 실패).
- [ ] **Step 2:** `README.md` 한 화면 요약(무엇/구조/안내서 링크, 키를 커밋하지 말 것).
- [ ] **Step 3:** `git status`로 `.env` 미추적 확인, `grep -r` 로 키 문자열 미포함 확인.
- [ ] **Step 4:** Commit `docs: setup guide and README`
