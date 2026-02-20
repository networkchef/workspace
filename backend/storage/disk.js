'use strict';

const fs = require('fs').promises;
const path = require('path');

const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');

// Ensure a directory exists
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
  return p;
}

// Root for a user
function userRoot(username) {
  // Sanitize username to be safe as folder name
  const safe = username.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_ROOT, 'users', safe);
}

async function initUserDirs(username) {
  const root = userRoot(username);
  await ensureDir(root);
  await ensureDir(path.join(root, 'notebooks'));
  await ensureDir(path.join(root, 'tasks'));
  return root;
}

// ── Auth file ──
async function readUserAuth(username) {
  try {
    const p = path.join(userRoot(username), 'auth.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

async function writeUserAuth(username, data) {
  const root = userRoot(username);
  await ensureDir(root);
  await fs.writeFile(path.join(root, 'auth.json'), JSON.stringify(data, null, 2));
}

async function userExists(username) {
  const data = await readUserAuth(username);
  return data !== null;
}

// ── Notebook index ──
async function readNotebookIndex(username) {
  try {
    const p = path.join(userRoot(username), 'notebooks', 'index.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function writeNotebookIndex(username, list) {
  const p = path.join(userRoot(username), 'notebooks', 'index.json');
  await fs.writeFile(p, JSON.stringify(list, null, 2));
}

// ── Notebook content ──
async function readNotebookContent(username, nbId) {
  try {
    const p = path.join(userRoot(username), 'notebooks', nbId, 'content.html');
    return await fs.readFile(p, 'utf8');
  } catch { return ''; }
}

async function writeNotebookContent(username, nbId, html) {
  const dir = path.join(userRoot(username), 'notebooks', nbId);
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, 'content.html'), html);
}

async function deleteNotebook(username, nbId) {
  const dir = path.join(userRoot(username), 'notebooks', nbId);
  await fs.rm(dir, { recursive: true, force: true });
}

// ── Notebook images ──
async function saveNotebookImage(username, nbId, filename, base64Data) {
  const dir = path.join(userRoot(username), 'notebooks', nbId, 'images');
  await ensureDir(dir);
  const buf = Buffer.from(base64Data, 'base64');
  await fs.writeFile(path.join(dir, filename), buf);
  return filename;
}

async function readNotebookImage(username, nbId, filename) {
  const p = path.join(userRoot(username), 'notebooks', nbId, 'images', filename);
  try {
    const buf = await fs.readFile(p);
    return buf;
  } catch { return null; }
}

async function deleteNotebookImage(username, nbId, filename) {
  const p = path.join(userRoot(username), 'notebooks', nbId, 'images', filename);
  try { await fs.unlink(p); } catch {}
}

// ── Tasks ──
async function readTasks(username) {
  try {
    const p = path.join(userRoot(username), 'tasks', 'tasks.json');
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch { return []; }
}

async function writeTasks(username, tasks) {
  const dir = path.join(userRoot(username), 'tasks');
  await ensureDir(dir);
  await fs.writeFile(path.join(dir, 'tasks.json'), JSON.stringify(tasks, null, 2));
}

module.exports = {
  initUserDirs,
  readUserAuth, writeUserAuth, userExists,
  readNotebookIndex, writeNotebookIndex,
  readNotebookContent, writeNotebookContent, deleteNotebook,
  saveNotebookImage, readNotebookImage, deleteNotebookImage,
  readTasks, writeTasks
};
