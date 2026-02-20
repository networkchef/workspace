'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { readUserAuth, writeUserAuth, userExists, initUserDirs } = require('../storage/disk');
const { signToken } = require('../middleware/auth');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_ws_salt').digest('hex');
}

function validUsername(u) {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(u);
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required.' });
    if (!validUsername(username))
      return res.status(400).json({ error: 'Username must be 3–32 chars, letters/numbers/_ only.' });
    if (password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters.' });

    if (await userExists(username))
      return res.status(409).json({ error: 'Username already taken.' });

    const hash = hashPassword(password);
    await initUserDirs(username);
    await writeUserAuth(username, { username, hash, createdAt: new Date().toISOString() });

    const token = signToken(username);
    res.json({ token, username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Signup failed.' });
  }
});

// POST /api/auth/signin
router.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required.' });

    const auth = await readUserAuth(username);
    if (!auth)
      return res.status(401).json({ error: 'Invalid username or password.' });

    const hash = hashPassword(password);
    if (hash !== auth.hash)
      return res.status(401).json({ error: 'Invalid username or password.' });

    const token = signToken(username);
    res.json({ token, username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Sign in failed.' });
  }
});

// POST /api/auth/change-password
const { requireAuth } = require('../middleware/auth');
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const username = req.user.username;
    const auth = await readUserAuth(username);
    if (hashPassword(currentPassword) !== auth.hash)
      return res.status(401).json({ error: 'Current password is incorrect.' });
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'New password must be at least 4 characters.' });
    auth.hash = hashPassword(newPassword);
    await writeUserAuth(username, auth);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Password change failed.' });
  }
});

module.exports = router;
