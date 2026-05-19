const express = require('express');
const router = express.Router();
const firebase = require('../../db/firebase');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

function maskPassword(pass) {
  if (!pass) return '';
  return '****';
}

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

router.get('/export', async (req, res) => {
  const format = req.query.format || 'json';
  const accounts = await firebase.getAccounts() || [];
  
  if (format === 'csv') {
    const csvLines = [];
    csvLines.push('provider,user,pass,dailyLimit,hourlyLimit,fromName,fromAddress,host,port,secure,enabled');
    accounts.forEach(a => {
      const line = [
        a.provider,
        a.auth.user,
        maskPassword(a.auth.pass),
        a.dailyLimit,
        a.hourlyLimit,
        a.fromName,
        a.fromAddress,
        a.host || '',
        a.port || '',
        a.secure !== undefined ? a.secure : '',
        a.enabled
      ].map(field => `"${(field || '').toString().replace(/"/g, '""')}"`).join(',');
      csvLines.push(line);
    });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="accounts.csv"');
    return res.send(csvLines.join('\n'));
  } else {
    const rules = await firebase.getRules() || [];
    const stats = await firebase.getStats() || {};
    const safeAccounts = accounts.map(a => ({
      ...a,
      auth: { ...a.auth, pass: maskPassword(a.auth.pass) }
    }));
    
    const data = {
      version: "2.0",
      exportedAt: new Date().toISOString(),
      accounts: safeAccounts,
      rules,
      stats
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="export.json"');
    return res.send(JSON.stringify(data, null, 2));
  }
});

router.post('/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

  const overwrite = req.query.overwrite === 'true';
  const content = req.file.buffer.toString('utf8');
  const ext = req.file.originalname.split('.').pop().toLowerCase();

  const existingAccounts = await firebase.getAccounts() || [];
  const accountMap = new Map(existingAccounts.map(a => [a.id, a]));

  let imported = 0;
  let skipped = 0;
  const errors = [];

  if (ext === 'json') {
    try {
      const data = JSON.parse(content);
      if (data.accounts && Array.isArray(data.accounts)) {
        for (const acc of data.accounts) {
          let accId = acc.id || (acc.auth && acc.auth.user ? acc.auth.user.split('@')[0] : null);
          if (!accId) {
            errors.push("Account missing ID and user email");
            continue;
          }
          accId = accId.replace(/[.#$\[\]]/g, '_');
          acc.id = accId;
          
          if (accountMap.has(accId)) {
            if (!overwrite) {
              skipped++;
              continue;
            }
            if (acc.auth && acc.auth.pass === '****') {
              acc.auth.pass = accountMap.get(accId).auth.pass;
            }
          }
          await firebase.setAccount(accId, acc);
          imported++;
        }
      }
      
      if (data.rules && Array.isArray(data.rules)) {
        for (const rule of data.rules) {
          const ruleId = rule.id || rule.name.toLowerCase().replace(/\s+/g, '-');
          rule.id = ruleId;
          await firebase.setRule(ruleId, rule);
        }
      }
      
      return res.json({ success: true, data: { imported, skipped, errors } });
    } catch (e) {
      return res.status(400).json({ success: false, error: "Invalid JSON format" });
    }
  } else if (ext === 'csv') {
    try {
      const lines = content.split('\n');
      const header = lines[0].toLowerCase();
      if (!header.includes('provider') || !header.includes('user')) {
         return res.status(400).json({ success: false, error: "Invalid CSV format" });
      }
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Simple CSV parser ignoring commas inside quotes
        const match = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
        if (!match) continue;
        const fields = match.map(f => f.replace(/^"|"$/g, '').replace(/""/g, '"'));
        
        const provider = fields[0];
        const user = fields[1];
        const pass = fields[2];
        const dailyLimit = parseInt(fields[3] || 400, 10);
        const hourlyLimit = parseInt(fields[4] || 100, 10);
        const fromName = fields[5] || '';
        const fromAddress = fields[6] || '';
        let host = fields[7] || '';
        let port = parseInt(fields[8], 10) || '';
        let secure = fields[9] === 'true';
        const enabled = fields[10] !== 'false';
        
        if (!provider || !user) {
          errors.push(`Row ${i+1}: missing provider or user`);
          continue;
        }
        
        const accId = user.split('@')[0].replace(/[.#$\[\]]/g, '_');
        
        if (provider !== 'custom') {
          const preset = PROVIDER_PRESETS[provider];
          if (preset) {
            host = preset.host;
            port = preset.port;
            secure = preset.secure;
          }
        }
        
        if (accountMap.has(accId)) {
          if (!overwrite) {
            skipped++;
            continue;
          }
        }
        
        const newAcc = {
          id: accId,
          provider,
          host,
          port,
          secure,
          auth: { user, pass },
          dailyLimit,
          hourlyLimit,
          fromName,
          fromAddress,
          enabled,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        
        // Don't overwrite pass with masked value
        if (pass === '****' && accountMap.has(accId)) {
           newAcc.auth.pass = accountMap.get(accId).auth.pass;
        }

        await firebase.setAccount(accId, newAcc);
        imported++;
      }
      return res.json({ success: true, data: { imported, skipped, errors } });
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }
  } else {
    return res.status(400).json({ success: false, error: "Unsupported file type" });
  }
});

module.exports = router;
