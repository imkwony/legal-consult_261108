# 기능 확인 결과 (2026-11-08, scripts/verify.mjs)

1. BAZE 모델 목록: 200 OK. Claude(sonnet-5-5, sonnet-5, opus-5-5, haiku-5-5 등), GPT, Gemini, Grok 등 다수.
2. 기본 모델: **claude-sonnet-5-5** (스크립트 규칙은 claude-sonnet-5를 골랐으나, 같은 중간 가격대의 최신 Sonnet인 5.5도 tool calling 확인되어 채택)
3. tool calling: **지원** (finish_reason `tool_calls`, OpenAI 형식 `tool_calls[].function.{name,arguments}`)
4. 이미지 입력(image_url data URI): **지원**
5. MCP tools: search_law, get_law_text, ordinance_radar, get_annexes, legal_research, legal_analysis, discover_tools, execute_tool, search_decisions, get_decision_text
6. OC 키로 search_decisions(precedent, "대여금"): **성공** (총 1224건)

→ Task 4b(고정 파이프라인)는 실행하지 않는다.
