/* ══════════════════════════════════════
   api.js — all backend communication
   ══════════════════════════════════════ */

// Set this to your Ubuntu server's public IP / domain
const API_BASE = window.WS_API_URL || 'http://YOUR_SERVER_IP:3001/api';

function getToken() { return localStorage.getItem('ws_token'); }
function setToken(t) { localStorage.setItem('ws_token', t); }
function clearToken() { localStorage.removeItem('ws_token'); localStorage.removeItem('ws_user'); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE + path, {
    ...opts,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ── Auth ──
async function apiSignup(username, password) {
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
  return apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
}

// ── Notebooks ──
async function apiGetNotebooks() { return apiFetch('/notebooks'); }
async function apiCreateNotebook(title) { return apiFetch('/notebooks', { method: 'POST', body: { title } }); }
async function apiUpdateNotebook(id, title) { return apiFetch('/notebooks/' + id, { method: 'PUT', body: { title } }); }
async function apiDeleteNotebook(id) { return apiFetch('/notebooks/' + id, { method: 'DELETE' }); }
async function apiGetContent(id) { return apiFetch('/notebooks/' + id + '/content'); }
async function apiSaveContent(id, html) { return apiFetch('/notebooks/' + id + '/content', { method: 'PUT', body: { html } }); }

async function apiUploadImage(nbId, filename, base64Data) {
  return apiFetch('/notebooks/' + nbId + '/images', { method: 'POST', body: { filename, data: base64Data } });
}

function apiImageUrl(nbId, filename) {
  return API_BASE + '/notebooks/' + nbId + '/images/' + filename;
}

async function apiDeleteImage(nbId, filename) {
  return apiFetch('/notebooks/' + nbId + '/images/' + filename, { method: 'DELETE' });
}

// ── Tasks ──
async function apiGetTasks() { return apiFetch('/tasks'); }
async function apiAddTask(text, priority) { return apiFetch('/tasks', { method: 'POST', body: { text, priority } }); }
async function apiUpdateTask(id, data) { return apiFetch('/tasks/' + id, { method: 'PUT', body: data }); }
async function apiDeleteTask(id) { return apiFetch('/tasks/' + id, { method: 'DELETE' }); }
