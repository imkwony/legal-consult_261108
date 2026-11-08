// Apps Script 웹앱 호출. text/plain POST라 브라우저 사전요청(preflight)이 생기지 않는다.
export async function gasCall(scriptUrl, action, payload = {}, fetchFn = fetch) {
  let res;
  try {
    res = await fetchFn(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      redirect: 'follow',
    });
  } catch {
    throw new Error('구글 스크립트에 연결하지 못했어요. 인터넷 연결과 설정의 주소를 확인해 주세요.');
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error('구글 스크립트 응답이 올바르지 않아요. 설정의 주소를 확인해 주세요.');
  }
  if (!json.ok) throw new Error(json.error || '알 수 없는 오류');
  return json.data;
}
