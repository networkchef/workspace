/* ══════════════════════════════════════════
   tasks.js  —  enhanced with stats + layout
   ══════════════════════════════════════════ */

let tasks = [];
let activeFilter = 'all';
let searchQuery  = '';
let dragSrcId    = null;
let reminderTimers = {};

/* ── Tag colors ─────────────────────────── */
const TAG_COLORS = [
  '#6c8ebf','#82b366','#d6ae6b','#b5594e',
  '#8a6bbf','#4fb3b3','#c97abf','#5b8a5b'
];
let tagColorMap = {};
function getTagColor(tag) {
  if (!tagColorMap[tag]) {
    const idx = Object.keys(tagColorMap).length % TAG_COLORS.length;
    tagColorMap[tag] = TAG_COLORS[idx];
    try { localStorage.setItem('ws_tag_colors', JSON.stringify(tagColorMap)); } catch(_){}
  }
  return tagColorMap[tag];
}
function loadTagColors() {
  try { tagColorMap = JSON.parse(localStorage.getItem('ws_tag_colors') || '{}'); } catch(_){}
}

/* ── Normalize old + new tasks ──────────── */
function normalizeTask(t) {
  return { subtasks:[], tags:[], notes:'', due:'', ...t };
}

/* ── INIT ───────────────────────────────── */
async function loadTasks() {
  loadTagColors();
  injectTaskUI();
  try {
    tasks = await apiGetTasks();
    tasks = tasks.map(normalizeTask);
    renderTasks();
    renderStats();
    scheduleAllReminders();
  } catch(e) { toast('Failed to load tasks: ' + e.message); }
}

/* ── ADD ────────────────────────────────── */
async function addTask() {
  const inp      = document.getElementById('t-inp');
  const text     = inp.value.trim(); if (!text) return;
  const priority = document.getElementById('t-pri').value;
  const due      = document.getElementById('t-due')?.value  || '';
  const tagsRaw  = document.getElementById('t-tags')?.value || '';
  const tags     = tagsRaw ? tagsRaw.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const notes    = document.getElementById('t-notes')?.value.trim() || '';

  try {
    const raw  = await apiAddTask(text, priority);
    const task = normalizeTask({...raw, due, tags, notes});
    if (due || tags.length || notes) {
      try { await apiUpdateTask(task.id, {due,tags,notes}); } catch(_){}
    }
    tasks.unshift(task);
    inp.value = '';
    if (document.getElementById('t-due'))   document.getElementById('t-due').value   = '';
    if (document.getElementById('t-tags'))  document.getElementById('t-tags').value  = '';
    if (document.getElementById('t-notes')) document.getElementById('t-notes').value = '';
    tags.forEach(getTagColor);
    renderTasks();
    renderStats();
    scheduleReminder(task);
    const advRow = document.getElementById('t-adv-row');
    if (advRow && advRow.style.display !== 'none') toggleAddAdvanced();
  } catch(e) { toast('Error: ' + e.message); }
}

/* ── TOGGLE / DELETE ────────────────────── */
async function toggleTask(id) {
  const t = tasks.find(t=>t.id===id); if (!t) return;
  try {
    await apiUpdateTask(id, {done:!t.done});
    t.done = !t.done;
    renderTasks();
    renderStats();
  } catch(e) { toast('Error: ' + e.message); }
}

async function delTask(id) {
  try {
    await apiDeleteTask(id);
    tasks = tasks.filter(t=>t.id!==id);
    clearReminder(id);
    renderTasks();
    renderStats();
  } catch(e) { toast('Error: ' + e.message); }
}

/* ── INLINE EDIT ────────────────────────── */
function startEditTask(id) {
  const item  = document.querySelector(`.t-item[data-id="${id}"]`);
  if (!item) return;
  const txtEl = item.querySelector('.t-txt');
  txtEl.contentEditable = 'true';
  txtEl.classList.add('editing');
  txtEl.focus();
  const range = document.createRange();
  range.selectNodeContents(txtEl);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  const finish = async () => {
    txtEl.contentEditable = 'false';
    txtEl.classList.remove('editing');
    const newText = txtEl.textContent.trim();
    if (!newText) { renderTasks(); return; }
    const t = tasks.find(t=>t.id===id);
    if (t && newText !== t.text) {
      t.text = newText;
      try { await apiUpdateTask(id, {text:newText}); } catch(e) { toast('Save failed'); }
    }
  };
  txtEl.onblur    = finish;
  txtEl.onkeydown = e => {
    if (e.key==='Enter')  { e.preventDefault(); txtEl.blur(); }
    if (e.key==='Escape') { txtEl.textContent = tasks.find(t=>t.id===id)?.text||''; txtEl.blur(); }
  };
}

/* ── SUBTASKS ───────────────────────────── */
function toggleSubtaskPanel(id) {
  const p = document.getElementById(`sub-${id}`);
  if (p) p.style.display = p.style.display==='none' ? '' : 'none';
}
async function addSubtask(id) {
  const inp  = document.getElementById(`sub-inp-${id}`);
  const text = inp?.value.trim(); if (!text) return;
  const t    = tasks.find(t=>t.id===id); if (!t) return;
  const sub  = {id:Date.now().toString(), text, done:false};
  t.subtasks.push(sub);
  inp.value = '';
  try { await apiUpdateTask(id, {subtasks:t.subtasks}); } catch(_){}
  renderTasks();
  renderStats();
  const p = document.getElementById(`sub-${id}`);
  if (p) p.style.display = '';
}
async function toggleSubtask(taskId, subId) {
  const t = tasks.find(t=>t.id===taskId); if (!t) return;
  const s = t.subtasks.find(s=>s.id===subId); if (!s) return;
  s.done = !s.done;
  try { await apiUpdateTask(taskId, {subtasks:t.subtasks}); } catch(_){}
  renderTasks();
  const p = document.getElementById(`sub-${taskId}`);
  if (p) p.style.display = '';
}
async function delSubtask(taskId, subId) {
  const t = tasks.find(t=>t.id===taskId); if (!t) return;
  t.subtasks = t.subtasks.filter(s=>s.id!==subId);
  try { await apiUpdateTask(taskId, {subtasks:t.subtasks}); } catch(_){}
  renderTasks();
}

/* ── NOTES ──────────────────────────────── */
function toggleNotesPanel(id) {
  const p = document.getElementById(`notes-${id}`);
  if (p) p.style.display = p.style.display==='none' ? '' : 'none';
}
async function saveNotes(id) {
  const t  = tasks.find(t=>t.id===id); if (!t) return;
  const ta = document.getElementById(`notes-ta-${id}`);
  t.notes  = ta?.value || '';
  try { await apiUpdateTask(id, {notes:t.notes}); toast('Notes saved'); }
  catch(e) { toast('Save failed'); }
}

/* ── REMINDERS ──────────────────────────── */
function scheduleReminder(task) {
  if (!task.due) return;
  clearReminder(task.id);
  const due  = new Date(task.due);
  const now  = new Date();
  const diff = due - now;
  const msR  = diff - 30*60*1000;
  if (msR > 0) {
    reminderTimers[task.id] = setTimeout(() => notifyReminder(task), msR);
  } else if (diff > 0) {
    notifyReminder(task, true);
  }
}
function scheduleAllReminders() { tasks.forEach(scheduleReminder); }
function clearReminder(id) {
  if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
}
function notifyReminder(task, soon=false) {
  if (Notification && Notification.permission==='granted') {
    new Notification(`Task due ${soon?'very soon':'in 30 min'}`, {body:task.text});
  } else {
    toast(`[!] Reminder: "${task.text}" due ${soon?'very soon':'in 30 min'}`);
  }
}

/* ── DRAG ───────────────────────────────── */
function onDragStart(e,id) {
  dragSrcId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.classList.add('dragging');
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.t-item').forEach(el=>el.classList.remove('drag-over'));
}
function onDragOver(e,id) {
  e.preventDefault();
  document.querySelectorAll('.t-item').forEach(el=>el.classList.remove('drag-over'));
  if (id!==dragSrcId) e.currentTarget.classList.add('drag-over');
}
function onDrop(e,id) {
  e.preventDefault();
  if (!dragSrcId || dragSrcId===id) return;
  const si = tasks.findIndex(t=>t.id===dragSrcId);
  const di = tasks.findIndex(t=>t.id===id);
  if (si<0||di<0) return;
  const [m] = tasks.splice(si,1);
  tasks.splice(di,0,m);
  dragSrcId = null;
  renderTasks();
}

/* ── FILTER / SEARCH ────────────────────── */
function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.t-filter-pill').forEach(el =>
    el.classList.toggle('active', el.dataset.filter===f));
  renderTasks();
}
function onSearchInput(e) {
  searchQuery = e.target.value.toLowerCase();
  renderTasks();
}
function getFilteredTasks() {
  return tasks.filter(t => {
    if (searchQuery) {
      const hay = (t.text+' '+(t.notes||'')+' '+(t.tags||[]).join(' ')).toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    if (activeFilter==='all') return true;
    if (['high','med','low'].includes(activeFilter)) return t.priority===activeFilter;
    return (t.tags||[]).includes(activeFilter);
  });
}
function getAllTags() {
  const s = new Set();
  tasks.forEach(t=>(t.tags||[]).forEach(tag=>s.add(tag)));
  return [...s];
}

/* ── STATS ──────────────────────────────── */
function renderStats() {
  const el = document.getElementById('task-stats-panel');
  if (!el) return;

  const total     = tasks.length;
  const done      = tasks.filter(t=>t.done).length;
  const pending   = total - done;
  const pct       = total ? Math.round(done/total*100) : 0;

  // streak: count consecutive days with at least 1 task completed
  // we approximate using tasks that have a date and are done
  const doneDates = tasks
    .filter(t=>t.done && t.date)
    .map(t=> new Date(t.date).toDateString());
  const uniqueDays = [...new Set(doneDates)].sort();
  let streak = 0;
  if (uniqueDays.length) {
    let d = new Date(); d.setHours(0,0,0,0);
    for (let i=0;i<60;i++) {
      if (uniqueDays.includes(d.toDateString())) { streak++; d.setDate(d.getDate()-1); }
      else break;
    }
  }

  // overdue
  const now     = new Date();
  const overdue = tasks.filter(t=>!t.done && t.due && new Date(t.due)<now).length;

  // upcoming (next 3 days)
  const soon = tasks.filter(t=>{
    if (t.done||!t.due) return false;
    const diff = new Date(t.due)-now;
    return diff>0 && diff<3*86400000;
  }).length;

  el.innerHTML = `
    <div class="stats-title">-- STATS --</div>

    <div class="stats-donut-wrap">
      <svg viewBox="0 0 36 36" class="stats-donut">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--bdr,#e0e0e0)" stroke-width="3"/>
        <circle cx="18" cy="18" r="15.9" fill="none"
          stroke="var(--acc,#5b8a5b)" stroke-width="3"
          stroke-dasharray="${pct} ${100-pct}"
          stroke-dashoffset="25"
          stroke-linecap="round"/>
      </svg>
      <div class="stats-donut-label">${pct}<span>%</span></div>
    </div>
    <div class="stats-donut-sub">done</div>

    <div class="stats-grid">
      <div class="stats-cell">
        <div class="stats-num">${total}</div>
        <div class="stats-lbl">Total</div>
      </div>
      <div class="stats-cell">
        <div class="stats-num">${done}</div>
        <div class="stats-lbl">Done</div>
      </div>
      <div class="stats-cell">
        <div class="stats-num">${pending}</div>
        <div class="stats-lbl">Pending</div>
      </div>
      <div class="stats-cell ${streak>0?'streak-on':''}">
        <div class="stats-num">${streak}</div>
        <div class="stats-lbl">${streak===1?'day':'days'} streak</div>
      </div>
    </div>

    ${overdue ? `<div class="stats-alert overdue-alert">[!] ${overdue} overdue</div>` : ''}
    ${soon    ? `<div class="stats-alert soon-alert">(*) ${soon} due soon</div>` : ''}

    <div class="stats-bar-wrap">
      <div class="stats-bar-track">
        <div class="stats-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="stats-bar-labels">
        <span>0</span><span>${total}</span>
      </div>
    </div>
  `;
}

/* ── RENDER TASKS ───────────────────────── */
function renderTasks() {
  const filtered = getFilteredTasks();
  const pend = filtered.filter(t=>!t.done);
  const done = filtered.filter(t=> t.done);

  const pL = {high:'High', med:'Normal', low:'Low'};
  const pC = {high:'hi',   med:'md',     low:'lo'};

  const subtaskBar = t => {
    if (!t.subtasks?.length) return '';
    const tot  = t.subtasks.length;
    const done = t.subtasks.filter(s=>s.done).length;
    const pct  = Math.round(done/tot*100);
    return `<div class="sub-progress-wrap">
      <div class="sub-progress-bar"><div class="sub-progress-fill" style="width:${pct}%"></div></div>
      <span class="sub-progress-lbl">${done}/${tot}</span>
    </div>`;
  };

  const dueChip = t => {
    if (!t.due) return '';
    const d    = new Date(t.due);
    const diff = d - new Date();
    let cls = diff<0 ? 'due-over' : diff<86400000 ? 'due-soon' : 'due-ok';
    const lbl = d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
    return `<span class="t-due-chip ${cls}">[${lbl}]</span>`;
  };

  const tagsHtml = t => (t.tags||[]).map(tag=>
    `<span class="t-tag-chip" style="background:${getTagColor(tag)}22;color:${getTagColor(tag)};border-color:${getTagColor(tag)}55"
      onclick="setFilter('${esc(tag)}')">#${esc(tag)}</span>`
  ).join('');

  const subtaskPanel = t => {
    if (!t.subtasks) t.subtasks=[];
    const items = t.subtasks.map(s=>`
      <div class="sub-item${s.done?' done':''}">
        <button class="sub-chk" onclick="toggleSubtask('${t.id}','${s.id}')">${s.done?'x':' '}</button>
        <span class="sub-txt">${esc(s.text)}</span>
        <button class="sub-del" onclick="delSubtask('${t.id}','${s.id}')">x</button>
      </div>`).join('');
    return `<div class="sub-panel" id="sub-${t.id}" style="display:none">
      ${items}
      <div class="sub-add-row">
        <input class="sub-inp" id="sub-inp-${t.id}" placeholder="+ subtask..."
          onkeydown="if(event.key==='Enter'){addSubtask('${t.id}');document.getElementById('sub-${t.id}').style.display=''}">
        <button class="sub-add-btn" onclick="addSubtask('${t.id}');document.getElementById('sub-${t.id}').style.display=''">add</button>
      </div>
    </div>`;
  };

  const notesPanel = t => `
    <div class="notes-panel" id="notes-${t.id}" style="display:none">
      <textarea class="notes-ta" id="notes-ta-${t.id}" placeholder="rough notes...">${esc(t.notes||'')}</textarea>
      <button class="notes-save-btn" onclick="saveNotes('${t.id}')">save</button>
    </div>`;

  const row = t => `
    <div class="t-item${t.done?' done':''}" data-id="${t.id}"
         draggable="true"
         ondragstart="onDragStart(event,'${t.id}')"
         ondragend="onDragEnd(event)"
         ondragover="onDragOver(event,'${t.id}')"
         ondrop="onDrop(event,'${t.id}')">
      <div class="t-drag-handle" title="drag">::::</div>
      <button class="t-chk" onclick="toggleTask('${t.id}')">${t.done?'[x]':'[ ]'}</button>
      <div class="t-body">
        <div class="t-txt" ondblclick="startEditTask('${t.id}')" title="dbl-click to edit">${esc(t.text)}</div>
        <div class="t-meta">
          <span class="t-tag ${pC[t.priority]||'md'}">${pL[t.priority]||'Normal'}</span>
          ${dueChip(t)}
          ${tagsHtml(t)}
          <span class="t-date">${t.date||''}</span>
        </div>
        ${subtaskBar(t)}
      </div>
      <div class="t-actions">
        <button class="t-act-btn" onclick="startEditTask('${t.id}')"    title="edit">edit</button>
        <button class="t-act-btn" onclick="toggleSubtaskPanel('${t.id}')" title="subtasks">sub</button>
        <button class="t-act-btn" onclick="toggleNotesPanel('${t.id}')"   title="notes">note</button>
        <button class="t-del"     onclick="delTask('${t.id}')">del</button>
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
  const c = document.getElementById('t-filter-pills');
  if (!c) return;
  const tags  = getAllTags();
  const pills = [
    {label:'All',    f:'all'},
    {label:'High',   f:'high'},
    {label:'Med',    f:'med'},
    {label:'Low',    f:'low'},
    ...tags.map(tag=>({label:'#'+tag, f:tag}))
  ];
  c.innerHTML = pills.map(p=>
    `<button class="t-filter-pill${activeFilter===p.f?' active':''}" data-filter="${p.f}" onclick="setFilter('${p.f}')">${p.label}</button>`
  ).join('');
}

/* ── INJECT UI ──────────────────────────── */
function injectTaskUI() {
  // Wrap task view in a two-panel layout
  const tv = document.getElementById('task-view');
  if (!tv || tv.querySelector('.task-layout')) return;

  // Restructure: wrap existing .tl + add right panel
  const tl = tv.querySelector('.tl');
  if (!tl) return;

  const layout = document.createElement('div');
  layout.className = 'task-layout';
  tv.appendChild(layout);

  // Left: existing task list
  const leftCol = document.createElement('div');
  leftCol.className = 'task-col-left';
  leftCol.appendChild(tl);
  layout.appendChild(leftCol);

  // Right: stats + sticky notes
  const rightCol = document.createElement('div');
  rightCol.className = 'task-col-right';
  rightCol.innerHTML = `
    <div class="right-panel-inner">
      <div id="task-stats-panel" class="stats-panel"></div>
      <div class="sticky-section">
        <div class="sticky-hdr">
          <span class="sticky-title">-- SCRATCH PAD --</span>
          <button class="sticky-add-btn" onclick="addStickyNote()" title="New note">+</button>
        </div>
        <div class="sticky-list" id="sticky-list"></div>
      </div>
    </div>
  `;
  layout.appendChild(rightCol);

  // search + filter row above .tm
  const tm = tl.querySelector('.tm');
  if (tm) {
    const searchRow = document.createElement('div');
    searchRow.className = 'ta-search-row';
    searchRow.innerHTML = `
      <input class="ta-search" placeholder="search tasks..." oninput="onSearchInput(event)">
      <div class="t-filter-pills" id="t-filter-pills"></div>
    `;
    tm.insertBefore(searchRow, tm.firstChild);

    // Advanced add fields
    const box = tm.querySelector('.ta-box');
    if (box) {
      const advBtn = document.createElement('button');
      advBtn.className = 'ta-adv-toggle';
      advBtn.textContent = '+ more';
      advBtn.onclick = toggleAddAdvanced;
      box.appendChild(advBtn);

      const advRow = document.createElement('div');
      advRow.id = 't-adv-row';
      advRow.className = 'ta-adv-row';
      advRow.style.display = 'none';
      advRow.innerHTML = `
        <div class="ta-adv-field">
          <label class="ta-adv-lbl">due date</label>
          <input class="ta-adv-input" id="t-due" type="date">
        </div>
        <div class="ta-adv-field">
          <label class="ta-adv-lbl">tags (comma separated)</label>
          <input class="ta-adv-input" id="t-tags" type="text" placeholder="work, urgent">
        </div>
        <div class="ta-adv-field ta-adv-field--full">
          <label class="ta-adv-lbl">notes</label>
          <textarea class="ta-adv-ta" id="t-notes" placeholder="optional notes..." rows="2"></textarea>
        </div>
      `;
      box.parentNode.insertBefore(advRow, box.nextSibling);
    }
  }

  if (Notification && Notification.permission==='default') Notification.requestPermission();
}

function toggleAddAdvanced() {
  const row = document.getElementById('t-adv-row');
  const btn = document.querySelector('.ta-adv-toggle');
  if (!row) return;
  const open = row.style.display==='none';
  row.style.display = open ? '' : 'none';
  if (btn) btn.textContent = open ? '- less' : '+ more';
}

/* ── STICKY NOTES ───────────────────────── */
let stickyNotes = [];

function loadStickyNotes() {
  try { stickyNotes = JSON.parse(localStorage.getItem('ws_stickies') || '[]'); }
  catch(_) { stickyNotes = []; }
  renderStickyNotes();
}

function saveStickyNotes() {
  try { localStorage.setItem('ws_stickies', JSON.stringify(stickyNotes)); } catch(_){}
}

const STICKY_COLORS = [
  '#fef3c7', // amber
  '#dcfce7', // green
  '#dbeafe', // blue
  '#fce7f3', // pink
  '#ede9fe', // purple
  '#ffedd5', // orange
];

function addStickyNote() {
  const note = {
    id:    Date.now().toString(),
    text:  '',
    color: STICKY_COLORS[stickyNotes.length % STICKY_COLORS.length],
    created: new Date().toLocaleDateString(undefined,{month:'short',day:'numeric'})
  };
  stickyNotes.unshift(note);
  saveStickyNotes();
  renderStickyNotes();
  // focus the new note
  setTimeout(()=>{
    const ta = document.getElementById(`sticky-ta-${note.id}`);
    if (ta) ta.focus();
  }, 50);
}

function delStickyNote(id) {
  stickyNotes = stickyNotes.filter(n=>n.id!==id);
  saveStickyNotes();
  renderStickyNotes();
}

function onStickyInput(id, el) {
  const n = stickyNotes.find(n=>n.id===id);
  if (n) { n.text = el.value; saveStickyNotes(); }
}

function changeStickyColor(id, color) {
  const n = stickyNotes.find(n=>n.id===id);
  if (n) { n.color = color; saveStickyNotes(); renderStickyNotes(); }
}

function renderStickyNotes() {
  const list = document.getElementById('sticky-list');
  if (!list) return;

  if (!stickyNotes.length) {
    list.innerHTML = `<div class="sticky-empty">no notes yet.<br>click + to add one.</div>`;
    return;
  }

  list.innerHTML = stickyNotes.map(n=>`
    <div class="sticky-card" style="background:${n.color}">
      <div class="sticky-card-hdr">
        <span class="sticky-date">${n.created||''}</span>
        <div class="sticky-color-dots">
          ${STICKY_COLORS.map(c=>
            `<button class="sticky-dot${n.color===c?' active':''}" style="background:${c}"
              onclick="changeStickyColor('${n.id}','${c}')"></button>`
          ).join('')}
        </div>
        <button class="sticky-del" onclick="delStickyNote('${n.id}')">x</button>
      </div>
      <textarea class="sticky-ta" id="sticky-ta-${n.id}"
        placeholder="write anything..."
        oninput="onStickyInput('${n.id}',this)">${esc(n.text)}</textarea>
    </div>
  `).join('');
}

/* ── UTILITY ────────────────────────────── */
function esc(s) {
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}