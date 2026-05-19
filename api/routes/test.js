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

module.exports = router;
