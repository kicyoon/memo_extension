chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

/* ------------------------------------------------------------------ *
 * 메모별 시간 알림
 *
 * 사이드패널은 note.remindAt만 저장한다. 서비스 워커는 언제든 꺼질 수
 * 있으므로 setTimeout 대신 chrome.alarms를 쓰고, 알람은 메모마다 하나씩
 * "note:<id>"라는 이름으로 건다. 알람은 브라우저를 껐다 켜면 사라질 수
 * 있어서, 시작할 때와 메모가 바뀔 때마다 저장된 remindAt에 맞춰 다시 건다.
 * ------------------------------------------------------------------ */

const STORAGE_KEY = "notes";
const ALARM_PREFIX = "note:";

// remindAt이 있는 메모만 알람이 있게 맞춘다(추가·변경·삭제 모두 이 한 함수로).
// 과거 시각으로 create하면 곧바로 울리므로, 브라우저가 꺼져 있던 사이에 놓친
// 알림도 다음 시작 때 한 번 울린다.
async function syncAlarms() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const notes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const wanted = new Map(
    notes
      .filter((n) => Number.isFinite(n.remindAt))
      .map((n) => [ALARM_PREFIX + n.id, n.remindAt])
  );

  const existing = await chrome.alarms.getAll();
  for (const alarm of existing) {
    if (alarm.name.startsWith(ALARM_PREFIX) && !wanted.has(alarm.name)) {
      await chrome.alarms.clear(alarm.name);
    }
  }
  for (const [name, when] of wanted) {
    const current = existing.find((a) => a.name === name);
    if (!current || current.scheduledTime !== when) {
      await chrome.alarms.create(name, { when });
    }
  }
}

// 본문은 <div>/<b>/<font> 등이 섞인 HTML이라 알림 문구용으로 글자만 뽑는다.
// 서비스 워커에는 DOM이 없어 정규식으로 처리한다(저장 형식이 우리가 직렬화한
// 단순한 태그뿐이라 이걸로 충분하다). 1.0.2 이전의 순수 텍스트 메모는 그대로 쓴다.
function notePreview(note) {
  let text = note.content || "";
  if (note.format === "html") {
    text = text
      .replace(/<\/div>\s*<div>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }
  text = text.trim();
  return text.length > 120 ? text.slice(0, 120) + "…" : text;
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);

  const result = await chrome.storage.local.get(STORAGE_KEY);
  const notes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const note = notes.find((n) => n.id === id);
  // 그 사이 메모가 지워졌거나 알림 시각이 바뀌었다면(더 늦게 옮긴 경우 등)
  // 이 알람은 낡은 것이다.
  if (!note || !Number.isFinite(note.remindAt) || note.remindAt > Date.now() + 1000) {
    return;
  }

  // 알림은 한 번만 울리므로 먼저 소진 처리한다.
  delete note.remindAt;
  await chrome.storage.local.set({ [STORAGE_KEY]: notes });

  chrome.notifications.create(`${ALARM_PREFIX}${id}:${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: note.title || "메모 알림",
    message: notePreview(note) || "알림 시각이 되었어요.",
    // 자리를 비운 사이에 울려도 놓치지 않도록 직접 닫을 때까지 남겨 둔다.
    requireInteraction: true,
    // 알림창 자체의 소리는 쓰지 않는다. Windows에서 chrome.notifications는
    // OS 토스트가 아니라 Chrome 자체 알림창으로 뜨는 경우가 있고, 그때는
    // silent:false여도 소리가 나지 않는다. 소리는 아래에서 직접 재생한다.
    silent: true,
  });

  // 메모마다 정한 소리 설정. 값이 없는 메모는 소리가 켜진 것으로 본다.
  if (note.remindSound !== false) playChime();
});

/* ------------------------------------------------------------------ *
 * 알림음 재생
 *
 * 서비스 워커에는 오디오가 없으므로 offscreen 문서(AUDIO_PLAYBACK)를 잠깐
 * 띄워 재생하고, 끝나면 닫는다. 문서는 하나만 만들 수 있어서, 알림이 연달아
 * 울릴 때는 이미 있는 문서에 메시지만 다시 보낸다.
 * ------------------------------------------------------------------ */

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return contexts.length > 0;
}

async function playChime() {
  try {
    if (!(await hasOffscreenDocument())) {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "메모 알림 시각에 알림음을 재생하기 위해 필요합니다.",
      });
    }
    await chrome.runtime.sendMessage({ type: "play-chime" });
  } catch (error) {
    console.error("알림음을 재생하지 못했습니다:", error);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "chime-done") {
    chrome.offscreen.closeDocument().catch(() => {});
  }
});

// 사이드패널이 직접 외부 서버를 호출하지 않도록 서비스 워커가 코스피 시세를
// 가져온다. 네이버 증권 페이지가 실제로 사용하는 공개 JSON 응답이다.
const KOSPI_API_URL =
  "https://stock.naver.com/api/securityFe/api/index/KOSPI/basic";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "get-kospi") return;

  fetch(KOSPI_API_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (
        typeof data.closePrice !== "string" ||
        typeof data.compareToPreviousClosePrice !== "string" ||
        typeof data.fluctuationsRatio !== "string"
      ) {
        throw new Error("코스피 응답 형식이 올바르지 않습니다");
      }
      sendResponse({
        ok: true,
        closePrice: data.closePrice,
        change: data.compareToPreviousClosePrice,
        changeType: data.compareToPreviousPrice?.name,
        changeText: data.compareToPreviousPrice?.text,
        ratio: data.fluctuationsRatio,
        marketStatus: data.marketStatus,
        tradedAt: data.localTradedAt,
      });
    })
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  // 비동기 fetch가 끝난 뒤에도 sendResponse 채널을 유지한다.
  return true;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) syncAlarms();
});

// 서비스 워커가 브라우저 시작 때 깨어나도록 리스너를 등록해 둔다.
chrome.runtime.onStartup.addListener(syncAlarms);
chrome.runtime.onInstalled.addListener(syncAlarms);
syncAlarms();
