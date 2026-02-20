'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
  readNotebookIndex, writeNotebookIndex,
  readNotebookContent, writeNotebookContent, deleteNotebook,
  saveNotebookImage, readNotebookImage, deleteNotebookImage
} = require('../storage/disk');

// GET /api/notebooks — list all notebooks
router.get('/', async (req, res) => {
  try {
    const list = await readNotebookIndex(req.user.username);
    res.json(list);
  } catch (e) { res.status(500).json({ error: 'Failed to load notebooks.' }); }
});

// POST /api/notebooks — create new notebook
router.post('/', async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required.' });
    const list = await readNotebookIndex(req.user.username);
    const nb = { id: uuidv4(), title: title.trim(), createdAt: new Date().toISOString() };
    list.push(nb);
    await writeNotebookIndex(req.user.username, list);
    await writeNotebookContent(req.user.username, nb.id, '');
    res.json(nb);
  } catch (e) { res.status(500).json({ error: 'Failed to create notebook.' }); }
});

// PUT /api/notebooks/:id — update title
router.put('/:id', async (req, res) => {
  try {
    const list = await readNotebookIndex(req.user.username);
    const nb = list.find(n => n.id === req.params.id);
    if (!nb) return res.status(404).json({ error: 'Notebook not found.' });
    if (req.body.title) nb.title = req.body.title.trim();
    await writeNotebookIndex(req.user.username, list);
    res.json(nb);
  } catch (e) { res.status(500).json({ error: 'Failed to update notebook.' }); }
});

// DELETE /api/notebooks/:id
router.delete('/:id', async (req, res) => {
  try {
    let list = await readNotebookIndex(req.user.username);
    list = list.filter(n => n.id !== req.params.id);
    await writeNotebookIndex(req.user.username, list);
    await deleteNotebook(req.user.username, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete notebook.' }); }
});

// GET /api/notebooks/:id/content
router.get('/:id/content', async (req, res) => {
  try {
    const html = await readNotebookContent(req.user.username, req.params.id);
    res.json({ html });
  } catch (e) { res.status(500).json({ error: 'Failed to load content.' }); }
});

// PUT /api/notebooks/:id/content
router.put('/:id/content', async (req, res) => {
  try {
    const { html } = req.body;
    if (html === undefined) return res.status(400).json({ error: 'html required.' });
    await writeNotebookContent(req.user.username, req.params.id, html);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to save content.' }); }
});

// POST /api/notebooks/:id/images — upload image (base64)
router.post('/:id/images', async (req, res) => {
  try {
    const { filename, data, type } = req.body;
    if (!filename || !data) return res.status(400).json({ error: 'filename and data required.' });
    await saveNotebookImage(req.user.username, req.params.id, filename, data);
    res.json({ ok: true, filename });
  } catch (e) { res.status(500).json({ error: 'Failed to save image.' }); }
});

// GET /api/notebooks/:id/images/:filename
router.get('/:id/images/:filename', async (req, res) => {
  try {
    const buf = await readNotebookImage(req.user.username, req.params.id, req.params.filename);
    if (!buf) return res.status(404).json({ error: 'Image not found.' });
    const ext = req.params.filename.split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.send(buf);
  } catch (e) { res.status(500).json({ error: 'Failed to load image.' }); }
});

// DELETE /api/notebooks/:id/images/:filename
router.delete('/:id/images/:filename', async (req, res) => {
  try {
    await deleteNotebookImage(req.user.username, req.params.id, req.params.filename);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete image.' }); }
});

module.exports = router;
