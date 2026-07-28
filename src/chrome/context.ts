// 확장 컨텍스트가 아직 유효한지(리로드·업데이트로 무효화되지 않았는지) 판정하는 가드
// 확장이 리로드/제거/업데이트되면 chrome.runtime.id 가 undefined 가 되고,
// 이 상태에서 chrome.* 를 호출하면 'Extension context invalidated' 가 던져진다.
// 이미 주입돼 돌던 content script·열려 있던 side panel 이 죽은 컨텍스트를 참조할 때 발생한다.
export function isExtensionContextValid(): boolean {
  return Boolean(chrome.runtime?.id);
}
