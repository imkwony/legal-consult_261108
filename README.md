# 법률 상담

국가법령정보센터의 **실제 법령과 판례**를 찾아본 뒤, 근거와 함께 쉽게 설명해 주는 개인용 법률 상담 챗봇입니다.

- AI: BAZE API Gateway (기본 모델 `claude-sonnet-5-5`)
- 법률 자료: [korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp) 원격 서버 (판례·법령 검색, 조문·판결문 조회, 인용 검증)
- 상담 기록: 구글 스프레드시트 (저장, 불러오기)
- 다운로드: Markdown / Word / PDF
- 서류 입력: 텍스트 붙여넣기 또는 PDF (스캔본은 이미지 인식으로 읽음)

## 구조

```
브라우저 (GitHub Pages)
  ├─→ BAZE (본인 키를 넣은 경우 직접)
  └─→ Google Apps Script 웹앱
         ├─→ BAZE (소유자 키로 대신 호출)
         ├─→ korean-law-mcp (OC 키)
         └─→ 스프레드시트
```

## 설정
[설정 안내서](docs/setup-guide.md)를 따라 하세요.

## 개발
```bash
npm test
```

> ⚠️ API 키는 Apps Script의 스크립트 속성에만 넣습니다. `.env`는 로컬 확인용이며 커밋하지 않습니다.
>
> ⚠️ 이 사이트의 답변은 참고용입니다. 중요한 결정 전에는 변호사와 확인하세요.
