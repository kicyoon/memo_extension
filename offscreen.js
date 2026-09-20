// background.js가 보내는 "play-chime" 메시지에 맞춰 알림음을 한 번 재생하고,
// 끝나면(또는 실패하면) 알려서 이 문서를 닫게 한다.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "play-chime") return;

  const audio = new Audio(chrome.runtime.getURL("sounds/chime.wav"));
  const done = (ok) => chrome.runtime.sendMessage({ type: "chime-done", ok });
  audio.addEventListener("ended", () => done(true));
  audio.addEventListener("error", () => done(false));
  audio.play().catch((error) => {
    console.error("알림음 재생 실패:", error);
    done(false);
  });
});
