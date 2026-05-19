const express = require('express');
const cors = require('cors');
const path = require('path');

const accountsRouter = require('./routes/accounts');
const rulesRouter = require('./routes/rules');
const statsRouter = require('./routes/stats');
const testRouter = require('./routes/test');
const backupRouter = require('./routes/backup');
const importExportRouter = require('./routes/import-export');
const smtpUsersRouter = require('./routes/smtp-users');

const app = express();
app.use(cors());
app.use(express.json());

// Auth middleware for API routes
function apiAuth(req, res, next) {
  const secret = req.headers['x-api-secret'];
  if (!secret || secret !== process.env.API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Health check (No auth)
app.get('/api/health', async (req, res) => {
  const firebase = require('../db/firebase');
  let accountsTotal = 0;
  let accountsAvailable = 0;
  if (firebase.isFirebaseReady()) {
    const accs = await firebase.getAccounts() || [];
    accountsTotal = accs.length;
    // Assuming available logic or skip for health
  }

  res.json({
    status: 'ok',
    firebase: firebase.isFirebaseReady(),
    accountsTotal,
    uptime: process.uptime()
  });
});

// Protect all other /api routes
app.use('/api', apiAuth);

// Routes
app.use('/api/accounts', accountsRouter);
app.use('/api/rules', rulesRouter);
app.use('/api/stats', statsRouter);
app.use('/api/accounts', testRouter); // mounts /:id/test
app.use('/api/backup', backupRouter);
app.use('/api', importExportRouter); // mounts /import and /export
app.use('/api/smtp-users', smtpUsersRouter); // SMTP virtual users (Gitea, etc.)

// Static UI
app.use(express.static(path.join(__dirname, '../ui')));

// Settings mock routes for now (need to be in separate or just here)
const firebase = require('../db/firebase');

app.get('/api/settings', async (req, res) => {
  const settings = await firebase.getSettings() || {};
  res.json({ success: true, data: settings });
});

app.put('/api/settings', async (req, res) => {
  await firebase.updateSettings(req.body);
  res.json({ success: true, data: req.body });
});

module.exports = app;
