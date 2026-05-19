const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');

const PROVIDER_PRESETS = {
  gmail:    { host: 'smtp.gmail.com',        port: 465, secure: true },
  outlook:  { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  hotmail:  { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  yahoo:    { host: 'smtp.mail.yahoo.com',   port: 465, secure: true },
  zoho:     { host: 'smtp.zoho.com',         port: 465, secure: true },
  sendgrid: { host: 'smtp.sendgrid.net',     port: 587, secure: false },
  mailgun:  { host: 'smtp.mailgun.org',      port: 587, secure: false },
  custom:   null,
};

function maskPassword(pass) {
  if (!pass) return '';
  return '****';
}

router.get('/', async (req, res) => {
  const accounts = await firebase.getAccounts() || [];
  const safeAccounts = accounts.map(a => ({
    ...a,
    auth: { ...a.auth, pass: maskPassword(a.auth.pass) }
  }));
  res.json({ success: true, data: safeAccounts });
});

router.post('/', async (req, res) => {
  const { provider, auth, dailyLimit, hourlyLimit, fromName, fromAddress, enabled, host, port, secure } = req.body;
  if (!provider || !auth || !auth.user || !auth.pass) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  const accountId = auth.user.split('@')[0].replace(/[.#$\[\]]/g, '_');
  let finalId = accountId;
  const existingAccounts = await firebase.getAccounts() || [];
  let counter = 2;
  while(existingAccounts.find(a => a.id === finalId)) {
    finalId = `${accountId}-${counter}`;
    counter++;
  }

  let configHost, configPort, configSecure;
  if (provider === 'custom') {
    configHost = host;
    configPort = parseInt(port, 10);
    configSecure = secure === true || secure === 'true';
  } else {
    const preset = PROVIDER_PRESETS[provider];
    if (!preset) return res.status(400).json({ success: false, error: "Invalid provider" });
    configHost = preset.host;
    configPort = preset.port;
    configSecure = preset.secure;
  }

  const newAccount = {
    id: finalId,
    provider,
    host: configHost,
    port: configPort,
    secure: configSecure,
    auth,
    dailyLimit: parseInt(dailyLimit || 400, 10),
    hourlyLimit: parseInt(hourlyLimit || 100, 10),
    fromName: fromName || "",
    fromAddress: fromAddress || "",
    enabled: enabled !== false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const success = await firebase.setAccount(finalId, newAccount);
  if (success) {
    res.json({ success: true, data: { ...newAccount, auth: { ...newAccount.auth, pass: maskPassword(newAccount.auth.pass) } } });
  } else {
    res.status(500).json({ success: false, error: "Failed to save account" });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const accounts = await firebase.getAccounts() || [];
  const existing = accounts.find(a => a.id === id);
  
  if (!existing) return res.status(404).json({ success: false, error: "Account not found" });

  const data = req.body;
  const updated = { ...existing, ...data, updatedAt: Date.now() };

  if (data.auth) {
    if (data.auth.pass === '****' || data.auth.pass === '') {
      updated.auth.pass = existing.auth.pass;
    }
  }

  if (data.provider === 'custom') {
      if (data.host) updated.host = data.host;
      if (data.port) updated.port = parseInt(data.port, 10);
      if (data.secure !== undefined) updated.secure = data.secure === true || data.secure === 'true';
  } else if (data.provider && PROVIDER_PRESETS[data.provider]) {
      updated.host = PROVIDER_PRESETS[data.provider].host;
      updated.port = PROVIDER_PRESETS[data.provider].port;
      updated.secure = PROVIDER_PRESETS[data.provider].secure;
  }

  const success = await firebase.setAccount(id, updated);
  if (success) {
    res.json({ success: true, data: { ...updated, auth: { ...updated.auth, pass: maskPassword(updated.auth.pass) } } });
  } else {
    res.status(500).json({ success: false, error: "Failed to update account" });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const rules = await firebase.getRules() || [];
  
  const usedInRules = rules.some(r => r.accounts && r.accounts.includes(id));
  if (usedInRules) {
    return res.status(400).json({ success: false, error: "Account is in use by one or more rules" });
  }

  const success = await firebase.deleteAccount(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "Failed to delete account" });
  }
});

module.exports = router;
