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

  titleInput.addEventListener("input", () => {
    updateNote(note.id, { title: titleInput.value }, { debounce: true });
  });
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      contentArea.focus();
    }
  });

  contentArea.addEventListener("input", () => {
    autoResize(contentArea);
    updateNote(note.id, { content: contentArea.value }, { debounce: true });
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

loadNotes();
