/* ══════════════════════════════════════════
   tasks.js  —  task manager logic (enhanced)
   Features: filter/search, drag-to-reorder, edit text,
             subtasks/checklists, due dates & reminders,
             categories/tags, notes/description per task
   ══════════════════════════════════════════ */

let tasks = [];
let activeFilter  = 'all';   // 'all' | 'high' | 'med' | 'low' | tag name
let searchQuery   = '';
let dragSrcId     = null;
let reminderTimers = {};

/* ─── CATEGORY / TAG COLOR MAP ─────────────────── */
const TAG_COLORS = [
  '#6c8ebf','#82b366','#d6ae6b','#b5594e',
  '#8a6bbf','#4fb3b3','#c97abf','#5b8a5b'
];
let tagColorMap = {};  // tag → color (persisted in localStorage)

function getTagColor(tag) {
  if (!tagColorMap[tag]) {
    const idx = Object.keys(tagColorMap).length % TAG_COLORS.length;
    tagColorMap[tag] = TAG_COLORS[idx];
    saveTagColors();
  }
  return tagColorMap[tag];
}
function saveTagColors() {
  try { localStorage.setItem('ws_tag_colors', JSON.stringify(tagColorMap)); } catch(_){}
}
function loadTagColors() {
  try { tagColorMap = JSON.parse(localStorage.getItem('ws_tag_colors') || '{}'); } catch(_){}
}

/* ─── INIT ──────────────────────────────────────── */
async function loadTasks() {
  loadTagColors();
  injectTaskUI();
  try {
    tasks = await apiGetTasks();
    tasks = tasks.map(normalizeTask);
    renderTasks();
    scheduleAllReminders();
  } catch (e) { toast('Failed to load tasks: ' + e.message); }
}

/** Ensure every task has the new fields (backward compat) */
function normalizeTask(t) {
  return {
    subtasks:    [],
    tags:        [],
    notes:       '',
    due:         '',
    ...t
  };
}

/* ─── ADD TASK ──────────────────────────────────── */
async function addTask() {
  const inp      = document.getElementById('t-inp');
  const text     = inp.value.trim(); if (!text) return;
  const priority = document.getElementById('t-pri').value;
  const due      = document.getElementById('t-due').value;
  const tagsRaw  = document.getElementById('t-tags').value.trim();
  const tags     = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const notes    = document.getElementById('t-notes').value.trim();

  try {
    const raw  = await apiAddTask(text, priority);
    const task = normalizeTask({ ...raw, due, tags, notes });
    // Persist extra fields via update (if API supports it)
    if (due || tags.length || notes) {
      try { await apiUpdateTask(task.id, { due, tags, notes }); } catch(_){}
    }
    tasks.unshift(task);
    inp.value = '';
    document.getElementById('t-due').value   = '';
    document.getElementById('t-tags').value  = '';
    document.getElementById('t-notes').value = '';
    tags.forEach(getTagColor);
    renderTasks();
    scheduleReminder(task);
    if (document.getElementById('t-adv-row').style.display !== 'none') toggleAddAdvanced();
  } catch (e) { toast('Error: ' + e.message); }
}

/* ─── TOGGLE / DELETE ───────────────────────────── */
async function toggleTask(id) {
  const t = tasks.find(t => t.id === id); if (!t) return;
  try {
    await apiUpdateTask(id, { done: !t.done });
    t.done = !t.done;
    renderTasks();
  } catch (e) { toast('Error: ' + e.message); }
}

async function delTask(id) {
  try {
    await apiDeleteTask(id);
    tasks = tasks.filter(t => t.id !== id);
    clearReminder(id);
    renderTasks();
  } catch (e) { toast('Error: ' + e.message); }
}

/* ─── INLINE EDIT ───────────────────────────────── */
function startEditTask(id) {
  const item = document.querySelector(`.t-item[data-id="${id}"]`);
  if (!item) return;
  const txtEl = item.querySelector('.t-txt');
  txtEl.contentEditable = 'true';
  txtEl.classList.add('editing');
  txtEl.focus();
  // select all
  const range = document.createRange();
  range.selectNodeContents(txtEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = async () => {
    txtEl.contentEditable = 'false';
    txtEl.classList.remove('editing');
    const newText = txtEl.textContent.trim();
    if (!newText) { renderTasks(); return; }
    const t = tasks.find(t => t.id === id);
    if (t && newText !== t.text) {
      t.text = newText;
      try { await apiUpdateTask(id, { text: newText }); }
      catch(e) { toast('Save failed: ' + e.message); }
    }
  };
  txtEl.onblur  = finish;
  txtEl.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); txtEl.blur(); }
    if (e.key === 'Escape') { txtEl.textContent = tasks.find(t=>t.id===id)?.text || ''; txtEl.blur(); }
  };
}

/* ─── SUBTASKS ──────────────────────────────────── */
function toggleSubtaskPanel(id) {
  const panel = document.getElementById(`sub-${id}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

async function addSubtask(id) {
  const inp = document.getElementById(`sub-inp-${id}`);
  const text = inp?.value.trim(); if (!text) return;
  const t = tasks.find(t => t.id === id); if (!t) return;
  const sub = { id: Date.now().toString(), text, done: false };
  t.subtasks.push(sub);
  inp.value = '';
  try { await apiUpdateTask(id, { subtasks: t.subtasks }); } catch(_){}
  renderTasks();
  // re-open panel
  const panel = document.getElementById(`sub-${id}`);
  if (panel) panel.style.display = '';
}

async function toggleSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  const s = t.subtasks.find(s => s.id === subId); if (!s) return;
  s.done = !s.done;
  try { await apiUpdateTask(taskId, { subtasks: t.subtasks }); } catch(_){}
  renderTasks();
  const panel = document.getElementById(`sub-${taskId}`);
  if (panel) panel.style.display = '';
}

async function delSubtask(taskId, subId) {
  const t = tasks.find(t => t.id === taskId); if (!t) return;
  t.subtasks = t.subtasks.filter(s => s.id !== subId);
  try { await apiUpdateTask(taskId, { subtasks: t.subtasks }); } catch(_){}
  renderTasks();
}

/* ─── NOTES ─────────────────────────────────────── */
function toggleNotesPanel(id) {
  const panel = document.getElementById(`notes-${id}`);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

async function saveNotes(id) {
  const t = tasks.find(t => t.id === id); if (!t) return;
  const ta = document.getElementById(`notes-ta-${id}`);
  t.notes = ta?.value || '';
  try { await apiUpdateTask(id, { notes: t.notes }); toast('Notes saved'); }
  catch(e) { toast('Save failed: ' + e.message); }
}

/* ─── DUE DATE REMINDERS ────────────────────────── */
function scheduleReminder(task) {
  if (!task.due) return;
  clearReminder(task.id);
  const due = new Date(task.due);
  const now = new Date();
  const msUntilDue = due - now;
  const msRemind   = msUntilDue - 30 * 60 * 1000; // 30 min before

  if (msRemind > 0) {
    reminderTimers[task.id] = setTimeout(() => {
      notifyReminder(task);
    }, msRemind);
  } else if (msUntilDue > 0) {
    notifyReminder(task, true); // overdue soon
  }
}

function scheduleAllReminders() {
  tasks.forEach(scheduleReminder);
}

function clearReminder(id) {
  if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
}

function notifyReminder(task, soon = false) {
  if (Notification && Notification.permission === 'granted') {
    new Notification(`Task due ${soon ? 'very soon' : 'in 30 min'}`, {
      body: task.text,
      icon: '📋'
    });
  } else {
    toast(`⏰ Reminder: "${task.text}" is due ${soon ? 'very soon' : 'in 30 min'}!`);
  }
}

function requestNotificationPermission() {
  if (Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

/* ─── DRAG TO REORDER ───────────────────────────── */
function onDragStart(e, id) {
  dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.t-item').forEach(el => el.classList.remove('drag-over'));
}
function onDragOver(e, id) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.t-item').forEach(el => el.classList.remove('drag-over'));
  if (id !== dragSrcId) e.currentTarget.classList.add('drag-over');
}
function onDrop(e, id) {
  e.preventDefault();
  if (!dragSrcId || dragSrcId === id) return;
  const srcIdx  = tasks.findIndex(t => t.id === dragSrcId);
  const destIdx = tasks.findIndex(t => t.id === id);
  if (srcIdx < 0 || destIdx < 0) return;
  const [moved] = tasks.splice(srcIdx, 1);
  tasks.splice(destIdx, 0, moved);
  dragSrcId = null;
  renderTasks();
}

/* ─── FILTER & SEARCH ───────────────────────────── */
function setFilter(f) {
  activeFilter = f;
  // update pill UI
  document.querySelectorAll('.t-filter-pill').forEach(el => {
    el.classList.toggle('active', el.dataset.filter === f);
  });
  renderTasks();
}

function onSearchInput(e) {
  searchQuery = e.target.value.toLowerCase();
  renderTasks();
}

function getFilteredTasks() {
  return tasks.filter(t => {
    // search
    if (searchQuery) {
      const haystack = (t.text + ' ' + (t.notes||'') + ' ' + (t.tags||[]).join(' ')).toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }
    // filter
    if (activeFilter === 'all') return true;
    if (activeFilter === 'high' || activeFilter === 'med' || activeFilter === 'low')
      return t.priority === activeFilter;
    // tag filter
    return (t.tags || []).includes(activeFilter);
  });
}

function getAllTags() {
  const set = new Set();
  tasks.forEach(t => (t.tags||[]).forEach(tag => set.add(tag)));
  return [...set];
}

/* ─── RENDER ─────────────────────────────────────── */
function renderTasks() {
  const filtered = getFilteredTasks();
  const pend = filtered.filter(t => !t.done);
  const done = filtered.filter(t =>  t.done);

  const pL = { high: 'High', med: 'Normal', low: 'Low' };
  const pC = { high: 'hi',   med: 'md',     low: 'lo'  };

  const subtaskBar = t => {
    if (!t.subtasks?.length) return '';
    const total = t.subtasks.length;
    const doneC = t.subtasks.filter(s=>s.done).length;
    const pct   = Math.round(doneC/total*100);
    return `<div class="sub-progress-wrap">
      <div class="sub-progress-bar"><div class="sub-progress-fill" style="width:${pct}%"></div></div>
      <span class="sub-progress-lbl">${doneC}/${total}</span>
    </div>`;
  };

  const dueChip = t => {
    if (!t.due) return '';
    const d   = new Date(t.due);
    const now = new Date();
    const diff = d - now;
    let cls = 'due-ok';
    if (diff < 0)              cls = 'due-over';
    else if (diff < 86400000)  cls = 'due-soon';
    const label = d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
    return `<span class="t-due-chip ${cls}">📅 ${label}</span>`;
  };

  const tagsHtml = t => (t.tags||[]).map(tag =>
    `<span class="t-tag-chip" style="background:${getTagColor(tag)}22;color:${getTagColor(tag)};border-color:${getTagColor(tag)}55"
      onclick="setFilter('${esc(tag)}')">${esc(tag)}</span>`
  ).join('');

  const subtaskPanel = t => {
    if (!t.subtasks) t.subtasks = [];
    const items = t.subtasks.map(s => `
      <div class="sub-item${s.done ? ' done' : ''}">
        <button class="sub-chk" onclick="toggleSubtask('${t.id}','${s.id}')">${s.done ? '✓' : ''}</button>
        <span class="sub-txt">${esc(s.text)}</span>
        <button class="sub-del" onclick="delSubtask('${t.id}','${s.id}')">×</button>
      </div>`).join('');
    return `<div class="sub-panel" id="sub-${t.id}" style="display:none">
      ${items}
      <div class="sub-add-row">
        <input class="sub-inp" id="sub-inp-${t.id}" placeholder="Add subtask…"
          onkeydown="if(event.key==='Enter'){addSubtask('${t.id}');document.getElementById('sub-${t.id}').style.display=''}">
        <button class="sub-add-btn" onclick="addSubtask('${t.id}');document.getElementById('sub-${t.id}').style.display=''">+</button>
      </div>
    </div>`;
  };

  const notesPanel = t => `
    <div class="notes-panel" id="notes-${t.id}" style="display:none">
      <textarea class="notes-ta" id="notes-ta-${t.id}" placeholder="Add notes…">${esc(t.notes||'')}</textarea>
      <button class="notes-save-btn" onclick="saveNotes('${t.id}')">Save notes</button>
    </div>`;

  const row = t => `
    <div class="t-item${t.done ? ' done' : ''}" data-id="${t.id}"
         draggable="true"
         ondragstart="onDragStart(event,'${t.id}')"
         ondragend="onDragEnd(event)"
         ondragover="onDragOver(event,'${t.id}')"
         ondrop="onDrop(event,'${t.id}')">

      <div class="t-drag-handle" title="Drag to reorder">⠿</div>

      <button class="t-chk" onclick="toggleTask('${t.id}')">${t.done ? '&#x2713;' : ''}</button>

      <div class="t-body">
        <div class="t-txt" ondblclick="startEditTask('${t.id}')" title="Double-click to edit">${esc(t.text)}</div>

        <div class="t-meta">
          <span class="t-tag ${pC[t.priority] || 'md'}">${pL[t.priority] || 'Normal'}</span>
          ${dueChip(t)}
          ${tagsHtml(t)}
          <span class="t-date">${t.date || ''}</span>
        </div>

        ${subtaskBar(t)}
      </div>

      <div class="t-actions">
        <button class="t-act-btn" onclick="startEditTask('${t.id}')" title="Edit">✏️</button>
        <button class="t-act-btn" onclick="toggleSubtaskPanel('${t.id}')" title="Subtasks">☑️</button>
        <button class="t-act-btn" onclick="toggleNotesPanel('${t.id}')" title="Notes">📝</button>
        <button class="t-del"     onclick="delTask('${t.id}')">&#xD7;</button>
      </div>

    </div>
    ${subtaskPanel(t)}
    ${notesPanel(t)}`;

  document.getElementById('t-pend').innerHTML = pend.map(row).join('');
  document.getElementById('t-done').innerHTML = done.map(row).join('');
  document.getElementById('pend-sec').style.display = pend.length ? '' : 'none';
  document.getElementById('done-sec').style.display = done.length ? '' : 'none';

  renderFilterPills();
}

function renderFilterPills() {
  const container = document.getElementById('t-filter-pills');
  if (!container) return;
  const tags = getAllTags();
  const pills = [
    { label: 'All',    f: 'all'  },
    { label: '🔴 High', f: 'high' },
    { label: '🟡 Med',  f: 'med'  },
    { label: '🟢 Low',  f: 'low'  },
    ...tags.map(tag => ({ label: tag, f: tag }))
  ];
  container.innerHTML = pills.map(p =>
    `<button class="t-filter-pill${activeFilter === p.f ? ' active' : ''}" data-filter="${p.f}" onclick="setFilter('${p.f}')">${p.label}</button>`
  ).join('');
}

/* ─── INJECT UI INTO DOM ────────────────────────── */
function injectTaskUI() {
  const box = document.querySelector('.ta-box');
  if (!box) return;

  // ── search & filter row above the add box
  const searchRow = document.createElement('div');
  searchRow.className = 'ta-search-row';
  searchRow.innerHTML = `
    <input class="ta-search" placeholder="🔍 Search tasks…" oninput="onSearchInput(event)">
    <div class="t-filter-pills" id="t-filter-pills"></div>
  `;
  box.parentNode.insertBefore(searchRow, box);

  // ── extend add-box with due / tags / notes (collapsible)
  // Add due date input after priority select
  const priSel = document.getElementById('t-pri');

  // Advanced toggle button
  const advBtn = document.createElement('button');
  advBtn.className = 'ta-adv-toggle';
  advBtn.textContent = '+ More';
  advBtn.onclick = toggleAddAdvanced;
  box.appendChild(advBtn);

  // Advanced row (hidden by default)
  const advRow = document.createElement('div');
  advRow.className = 'ta-adv-row';
  advRow.id = 'ta-adv-row-ref'; // used internally but we'll use id below
  advRow.style.display = 'none';
  advRow.innerHTML = `
    <div class="ta-adv-field">
      <label class="ta-adv-lbl">Due date</label>
      <input class="ta-adv-input" id="t-due" type="date">
    </div>
    <div class="ta-adv-field">
      <label class="ta-adv-lbl">Tags <span style="opacity:.6">(comma-separated)</span></label>
      <input class="ta-adv-input" id="t-tags" type="text" placeholder="work, urgent, personal">
    </div>
    <div class="ta-adv-field ta-adv-field--full">
      <label class="ta-adv-lbl">Notes</label>
      <textarea class="ta-adv-ta" id="t-notes" placeholder="Optional notes…" rows="2"></textarea>
    </div>
  `;
  advRow.id = 't-adv-row';
  box.parentNode.insertBefore(advRow, box.nextSibling);

  // Request notification permission for reminders
  requestNotificationPermission();
}

function toggleAddAdvanced() {
  const row = document.getElementById('t-adv-row');
  const btn = document.querySelector('.ta-adv-toggle');
  if (!row) return;
  const open = row.style.display === 'none';
  row.style.display = open ? '' : 'none';
  if (btn) btn.textContent = open ? '− Less' : '+ More';
}

/* ─── UTILITY ───────────────────────────────────── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}