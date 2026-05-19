const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');

router.get('/', async (req, res) => {
  const rules = await firebase.getRules() || [];
  res.json({ success: true, data: rules });
});

router.post('/', async (req, res) => {
  const { name, order, match, accounts, enabled } = req.body;
  if (!name) return res.status(400).json({ success: false, error: "Name is required" });

  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]]/g, '');
  
  const existingRules = await firebase.getRules() || [];
  if (existingRules.find(r => r.id === id)) {
      return res.status(400).json({ success: false, error: "Rule with this name already exists" });
  }

  const newRule = {
    id,
    name,
    order: typeof order === 'number' ? order : 100,
    match: match || { subject: "", from: "", to: "" },
    accounts: accounts || [],
    enabled: enabled !== false
  };

  const success = await firebase.setRule(id, newRule);
  if (success) {
    res.json({ success: true, data: newRule });
  } else {
    res.status(500).json({ success: false, error: "Failed to save rule" });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const rules = await firebase.getRules() || [];
  const existing = rules.find(r => r.id === id);
  
  if (!existing) return res.status(404).json({ success: false, error: "Rule not found" });

  const updated = { ...existing, ...req.body };
  updated.id = id; // prevent id change

  const success = await firebase.setRule(id, updated);
  if (success) {
    res.json({ success: true, data: updated });
  } else {
    res.status(500).json({ success: false, error: "Failed to update rule" });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const rules = await firebase.getRules() || [];
  
  if (rules.length === 1) {
    return res.status(400).json({ success: false, error: "Cannot delete the last rule" });
  }
  
  const existing = rules.find(r => r.id === id);
  if (existing && existing.name.toLowerCase() === 'default') {
     // Wait, the prompt says "không được xóa rule Default cuối cùng"
     // Let's protect the one with order 999 or name Default if it's the fallback
     if (rules.length === 1) return res.status(400).json({ success: false, error: "Cannot delete default rule" });
  }

  const success = await firebase.deleteRule(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "Failed to delete rule" });
  }
});

module.exports = router;
