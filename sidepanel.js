const COLORS = [
  "#FFF59D", // 노랑
  "#FFCC80", // 주황
  "#F8BBD0", // 분홍
  "#C8E6C9", // 초록
  "#BBDEFB", // 파랑
  "#E1BEE7", // 보라
];

const STORAGE_KEY = "notes";

const listEl = document.getElementById("notes-list");
const emptyStateEl = document.getElementById("empty-state");
const addBtn = document.getElementById("add-note-btn");
const template = document.getElementById("note-template");

let notes = [];
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

function loadNotes() {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    notes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    render();
  });
}

function persist() {
  chrome.storage.local.set({ [STORAGE_KEY]: notes });
}

// 화면(DOM)에 떠 있는 값과 메모리의 notes가 어긋났는지 본다. blur 이후
// 안전망으로 render()를 부를지 판단하는 용도 — 어긋난 게 없으면 굳이 DOM을
// 새로 만들지 않는다(불필요하게 커서/포커스를 날리지 않기 위해).
function domDivergesFromNotes() {
  return [...listEl.querySelectorAll(".note")].some((noteEl) => {
    const n = notes.find((x) => x.id === noteEl.dataset.id);
    if (!n) return true;
    const t = noteEl.querySelector(".note-title");
    const c = noteEl.querySelector(".note-content");
    return (t && t.value !== n.title) || (c && c.value !== n.content);
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
  if (area !== "local" || !changes[STORAGE_KEY]) return;
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
  Object.assign(note, patch, { updatedAt: Date.now() });

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

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
}

// blur가 발생하는 바로 그 순간의 el.value는 이미 조합 중이던 글자까지
// 정확히 포함하고 있다. 문제는 그 이후다 — 패널 밖으로 포커스가 나가면
// 브라우저가 뒤늦게 조합 정리를 위해 compositionend와 deleteContentBackward를
// 발생시켜 DOM 값을 건드린다. 그래서 blur 시점의 값을 그대로 신뢰해 저장하고,
// 그 뒤 (포커스 없는 상태에서) 도착하는 변경은 화면만 되돌린다.
//
// 되돌릴 기준값으로 note[field]를 쓰면 안 된다. persist()마다
// storage.onChanged가 notes 배열을 통째로 새 객체로 갈아치우기 때문에,
// 이 클로저가 붙들고 있는 note는 곧 고아가 되어 마지막 render 시점 값에
// 얼어붙는다. 그 죽은 값으로 되돌리면 멀쩡한 글자가 지워진다(원래 버그).
// 그래서 정상 입력마다 직접 갱신하는 lastGoodValue를 기준으로 삼는다.
function bindEditableField(el, note, field, onAfterChange) {
  let focused = false;
  let lastGoodValue = el.value;

  el.addEventListener("focus", () => {
    focused = true;
    lastGoodValue = el.value;
  });

  // 포커스가 없는 상태에서 도착한 변경을 화면에서 되돌린다.
  const revertIfStray = () => {
    if (el.value === lastGoodValue) return;
    el.value = lastGoodValue;
    if (onAfterChange) onAfterChange();
  };

  el.addEventListener("compositionend", () => {
    if (!focused) {
      revertIfStray();
      return;
    }
    if (onAfterChange) onAfterChange();
    lastGoodValue = el.value;
    updateNote(note.id, { [field]: el.value });
  });

  el.addEventListener("input", (e) => {
    if (!focused) {
      revertIfStray();
      return;
    }
    if (onAfterChange) onAfterChange();
    if (e.inputType === "deleteCompositionText") return;
    lastGoodValue = el.value;
    updateNote(note.id, { [field]: el.value }, { debounce: true });
  });

  el.addEventListener("blur", () => {
    focused = false;
    // blur 시점의 el.value는 조합 중이던 글자까지 온전히 담고 있다(실측).
    lastGoodValue = el.value;
    updateNote(note.id, { [field]: el.value });
    // 조합 정리로 DOM이 건드려진 건 위 revertIfStray가 되돌린다. 이 rAF는
    // 그걸로도 안 잡힌 어긋남이 남았을 때만 도는 마지막 안전망이다.
    // 어긋남이 없으면 render를 건너뛴다 — 다른 앱에 갔다 왔을 뿐인데
    // DOM을 새로 만들어 커서를 날려버리지 않기 위해서다.
    requestAnimationFrame(() => {
      if (!isEditingAnyNote() && domDivergesFromNotes()) render();
    });
  });
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
  noteEl.style.background = note.color;
  titleInput.value = note.title;
  contentArea.value = note.content;
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
  bindEditableField(contentArea, note, "content", () => autoResize(contentArea));

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

  COLORS.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.className = "swatch" + (color === note.color ? " active" : "");
    swatch.style.background = color;
    swatch.title = "색상 변경";
    swatch.addEventListener("click", () => {
      noteEl.style.background = color;
      swatchesEl
        .querySelectorAll(".swatch")
        .forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
      updateNote(note.id, { color });
    });
    swatchesEl.appendChild(swatch);
  });

  requestAnimationFrame(() => autoResize(contentArea));

  return fragment;
}

function render() {
  const focusedId =
    document.activeElement && document.activeElement.closest
      ? document.activeElement.closest(".note")?.dataset.id
      : null;
  const focusedField = document.activeElement?.classList?.contains(
    "note-title"
  )
    ? "title"
    : document.activeElement?.classList?.contains("note-content")
    ? "content"
    : null;
  const selStart = document.activeElement?.selectionStart;
  const selEnd = document.activeElement?.selectionEnd;

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
      if (typeof selStart === "number" && typeof el.setSelectionRange === "function") {
        el.setSelectionRange(selStart, selEnd);
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
  notes = orderedIds
    .map((id) => notes.find((n) => n.id === id))
    .filter(Boolean);
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

// 사이드패널이 열리는 슬라이드 인 애니메이션 도중에는 실제 너비가 아직
// 확정되지 않아 scrollHeight 기반 높이 계산이 부정확할 수 있다.
// 패널 크기가 바뀔 때마다 모든 노트의 높이를 다시 계산해 보정한다.
const panelResizeObserver = new ResizeObserver(() => {
  listEl.querySelectorAll(".note-content").forEach(autoResize);
});
panelResizeObserver.observe(document.body);

loadNotes();
