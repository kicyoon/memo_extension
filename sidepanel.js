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

function isEditingAnyNote() {
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

  if (!debounce) {
    persist();
    return;
  }
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(() => persist(), 300)
  );
}

function flushNote(id, patch) {
  clearTimeout(saveTimers.get(id));
  updateNote(id, patch, { debounce: false });
}

// DOM 값을 건드리지 않고, 이미 input 이벤트로 메모리에 반영된 값을
// 그대로 즉시 저장한다. IME 조합 중 blur가 발생한 경우처럼 DOM의
// 현재 값을 신뢰할 수 없을 때 사용한다.
function flushPersist(id) {
  clearTimeout(saveTimers.get(id));
  persist();
}

function autoResize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = textarea.scrollHeight + "px";
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

  let titleComposing = false;
  titleInput.addEventListener("compositionstart", () => {
    titleComposing = true;
  });
  titleInput.addEventListener("compositionend", () => {
    titleComposing = false;
    flushNote(note.id, { title: titleInput.value });
  });
  titleInput.addEventListener("input", () => {
    updateNote(note.id, { title: titleInput.value }, { debounce: true });
  });
  titleInput.addEventListener("focus", () => {
    titleInput.spellcheck = true;
  });
  titleInput.addEventListener("blur", () => {
    titleInput.spellcheck = false;
    if (titleComposing) {
      // 사이드패널 밖으로 포커스가 나가면서 IME 조합이 커밋되지 않고
      // 취소된 경우: DOM 값이 이미 훼손되었을 수 있으므로 다시 읽지
      // 않고, 마지막 input 이벤트가 저장해둔 값을 그대로 즉시 저장한다.
      flushPersist(note.id);
      titleComposing = false;
    } else {
      flushNote(note.id, { title: titleInput.value });
    }
  });
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      contentArea.focus();
    }
  });

  let contentComposing = false;
  contentArea.addEventListener("compositionstart", () => {
    contentComposing = true;
  });
  contentArea.addEventListener("compositionend", () => {
    contentComposing = false;
    autoResize(contentArea);
    flushNote(note.id, { content: contentArea.value });
  });
  contentArea.addEventListener("input", () => {
    autoResize(contentArea);
    updateNote(note.id, { content: contentArea.value }, { debounce: true });
  });
  contentArea.addEventListener("focus", () => {
    contentArea.spellcheck = true;
  });
  contentArea.addEventListener("blur", () => {
    contentArea.spellcheck = false;
    if (contentComposing) {
      flushPersist(note.id);
      contentComposing = false;
    } else {
      flushNote(note.id, { content: contentArea.value });
    }
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

  if (focusedId && focusedField) {
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
