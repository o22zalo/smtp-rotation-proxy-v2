const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');

router.get('/', async (req, res) => {
  const stats = await firebase.getStats() || {};
  res.json({ success: true, data: stats });
});

router.post('/reset', async (req, res) => {
  const { accountId } = req.body;
  const success = await firebase.resetStats(accountId);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "Failed to reset stats" });
  }
});

module.exports = router;
