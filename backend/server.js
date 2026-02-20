'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const notebookRoutes = require('./routes/notebooks');
const taskRoutes = require('./routes/tasks');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security ──
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // set to your Cloudflare Pages URL
  credentials: true
}));

// ── Rate limiting ──
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(limiter);

// ── Body parsing ──
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Routes ──
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/notebooks', requireAuth, notebookRoutes);
app.use('/api/tasks', requireAuth, taskRoutes);

// ── Health ──
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// ── 404 ──
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Workspace backend running on :${PORT}`));
