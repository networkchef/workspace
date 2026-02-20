/* ══════════════════════════════════════
   app.js — main controller, auth, UI
   ══════════════════════════════════════ */

'use strict';

// ── Utils ──
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let _toast = null;
function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(_toast);
  _toast = setTimeout(() => el.classList.remove('show'), ms);
}

function setBtn(id, loading, text) {
  const el = document.getElementById(id); if (!el) return;
  el.disabled = loading;
  el.innerHTML = loading ? `<span class="spinner"></span>${text}…` : text;
}

// ── Theme ──
let dark = localStorage.getItem('ws_dark') === '1';
function applyTheme() {
  document.body.classList.toggle('dark', dark);
  const tr = document.getElementById('tog-tr'), lb = document.getElementById('th-lbl');
  if (tr) { tr.classList.toggle('on', dark); lb.textContent = dark ? 'Dark' : 'Light'; }
}
function toggleTheme() { dark = !dark; localStorage.setItem('ws_dark', dark ? '1' : '0'); applyTheme(); }
applyTheme();

// ── Auth tab switching ──
function showAuthTab(tab) {
  document.getElementById('pane-signin').style.display = tab === 'signin' ? '' : 'none';
  document.getElementById('pane-signup').style.display = tab === 'signup' ? '' : 'none';
  document.getElementById('tab-signin').classList.toggle('active', tab === 'signin');
  document.getElementById('tab-signup').classList.toggle('active', tab === 'signup');
  // clear errors
  document.getElementById('si-err').textContent = '';
  document.getElementById('su-err').textContent = '';
}

// ── Sign In ──
async function signIn() {
  const user = document.getElementById('si-user').value.trim();
  const pass = document.getElementById('si-pass').value;
  const errEl = document.getElementById('si-err');
  errEl.textContent = '';
  if (!user || !pass) { errEl.textContent = 'All fields required.'; return; }

  setBtn('signin-btn', true, 'Signing in');
  try {
    await apiSignin(user, pass);
    setBtn('signin-btn', false, 'Sign In');
    enterApp();
  } catch (e) {
    setBtn('signin-btn', false, 'Sign In');
    errEl.textContent = e.message;
  }
}

// ── Sign Up ──
async function signUp() {
  const user = document.getElementById('su-user').value.trim();
  const pass = document.getElementById('su-pass').value;
  const pass2 = document.getElementById('su-pass2').value;
  const errEl = document.getElementById('su-err');
  errEl.textContent = '';

  if (!user || !pass) { errEl.textContent = 'All fields required.'; return; }
  if (pass.length < 4) { errEl.textContent = 'Password must be at least 4 characters.'; return; }
  if (pass !== pass2) { errEl.textContent = 'Passwords do not match.'; return; }

  setBtn('signup-btn', true, 'Creating account');
  try {
    await apiSignup(user, pass);
    setBtn('signup-btn', false, 'Create Account');
    enterApp();
  } catch (e) {
    setBtn('signup-btn', false, 'Create Account');
    errEl.textContent = e.message;
  }
}

// ── Enter App ──
async function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('main-app').style.display = 'flex';

  const username = localStorage.getItem('ws_user') || '';
  document.getElementById('tb-user').textContent = username;

  setupEditorEvents();
  await loadNotebooks();
  await loadTasks();
  toast('Welcome back, ' + username + ' ✓');
}

// ── Logout ──
function logout() {
  if (!confirm('Sign out of Workspace?')) return;
  clearToken();
  location.reload();
}

// ── Change Password ──
function openChangePw() {
  ['cp-cur','cp-new','cp-con'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cp-err').textContent = '';
  openMo('mo-pw');
  setTimeout(() => document.getElementById('cp-cur').focus(), 60);
}

async function doChangePw() {
  const cur = document.getElementById('cp-cur').value;
  const nw = document.getElementById('cp-new').value;
  const con = document.getElementById('cp-con').value;
  const err = document.getElementById('cp-err'); err.textContent = '';
  if (nw.length < 4) { err.textContent = 'New password must be at least 4 characters.'; return; }
  if (nw !== con) { err.textContent = 'Passwords do not match.'; return; }
  try {
    await apiChangePassword(cur, nw);
    closeMo('mo-pw'); toast('Password updated ✓');
  } catch (e) { err.textContent = e.message; }
}

// ── Mode ──
function switchMode(m) {
  document.getElementById('notebook-view').style.display = m === 'notebook' ? 'flex' : 'none';
  document.getElementById('task-view').style.display = m === 'tasks' ? 'flex' : 'none';
  document.getElementById('btn-nb').classList.toggle('active', m === 'notebook');
  document.getElementById('btn-tk').classList.toggle('active', m === 'tasks');
  // Save notebook when switching away
  if (m !== 'notebook' && activeNbId) saveCurrentNb();
}

// ── Modals ──
function openMo(id) { document.getElementById(id).classList.add('open'); }
function closeMo(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.mo').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) closeMo(el.id); });
});

// ── Keyboard ──
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    if (activeNbId) saveCurrentNb().then(() => toast('Saved ✓'));
  }
  if (e.key === 'Escape') {
    document.querySelectorAll('.mo.open').forEach(m => closeMo(m.id));
  }
});

// ── Auto-login if token exists ──
window.addEventListener('DOMContentLoaded', () => {
  const token = getToken();
  if (token) {
    // Try to enter app; if token is invalid, show auth
    enterApp().catch(() => {
      clearToken();
      document.getElementById('auth-screen').style.display = 'flex';
    });
  }
});
