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

// 글자색 팝오버의 기본 팔레트. 배경색(COLORS)과 달리 잉크로 쓸 색이라
// 채도를 낮추지 않고 그대로 쓴다.
const TEXT_COLORS = ["#E03131", "#E8590C", "#2F9E44", "#1971C2", "#9C36B5", "#343A40"];

// Ctrl(맥은 ⌘) + 이 키로 선택 글자에 서식을 건다. e.code(물리 키 위치)를
// 기준으로 삼아야 한글 입력 상태에서도 같은 키가 같은 서식으로 이어진다.
const FORMAT_SHORTCUTS = { KeyB: "bold", KeyI: "italic", KeyU: "underline" };

const STORAGE_KEY = "notes";
const THEME_KEY = "theme";
const DAILY_TYPE_KEY = "dailyType";
const DAILY_TYPES = ["idiom", "quote", "date", "kospi"];

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
let dailyType = "idiom";
const saveTimers = new Map();

// 각 메모의 contentArea(DOM)에서 그 메모의 bindEditableField().commit을
// 곧장 찾기 위한 표. 글씨체 팝오버는 어떤 메모를 편집 중이었는지 모르는
// 채로 시작하므로, 이 표가 없으면 서식을 건 뒤 저장할 방법이 없다.
const contentFieldByArea = new WeakMap();

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
const ITALIC_TAGS = new Set(["I", "EM"]);
const UNDERLINE_TAGS = new Set(["U"]);
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

function isItalicElement(el) {
  if (ITALIC_TAGS.has(el.tagName)) return true;
  const style = el.style && el.style.fontStyle;
  return style === "italic" || style === "oblique";
}

function isUnderlineElement(el) {
  if (UNDERLINE_TAGS.has(el.tagName)) return true;
  const style = el.style && (el.style.textDecorationLine || el.style.textDecoration);
  return !!style && style.includes("underline");
}

// 브라우저가 돌려주는 "rgb(r, g, b)"/"rgba(r, g, b, a)" 형태를 우리 모델의
// 헥스로 바꾼다. style.color, getComputedStyle().color, queryCommandValue
// ("foreColor")가 전부 이 형태라 여러 곳에서 같이 쓴다.
function cssColorToHex(css) {
  if (!css) return null;
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  if (m) {
    const hex = "#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
    return normalizeHex(hex);
  }
  return normalizeHex(css);
}

// execCommand("foreColor")는 <font color>를 만들고, 바깥에서 붙여넣은
// HTML은 style.color를 쓸 수 있다.
function elementColor(el) {
  if (el.tagName === "FONT" && el.hasAttribute("color")) {
    return normalizeHex(el.getAttribute("color"));
  }
  return el.style ? cssColorToHex(el.style.color) : null;
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
  let italicDepth = 0;
  let underlineDepth = 0;
  // 굵게/기울임/밑줄과 달리 색은 단순 on/off가 아니라 값이라 depth 대신
  // 스택을 쓴다. 지금 유효한 색은 항상 스택 맨 위(가장 안쪽 <font>) 값이다.
  const colorStack = [];
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
    const italic = italicDepth > 0;
    const underline = underlineDepth > 0;
    const color = colorStack.length ? colorStack[colorStack.length - 1] : null;
    const last = run[run.length - 1];
    if (
      last &&
      last.bold === bold &&
      last.italic === italic &&
      last.underline === underline &&
      last.color === color
    ) {
      last.text += text;
    } else {
      run.push({ text, bold, italic, underline, color });
    }
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
      const italic = isItalicElement(child);
      const underline = isUnderlineElement(child);
      const color = elementColor(child);
      if (bold) boldDepth++;
      if (italic) italicDepth++;
      if (underline) underlineDepth++;
      if (color) colorStack.push(color);
      walk(child);
      if (bold) boldDepth--;
      if (italic) italicDepth--;
      if (underline) underlineDepth--;
      if (color) colorStack.pop();

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

// 서식은 색(font) > 굵게(b) > 기울임(i) > 밑줄(u) 순으로 감싼다. 중첩
// 순서 자체는 렌더링에 영향이 없지만, 순서를 고정해야 직렬화 결과가
// 항상 같은 모양으로 나온다.
function runToHtml(r) {
  let html = escapeHtml(r.text);
  if (r.underline) html = `<u>${html}</u>`;
  if (r.italic) html = `<i>${html}</i>`;
  if (r.bold) html = `<b>${html}</b>`;
  if (r.color) html = `<font color="${r.color}">${html}</font>`;
  return html;
}

function linesToHtml(lines) {
  return lines
    .map((runs) => {
      const inner = runs.length ? runs.map(runToHtml).join("") : "<br>";
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
      .map((line) =>
        line
          ? [{ text: line, bold: false, italic: false, underline: false, color: null }]
          : []
      )
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
  chrome.storage.local.get([STORAGE_KEY, THEME_KEY, DAILY_TYPE_KEY], (result) => {
    // 흰 화면이 번쩍이지 않도록 메모를 그리기 전에 테마부터 확정한다.
    themeSetting = THEMES.includes(result[THEME_KEY])
      ? result[THEME_KEY]
      : "system";
    applyTheme();
    dailyType = DAILY_TYPES.includes(result[DAILY_TYPE_KEY])
      ? result[DAILY_TYPE_KEY]
      : "idiom";
    dailyTypeSelect.value = dailyType;
    showDailyInfo();
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

  if (changes[DAILY_TYPE_KEY]) {
    const incomingType = changes[DAILY_TYPE_KEY].newValue;
    if (DAILY_TYPES.includes(incomingType) && incomingType !== dailyType) {
      dailyType = incomingType;
      dailyTypeSelect.value = dailyType;
      showDailyInfo();
    }
  }

  if (!changes[STORAGE_KEY]) return;
  const incoming = changes[STORAGE_KEY].newValue || [];
  if (isEditingAnyNote()) {
    notes = incoming;
    // 편집 중에는 통째로 다시 그리지 않는다. 알림이 울려서 지워진 경우처럼
    // 바깥에서 바뀐 알림 시각만 화면에 맞춰 준다.
    syncReminderButtons();
    return;
  }
  notes = incoming;
  render();
});

/* ------------------------------------------------------------------ *
 * 메모별 알림 시각
 *
 * note.remindAt(밀리초 타임스탬프)만 저장한다. 실제로 알림을 울리는 건
 * background.js가 storage 변경을 보고 chrome.alarms를 걸어서 한다.
 * ------------------------------------------------------------------ */

// <input type="datetime-local">은 "YYYY-MM-DDTHH:mm"(지역 시각)을 주고받는다.
function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function formatReminder(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 종 버튼의 시각·소리 표시, 그리고 패널 안의 입력값을 저장된 알림 설정에
// 맞춘다. note는 지워진 경우 undefined일 수 있다.
function paintReminder(noteEl, note) {
  const remindAt = note && note.remindAt;
  const isSet = Number.isFinite(remindAt);
  // 소리는 켜짐이 기본이라, 값이 없는 메모도 켜진 것으로 본다.
  const muted = !!note && note.remindSound === false;
  const box = noteEl.querySelector(".note-reminder");
  const btn = box.querySelector(".note-reminder-btn");
  box.classList.toggle("is-set", isSet);
  box.classList.toggle("is-muted", muted);
  box.querySelector(".note-reminder-text").textContent = isSet
    ? formatReminder(remindAt)
    : "";
  box.querySelector(".note-reminder-input").value = isSet ? toLocalInput(remindAt) : "";
  box.querySelector(".note-reminder-sound").checked = !muted;
  box.querySelector(".note-reminder-clear").disabled = !isSet;

  const label = isSet
    ? `알림 ${formatReminder(remindAt)}${muted ? ", 소리 꺼짐" : ""} (눌러서 설정)`
    : "알림 설정";
  btn.title = label;
  btn.setAttribute("aria-label", label);
}

// 편집 중이라 render()를 건너뛴 사이 바깥(백그라운드)에서 알림이 소진되는
// 경우 등을 화면에 반영한다.
function syncReminderButtons() {
  listEl.querySelectorAll(".note").forEach((noteEl) => {
    const note = notes.find((n) => n.id === noteEl.dataset.id);
    if (note) paintReminder(noteEl, note);
  });
}

function setReminderPopoverOpen(box, open) {
  box.querySelector(".note-reminder-popover").hidden = !open;
  box.querySelector(".note-reminder-btn").setAttribute("aria-expanded", String(open));
}

function closeReminderPopovers(except) {
  listEl.querySelectorAll(".note-reminder").forEach((box) => {
    if (box !== except) setReminderPopoverOpen(box, false);
  });
}

function bindReminder(noteEl, note) {
  const box = noteEl.querySelector(".note-reminder");
  const btn = box.querySelector(".note-reminder-btn");
  const popover = box.querySelector(".note-reminder-popover");
  const input = box.querySelector(".note-reminder-input");
  const soundBox = box.querySelector(".note-reminder-sound");
  const clearBtn = box.querySelector(".note-reminder-clear");

  // 이 클로저의 note는 storage.onChanged가 notes를 갈아치우면 낡은 객체가
  // 되므로, 화면을 다시 칠할 때는 항상 id로 최신 값을 찾아 쓴다.
  const repaint = () => paintReminder(noteEl, notes.find((n) => n.id === note.id));

  repaint();

  btn.addEventListener("click", () => {
    const open = popover.hidden;
    closeReminderPopovers(open ? box : null);
    setReminderPopoverOpen(box, open);
    if (open) {
      // 지난 시각은 고를 수 없게 하한을 지금으로 둔다. 포커스를 패널 안으로
      // 옮겨 두면 바깥에서 저장이 바뀌어도 패널이 다시 그려져 닫히지 않는다
      // (isEditingAnyNote가 이 메모를 편집 중으로 본다).
      input.min = toLocalInput(Date.now());
      input.focus();
    }
  });

  input.addEventListener("change", () => {
    const ts = input.value ? new Date(input.value).getTime() : NaN;
    if (!Number.isFinite(ts)) {
      updateNote(note.id, { remindAt: null });
    } else if (ts <= Date.now()) {
      // 같은 날 이미 지난 시각은 min으로 다 걸러지지 않는다.
      alert("지난 시각에는 알림을 걸 수 없어요.");
    } else {
      updateNote(note.id, { remindAt: ts });
    }
    repaint();
  });

  soundBox.addEventListener("change", () => {
    updateNote(note.id, { remindSound: soundBox.checked });
    repaint();
  });

  clearBtn.addEventListener("click", () => {
    updateNote(note.id, { remindAt: null });
    repaint();
  });
}

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
  // 글씨체 팝오버가 이 메모의 commit을 찾을 수 있도록 등록해 둔다.
  contentFieldByArea.set(contentArea, contentField);

  // Ctrl+B/I/U(맥은 ⌘)로 선택한 글자에 굵게/기울임/밑줄을 건다. e.code(물리
  // 키 위치)를 기준으로 삼는 이유는 한글 입력 상태에서 e.key가 자판 위치가
  // 아니라 글자로 오는 경우가 있어서다.
  contentArea.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const command = FORMAT_SHORTCUTS[e.code];
    if (!command) return;
    e.preventDefault();
    // 조합 중에 서식을 건드리면 IME가 만들던 글자가 깨진다. 조합이 끝난
    // 뒤에 다시 누르게 두는 편이 안전하다.
    if (e.isComposing) return;
    document.execCommand(command);
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
  bindReminder(noteEl, note);

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

// 헤더 타이틀 자리의 오늘의 사자성어. 날짜로 고르므로 하루 동안은 패널을
// 몇 번 열어도 같은 성어가 나온다. 날짜에 곱하는 7919는 목록 길이를 나누지
// 않는 소수라, 날마다 목록을 건너뛰며 전체를 한 바퀴 돈 뒤에야 반복된다.
const IDIOM_SEARCH_URL = "https://hanja.dict.naver.com/#/search?range=all&query=";
const NAVER_SEARCH_URL =
  "https://search.naver.com/search.naver?sm=tab_hty.top&where=nexearch&ssc=tab.nx.all&query=";
const KOSPI_URL = "https://stock.naver.com/domestic/index/KOSPI/price";
const IDIOM_DAY_STEP = 7919;
const idiomLink = document.getElementById("idiom");
const dailyTypeSelect = document.getElementById("daily-type");
let idiomRefreshTimer;
let kospiRefreshTimer;

function localDayNumber(now) {
  const localNow = now.getTime() - now.getTimezoneOffset() * 60000;
  return Math.floor(localNow / 86400000);
}

function todaysIdiom(now = new Date()) {
  return IDIOMS[(localDayNumber(now) * IDIOM_DAY_STEP) % IDIOMS.length];
}

function todaysQuote(now = new Date()) {
  return QUOTES[(localDayNumber(now) * IDIOM_DAY_STEP) % QUOTES.length];
}

function signedKospiValue(value, changeType, { positiveSign = false } = {}) {
  const clean = String(value || "0").replace(/^[+-]/, "");
  if (changeType === "FALLING") return `-${clean}`;
  if (changeType === "RISING" && positiveSign) return `+${clean}`;
  return clean;
}

function renderKospi(result, reading) {
  const isRising = result.changeType === "RISING";
  const isFalling = result.changeType === "FALLING";
  const direction = isRising ? "▲" : isFalling ? "▼" : "―";
  const change = String(result.change || "0").replace(/^[+-]/, "");
  const ratio = signedKospiValue(result.ratio, result.changeType, {
    positiveSign: true,
  });
  const changeText = `${direction} ${change} (${ratio}%)`;

  idiomLink.replaceChildren(
    document.createTextNode(`${result.closePrice} `),
    Object.assign(document.createElement("span"), {
      className: isRising ? "kospi-rise" : isFalling ? "kospi-fall" : "kospi-flat",
      textContent: changeText,
    })
  );
  reading.textContent = `${result.closePrice} ${changeText}`;
  reading.classList.toggle("kospi-rise", isRising);
  reading.classList.toggle("kospi-fall", isFalling);
  reading.classList.toggle("kospi-flat", !isRising && !isFalling);
}

function loadKospi() {
  chrome.runtime.sendMessage({ type: "get-kospi" }, (result) => {
    if (dailyType !== "kospi") return;

    const reading = document.getElementById("idiom-reading");
    const meaning = document.getElementById("idiom-meaning");
    if (chrome.runtime.lastError || !result?.ok) {
      idiomLink.textContent = "코스피 정보를 불러오지 못했습니다";
      reading.textContent = "코스피 정보를 불러오지 못했습니다";
      reading.classList.remove("kospi-rise", "kospi-fall", "kospi-flat");
      meaning.textContent = "잠시 후 자동으로 다시 시도합니다";
    } else {
      renderKospi(result, reading);
      meaning.textContent = result.changeText || "보합";
    }

    clearTimeout(kospiRefreshTimer);
    if (document.visibilityState === "visible") {
      kospiRefreshTimer = setTimeout(loadKospi, 60000);
    }
  });
}

function showDailyInfo() {
  const now = new Date();
  const tipTitle = document.querySelector(".idiom-tip-title");
  const reading = document.getElementById("idiom-reading");
  const meaning = document.getElementById("idiom-meaning");
  const hint = document.querySelector(".idiom-hint");
  clearTimeout(kospiRefreshTimer);
  reading.classList.remove("kospi-rise", "kospi-fall", "kospi-flat");
  idiomLink.classList.toggle("is-date", dailyType === "date");
  idiomLink.setAttribute("aria-disabled", dailyType === "date" ? "true" : "false");

  if (dailyType === "kospi") {
    idiomLink.textContent = "코스피 불러오는 중…";
    idiomLink.href = KOSPI_URL;
    tipTitle.textContent = "코스피 현재 지수";
    reading.textContent = "시세를 불러오고 있습니다";
    meaning.textContent = "";
    hint.textContent = "클릭하면 네이버 증권에서 보기";
    loadKospi();
  } else if (dailyType === "quote") {
    const quote = todaysQuote(now);
    idiomLink.textContent = quote.text;
    idiomLink.href =
      NAVER_SEARCH_URL + encodeURIComponent(`${quote.text} ${quote.author} 명언`);
    tipTitle.textContent = "오늘의 명언";
    reading.textContent = quote.text;
    meaning.textContent = `— ${quote.author}`;
    hint.textContent = "클릭하면 네이버 명언정보에서 보기";
  } else if (dailyType === "date") {
    const fullDate = new Intl.DateTimeFormat("ko-KR", {
      year: "numeric", month: "long", day: "numeric", weekday: "long",
    }).format(now);
    idiomLink.textContent = new Intl.DateTimeFormat("ko-KR", {
      month: "long", day: "numeric", weekday: "short",
    }).format(now);
    idiomLink.removeAttribute("href");
    tipTitle.textContent = "오늘 날짜";
    reading.textContent = fullDate;
    meaning.textContent = "";
    hint.textContent = "날짜는 자정에 자동으로 바뀝니다";
  } else {
    const idiom = todaysIdiom(now);
    idiomLink.textContent = idiom.hanja;
    idiomLink.href = IDIOM_SEARCH_URL + encodeURIComponent(idiom.hanja);
    tipTitle.textContent = "오늘의 사자성어";
    reading.textContent = idiom.hangul;
    meaning.textContent = idiom.meaning;
    hint.textContent = "클릭하면 네이버 한자사전에서 보기";
  }

  // 현지 시각의 다음 자정에 갱신한다. 매번 다시 계산해 날짜별 시간 차이도 반영한다.
  clearTimeout(idiomRefreshTimer);
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  idiomRefreshTimer = setTimeout(showDailyInfo, nextMidnight - now);
}

// 절전이나 백그라운드 상태에서 타이머가 늦어졌다면 패널로 돌아올 때 갱신한다.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") showDailyInfo();
});
window.addEventListener("focus", showDailyInfo);

dailyTypeSelect.addEventListener("change", () => {
  dailyType = dailyTypeSelect.value;
  chrome.storage.local.set({ [DAILY_TYPE_KEY]: dailyType });
  showDailyInfo();
});

// 사이드패널 안에서 링크를 따라가지 않고 브라우저 탭으로 연다.
// tabs.create는 url만 넘길 때 별도 권한이 필요 없다.
idiomLink.addEventListener("click", (e) => {
  e.preventDefault();
  if (dailyType === "date") return;
  chrome.tabs.create({ url: idiomLink.href });
});

/* ------------------------------------------------------------------ *
 * 글씨체 설정 팝오버 (굵게 / 기울임 / 밑줄 / 글자색)
 *
 * 팝오버 버튼을 누르는 순간 포커스가 note-content 밖으로 나가면 브라우저
 * 선택 영역이 사라져 서식을 적용할 대상을 잃는다. 그래서 팝오버 안의
 * 버튼은 모두 mousedown에서 기본 동작(포커스 이동)을 막아, 클릭해도
 * 어떤 메모를 편집 중이었는지 그대로 유지한다. 유일한 예외는 <input
 * type="color">인데, 네이티브 색상 선택창을 열려면 실제로 포커스를
 * 받아야 하므로 그 경우만 직접 선택 영역을 저장해 뒀다가 복원한다.
 * ------------------------------------------------------------------ */
const formatBtn = document.getElementById("format-btn");
const formatIcon = formatBtn.querySelector(".format-icon");
const formatPopover = document.getElementById("format-popover");
const formatColorsEl = formatPopover.querySelector(".format-colors");

let savedSelection = null; // { area, range } — 포커스가 note-content를 벗어나기 직전의 선택 영역

function focusedContentArea() {
  const el = document.activeElement;
  return el && el.classList && el.classList.contains("note-content") ? el : null;
}

function openFormatPopover() {
  formatPopover.hidden = false;
  formatBtn.setAttribute("aria-expanded", "true");
  refreshFormatState();
}

function closeFormatPopover() {
  formatPopover.hidden = true;
  formatBtn.setAttribute("aria-expanded", "false");
}

// 캐럿(또는 선택 시작점)을 감싼 <font color> 조상을 찾는다. queryCommandValue
// ("foreColor")는 서식이 없어도 상속된 계산값(검정 등)을 그대로 돌려줘서
// "색이 지정 안 됨"과 구분이 안 된다 — 우리 데이터 모델과 같은 기준(<font>
// 조상의 유무)으로 판정해야 "색 지우기" 상태가 정확히 "색 없음"으로 보인다.
function caretColor(area) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== area && area.contains(node)) {
    const color = elementColor(node);
    if (color) return color;
    node = node.parentElement;
  }
  // 방금 막 색을 고른 직후의 빈 캐럿처럼 아직 <font> 조상이 안 생겼을 수
  // 있다. 이 경우 브라우저가 들고 있는 "다음 입력에 쓰일 색"과 메모
  // 기본 글자색을 비교해, 다르면 그 색이 곧 입력될 색이라고 본다.
  const pending = cssColorToHex(document.queryCommandValue("foreColor"));
  if (!pending) return null;
  const baseline = cssColorToHex(getComputedStyle(area).color);
  return pending !== baseline ? pending : null;
}

// 굵게/기울임/밑줄 버튼과 "가" 아이콘이 지금 캐럿의 실제 서식을 그대로
// 보여 주게 한다. 팝오버를 닫아도 이 버튼 자체가 "지금 이 서식으로
// 입력 중"이라는 표시로 남도록, 팝오버가 열려 있는지와 무관하게 매번
// 갱신한다.
function refreshFormatState() {
  const area = focusedContentArea();
  const bold = !!area && document.queryCommandState("bold");
  const italic = !!area && document.queryCommandState("italic");
  const underline = !!area && document.queryCommandState("underline");
  const color = area ? caretColor(area) : null;

  formatPopover.classList.toggle("is-disabled", !area);
  formatPopover.querySelectorAll(".format-toggle").forEach((btn) => {
    const on = { bold, italic, underline }[btn.dataset.cmd];
    btn.setAttribute("aria-pressed", String(on));
  });

  formatIcon.style.fontWeight = bold ? "800" : "";
  formatIcon.style.fontStyle = italic ? "italic" : "";
  formatIcon.style.textDecoration = underline ? "underline" : "";
  formatIcon.style.color = color || "";
  formatBtn.classList.toggle("is-active", bold || italic || underline || !!color);
}

// 서식을 적용한 뒤 공통으로 해야 할 뒷정리(빈 상태 갱신, 저장, 버튼 상태
// 갱신)를 한데 모았다. area가 없으면 적용할 메모가 없다는 뜻이라 그냥
// 무시한다.
function applyFormat(area, run) {
  if (!area) return;
  run();
  refreshBlankState(area);
  const field = contentFieldByArea.get(area);
  if (field) field.commit();
  refreshFormatState();
}

// removeFormat은 글자색뿐 아니라 굵게/기울임/밑줄까지 전부 지워 버린다.
// 그래서 지우기 전에 세 상태를 기억해 뒀다가 다시 걸어 준다.
function removeSelectionColor() {
  const wasBold = document.queryCommandState("bold");
  const wasItalic = document.queryCommandState("italic");
  const wasUnderline = document.queryCommandState("underline");
  document.execCommand("removeFormat");
  if (wasBold) document.execCommand("bold");
  if (wasItalic) document.execCommand("italic");
  if (wasUnderline) document.execCommand("underline");
}

// 네이티브 색상 선택창을 열기 직전, 포커스가 옮겨가기 전의 선택 영역을
// 복원한다(포커스와 선택을 다시 note-content로 되돌린 뒤 그 영역을
// 돌려준다). 저장된 영역이 이미 문서에서 사라졌다면(메모 삭제 등) 아무것도
// 하지 않는다.
function restoreSavedSelection() {
  if (!savedSelection || !document.contains(savedSelection.area)) return null;
  const { area, range } = savedSelection;
  area.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return area;
}

// 기본 6색 + 색 지우기 + 직접 고르기.
function buildFormatColors(container) {
  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "format-color format-color-none";
  noneBtn.dataset.color = "";
  noneBtn.title = "글자색 지우기";
  noneBtn.setAttribute("aria-label", "글자색 지우기");
  container.appendChild(noneBtn);

  TEXT_COLORS.forEach((color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "format-color";
    btn.dataset.color = color;
    btn.style.background = color;
    btn.title = "글자색";
    btn.setAttribute("aria-label", `글자색 ${color}`);
    container.appendChild(btn);
  });

  container.querySelectorAll(".format-color[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const color = btn.dataset.color;
      applyFormat(focusedContentArea(), () => {
        if (color) document.execCommand("foreColor", false, color);
        else removeSelectionColor();
      });
    });
  });

  const customLabel = document.createElement("label");
  customLabel.className = "format-color format-color-custom";
  customLabel.title = "직접 색 고르기";
  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.className = "format-color-input";
  customInput.setAttribute("aria-label", "글자색 직접 고르기");
  customLabel.appendChild(customInput);
  container.appendChild(customLabel);

  // input은 색을 고르는 동안 계속 온다(미리보기). 클릭하는 순간 포커스가
  // 색상 선택창으로 넘어가 선택 영역이 사라지므로, selectionchange가
  // 미리 저장해 둔 영역을 매번 복원한 뒤 적용한다.
  customInput.addEventListener("input", () => {
    const area = restoreSavedSelection();
    if (!area) return;
    applyFormat(area, () => document.execCommand("foreColor", false, customInput.value));
  });
}

buildFormatColors(formatColorsEl);

formatBtn.addEventListener("mousedown", (e) => e.preventDefault());
formatBtn.addEventListener("click", () => {
  if (formatPopover.hidden) openFormatPopover();
  else closeFormatPopover();
});

formatPopover.addEventListener("mousedown", (e) => {
  if (e.target.closest(".format-color-custom")) return; // 네이티브 색상 선택창은 포커스가 필요하다
  e.preventDefault();
});

formatPopover.querySelectorAll(".format-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyFormat(focusedContentArea(), () => document.execCommand(btn.dataset.cmd));
  });
});

// note-content 안에서 선택이 바뀔 때마다(포커스가 거기 있는 동안만) 최신
// 선택 영역을 기억해 둔다. 색상 선택창처럼 포커스가 밖으로 나가야 하는
// 조작 직전, 마지막으로 남은 유효한 선택을 여기서 가져와 되돌린다.
//
// refreshFormatState는 팝오버가 닫혀 있어도 부른다 — "가" 버튼 자체가
// 지금 캐럿의 서식을 보여 주는 표시판이라, 타이핑하며 캐럿이 움직일
// 때마다(선택이 바뀔 때마다) 계속 따라가야 한다.
document.addEventListener("selectionchange", () => {
  const area = focusedContentArea();
  const sel = window.getSelection();
  if (area && sel && sel.rangeCount) {
    savedSelection = { area, range: sel.getRangeAt(0).cloneRange() };
  }
  refreshFormatState();
});

// 클릭으로 메모를 옮겨 다니는 것처럼 캐럿 위치는 그대로인데 포커스만
// 바뀌는 경우(예: 방금 만든 빈 메모에 자동 포커스)도 selectionchange가
// 안 일어날 수 있어 focusin/focusout에서도 한 번 더 맞춰 준다.
document.addEventListener("focusin", refreshFormatState);
document.addEventListener("focusout", refreshFormatState);

document.addEventListener("click", (e) => {
  // 알림 설정 패널은 자기 종/패널 밖을 누르면 닫힌다.
  closeReminderPopovers(e.target.closest ? e.target.closest(".note-reminder") : null);

  if (formatPopover.hidden) return;
  if (formatBtn.contains(e.target) || formatPopover.contains(e.target)) return;
  closeFormatPopover();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!formatPopover.hidden) closeFormatPopover();
  closeReminderPopovers(null);
});


showDailyInfo();
addBtn.addEventListener("click", addNote);
themeBtn.addEventListener("click", cycleTheme);

// 굵게를 <span style="font-weight:bold">가 아니라 <b>로 만들게 하고, 줄바꿈을
// <div>로 통일한다. 어차피 저장할 때 우리 모델을 거치지만, 편집 중 DOM이
// 단순할수록 캐럿 계산과 되돌리기가 덜 헷갈린다.
document.execCommand("styleWithCSS", false, false);
document.execCommand("defaultParagraphSeparator", false, "div");

loadNotes();
