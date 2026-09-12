const COLORS = [
  "#FFF59D", // 노랑
  "#FFCC80", // 주황
  "#F8BBD0", // 분홍
  "#C8E6C9", // 초록
  "#BBDEFB", // 파랑
  "#E1BEE7", // 보라
];

// 다크모드에서 파스텔 원색을 그대로 쓰면 눈이 아프고 본문 글자가 묻힌다.
// note.color에는 위 COLORS의 값(그 메모의 색 정체성)을 그대로 저장하고,
// 화면에 칠할 때만 테마에 맞는 값으로 바꿔 쓴다. 그래서 테마를 오가도
// 저장된 데이터는 변하지 않고, 기존 메모도 그대로 호환된다.
const DARK_COLORS = {
  "#FFF59D": "#5C5320", // 노랑
  "#FFCC80": "#5F4522", // 주황
  "#F8BBD0": "#5C2F3E", // 분홍
  "#C8E6C9": "#2D4A30", // 초록
  "#BBDEFB": "#27405C", // 파랑
  "#E1BEE7": "#4A2F52", // 보라
};

const STORAGE_KEY = "notes";
const THEME_KEY = "theme";

// 순환 순서 겸 유효값 목록.
const THEMES = ["system", "light", "dark"];

// 이모지 대신 선 아이콘을 쓴다. 이모지는 폰트마다 모양과 색이 제각각이라
// 옆의 + 버튼과 따로 놀고, currentColor를 따르지 않아 테마가 바뀌어도 색이
// 그대로다. 아래 아이콘들은 선 굵기(2)와 크기(16)를 sidepanel.html의 +
// 아이콘과 맞춰 두 버튼이 한 벌로 보이게 했다.
const svgIcon = (body) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" ` +
  `stroke="currentColor" stroke-width="2" stroke-linecap="round" ` +
  `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const THEME_LABELS = {
  // 반쯤 칠한 원 — 시스템을 따라간다는 뜻
  system: {
    name: "시스템 설정",
    icon: svgIcon(
      `<circle cx="12" cy="12" r="8.2" />` +
        `<path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none" />`
    ),
  },
  light: {
    name: "라이트",
    icon: svgIcon(
      `<circle cx="12" cy="12" r="4.1" />` +
        `<path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2` +
        `M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9L5.5 5.5" />`
    ),
  },
  dark: {
    name: "다크",
    icon: svgIcon(`<path d="M20.3 13.4A8.3 8.3 0 0 1 10.6 3.7a8.3 8.3 0 1 0 9.7 9.7z" />`),
  },
};

const listEl = document.getElementById("notes-list");
const emptyStateEl = document.getElementById("empty-state");
const addBtn = document.getElementById("add-note-btn");
const themeBtn = document.getElementById("theme-btn");
const template = document.getElementById("note-template");
const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");

let notes = [];
let themeSetting = "system";
const saveTimers = new Map();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ *
 * 색 계산
 * ------------------------------------------------------------------ */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const h =
    m[1].length === 3
      ? m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]
      : m[1];
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// DARK_COLORS의 키가 대문자 표기라, 색상 선택기가 돌려주는 소문자 값과
// 섞이면 같은 색을 서로 다른 색으로 취급하게 된다. 항상 이 표기로 맞춘다.
function normalizeHex(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (
    "#" +
    [rgb.r, rgb.g, rgb.b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h, s, l };
}

function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// 사용자가 직접 고른 색에도 기본 6색과 같은 규칙을 적용해 다크모드 짝을
// 만든다. 계수는 위 DARK_COLORS의 실측값에서 역산했다(채도 절반, 명도는
// 0.16~0.28의 좁은 띠).
//
// 명도를 24.5% 한 값으로 고정하지 않고 원래 명도를 그 띠에 눌러 담는 이유는
// 무채색 때문이다. 고정하면 흰색·회색·검정이 전부 같은 색으로 뭉쳐 버린다.
// 채도에 하한을 두지 않는 것도 같은 이유다 — 하한이 있으면 색상값이 없는
// 회색이 색상 0(빨강) 쪽으로 끌려가 불그스름해진다.
function deriveDarkColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const { h, s, l } = rgbToHsl(rgb);
  return hslToHex(h, Math.min(s * 0.5, 0.5), 0.16 + l * 0.12);
}

// 임의의 색 위에서도 글자가 읽히도록 배경 밝기를 재서 잉크 색을 뒤집는다.
// 기본 6색만 있을 때는 테마별 고정값으로 충분했지만, 이제는 사용자가 어두운
// 색을 라이트모드에서 고를 수도 있다.
function isDarkColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b) < 0.4;
}

/* ------------------------------------------------------------------ *
 * 본문(서식 있는 텍스트) 모델
 *
 * 브라우저가 contenteditable 안에 만들어 두는 DOM은 제각각이다. 같은
 * 줄바꿈이 <br>이기도 <div>이기도 하고, 굵게가 <b>이기도 <span style>이기도
 * 하다. 그래서 DOM을 그대로 저장하지 않고 항상 "줄 배열 × {text, bold} 조각"
 * 이라는 한 가지 모델로 환산한 뒤, 우리가 정한 형태(<div>/<b>)로만
 * 직렬화한다. 덕분에 저장 형식이 안정되고, 바깥에서 들어온 HTML도 이 과정을
 * 지나며 걸러진다.
 * ------------------------------------------------------------------ */

const BOLD_TAGS = new Set(["B", "STRONG"]);
const BLOCK_TAGS = new Set([
  "DIV",
  "P",
  "LI",
  "TR",
  "BLOCKQUOTE",
  "PRE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

function isBoldElement(el) {
  if (BOLD_TAGS.has(el.tagName)) return true;
  const weight = el.style && el.style.fontWeight;
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  return parseInt(weight, 10) >= 600;
}

// 블록 끝의 <br>은 빈 줄을 지탱하려고 브라우저가 넣어 둔 것이라 줄로 세지 않는다.
function isTrailingNode(siblings, index) {
  for (let i = index + 1; i < siblings.length; i++) {
    const node = siblings[i];
    if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim()) continue;
    return false;
  }
  return true;
}

function htmlToLines(root) {
  const lines = [];
  let run = [];
  let boldDepth = 0;
  // "지금 줄이 시작되긴 했다"는 표시. 글자가 하나도 없는 마지막 빈 줄을
  // 살리는 데 쓴다 — filler <br>만 있는 줄은 run이 비어 있어서, 이 표시가
  // 없으면 마지막에 통째로 버려진다.
  let lineOpen = false;

  const endLine = () => {
    lines.push(run);
    run = [];
    lineOpen = false;
  };

  const pushText = (text) => {
    if (!text) return;
    const bold = boldDepth > 0;
    const last = run[run.length - 1];
    if (last && last.bold === bold) last.text += text;
    else run.push({ text, bold });
    lineOpen = true;
  };

  const walk = (node) => {
    const kids = [...node.childNodes];
    kids.forEach((child, i) => {
      if (child.nodeType === Node.TEXT_NODE) {
        // contenteditable은 공백을 자주 &nbsp;로 바꿔 놓는다. 저장할 때는
        // 평범한 공백으로 되돌려야 다른 곳에 붙여넣었을 때 자연스럽다.
        pushText(child.nodeValue.replace(/ /g, " "));
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      if (child.tagName === "BR") {
        // 끝의 filler <br>은 새 줄을 만들지는 않지만, 자기가 놓인 줄이
        // 존재한다는 사실은 알려 준다.
        if (isTrailingNode(kids, i)) lineOpen = true;
        else endLine();
        return;
      }

      const isBlock = BLOCK_TAGS.has(child.tagName);
      if (isBlock && run.length) endLine();

      const bold = isBoldElement(child);
      if (bold) boldDepth++;
      walk(child);
      if (bold) boldDepth--;

      if (isBlock) endLine();
    });
  };

  walk(root);
  if (run.length || lineOpen) endLine();
  return lines.length ? lines : [[]];
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linesToText(lines) {
  return lines.map((runs) => runs.map((r) => r.text).join("")).join("\n");
}

function linesToHtml(lines) {
  return lines
    .map((runs) => {
      const inner = runs.length
        ? runs
            .map((r) =>
              r.bold ? `<b>${escapeHtml(r.text)}</b>` : escapeHtml(r.text)
            )
            .join("")
        : "<br>";
      return `<div>${inner}</div>`;
    })
    .join("");
}

// 내용이 아예 비면 빈 문자열로 저장한다. 그래야 비었는지 판정이 단순해지고,
// 예전 순수 텍스트 메모와도 값이 같아진다.
function serializeLines(lines) {
  return linesToText(lines).length ? linesToHtml(lines) : "";
}

// 바깥에서 들어온 HTML을 우리 모델에 한 번 통과시켜 안전한 형태만 남긴다.
// DOMParser는 스크립트를 실행하지도, 이미지를 불러오지도 않는다.
function sanitizeContent(html) {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><body>${html}`,
    "text/html"
  );
  return serializeLines(htmlToLines(doc.body));
}

function plainToHtml(text) {
  return serializeLines(
    String(text)
      .split("\n")
      .map((line) => (line ? [{ text: line, bold: false }] : []))
  );
}

// 1.0.2까지 본문은 순수 텍스트였다. format 표시가 없는 메모는 그 시절
// 데이터로 보고 읽을 때만 HTML로 바꿔 준다. 저장은 사용자가 그 메모를 실제로
// 고칠 때 일어나므로, 손대지 않은 옛 메모는 원본 그대로 남는다.
function contentHtml(note) {
  const raw = note.content || "";
  return note.format === "html" ? sanitizeContent(raw) : plainToHtml(raw);
}

/* ------------------------------------------------------------------ *
 * 필드 값 읽기/쓰기
 *
 * 제목은 <input>(el.value), 본문은 contenteditable(직렬화한 HTML)이라
 * 읽고 쓰는 법이 다르다. 아래 두 함수가 그 차이를 감춰서, 힘들게 잡아 둔
 * IME 보정 로직(bindEditableField)을 두 필드에 그대로 쓸 수 있다.
 * ------------------------------------------------------------------ */

function fieldValue(el) {
  return el.isContentEditable ? serializeLines(htmlToLines(el)) : el.value;
}

function setFieldValue(el, value) {
  if (!el.isContentEditable) {
    el.value = value;
    return;
  }
  el.innerHTML = value;
  refreshBlankState(el);
}

// contenteditable에는 placeholder 속성이 없다. 비었을 때만 CSS가 안내문을
// 그리도록 클래스를 붙여 준다.
function refreshBlankState(el) {
  el.classList.toggle("is-blank", el.textContent.length === 0);
}

/* ------------------------------------------------------------------ *
 * contenteditable 캐럿 위치 (selectionStart 대용)
 * ------------------------------------------------------------------ */

// 캐럿 앞쪽 내용을 본문과 똑같은 규칙으로 직렬화해서 "앞에 놓인 글자 수"로
// 환산한다. 줄바꿈도 한 글자로 세므로 setCaretOffset과 계산이 맞아떨어진다.
function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(el);
  before.setEnd(range.endContainer, range.endOffset);
  const holder = document.createElement("div");
  holder.appendChild(before.cloneContents());
  return linesToText(htmlToLines(holder)).length;
}

function placeCaret(lineEl, offset) {
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node = walker.nextNode();
  let remaining = offset;

  if (!node) {
    range.selectNodeContents(lineEl); // 빈 줄(<div><br></div>)
  } else {
    for (;;) {
      if (remaining <= node.nodeValue.length) {
        range.setStart(node, remaining);
        break;
      }
      remaining -= node.nodeValue.length;
      const next = walker.nextNode();
      if (!next) {
        range.setStart(node, node.nodeValue.length);
        break;
      }
      node = next;
    }
  }

  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function setCaretOffset(el, offset) {
  const lineEls = [...el.children].filter((c) => c.tagName === "DIV");
  const lines = lineEls.length ? lineEls : [el];
  let remaining = Math.max(0, offset);
  for (let i = 0; i < lines.length; i++) {
    const len = lines[i].textContent.length;
    if (remaining <= len || i === lines.length - 1) {
      placeCaret(lines[i], Math.min(remaining, len));
      return;
    }
    remaining -= len + 1; // 줄바꿈 한 글자
  }
}

/* ------------------------------------------------------------------ *
 * 저장 / 테마
 * ------------------------------------------------------------------ */

function loadNotes() {
  chrome.storage.local.get([STORAGE_KEY, THEME_KEY], (result) => {
    // 흰 화면이 번쩍이지 않도록 메모를 그리기 전에 테마부터 확정한다.
    themeSetting = THEMES.includes(result[THEME_KEY])
      ? result[THEME_KEY]
      : "system";
    applyTheme();
    notes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    render();
  });
}

function persist() {
  chrome.storage.local.set({ [STORAGE_KEY]: notes });
}

// "system"이면 OS 설정을 따라 실제 테마를 정한다.
function resolvedTheme() {
  if (themeSetting === "dark") return "dark";
  if (themeSetting === "light") return "light";
  return darkMedia.matches ? "dark" : "light";
}

// 저장된 색을 지금 테마에서 화면에 칠할 색으로 바꾼다. 기본 6색은 손으로
// 고른 짝이 있고, 사용자가 직접 고른 색은 같은 규칙으로 계산해서 쓴다.
function paintColor(color) {
  const hex = normalizeHex(color) || COLORS[0];
  if (resolvedTheme() !== "dark") return hex;
  return DARK_COLORS[hex] || deriveDarkColor(hex);
}

function paintNote(noteEl, color) {
  const painted = paintColor(color);
  noteEl.style.background = painted;
  noteEl.classList.toggle("note-on-dark", isDarkColor(painted));
}

// 테마가 바뀌었을 때 이미 그려진 메모들의 색만 갈아끼운다. render()로
// 통째로 다시 그리면 입력 중이던 커서와 포커스가 날아가므로 쓰지 않는다.
function repaintNoteColors() {
  listEl.querySelectorAll(".note").forEach((noteEl) => {
    const note = notes.find((n) => n.id === noteEl.dataset.id);
    if (note) {
      paintNote(noteEl, note.color);
      const custom = noteEl.querySelector(".swatch-custom.active");
      if (custom) custom.style.background = paintColor(note.color);
    }
    noteEl.querySelectorAll(".swatch[data-color]").forEach((swatch) => {
      swatch.style.background = paintColor(swatch.dataset.color);
    });
  });
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme();
  const { icon, name } = THEME_LABELS[themeSetting];
  const next =
    THEME_LABELS[THEMES[(THEMES.indexOf(themeSetting) + 1) % THEMES.length]];
  themeBtn.innerHTML = icon;
  themeBtn.title = `테마: ${name} (클릭하면 ${next.name})`;
  themeBtn.setAttribute("aria-label", `테마: ${name}. 클릭하면 ${next.name}`);
  repaintNoteColors();
}

function cycleTheme() {
  themeSetting = THEMES[(THEMES.indexOf(themeSetting) + 1) % THEMES.length];
  chrome.storage.local.set({ [THEME_KEY]: themeSetting });
  applyTheme();
}

// "시스템 설정"일 때 OS 쪽에서 다크/라이트가 바뀌면 즉시 따라간다.
darkMedia.addEventListener("change", () => {
  if (themeSetting === "system") applyTheme();
});

// 화면(DOM)에 떠 있는 값과 메모리의 notes가 어긋났는지 본다. blur 이후
// 안전망으로 render()를 부를지 판단하는 용도 — 어긋난 게 없으면 굳이 DOM을
// 새로 만들지 않는다(불필요하게 커서/포커스를 날리지 않기 위해).
function domDivergesFromNotes() {
  return [...listEl.querySelectorAll(".note")].some((noteEl) => {
    const n = notes.find((x) => x.id === noteEl.dataset.id);
    if (!n) return true;
    const t = noteEl.querySelector(".note-title");
    const c = noteEl.querySelector(".note-content");
    return (t && t.value !== n.title) || (c && fieldValue(c) !== contentHtml(n));
  });
}

// 포커스가 패널 밖(브라우저 탭 등)으로 나가도 document.activeElement는
// 그대로 그 input에 남아 있다. hasFocus()를 같이 봐야 "지금 이 패널 안에서
// 편집 중"인지 판별된다. 이게 없으면 blur 뒤 복구용 render가 통째로 걸러진다.
function isEditingAnyNote() {
  if (!document.hasFocus()) return false;
  const active = document.activeElement;
  return !!(active && active.closest && active.closest(".note"));
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;

  // 창이 여러 개 열려 있을 때 한쪽에서 바꾼 테마를 나머지도 따라간다.
  if (changes[THEME_KEY]) {
    const incomingTheme = changes[THEME_KEY].newValue;
    if (THEMES.includes(incomingTheme) && incomingTheme !== themeSetting) {
      themeSetting = incomingTheme;
      applyTheme();
    }
  }

  if (!changes[STORAGE_KEY]) return;
  const incoming = changes[STORAGE_KEY].newValue || [];
  if (isEditingAnyNote()) {
    notes = incoming;
    return;
  }
  notes = incoming;
  render();
});

function addNote() {
  const note = {
    id: uid(),
    title: "",
    content: "",
    format: "html",
    color: COLORS[0],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  notes.unshift(note);
  persist();
  render();
  const firstTitle = listEl.querySelector(".note .note-title");
  if (firstTitle) firstTitle.focus();
}

function deleteNote(id) {
  notes = notes.filter((n) => n.id !== id);
  persist();
  render();
}

function updateNote(id, patch, { debounce = false } = {}) {
  const note = notes.find((n) => n.id === id);
  if (!note) return;
  // 본문을 쓰는 순간 그 메모는 HTML 형식으로 승격된다(옛 메모 호환 처리).
  const next = "content" in patch ? { ...patch, format: "html" } : patch;
  Object.assign(note, next, { updatedAt: Date.now() });

  clearTimeout(saveTimers.get(id));
  if (!debounce) {
    persist();
    return;
  }
  saveTimers.set(
    id,
    setTimeout(() => persist(), 300)
  );
}

// blur가 발생하는 바로 그 순간의 값은 이미 조합 중이던 글자까지 정확히
// 포함하고 있다. 문제는 그 이후다 — 패널 밖으로 포커스가 나가면 브라우저가
// 뒤늦게 조합 정리를 위해 compositionend와 deleteContentBackward를 발생시켜
// DOM 값을 건드린다. 그래서 blur 시점의 값을 그대로 신뢰해 저장하고,
// 그 뒤 (포커스 없는 상태에서) 도착하는 변경은 화면만 되돌린다.
//
// 되돌릴 기준값으로 note[field]를 쓰면 안 된다. persist()마다
// storage.onChanged가 notes 배열을 통째로 새 객체로 갈아치우기 때문에,
// 이 클로저가 붙들고 있는 note는 곧 고아가 되어 마지막 render 시점 값에
// 얼어붙는다. 그 죽은 값으로 되돌리면 멀쩡한 글자가 지워진다(원래 버그).
// 그래서 정상 입력마다 직접 갱신하는 lastGoodValue를 기준으로 삼는다.
function bindEditableField(el, note, field, onAfterChange) {
  let focused = false;
  let lastGoodValue = fieldValue(el);

  el.addEventListener("focus", () => {
    focused = true;
    lastGoodValue = fieldValue(el);
  });

  // 포커스가 없는 상태에서 도착한 변경을 화면에서 되돌린다.
  const revertIfStray = () => {
    if (fieldValue(el) === lastGoodValue) return;
    setFieldValue(el, lastGoodValue);
    if (onAfterChange) onAfterChange();
  };

  el.addEventListener("compositionend", () => {
    if (!focused) {
      revertIfStray();
      return;
    }
    if (onAfterChange) onAfterChange();
    lastGoodValue = fieldValue(el);
    updateNote(note.id, { [field]: lastGoodValue });
  });

  el.addEventListener("input", (e) => {
    if (!focused) {
      revertIfStray();
      return;
    }
    if (onAfterChange) onAfterChange();
    if (e.inputType === "deleteCompositionText") return;
    lastGoodValue = fieldValue(el);
    updateNote(note.id, { [field]: lastGoodValue }, { debounce: true });
  });

  el.addEventListener("blur", () => {
    focused = false;
    // blur 시점의 값은 조합 중이던 글자까지 온전히 담고 있다(실측).
    lastGoodValue = fieldValue(el);
    updateNote(note.id, { [field]: lastGoodValue });
    // 조합 정리로 DOM이 건드려진 건 위 revertIfStray가 되돌린다. 이 rAF는
    // 그걸로도 안 잡힌 어긋남이 남았을 때만 도는 마지막 안전망이다.
    // 어긋남이 없으면 render를 건너뛴다 — 다른 앱에 갔다 왔을 뿐인데
    // DOM을 새로 만들어 커서를 날려버리지 않기 위해서다.
    requestAnimationFrame(() => {
      if (!isEditingAnyNote() && domDivergesFromNotes()) render();
    });
  });

  // Ctrl+B처럼 우리가 직접 DOM을 바꾼 뒤, 그 결과를 "정상 입력"으로
  // 인정받게 한다. 이걸 부르지 않으면 lastGoodValue가 옛 값에 머물러 있다가
  // revertIfStray가 방금 넣은 서식을 되돌려 버린다.
  return {
    commit() {
      lastGoodValue = fieldValue(el);
      updateNote(note.id, { [field]: lastGoodValue });
    },
  };
}

function createNoteElement(note) {
  const fragment = template.content.cloneNode(true);
  const noteEl = fragment.querySelector(".note");
  const handle = fragment.querySelector(".note-handle");
  const titleInput = fragment.querySelector(".note-title");
  const contentArea = fragment.querySelector(".note-content");
  const deleteBtn = fragment.querySelector(".note-delete");
  const swatchesEl = fragment.querySelector(".color-swatches");
  const dateEl = fragment.querySelector(".note-date");

  noteEl.dataset.id = note.id;
  paintNote(noteEl, note.color);
  titleInput.value = note.title;
  setFieldValue(contentArea, contentHtml(note));
  dateEl.textContent = formatDate(note.updatedAt);

  titleInput.addEventListener("focus", () => {
    titleInput.spellcheck = true;
  });
  titleInput.addEventListener("blur", () => {
    titleInput.spellcheck = false;
  });
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      contentArea.focus();
    }
  });
  bindEditableField(titleInput, note, "title");

  contentArea.addEventListener("focus", () => {
    contentArea.spellcheck = true;
  });
  contentArea.addEventListener("blur", () => {
    contentArea.spellcheck = false;
  });
  const contentField = bindEditableField(contentArea, note, "content", () =>
    refreshBlankState(contentArea)
  );

  // Ctrl+B(맥은 ⌘B)로 선택한 글자를 굵게. e.code를 함께 보는 이유는 한글
  // 입력 상태에서 e.key가 자판 위치가 아니라 글자로 오는 경우가 있어서다.
  contentArea.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.code !== "KeyB" && e.key !== "b" && e.key !== "B") return;
    e.preventDefault();
    // 조합 중에 서식을 건드리면 IME가 만들던 글자가 깨진다. 조합이 끝난
    // 뒤에 다시 누르게 두는 편이 안전하다.
    if (e.isComposing) return;
    document.execCommand("bold");
    refreshBlankState(contentArea);
    contentField.commit();
  });

  // 붙여넣기는 글자만 받는다. 바깥 HTML을 그대로 들이면 우리 모델이 버리는
  // 서식이 섞여 들어와, 붙여넣은 직후 화면과 저장된 값이 달라진다.
  contentArea.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (text) document.execCommand("insertText", false, text);
  });

  handle.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", note.id);
    e.dataTransfer.setDragImage(noteEl, 20, 20);
    noteEl.classList.add("dragging");
  });

  handle.addEventListener("dragend", () => {
    noteEl.classList.remove("dragging");
    syncOrderFromDOM();
  });

  deleteBtn.addEventListener("click", () => {
    if (confirm("이 메모를 삭제할까요?")) {
      deleteNote(note.id);
    }
  });

  buildSwatches(swatchesEl, noteEl, note);

  return fragment;
}

// 기본 6색 + 직접 고르기. 직접 고른 색도 note.color에 그대로 들어가므로
// 기본색과 저장 구조가 같고, 다크모드 짝만 계산해서 쓴다.
function buildSwatches(swatchesEl, noteEl, note) {
  const customLabel = document.createElement("label");
  customLabel.className = "swatch swatch-custom";
  customLabel.title = "직접 색 고르기";

  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.className = "swatch-input";
  customInput.setAttribute("aria-label", "메모 색 직접 고르기");
  customLabel.appendChild(customInput);

  const applyColor = (color, options) => {
    paintNote(noteEl, color);
    swatchesEl
      .querySelectorAll(".swatch")
      .forEach((s) => s.classList.remove("active"));

    const preset = swatchesEl.querySelector(`.swatch[data-color="${color}"]`);
    if (preset) {
      preset.classList.add("active");
      customLabel.style.background = ""; // 무지개 표시로 되돌린다
    } else {
      customLabel.classList.add("active");
      customLabel.style.background = paintColor(color);
    }
    customInput.value = color.toLowerCase();
    if (options) updateNote(note.id, { color }, options);
  };

  COLORS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.dataset.color = color;
    swatch.style.background = paintColor(color);
    swatch.title = "색상 변경";
    swatch.addEventListener("click", () => applyColor(color, {}));
    swatchesEl.appendChild(swatch);
  });

  swatchesEl.appendChild(customLabel);

  // input은 색을 고르는 동안 계속 오고(미리보기), change는 확정될 때 한 번
  // 온다. 미리보기 단계의 저장만 묶어서 늦춘다.
  customInput.addEventListener("input", () => {
    const color = normalizeHex(customInput.value);
    if (color) applyColor(color, { debounce: true });
  });
  customInput.addEventListener("change", () => {
    const color = normalizeHex(customInput.value);
    if (color) applyColor(color, {});
  });

  // 처음 그릴 때는 화면만 맞추고 저장은 하지 않는다(updatedAt이 튀지 않게).
  applyColor(normalizeHex(note.color) || COLORS[0], null);
}

function render() {
  const active = document.activeElement;
  const focusedNote = active && active.closest ? active.closest(".note") : null;
  const focusedId = focusedNote ? focusedNote.dataset.id : null;
  const focusedField = active?.classList?.contains("note-title")
    ? "title"
    : active?.classList?.contains("note-content")
    ? "content"
    : null;
  const caret =
    focusedField === "title"
      ? { start: active.selectionStart, end: active.selectionEnd }
      : focusedField === "content"
      ? { offset: caretOffset(active) }
      : null;

  listEl.innerHTML = "";
  emptyStateEl.hidden = notes.length > 0;

  notes.forEach((note) => {
    listEl.appendChild(createNoteElement(note));
  });

  // 패널이 포커스를 갖고 있지 않은데 focus()를 부르면, 사용자가 브라우저
  // 쪽으로 옮겨간 포커스를 도로 뺏어온다. activeElement는 창 밖으로 나간
  // 뒤에도 남아 있으므로 hasFocus()로 한 번 더 걸러야 한다.
  if (focusedId && focusedField && document.hasFocus()) {
    const selector = `.note[data-id="${focusedId}"] .note-${focusedField}`;
    const el = listEl.querySelector(selector);
    if (el) {
      el.focus();
      if (caret && typeof caret.start === "number" && el.setSelectionRange) {
        el.setSelectionRange(caret.start, caret.end);
      } else if (caret && typeof caret.offset === "number") {
        setCaretOffset(el, caret.offset);
      }
    }
  }
}

function getDragAfterElement(container, y) {
  const candidates = [...container.querySelectorAll(".note:not(.dragging)")];
  return candidates.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

function syncOrderFromDOM() {
  const orderedIds = [...listEl.querySelectorAll(".note")].map(
    (el) => el.dataset.id
  );
  notes = orderedIds.map((id) => notes.find((n) => n.id === id)).filter(Boolean);
  persist();
}

listEl.addEventListener("dragover", (e) => {
  const dragging = listEl.querySelector(".note.dragging");
  if (!dragging) return;
  e.preventDefault();
  const afterElement = getDragAfterElement(listEl, e.clientY);
  if (afterElement == null) {
    listEl.appendChild(dragging);
  } else {
    listEl.insertBefore(dragging, afterElement);
  }
});

listEl.addEventListener("drop", (e) => {
  e.preventDefault();
});

addBtn.addEventListener("click", addNote);
themeBtn.addEventListener("click", cycleTheme);

// 굵게를 <span style="font-weight:bold">가 아니라 <b>로 만들게 하고, 줄바꿈을
// <div>로 통일한다. 어차피 저장할 때 우리 모델을 거치지만, 편집 중 DOM이
// 단순할수록 캐럿 계산과 되돌리기가 덜 헷갈린다.
document.execCommand("styleWithCSS", false, false);
document.execCommand("defaultParagraphSeparator", false, "div");

loadNotes();
