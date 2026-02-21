/* ══════════════════════════════════════════
   tasks.js  —  task manager logic
   ══════════════════════════════════════════ */

let tasks = [];

async function loadTasks() {
  try {
    tasks = await apiGetTasks();
    renderTasks();
  } catch (e) { toast('Failed to load tasks: ' + e.message); }
}

async function addTask() {
  const inp  = document.getElementById('t-inp');
  const text = inp.value.trim(); if (!text) return;
  const priority = document.getElementById('t-pri').value;
  try {
    const task = await apiAddTask(text, priority);
    tasks.unshift(task);
    inp.value = '';
    renderTasks();
  } catch (e) { toast('Error: ' + e.message); }
}

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
    renderTasks();
  } catch (e) { toast('Error: ' + e.message); }
}

function renderTasks() {
  const pend = tasks.filter(t => !t.done);
  const done = tasks.filter(t =>  t.done);

  const pL = { high: 'High', med: 'Normal', low: 'Low' };
  const pC = { high: 'hi',   med: 'md',     low: 'lo'  };

  const row = t => `
    <div class="t-item${t.done ? ' done' : ''}">
      <button class="t-chk" onclick="toggleTask('${t.id}')">${t.done ? '&#x2713;' : ''}</button>
      <div class="t-body">
        <div class="t-txt">${esc(t.text)}</div>
        <div class="t-meta">
          <span class="t-tag ${pC[t.priority] || 'md'}">${pL[t.priority] || 'Normal'}</span>
          <span class="t-date">${t.date || ''}</span>
        </div>
      </div>
      <button class="t-del" onclick="delTask('${t.id}')">&#xD7;</button>
    </div>`;

  document.getElementById('t-pend').innerHTML = pend.map(row).join('');
  document.getElementById('t-done').innerHTML = done.map(row).join('');
  document.getElementById('pend-sec').style.display = pend.length ? '' : 'none';
  document.getElementById('done-sec').style.display = done.length ? '' : 'none';
}
