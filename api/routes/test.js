const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');
const nodemailer = require('nodemailer');

router.post('/:id/test', async (req, res) => {
  const { id } = req.params;
  const { to } = req.body;
  if (!to) return res.status(400).json({ success: false, error: "Missing 'to' address" });

  const accounts = await firebase.getAccounts() || [];
  const account = accounts.find(a => a.id === id);
  if (!account) return res.status(404).json({ success: false, error: "Account not found" });

  const transportConfig = account.host ? {
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: account.auth
  } : account;

  const transporter = nodemailer.createTransport(transportConfig);

  const displayName = account.fromName || account.fromAddress;
  const from = account.fromAddress && displayName 
    ? `"${displayName}" <${account.fromAddress}>` 
    : account.fromAddress || account.auth.user;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject: `Test email from ${account.auth.user}`,
      text: "This is a test email sent from SMTP Rotation Proxy v2.",
    });
    res.json({ success: true, data: { messageId: info.messageId, time: Date.now() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

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

router.post('/test-connection', async (req, res) => {
  try {
    const { provider, host, port, secure, user, pass, fromAddress } = req.body;
    let testHost = host;
    let testPort = port;
    let testSecure = secure;

    if (provider !== 'custom') {
      const preset = PROVIDER_PRESETS[provider];
      if (preset) {
        testHost = preset.host;
        testPort = preset.port;
        testSecure = preset.secure;
      }
    }

    if (!testHost || !testPort || !user || !pass) {
      return res.status(400).json({ success: false, error: 'Missing required configuration to test' });
    }

    const protocol = testSecure ? 'smtps' : 'smtp';
    const mailFrom = fromAddress || user;
    const mailTo = user;

    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    // Create an empty temp file because /dev/null causes errors in curl on Windows
    const tempFile = path.join(os.tmpdir(), `empty-${Date.now()}.txt`);
    fs.writeFileSync(tempFile, '');

    const args = [
      '-v',
      '--url', `${protocol}://${testHost}:${testPort}`,
      '--user', `${user}:${pass}`,
      '--mail-from', mailFrom,
      '--mail-rcpt', mailTo,
      '--upload-file', tempFile
    ];

    if (testSecure) {
      args.unshift('--ssl-reqd');
    }

    try {
      await execFilePromise('curl', args);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }

    res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    console.error('Curl test failed:', err.stderr || err.message);
    res.status(500).json({ success: false, error: err.message || 'Connection failed', details: err.stderr });
  }
});

module.exports = router;
