'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { readTasks, writeTasks } = require('../storage/disk');

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    const tasks = await readTasks(req.user.username);
    res.json(tasks);
  } catch (e) { res.status(500).json({ error: 'Failed to load tasks.' }); }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const { text, priority } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required.' });
    const tasks = await readTasks(req.user.username);
    const task = {
      id: uuidv4(),
      text: text.trim(),
      priority: priority || 'med',
      done: false,
      date: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      createdAt: new Date().toISOString()
    };
    tasks.unshift(task);
    await writeTasks(req.user.username, tasks);
    res.json(task);
  } catch (e) { res.status(500).json({ error: 'Failed to add task.' }); }
});

// PUT /api/tasks/:id — toggle done or edit
router.put('/:id', async (req, res) => {
  try {
    const tasks = await readTasks(req.user.username);
    const task = tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (req.body.done !== undefined) task.done = req.body.done;
    if (req.body.text !== undefined) task.text = req.body.text.trim();
    if (req.body.priority !== undefined) task.priority = req.body.priority;
    await writeTasks(req.user.username, tasks);
    res.json(task);
  } catch (e) { res.status(500).json({ error: 'Failed to update task.' }); }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    let tasks = await readTasks(req.user.username);
    tasks = tasks.filter(t => t.id !== req.params.id);
    await writeTasks(req.user.username, tasks);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete task.' }); }
});

module.exports = router;
