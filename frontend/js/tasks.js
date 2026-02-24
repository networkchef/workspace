/* ══════════════════════════════════════════
   tasks.js  —  v2: planner + calendar + floating scratch pads
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
  // NOTE: injectTaskUI() and loadScratchPads() are called by switchMode()
  // in app.js when the user switches to the tasks view — NOT here.
  // This prevents task DOM from injecting into the notebook view on first paint.
  try {
    tasks = await apiGetTasks();
    tasks = tasks.map(normalizeTask);
    // Only render if the task view is currently visible
    if (document.getElementById('task-view')?.style.display !== 'none') {
      renderTasks();
      renderPlannerView();
      renderCalendarView();
    }
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
    renderPlannerView();
    renderCalendarView();
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
    renderPlannerView();
    renderCalendarView();
  } catch(e) { toast('Error: ' + e.message); }
}

async function delTask(id) {
  try {
    await apiDeleteTask(id);
    tasks = tasks.filter(t=>t.id!==id);
    clearReminder(id);
    renderTasks();
    renderPlannerView();
    renderCalendarView();
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

/* ══════════════════════════════════════════
   FLOATING SCRATCH PADS
   — Persists via localStorage
   — Draggable anywhere on screen
   — Only clears when user explicitly closes
   ══════════════════════════════════════════ */

let scratchPads = [];
let activeDragPad = null;
let padDragOffset = {x:0, y:0};

const PAD_COLORS = [
  {bg:'#fef9c3', border:'#fde047', hdr:'#fef08a'},
  {bg:'#dbeafe', border:'#93c5fd', hdr:'#bfdbfe'},
  {bg:'#dcfce7', border:'#86efac', hdr:'#bbf7d0'},
  {bg:'#fce7f3', border:'#f9a8d4', hdr:'#fbcfe8'},
  {bg:'#ede9fe', border:'#c4b5fd', hdr:'#ddd6fe'},
  {bg:'#ffedd5', border:'#fdba74', hdr:'#fed7aa'},
];

let _scratchPadsLoaded = false;
function loadScratchPads() {
  if (_scratchPadsLoaded) return;   // only render once per session
  _scratchPadsLoaded = true;
  try {
    scratchPads = JSON.parse(localStorage.getItem('ws_scratch_pads') || '[]');
  } catch(_) { scratchPads = []; }
  scratchPads.forEach(pad => renderScratchPad(pad));
}

function saveScratchPads() {
  try { localStorage.setItem('ws_scratch_pads', JSON.stringify(scratchPads)); } catch(_){}
}

function createScratchPad(x, y) {
  const colorIdx = scratchPads.length % PAD_COLORS.length;
  const pad = {
    id: Date.now().toString(),
    text: '',
    colorIdx,
    x: x || (120 + Math.random() * 200),
    y: y || (120 + Math.random() * 150),
    w: 240,
    h: 180,
    created: new Date().toLocaleDateString(undefined, {month:'short', day:'numeric'})
  };
  scratchPads.push(pad);
  saveScratchPads();
  renderScratchPad(pad);
  // focus textarea
  setTimeout(() => {
    const ta = document.getElementById(`sp-ta-${pad.id}`);
    if (ta) ta.focus();
  }, 50);
}

function closeScratchPad(id) {
  const el = document.getElementById(`sp-${id}`);
  if (el) {
    el.style.transform = 'scale(0.85)';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }
  scratchPads = scratchPads.filter(p => p.id !== id);
  saveScratchPads();
}

function onPadInput(id, el) {
  const p = scratchPads.find(p => p.id === id);
  if (p) { p.text = el.value; saveScratchPads(); }
}

function cyclePadColor(id) {
  const p = scratchPads.find(p => p.id === id);
  if (!p) return;
  p.colorIdx = (p.colorIdx + 1) % PAD_COLORS.length;
  saveScratchPads();
  const el = document.getElementById(`sp-${id}`);
  if (!el) return;
  const c = PAD_COLORS[p.colorIdx];
  el.style.background = c.bg;
  el.style.borderColor = c.border;
  el.querySelector('.sp-hdr').style.background = c.hdr;
}

function renderScratchPad(pad) {
  // Remove existing if re-rendering
  const existing = document.getElementById(`sp-${pad.id}`);
  if (existing) existing.remove();

  const c = PAD_COLORS[pad.colorIdx] || PAD_COLORS[0];
  const el = document.createElement('div');
  el.id = `sp-${pad.id}`;
  el.className = 'scratch-pad';
  el.style.cssText = `
    left:${pad.x}px; top:${pad.y}px;
    width:${pad.w}px; min-height:${pad.h}px;
    background:${c.bg}; border-color:${c.border};
  `;
  el.innerHTML = `
    <div class="sp-hdr" style="background:${c.hdr}" data-pad-id="${pad.id}">
      <span class="sp-date">${pad.created}</span>
      <button class="sp-color-btn" onclick="cyclePadColor('${pad.id}')" title="Change color">◉</button>
      <button class="sp-close" onclick="closeScratchPad('${pad.id}')" title="Close">✕</button>
    </div>
    <textarea class="sp-ta" id="sp-ta-${pad.id}"
      placeholder="scratch pad..."
      oninput="onPadInput('${pad.id}',this)">${esc(pad.text)}</textarea>
    <div class="sp-resize" data-pad-id="${pad.id}">⌟</div>
  `;
  document.body.appendChild(el);

  // Drag via header
  const hdr = el.querySelector('.sp-hdr');
  hdr.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    activeDragPad = pad.id;
    const rect = el.getBoundingClientRect();
    padDragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    el.style.transition = 'none';
    el.classList.add('sp-dragging');
    e.preventDefault();
  });

  // Resize handle
  const resizeHandle = el.querySelector('.sp-resize');
  let isResizing = false;
  let resizeStart = {};
  resizeHandle.addEventListener('mousedown', e => {
    isResizing = true;
    resizeStart = { x: e.clientX, y: e.clientY, w: el.offsetWidth, h: el.offsetHeight };
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener('mousemove', e => {
    if (isResizing) {
      const nw = Math.max(180, resizeStart.w + (e.clientX - resizeStart.x));
      const nh = Math.max(120, resizeStart.h + (e.clientY - resizeStart.y));
      el.style.width = nw + 'px';
      el.style.minHeight = nh + 'px';
      pad.w = nw; pad.h = nh;
      saveScratchPads();
    }
    if (activeDragPad === pad.id) {
      const nx = e.clientX - padDragOffset.x;
      const ny = e.clientY - padDragOffset.y;
      el.style.left = Math.max(0, nx) + 'px';
      el.style.top  = Math.max(0, ny) + 'px';
      pad.x = Math.max(0, nx);
      pad.y = Math.max(0, ny);
      saveScratchPads();
    }
  });

  document.addEventListener('mouseup', () => {
    if (activeDragPad === pad.id) {
      activeDragPad = null;
      el.classList.remove('sp-dragging');
    }
    isResizing = false;
  });

  // Animate in
  el.style.opacity = '0';
  el.style.transform = 'scale(0.9)';
  el.style.transition = 'opacity .2s ease, transform .2s ease';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'scale(1)';
  });
}

/* ── Scratch pad toggle button (FAB) ─────── */
function injectScratchPadFAB() {
  if (document.getElementById('sp-fab')) return;
  const fab = document.createElement('button');
  fab.id = 'sp-fab';
  fab.className = 'sp-fab';
  fab.title = 'New Scratch Pad';
  fab.innerHTML = '📝';
  fab.onclick = () => createScratchPad(
    80 + Math.random() * 300,
    100 + Math.random() * 200
  );
  document.body.appendChild(fab);
}

/* ══════════════════════════════════════════
   TASK VIEW TABS: List | Daily | Weekly | Calendar
   ══════════════════════════════════════════ */

let activeTaskTab = 'list';
let plannerWeekOffset = 0;  // 0 = current week
let calendarMonth = new Date().getMonth();
let calendarYear  = new Date().getFullYear();
let calendarSelectedDate = null;

function switchTaskTab(tab) {
  activeTaskTab = tab;
  document.querySelectorAll('.ttab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tv-list').style.display    = tab === 'list'     ? '' : 'none';
  document.getElementById('tv-daily').style.display   = tab === 'daily'    ? '' : 'none';
  document.getElementById('tv-weekly').style.display  = tab === 'weekly'   ? '' : 'none';
  document.getElementById('tv-calendar').style.display = tab === 'calendar' ? '' : 'none';

  if (tab === 'daily')    renderDailyView();
  if (tab === 'weekly')   renderWeeklyView();
  if (tab === 'calendar') renderCalendarView();
}

/* ── DAILY PLANNER ───────────────────────── */
let dailyDate = new Date();
dailyDate.setHours(0,0,0,0);

function fmtDate(d) {
  return d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
}
function fmtDateShort(d) {
  return d.toLocaleDateString(undefined, {month:'short', day:'numeric'});
}
function isoDate(d) {
  return d.toISOString().slice(0,10);
}

function navDailyDate(delta) {
  dailyDate.setDate(dailyDate.getDate() + delta);
  renderDailyView();
}

function renderDailyView() {
  const el = document.getElementById('tv-daily');
  if (!el) return;
  const dateStr = isoDate(dailyDate);
  const today   = isoDate(new Date());
  const isToday = dateStr === today;

  // tasks due on this date
  const dueTasks = tasks.filter(t => t.due && t.due.slice(0,10) === dateStr);
  // tasks created on this date
  const createdTasks = tasks.filter(t => t.date && t.date.slice(0,10) === dateStr);

  const hours = Array.from({length:24}, (_,i) => i);

  // Get saved planner blocks for this date
  let plannerBlocks = {};
  try { plannerBlocks = JSON.parse(localStorage.getItem(`ws_planner_${dateStr}`) || '{}'); } catch(_){}

  el.innerHTML = `
    <div class="planner-hdr">
      <button class="planner-nav" onclick="navDailyDate(-1)">◀</button>
      <div class="planner-date-wrap">
        <div class="planner-date-main">${fmtDate(dailyDate)}</div>
        ${isToday ? '<div class="planner-today-badge">TODAY</div>' : ''}
      </div>
      <button class="planner-nav" onclick="navDailyDate(1)">▶</button>
      <button class="planner-nav-today" onclick="dailyDate=new Date();dailyDate.setHours(0,0,0,0);renderDailyView()">Today</button>
    </div>

    <div class="daily-body">
      <div class="daily-timeline">
        ${hours.map(h => {
          const key = String(h).padStart(2,'0');
          const saved = plannerBlocks[key] || '';
          const tasksDue = dueTasks.filter(t => {
            if (!t.due) return false;
            const dh = new Date(t.due).getHours();
            return dh === h;
          });
          return `
          <div class="daily-hour-row" data-hour="${h}">
            <div class="daily-hour-lbl">${h === 0 ? '12 AM' : h < 12 ? h+' AM' : h===12?'12 PM':(h-12)+' PM'}</div>
            <div class="daily-hour-cell">
              <textarea class="daily-block-ta" placeholder="..." rows="1"
                onchange="saveDailyBlock('${dateStr}','${key}',this.value)"
                oninput="autoResizeTa(this)">${esc(saved)}</textarea>
              ${tasksDue.map(t=>`
                <div class="daily-task-chip${t.done?' done':''}">
                  <button class="daily-chip-chk" onclick="toggleTask('${t.id}')">${t.done?'✓':'○'}</button>
                  <span>${esc(t.text)}</span>
                  <span class="t-tag ${t.priority==='high'?'hi':t.priority==='low'?'lo':'md'}">${t.priority||'med'}</span>
                </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>

      <div class="daily-sidebar">
        <div class="daily-sidebar-sec">
          <div class="daily-sidebar-hdr">[!] DUE TODAY</div>
          ${dueTasks.length === 0
            ? '<div class="daily-sidebar-empty">nothing due</div>'
            : dueTasks.map(t=>`
              <div class="daily-side-task${t.done?' done':''}">
                <button class="t-chk" onclick="toggleTask('${t.id}')">${t.done?'[x]':'[ ]'}</button>
                <span>${esc(t.text)}</span>
              </div>`).join('')}
        </div>

        <div class="daily-sidebar-sec">
          <div class="daily-sidebar-hdr">[+] ALL PENDING</div>
          ${tasks.filter(t=>!t.done).slice(0,10).map(t=>`
            <div class="daily-side-task">
              <button class="t-chk" onclick="toggleTask('${t.id}')">${t.done?'[x]':'[ ]'}</button>
              <span>${esc(t.text)}</span>
            </div>`).join('') || '<div class="daily-sidebar-empty">all done!</div>'}
        </div>
      </div>
    </div>
  `;

  // Scroll to 8am on load
  setTimeout(() => {
    const rows = el.querySelectorAll('.daily-hour-row');
    if (rows[8]) rows[8].scrollIntoView({block:'start', behavior:'smooth'});
  }, 100);
}

function saveDailyBlock(dateStr, hour, val) {
  try {
    let blocks = JSON.parse(localStorage.getItem(`ws_planner_${dateStr}`) || '{}');
    if (val.trim()) blocks[hour] = val;
    else delete blocks[hour];
    localStorage.setItem(`ws_planner_${dateStr}`, JSON.stringify(blocks));
  } catch(_){}
}

function autoResizeTa(ta) {
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight) + 'px';
}

/* ── WEEKLY PLANNER ──────────────────────── */
function getWeekDays(offset) {
  const now = new Date();
  const day = now.getDay(); // 0=sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day===0?6:day-1) + offset*7);
  monday.setHours(0,0,0,0);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate()+i);
    return d;
  });
}

function renderWeeklyView() {
  const el = document.getElementById('tv-weekly');
  if (!el) return;
  const days = getWeekDays(plannerWeekOffset);
  const todayStr = isoDate(new Date());

  el.innerHTML = `
    <div class="planner-hdr">
      <button class="planner-nav" onclick="plannerWeekOffset--;renderWeeklyView()">◀</button>
      <div class="planner-date-wrap">
        <div class="planner-date-main">${fmtDateShort(days[0])} – ${fmtDateShort(days[6])}, ${days[0].getFullYear()}</div>
      </div>
      <button class="planner-nav" onclick="plannerWeekOffset++;renderWeeklyView()">▶</button>
      <button class="planner-nav-today" onclick="plannerWeekOffset=0;renderWeeklyView()">This Week</button>
    </div>

    <div class="weekly-grid">
      ${days.map(d => {
        const ds = isoDate(d);
        const isToday = ds === todayStr;
        const dayTasks = tasks.filter(t => t.due && t.due.slice(0,10) === ds);
        let blocks = {};
        try { blocks = JSON.parse(localStorage.getItem(`ws_planner_${ds}`) || '{}'); } catch(_){}
        const noteVal = blocks['__day__'] || '';

        return `
        <div class="weekly-col${isToday?' today':''}">
          <div class="weekly-col-hdr">
            <div class="weekly-day-name">${d.toLocaleDateString(undefined,{weekday:'short'})}</div>
            <div class="weekly-day-num${isToday?' today-num':''}">${d.getDate()}</div>
          </div>
          <div class="weekly-col-body">
            <textarea class="weekly-note-ta" placeholder="plan..."
              onchange="saveDailyBlock('${ds}','__day__',this.value)"
              oninput="autoResizeTa(this)">${esc(noteVal)}</textarea>
            <div class="weekly-tasks">
              ${dayTasks.map(t=>`
                <div class="weekly-task-item${t.done?' done':''}">
                  <button class="weekly-chk" onclick="toggleTask('${t.id}')">${t.done?'✓':'○'}</button>
                  <span class="weekly-task-txt">${esc(t.text)}</span>
                </div>`).join('') || ''}
            </div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

/* ── CALENDAR VIEW ───────────────────────── */
function renderCalendarView() {
  const el = document.getElementById('tv-calendar');
  if (!el) return;

  const firstDay = new Date(calendarYear, calendarMonth, 1);
  const lastDay  = new Date(calendarYear, calendarMonth+1, 0);
  const startDow = firstDay.getDay(); // 0=sun
  const todayStr = isoDate(new Date());

  // Collect tasks per date
  const tasksByDate = {};
  tasks.forEach(t => {
    const d = t.due ? t.due.slice(0,10) : (t.date ? t.date.slice(0,10) : null);
    if (d) {
      if (!tasksByDate[d]) tasksByDate[d] = [];
      tasksByDate[d].push(t);
    }
  });

  const monthName = firstDay.toLocaleDateString(undefined, {month:'long', year:'numeric'});
  const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  // Build calendar cells
  const cells = [];
  for (let i=0; i<startDow; i++) cells.push(null);
  for (let d=1; d<=lastDay.getDate(); d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const selDs = calendarSelectedDate;

  el.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-top">
        <div class="cal-grid-wrap">
          <div class="cal-hdr">
            <button class="planner-nav" onclick="if(calendarMonth===0){calendarMonth=11;calendarYear--;}else{calendarMonth--;}renderCalendarView()">◀</button>
            <span class="cal-month-lbl">${monthName}</span>
            <button class="planner-nav" onclick="if(calendarMonth===11){calendarMonth=0;calendarYear++;}else{calendarMonth++;}renderCalendarView()">▶</button>
            <button class="planner-nav-today" onclick="calendarMonth=new Date().getMonth();calendarYear=new Date().getFullYear();renderCalendarView()">Today</button>
          </div>
          <div class="cal-dow-row">
            ${dowLabels.map(d=>`<div class="cal-dow">${d}</div>`).join('')}
          </div>
          <div class="cal-grid">
            ${cells.map((day, i) => {
              if (day === null) return `<div class="cal-cell empty"></div>`;
              const ds = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const dayTasks = tasksByDate[ds] || [];
              const isToday = ds === todayStr;
              const isSel   = ds === selDs;
              const hasOver = dayTasks.some(t => !t.done && new Date(t.due||t.date) < new Date());
              return `
              <div class="cal-cell${isToday?' cal-today':''}${isSel?' cal-selected':''}${hasOver?' cal-has-overdue':''}"
                   onclick="calendarSelectedDate='${ds}';renderCalendarView()">
                <div class="cal-day-num">${day}</div>
                <div class="cal-task-dots">
                  ${dayTasks.slice(0,3).map(t=>`
                    <div class="cal-task-dot${t.done?' done':''} pri-${t.priority||'med'}" title="${esc(t.text)}"></div>
                  `).join('')}
                  ${dayTasks.length > 3 ? `<div class="cal-more-dots">+${dayTasks.length-3}</div>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>

        <div class="cal-detail-panel">
          ${selDs ? renderCalendarDayDetail(selDs, tasksByDate[selDs]||[]) : `
            <div class="cal-detail-empty">
              <div style="font-size:28px">📅</div>
              <div>Click a date to see tasks</div>
            </div>`}
        </div>
      </div>
    </div>
  `;
}

function renderCalendarDayDetail(ds, dayTasks) {
  const d = new Date(ds + 'T00:00:00');
  const label = d.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'});
  return `
    <div class="cal-detail-hdr">${label}</div>
    ${dayTasks.length === 0
      ? '<div class="cal-detail-empty"><div>No tasks for this day</div></div>'
      : dayTasks.map(t=>`
        <div class="cal-detail-task${t.done?' done':''}">
          <button class="t-chk" onclick="toggleTask('${t.id}');event.stopPropagation()">${t.done?'[x]':'[ ]'}</button>
          <div class="cal-detail-task-body">
            <div class="cal-detail-task-txt">${esc(t.text)}</div>
            <span class="t-tag ${t.priority==='high'?'hi':t.priority==='low'?'lo':'md'}">${t.priority||'med'}</span>
          </div>
          <button class="t-del" onclick="delTask('${t.id}');event.stopPropagation()">del</button>
        </div>`).join('')}
  `;
}

/* ── INJECT UI ──────────────────────────── */
function injectTaskUI() {
  const tv = document.getElementById('task-view');
  if (!tv || tv.querySelector('.ttab-bar')) return;

  // Build tab bar
  const tabBar = document.createElement('div');
  tabBar.className = 'ttab-bar';
  tabBar.innerHTML = `
    <button class="ttab-btn active" data-tab="list"     onclick="switchTaskTab('list')">    ≡ List</button>
    <button class="ttab-btn"        data-tab="daily"    onclick="switchTaskTab('daily')">   ◷ Daily</button>
    <button class="ttab-btn"        data-tab="weekly"   onclick="switchTaskTab('weekly')">  ☷ Weekly</button>
    <button class="ttab-btn"        data-tab="calendar" onclick="switchTaskTab('calendar')">◫ Calendar</button>
  `;
  tv.insertBefore(tabBar, tv.firstChild);

  // Wrap existing .tl in #tv-list
  const tl = tv.querySelector('.tl');
  if (tl) {
    const listWrap = document.createElement('div');
    listWrap.id = 'tv-list';
    listWrap.className = 'tv-panel';
    tl.parentNode.insertBefore(listWrap, tl);
    listWrap.appendChild(tl);
  }

  // Add other panels
  ['daily','weekly','calendar'].forEach(tab => {
    const panel = document.createElement('div');
    panel.id = `tv-${tab}`;
    panel.className = 'tv-panel';
    panel.style.display = 'none';
    tv.appendChild(panel);
  });

  // search + filter row inside .tm
  const tm = tv.querySelector('.tm');
  if (tm) {
    const searchRow = document.createElement('div');
    searchRow.className = 'ta-search-row';
    searchRow.innerHTML = `
      <input class="ta-search" placeholder="search tasks..." oninput="onSearchInput(event)">
      <div class="t-filter-pills" id="t-filter-pills"></div>
    `;
    tm.insertBefore(searchRow, tm.firstChild);

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

  injectScratchPadFAB();
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

function renderPlannerView() {
  if (activeTaskTab === 'daily')   renderDailyView();
  if (activeTaskTab === 'weekly')  renderWeeklyView();
  if (activeTaskTab === 'calendar') renderCalendarView();
}

/* ── UTILITY ────────────────────────────── */
function esc(s) {
  return String(s??'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}