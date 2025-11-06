const STORAGE_KEY = "advanced-task-manager::tasks";
const SETTINGS_KEY = "advanced-task-manager::settings";

const tagPalette = [
  "#6366f1",
  "#10b981",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#06b6d4",
  "#facc15",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
];

const tagColorMap = new Map();

const idle =
  "requestIdleCallback" in window
    ? (cb) => window.requestIdleCallback(cb)
    : (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 }), 1);

const defaultTasks = [
  {
    id: crypto.randomUUID(),
    title: "إعداد خطة أسبوعية للفريق",
    description: "تحديد أولويات هذا الأسبوع وتوزيع المهام حسب قدرات الأفراد.",
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    priority: "high",
    status: "active",
    tags: ["عمل", "استراتيجية"],
    createdAt: Date.now(),
  },
  {
    id: crypto.randomUUID(),
    title: "مراجعة التقارير الشهرية",
    description: "تحليل الأداء العام وتقديم مقترحات للتحسين.",
    dueDate: new Date(Date.now() - 86400000 * 2).toISOString(),
    priority: "medium",
    status: "active",
    tags: ["تحليل", "عاجل"],
    createdAt: Date.now() - 200000,
  },
  {
    id: crypto.randomUUID(),
    title: "جلسة تدريب للفريق",
    description: "تنظيم ورشة عمل حول أفضل ممارسات الإنتاجية.",
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    priority: "low",
    status: "completed",
    tags: ["تدريب"],
    createdAt: Date.now() - 500000,
  },
];

const settings = loadSettings();
const state = {
  tasks: loadTasks(),
  filters: {
    status: "all",
    priority: "all",
    date: "",
    tags: new Set(),
    search: "",
  },
  dragSourceId: null,
  pomodoro: {
    remaining: 25 * 60,
    interval: null,
  },
};

const elements = {
  shell: document.querySelector(".app-shell"),
  themeToggle: document.querySelector(".theme-toggle"),
  filterStatus: document.getElementById("filter-status"),
  filterPriority: document.getElementById("filter-priority"),
  filterDate: document.getElementById("filter-date"),
  filterTags: document.getElementById("filter-tags"),
  clearFilters: document.querySelector(".clear-filters"),
  searchInput: document.getElementById("task-search"),
  taskList: document.getElementById("task-list"),
  openTaskModal: document.querySelector(".open-task-modal"),
  modal: document.querySelector('[data-modal="task"]'),
  modalTitle: document.getElementById("modal-title"),
  modalCloseButtons: document.querySelectorAll(".modal-close"),
  taskForm: document.querySelector(".task-form"),
  notificationTray: document.querySelector(".notification-tray"),
  exportButtons: document.querySelectorAll("[data-export]"),
  loader: document.querySelector(".loader"),
  stats: {
    total: document.querySelector('[data-stat="total"]'),
    completed: document.querySelector('[data-stat="completed"]'),
    overdue: document.querySelector('[data-stat="overdue"]'),
    canvas: document.getElementById("completion-chart"),
  },
  pomodoro: {
    minutes: document.querySelector(".pomodoro-minutes"),
    seconds: document.querySelector(".pomodoro-seconds"),
    controls: document.querySelectorAll(".pomodoro-controls button"),
  },
};

let editingTaskId = null;

init();

function init() {
  applyTheme(settings.theme ?? "light");
  elements.shell.dataset.theme = settings.theme ?? "light";
  attachEventListeners();
  updatePomodoroDisplay();
  lazyInit();
  idle(() => {
    evaluateDueTasks();
  });
}

function lazyInit() {
  elements.loader.classList.add("active");
  setTimeout(() => {
    render();
    elements.loader.classList.remove("active");
  }, 900);
}

function attachEventListeners() {
  elements.themeToggle.addEventListener("click", () => {
    const nextTheme = elements.shell.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
    persistSettings();
  });

  elements.filterStatus.addEventListener("change", (e) => {
    state.filters.status = e.target.value;
    renderTasks();
  });

  elements.filterPriority.addEventListener("change", (e) => {
    state.filters.priority = e.target.value;
    renderTasks();
  });

  elements.filterDate.addEventListener("change", (e) => {
    state.filters.date = e.target.value;
    renderTasks();
  });

  elements.clearFilters.addEventListener("click", () => {
    state.filters = {
      status: "all",
      priority: "all",
      date: "",
      tags: new Set(),
      search: "",
    };
    elements.filterStatus.value = "all";
    elements.filterPriority.value = "all";
    elements.filterDate.value = "";
    elements.searchInput.value = "";
    renderTagFilters();
    renderTasks();
  });

  elements.searchInput.addEventListener("input", (e) => {
    state.filters.search = e.target.value.trim();
    renderTasks();
  });

  elements.openTaskModal.addEventListener("click", () => openTaskModal());
  elements.modalCloseButtons.forEach((btn) => {
    btn.addEventListener("click", closeTaskModal);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && elements.modal.classList.contains("active")) {
      closeTaskModal();
    }
  });

  elements.modal.addEventListener("click", (e) => {
    if (e.target === elements.modal) {
      closeTaskModal();
    }
  });

  elements.taskForm.addEventListener("submit", handleTaskSubmit);

  elements.exportButtons.forEach((btn) =>
    btn.addEventListener("click", () => handleExport(btn.dataset.export))
  );

  elements.pomodoro.controls.forEach((button) => {
    button.addEventListener("click", () => handlePomodoro(button.dataset.action));
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.pomodoro.interval) {
      notify("تم إيقاف المؤقت مؤقتًا عند تغيير النافذة.", "warning");
    }
  });
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const data = new FormData(elements.taskForm);

  const task = {
    title: data.get("title").trim(),
    description: data.get("description").trim(),
    dueDate: new Date(data.get("dueDate")).toISOString(),
    priority: data.get("priority"),
    tags: data
      .get("tags")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
  };

  if (!task.title || !task.dueDate) {
    notify("الرجاء تعبئة البيانات المطلوبة.", "error");
    return;
  }

  if (editingTaskId) {
    const index = state.tasks.findIndex((t) => t.id === editingTaskId);
    if (index > -1) {
      state.tasks[index] = { ...state.tasks[index], ...task };
      notify("تم تحديث المهمة بنجاح.", "success");
    }
  } else {
    state.tasks.unshift({
      ...task,
      id: crypto.randomUUID(),
      status: "active",
      createdAt: Date.now(),
    });
    notify("تمت إضافة المهمة.", "success");
  }

  persistTasks();
  closeTaskModal();
  render();
  idle(() => evaluateDueTasks());
}

function openTaskModal(task = null) {
  editingTaskId = task?.id ?? null;
  elements.modal.classList.add("active");
  document.body.style.overflow = "hidden";
  elements.modalTitle.textContent = editingTaskId ? "تعديل مهمة" : "مهمة جديدة";
  elements.taskForm.reset();

  if (task) {
    elements.taskForm.title.value = task.title;
    elements.taskForm.description.value = task.description;
    elements.taskForm.dueDate.value = task.dueDate
      ? new Date(task.dueDate).toISOString().slice(0, 10)
      : "";
    elements.taskForm.priority.value = task.priority;
    elements.taskForm.tags.value = task.tags.join(", ");
  } else {
    elements.taskForm.dueDate.value = new Date().toISOString().slice(0, 10);
  }

  setTimeout(() => {
    elements.taskForm.title.focus();
  }, 120);
}

function closeTaskModal() {
  elements.modal.classList.remove("active");
  document.body.style.overflow = "";
  editingTaskId = null;
}

function render() {
  tagColorMap.clear();
  state.tasks.forEach((task) => task.tags.forEach((tag) => colorForTag(tag)));
  renderTasks();
  renderTagFilters();
  updateStats();
  drawChart();
}

function renderTasks() {
  elements.taskList.innerHTML = "";
  const filteredTasks = applyFilters(state.tasks.slice());

  if (!filteredTasks.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "task-item";
    emptyState.innerHTML =
      '<p class="task-description">لا توجد مهام مطابقة للمعايير الحالية.</p>';
    elements.taskList.appendChild(emptyState);
    return;
  }

  filteredTasks.forEach((task) => {
    const item = document.createElement("li");
    item.className = "task-item";
    if (!("IntersectionObserver" in window)) {
      item.classList.add("reveal");
    }
    item.tabIndex = 0;
    item.draggable = true;
    item.dataset.id = task.id;
    item.dataset.priority = translatePriority(task.priority);
    item.innerHTML = composeTaskTemplate(task);
    attachTaskEvents(item, task);
    elements.taskList.appendChild(item);
  });
}

function translatePriority(priority) {
  switch (priority) {
    case "high":
      return "أولوية عالية";
    case "medium":
      return "أولوية متوسطة";
    case "low":
    default:
      return "أولوية منخفضة";
  }
}

function composeTaskTemplate(task) {
  const { search } = state.filters;
  const highlight = (text) => {
    const safeText = String(text ?? "");
    if (!search) return escapeHTML(safeText);
    const regex = new RegExp(`(${escapeRegExp(search)})`, "gi");
    return escapeHTML(safeText).replace(regex, "<mark>$1</mark>");
  };

  const dueDate = new Date(task.dueDate);
  const isOverdue = !isCompleted(task) && dueDate < startOfDay(new Date());
  const formattedDate = dueDate.toLocaleDateString("ar-EG", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const tagsMarkup = task.tags
    .map((tag) => {
      const color = colorForTag(tag);
      return `<span class="tag" style="background:${color}">${escapeHTML(tag)}</span>`;
    })
    .join("");

  return `
    <div class="task-headline">
      <h3 class="task-title">${highlight(task.title)}</h3>
      <div class="task-actions">
        <button type="button" data-action="edit" aria-label="تعديل">✏️</button>
        <button type="button" data-action="delete" aria-label="حذف">🗑️</button>
      </div>
    </div>
    <p class="task-description">${highlight(task.description || "بدون وصف")}</p>
    <div class="task-meta">
      <span class="due-badge ${isOverdue ? "overdue" : ""}">مستحق في ${formattedDate}</span>
      ${tagsMarkup}
    </div>
    <div class="task-footer">
      <label class="status-switch">
        <input type="checkbox" ${isCompleted(task) ? "checked" : ""} aria-label="تبديل حالة المهمة"/>
        <span>${isCompleted(task) ? "منجزة" : "نشطة"}</span>
      </label>
      <small>أضيفت ${formatRelative(task.createdAt)}</small>
    </div>
  `;
}

function attachTaskEvents(node, task) {
  node.addEventListener("dragstart", () => {
    state.dragSourceId = task.id;
    node.classList.add("dragging");
  });

  node.addEventListener("dragend", () => {
    node.classList.remove("dragging");
    state.dragSourceId = null;
  });

  node.addEventListener("dragover", (event) => {
    event.preventDefault();
    node.classList.add("dragover");
  });

  node.addEventListener("dragleave", () => {
    node.classList.remove("dragover");
  });

  node.addEventListener("drop", () => {
    node.classList.remove("dragover");
    const draggedId = state.dragSourceId;
    if (!draggedId || draggedId === task.id) return;
    const dragIndex = state.tasks.findIndex((t) => t.id === draggedId);
    const targetIndex = state.tasks.findIndex((t) => t.id === task.id);
    if (dragIndex === -1 || targetIndex === -1) return;
    const [draggedTask] = state.tasks.splice(dragIndex, 1);
    state.tasks.splice(targetIndex, 0, draggedTask);
    persistTasks();
    renderTasks();
  });

  node.querySelector('[data-action="edit"]').addEventListener("click", () => openTaskModal(task));
  node.querySelector('[data-action="delete"]').addEventListener("click", () => {
    confirmDelete(task.id);
  });
  node.querySelector(".status-switch input").addEventListener("change", (event) => {
    toggleStatus(task.id, event.target.checked);
    render();
  });
}

function toggleStatus(taskId, completed) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.status = completed ? "completed" : "active";
  persistTasks();
  evaluateDueTasks();
}

function confirmDelete(taskId) {
  const confirmed = window.confirm("هل أنت متأكد من حذف هذه المهمة؟");
  if (!confirmed) return;
  state.tasks = state.tasks.filter((task) => task.id !== taskId);
  persistTasks();
  render();
  notify("تم حذف المهمة.", "success");
}

function applyFilters(tasks) {
  return tasks
    .filter((task) => {
      if (state.filters.status === "completed" && !isCompleted(task)) return false;
      if (state.filters.status === "active" && isCompleted(task)) return false;
      if (
        state.filters.status === "overdue" &&
        !(new Date(task.dueDate) < startOfDay(new Date()) && !isCompleted(task))
      ) {
        return false;
      }
      return true;
    })
    .filter((task) => {
      if (state.filters.priority === "all") return true;
      return task.priority === state.filters.priority;
    })
    .filter((task) => {
      if (!state.filters.date) return true;
      return new Date(task.dueDate) <= new Date(state.filters.date);
    })
    .filter((task) => {
      if (!state.filters.tags.size) return true;
      return task.tags.some((tag) => state.filters.tags.has(tag));
    })
    .filter((task) => {
      if (!state.filters.search) return true;
      const needle = state.filters.search.toLowerCase();
      return (
        task.title.toLowerCase().includes(needle) ||
        (task.description || "").toLowerCase().includes(needle) ||
        task.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
}

function renderTagFilters() {
  const allTags = Array.from(
    new Set(
      state.tasks
        .flatMap((task) => task.tags)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
  elements.filterTags.innerHTML = "";
  allTags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    const color = colorForTag(tag);
    button.dataset.color = color;
    if (state.filters.tags.has(tag)) {
      button.style.background = color;
      button.style.color = "#fff";
    }
    button.classList.toggle("active", state.filters.tags.has(tag));
    button.addEventListener("click", () => {
      if (state.filters.tags.has(tag)) {
        state.filters.tags.delete(tag);
      } else {
        state.filters.tags.add(tag);
      }
      button.classList.toggle("active");
      if (state.filters.tags.has(tag)) {
        button.style.background = button.dataset.color;
        button.style.color = "#fff";
      } else {
        button.style.background = "";
        button.style.color = "";
      }
      renderTasks();
    });
    elements.filterTags.appendChild(button);
  });
}

function updateStats() {
  const total = state.tasks.length;
  const completed = state.tasks.filter(isCompleted).length;
  const overdue = state.tasks.filter(
    (task) => new Date(task.dueDate) < startOfDay(new Date()) && !isCompleted(task)
  ).length;

  elements.stats.total.textContent = total;
  elements.stats.completed.textContent = completed;
  elements.stats.overdue.textContent = overdue;
}

function drawChart() {
  const canvas = elements.stats.canvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const total = Math.max(state.tasks.length, 1);
  const completed = state.tasks.filter(isCompleted).length;
  const overdue = state.tasks.filter(
    (task) => new Date(task.dueDate) < startOfDay(new Date()) && !isCompleted(task)
  ).length;
  const active = total - completed - overdue;

  const segments = [
    { value: completed, color: "#10b981" },
    { value: active, color: "#6366f1" },
    { value: overdue, color: "#ef4444" },
  ];

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const radius = Math.min(canvas.width, canvas.height) / 2 - 10;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  let startAngle = -Math.PI / 2;

  ctx.lineWidth = 28;
  segments.forEach((segment) => {
    const angle = (segment.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.strokeStyle = segment.color;
    ctx.arc(cx, cy, radius, startAngle, startAngle + angle);
    ctx.stroke();
    startAngle += angle;
  });

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--color-surface");
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--color-text");
  ctx.textAlign = "center";
  ctx.font = "600 28px 'Cairo', sans-serif";
  ctx.fillText(`${Math.round((segments[0].value / total) * 100)}%`, cx, cy + 8);
}

function handleExport(type) {
  if (!state.tasks.length) {
    notify("لا توجد مهام للتصدير.", "warning");
    return;
  }

  let blob;
  if (type === "json") {
    blob = new Blob([JSON.stringify(state.tasks, null, 2)], {
      type: "application/json;charset=utf-8",
    });
  } else {
    const header = ["العنوان", "الوصف", "التاريخ", "الأولوية", "الحالة", "الوسوم"];
    const rows = state.tasks.map((task) => [
      task.title,
      task.description?.replace(/\n/g, " ") ?? "",
      new Date(task.dueDate).toLocaleDateString("ar-EG"),
      translatePriority(task.priority),
      isCompleted(task) ? "منجزة" : "نشطة",
      task.tags.join(" | "),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tasks-${Date.now()}.${type}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  notify("تم تصدير المهام.", "success");
}

function handlePomodoro(action) {
  switch (action) {
    case "start":
      if (!state.pomodoro.interval) {
        startPomodoro();
        notify("بدأ مؤقت بومودورو.", "success");
      }
      break;
    case "pause":
      if (state.pomodoro.interval) {
        pausePomodoro();
        notify("تم إيقاف المؤقت مؤقتًا.", "warning");
      }
      break;
    case "reset":
      resetPomodoro();
      notify("تمت إعادة ضبط المؤقت.", "success");
      break;
  }
}

function startPomodoro() {
  if (state.pomodoro.interval) return;
  updatePomodoroDisplay();
  state.pomodoro.interval = setInterval(() => {
    state.pomodoro.remaining -= 1;
    if (state.pomodoro.remaining <= 0) {
      clearInterval(state.pomodoro.interval);
      state.pomodoro.interval = null;
      state.pomodoro.remaining = 25 * 60;
      notify("انتهت جلسة التركيز! خذ استراحة مستحقة.", "success");
    }
    updatePomodoroDisplay();
  }, 1000);
}

function pausePomodoro() {
  clearInterval(state.pomodoro.interval);
  state.pomodoro.interval = null;
  updatePomodoroDisplay();
}

function resetPomodoro() {
  clearInterval(state.pomodoro.interval);
  state.pomodoro.interval = null;
  state.pomodoro.remaining = 25 * 60;
  updatePomodoroDisplay();
}

function updatePomodoroDisplay() {
  const minutes = Math.floor(state.pomodoro.remaining / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (state.pomodoro.remaining % 60).toString().padStart(2, "0");
  elements.pomodoro.minutes.textContent = minutes;
  elements.pomodoro.seconds.textContent = seconds;
}

function notify(message, type = "info") {
  const node = document.createElement("div");
  node.className = `notification ${type}`;
  node.setAttribute("role", "status");
  node.textContent = message;
  elements.notificationTray.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateX(40px)";
    setTimeout(() => node.remove(), 400);
  }, 4000);
}

function evaluateDueTasks() {
  const now = startOfDay(new Date());
  state.tasks
    .filter((task) => !isCompleted(task))
    .filter((task) => startOfDay(new Date(task.dueDate)) <= now)
    .forEach((task) => {
      notify(`المهمة "${task.title}" مستحقة اليوم أو متأخرة!`, "warning");
    });
}

function applyTheme(theme) {
  elements.shell.dataset.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  settings.theme = theme;
}

function persistTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}

function persistSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTasks;
    const tasks = JSON.parse(raw);
    if (!Array.isArray(tasks)) return defaultTasks;
    return tasks;
  } catch {
    return defaultTasks;
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isCompleted(task) {
  return task.status === "completed";
}

function escapeHTML(value) {
  const str = String(value ?? "");
  return str.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatRelative(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "منذ لحظات";
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} دقيقة`;
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} ساعة`;
  if (diff < 86400000 * 7) return `منذ ${Math.floor(diff / 86400000)} يوم`;
  return new Date(timestamp).toLocaleDateString("ar-EG");
}

function colorForTag(tag) {
  const normalized = tag.trim().toLowerCase();
  if (tagColorMap.has(normalized)) return tagColorMap.get(normalized);
  const color = tagPalette[tagColorMap.size % tagPalette.length];
  tagColorMap.set(normalized, color);
  return color;
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );
  const observe = () => {
    document.querySelectorAll(".task-item:not(.reveal)").forEach((item) => observer.observe(item));
  };
  const originalRenderTasks = renderTasks;
  renderTasks = function patchedRenderTasks() {
    originalRenderTasks();
    observe();
  };
}

window.addEventListener("beforeunload", () => {
  if (state.pomodoro.interval) {
    pausePomodoro();
  }
});
