const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');

function maskPassword(pass) {
  if (!pass) return '';
  return '****';
}

router.get('/', async (req, res) => {
  const accounts = await firebase.getAccounts() || [];
  const rules = await firebase.getRules() || [];
  const stats = await firebase.getStats() || {};
  const settings = await firebase.getSettings() || {};

  const safeAccounts = accounts.map(a => ({
    ...a,
    auth: { ...a.auth, pass: maskPassword(a.auth.pass) }
  }));

  const backupData = {
    version: "2.0",
    exportedAt: new Date().toISOString(),
    accounts: safeAccounts,
    rules,
    stats,
    settings
  };

  const dateStr = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Disposition', `attachment; filename="smtp-backup-${dateStr}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(backupData, null, 2));
});

module.exports = router;
