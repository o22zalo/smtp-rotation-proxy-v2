// api/routes/smtp-users.js
// Quản lý SMTP proxy users (virtual credentials)
// Gitea / bất kỳ client nào authenticate vào SMTP proxy bằng các tài khoản này.
// Khi xác thực thành công, proxy sẽ gửi email qua pool accounts theo rule thông thường.

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const firebase = require('../../db/firebase');

function maskPassword(pass) {
  if (!pass) return '';
  return '****';
}

// Sanitize id key — Firebase không chấp nhận . # $ [ ]
function toSafeKey(username) {
  return username.replace(/[.#$[\]/]/g, '_');
}

// GET /api/smtp-users
// Trả về danh sách SMTP users (mask password)
router.get('/', async (req, res) => {
  try {
    const users = await firebase.getSmtpUsers() || [];
    const safe = users.map(u => ({ ...u, password: maskPassword(u.password) }));
    res.json({ success: true, data: safe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/smtp-users
// Tạo mới một SMTP user
// Body: { username, password, description?, enabled? }
router.post('/', async (req, res) => {
  const { username, password, description, enabled } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'username and password are required' });
  }

  // Kiểm tra trùng username
  const existing = await firebase.getSmtpUsers() || [];
  const duplicate = existing.find(u => u.username === username);
  if (duplicate) {
    return res.status(409).json({ success: false, error: `Username "${username}" already exists` });
  }

  const id = toSafeKey(username) + '_' + Date.now();
  const newUser = {
    id,
    username,
    password,            // lưu plain-text (proxy nội bộ, không public internet)
    description: description || '',
    enabled: enabled !== false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const ok = await firebase.setSmtpUser(id, newUser);
  if (ok) {
    res.json({ success: true, data: { ...newUser, password: maskPassword(newUser.password) } });
  } else {
    res.status(500).json({ success: false, error: 'Failed to save SMTP user' });
  }
});

// PUT /api/smtp-users/:id
// Cập nhật SMTP user (password để trống sẽ giữ nguyên)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await firebase.getSmtpUsers() || [];
  const user = existing.find(u => u.id === id);

  if (!user) {
    return res.status(404).json({ success: false, error: 'SMTP user not found' });
  }

  const { username, password, description, enabled } = req.body;

  // Nếu đổi username, kiểm tra trùng với user khác
  if (username && username !== user.username) {
    const dup = existing.find(u => u.username === username && u.id !== id);
    if (dup) {
      return res.status(409).json({ success: false, error: `Username "${username}" already exists` });
    }
  }

  const updated = {
    ...user,
    username: username || user.username,
    password: (password && password !== '****') ? password : user.password,
    description: description !== undefined ? description : user.description,
    enabled: enabled !== undefined ? enabled : user.enabled,
    updatedAt: Date.now()
  };

  const ok = await firebase.setSmtpUser(id, updated);
  if (ok) {
    res.json({ success: true, data: { ...updated, password: maskPassword(updated.password) } });
  } else {
    res.status(500).json({ success: false, error: 'Failed to update SMTP user' });
  }
});

// DELETE /api/smtp-users/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const existing = await firebase.getSmtpUsers() || [];
  const user = existing.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ success: false, error: 'SMTP user not found' });
  }

  const ok = await firebase.deleteSmtpUser(id);
  if (ok) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: 'Failed to delete SMTP user' });
  }
});

// POST /api/smtp-users/verify
// Internal helper — verify username + password (dùng bởi server.js onAuth)
// Body: { username, password }
router.post('/verify', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'username and password required' });
  }

  const users = await firebase.getSmtpUsers() || [];
  const user = users.find(u => u.username === username && u.enabled !== false);
  if (!user) {
    return res.status(401).json({ success: false, error: 'User not found or disabled' });
  }
  if (user.password !== password) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }

  res.json({ success: true, data: { id: user.id, username: user.username } });
});

module.exports = router;
