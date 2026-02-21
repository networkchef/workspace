/* ══════════════════════════════════════════
   api.js  —  all backend communication
   Points at your FastAPI server
   ══════════════════════════════════════════ */

// ── Set your Ubuntu server URL here before deploying ──────────────────────────
const API_BASE = window.WS_API_URL || 'http://YOUR_SERVER_IP:3001/api';

// ── Token helpers ──────────────────────────────────────────────────────────────
function getToken()           { return localStorage.getItem('ws_token'); }
function setToken(t)          { localStorage.setItem('ws_token', t); }
function clearToken()         { localStorage.removeItem('ws_token'); localStorage.removeItem('ws_user'); }

// ── Base fetch wrapper ─────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach server. Is the backend running?');
  }

  // FastAPI returns detail field for errors
  if (!res.ok) {
    let msg = 'Request failed';
    try {
      const err = await res.json();
      msg = err.detail || err.error || msg;
    } catch {}
    throw new Error(msg);
  }

  return res.json();
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
async function apiSignup(username, password) {
  // FastAPI expects snake_case body, returns token + username
  const d = await apiFetch('/auth/signup', { method: 'POST', body: { username, password } });
  setToken(d.token);
  localStorage.setItem('ws_user', d.username);
  return d;
}

async function apiSignin(username, password) {
  const d = await apiFetch('/auth/signin', { method: 'POST', body: { username, password } });
  setToken(d.token);
  localStorage.setItem('ws_user', d.username);
  return d;
}

async function apiChangePassword(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

// ═══════════════════════════════════════════
// NOTEBOOKS
// ═══════════════════════════════════════════
async function apiGetNotebooks()         { return apiFetch('/notebooks/'); }
async function apiCreateNotebook(title, parentId) { return apiFetch('/notebooks/', { method: 'POST', body: { title, parent_id: parentId || null } }); }
async function apiUpdateNotebook(id, title) { return apiFetch('/notebooks/' + id, { method: 'PUT', body: { title } }); }
async function apiDeleteNotebook(id)     { return apiFetch('/notebooks/' + id, { method: 'DELETE' }); }
async function apiGetContent(id)         { return apiFetch('/notebooks/' + id + '/content'); }
async function apiSaveContent(id, html)  { return apiFetch('/notebooks/' + id + '/content', { method: 'PUT', body: { html } }); }

async function apiUploadImage(nbId, filename, base64Data) {
  return apiFetch('/notebooks/' + nbId + '/images', {
    method: 'POST',
    body: { filename, data: base64Data },
  });
}

function apiImageUrl(nbId, filename) {
  // Image requests need the auth token as a query param because
  // browser <img> tags cannot send custom headers.
  const token = getToken();
  return `${API_BASE}/notebooks/${nbId}/images/${filename}?token=${token}`;
}

async function apiDeleteImage(nbId, filename) {
  return apiFetch('/notebooks/' + nbId + '/images/' + filename, { method: 'DELETE' });
}

// ═══════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════
async function apiGetTasks()              { return apiFetch('/tasks/'); }
async function apiAddTask(text, priority) { return apiFetch('/tasks/', { method: 'POST', body: { text, priority } }); }
async function apiUpdateTask(id, data)    { return apiFetch('/tasks/' + id, { method: 'PUT', body: data }); }
async function apiDeleteTask(id)          { return apiFetch('/tasks/' + id, { method: 'DELETE' }); }
