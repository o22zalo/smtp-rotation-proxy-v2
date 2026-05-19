// ============================================
// rotator.js
const nodemailer = require("nodemailer");
const fs = require("fs");
const firebase = require("./db/firebase");

class Rotator {
  constructor(config) {
    this.config = config;
    this.accounts = new Map();
    this.statsFile = "./stats.json";

    this.ruleState = new Map();
    
    // Initialize from config (fallback)
    this._initAccountsAndRules(config.accounts, config.rules);

    this.loadStats();
    this.startResetTimer();
    
    // Async load from Firebase if ready
    this.reloadFromFirebase();
  }

  _initAccountsAndRules(accounts, rules) {
    this.accounts.clear();
    this.ruleState.clear();

    if (rules) {
      this.config.rules = rules;
      this.config.rules.forEach((r) => {
        this.ruleState.set(r.name, { currentIndex: 0 });
      });
    }

    if (accounts) {
      this.config.accounts = accounts;
      this.config.accounts.forEach((acc) => {
        // Build transporter configuration dynamically
        const transportConfig = acc.host ? {
          host: acc.host,
          port: acc.port,
          secure: acc.secure,
          auth: acc.auth
        } : acc; // fallback to acc itself if it's the old style
        
        this.accounts.set(acc.id, {
          config: acc,
          transporter: nodemailer.createTransport(transportConfig),
          stats: {
            sentToday: 0,
            sentHour: 0,
            total: 0,
            errors: 0,
            lastResetDay: Date.now(),
            lastResetHour: Date.now(),
          },
        });
      });
    }
  }

  async reloadFromFirebase() {
    if (!firebase.isFirebaseReady()) return;
    const fbAccounts = await firebase.getAccounts();
    const fbRules = await firebase.getRules();
    
    if (fbAccounts && fbRules) {
      this._initAccountsAndRules(fbAccounts, fbRules);
      
      // reload stats for new accounts
      await this.reloadStatsFromFirebase();
      console.log('[ROTATOR] ✓ Reloaded accounts and rules from Firebase');
    }
  }

  async reloadStatsFromFirebase() {
    if (!firebase.isFirebaseReady()) return;
    const stats = await firebase.getStats();
    if (stats) {
      Object.keys(stats).forEach(id => {
        if (this.accounts.has(id)) {
          const accStats = this.accounts.get(id).stats;
          const s = stats[id];
          accStats.sentToday = s.sentToday || 0;
          accStats.sentHour = s.sentHour || 0;
          accStats.total = s.total || 0;
          accStats.errors = s.errors || 0;
          accStats.lastResetDay = s.lastResetDay || Date.now();
          accStats.lastResetHour = s.lastResetHour || Date.now();
        }
      });
    }
  }

  loadStats() {
    try {
      if (fs.existsSync(this.statsFile)) {
        const data = JSON.parse(fs.readFileSync(this.statsFile, "utf8"));
        const today = new Date().toDateString();

        data.forEach((s) => {
          const acc = this.accounts.get(s.id);
          if (acc && new Date(s.lastResetDay).toDateString() === today) {
            acc.stats.sentToday = s.sentToday;
            acc.stats.total = s.total;
          }
        });
        console.log("[ROTATOR] ✓ Local stats loaded");
      }
    } catch (e) {
      console.log("[ROTATOR] No previous stats");
    }
  }

  async saveStats() {
    const data = Array.from(this.accounts.entries()).map(([id, acc]) => ({
      id,
      sentToday: acc.stats.sentToday,
      total: acc.stats.total,
      lastResetDay: acc.stats.lastResetDay,
    }));
    fs.writeFileSync(this.statsFile, JSON.stringify(data));
    
    if (firebase.isFirebaseReady()) {
      for (const [id, acc] of this.accounts.entries()) {
        await firebase.updateStats(id, {
          sentToday: acc.stats.sentToday,
          sentHour: acc.stats.sentHour,
          total: acc.stats.total,
          errors: acc.stats.errors,
          lastResetDay: acc.stats.lastResetDay,
          lastResetHour: acc.stats.lastResetHour,
        });
      }
    }
  }

  startResetTimer() {
    setInterval(() => {
      const now = Date.now();

      this.accounts.forEach((acc) => {
        // Reset giờ
        const lastHour = new Date(acc.stats.lastResetHour);
        const nowH = new Date(now);
        if (lastHour.getHours() !== nowH.getHours() || now - acc.stats.lastResetHour >= 60 * 60 * 1000) {
          acc.stats.sentHour = 0;
          acc.stats.lastResetHour = now;
        }

        // Reset ngày (theo local time của server)
        const lastDayStr = new Date(acc.stats.lastResetDay).toDateString();
        const nowDayStr = new Date(now).toDateString();
        if (lastDayStr !== nowDayStr) {
          acc.stats.sentToday = 0;
          acc.stats.lastResetDay = now;
        }
      });

      this.saveStats(); // lưu đều đặn
    }, 60_000); // mỗi phút kiểm tra & save 1 lần
  }

  findRule(email) {
    if (!this.config.rules || this.config.rules.length === 0) {
      // Fallback rule nếu không có rules nào trong database/config
      return {
        name: "Fallback-Default",
        match: {},
        accounts: Array.from(this.accounts.keys()),
        order: 999,
        enabled: true
      };
    }
    for (const rule of this.config.rules) {
      if (this.matches(rule.match, email)) {
        return rule;
      }
    }
    return this.config.rules[this.config.rules.length - 1];
  }

  matches(match, email) {
    if (!match) return true;
    if (match.subject && match.subject.trim() !== '') {
      const regex = new RegExp(match.subject, 'i');
      if (!regex.test(email.subject || "")) return false;
    }
    if (match.from && match.from.trim() !== '') {
      const regex = new RegExp(match.from, 'i');
      if (!regex.test(email.from || "")) return false;
    }
    if (match.to && match.to.trim() !== '') {
      const regex = new RegExp(match.to, 'i');
      if (!regex.test(email.to || "")) return false;
    }
    return true;
  }

  _isWithinQuota(acc) {
    const withinDaily = acc.stats.sentToday < acc.config.dailyLimit;
    const withinHourly = acc.stats.sentHour < acc.config.hourlyLimit;
    return withinDaily && withinHourly;
  }

  _advanceAccountForRule(rule) {
    if (!rule) throw new Error("No rule provided for rotation selection");
    
    let state = this.ruleState.get(rule.name);
    if (!state) {
      state = { currentIndex: 0 };
      this.ruleState.set(rule.name, state);
    }
    
    const list = rule.accounts.filter((id) => this.accounts.has(id));
    if (list.length === 0) throw new Error("No valid accounts configured for rule: " + rule.name);

    for (let step = 0; step < list.length; step++) {
      state.currentIndex = (state.currentIndex + 1) % list.length;
      const nextId = list[state.currentIndex];
      const acc = this.accounts.get(nextId);
      if (acc && this._isWithinQuota(acc)) {
        return nextId;
      }
    }
    throw new Error("All accounts in rule exhausted quota: " + rule.name);
  }

  _getCurrentAccountId(rule) {
    if (!rule) throw new Error("No rule provided for account selection");

    let state = this.ruleState.get(rule.name);
    if (!state) {
      state = { currentIndex: 0 };
      this.ruleState.set(rule.name, state);
    }

    const list = rule.accounts.filter((id) => this.accounts.has(id));
    if (list.length === 0) throw new Error("No valid accounts configured for rule: " + rule.name);

    // Nếu con trỏ đang trỏ vào account không tồn tại/quota, tự động nhảy tới account tiếp theo có quota
    let accId = list[state.currentIndex % list.length];
    let acc = this.accounts.get(accId);

    if (!acc || !this._isWithinQuota(acc)) {
      accId = this._advanceAccountForRule(rule);
      acc = this.accounts.get(accId);
    }
    return accId;
  }

  findAccountByEmail(email) {
    for (const [id, acc] of this.accounts.entries()) {
      if (acc.config.auth && acc.config.auth.user === email) {
        return acc;
      }
    }
    return null;
  }

  async sendWithAccount(email, accountId) {
    let acc = this.accounts.get(accountId);
    if (!acc) throw new Error(`Account ${accountId} not found`);

    if (acc.config.fromAddress) {
      const displayName = acc.config.fromName || acc.config.fromAddress;
      email.from = `"${displayName}" <${acc.config.fromAddress}>`;
    }

    try {
      const result = await acc.transporter.sendMail(email);
      acc.stats.sentToday++;
      acc.stats.sentHour++;
      acc.stats.total++;
      console.log(`[ROTATOR] ✓ Sent via ${accountId} (Override)`);
      this.saveStats();
      return { success: true, accId: accountId, messageId: result.messageId };
    } catch (error) {
      acc.stats.errors++;
      this.saveStats();
      throw error;
    }
  }

  async send(email) {
    const rule = this.findRule(email);
    let lastError;

    for (let i = 0; i <= this.config.retry.maxAttempts; i++) {
      let accId, acc;
      try {
        accId = this._getCurrentAccountId(rule);
        acc = this.accounts.get(accId);

        if (acc.config.fromAddress) {
          const displayName = acc.config.fromName || acc.config.fromAddress;
          email.from = `"${displayName}" <${acc.config.fromAddress}>`;
        }

        console.log(`[ROTATOR] [${i + 1}/${this.config.retry.maxAttempts + 1}] ${accId} (${rule.name})`);
        console.log(`  Account: ${acc.config.auth.user}`);
        console.log(`  Host: ${acc.config.host}:${acc.config.port}`);
        console.log(`  To: ${email.to}`);
        console.log(`  Subject: ${email.subject}`);

        const result = await acc.transporter.sendMail(email);

        acc.stats.sentToday++;
        acc.stats.sentHour++;
        acc.stats.total++;

        console.log(`[ROTATOR] ✓ Sent via ${accId} (${acc.stats.sentToday} today)`);

        if (!this._isWithinQuota(acc)) {
          console.log(`[ROTATOR] Quota reached for ${accId}, advancing pointer for rule "${rule.name}"`);
          this._advanceAccountForRule(rule);
        }

        this.saveStats();

        return { success: true, accId, messageId: result.messageId };
      } catch (error) {
        lastError = error;
        console.error(`[ROTATOR] ✗ Failed: ${error.message}`);

        const msg = error && error.message ? error.message : "";
        const isAuthError = /Invalid login|authentication|BadCredentials|535/i.test(msg);
        const isQuotaError = /quota|limit|550|421/i.test(msg);

        if (accId && this.accounts.has(accId)) {
          const accRef = this.accounts.get(accId);
          accRef.stats.errors++;
          if (isQuotaError) {
            accRef.stats.sentToday = Math.max(accRef.stats.sentToday, accRef.config.dailyLimit);
            accRef.stats.sentHour = Math.max(accRef.stats.sentHour, accRef.config.hourlyLimit);
          }
        }

        if (isAuthError || isQuotaError) {
          try {
            const nextId = this._advanceAccountForRule(rule);
            console.error(`[ROTATOR] ${isAuthError ? "Auth" : "Quota"} issue -> switch to next account: ${nextId}`);
            continue;
          } catch (advanceErr) {
            console.error(`[ROTATOR] No alternative account available: ${advanceErr.message}`);
          }
        }

        if (i < this.config.retry.maxAttempts) {
          const delay = this.config.retry.exponentialBackoff ? this.config.retry.delayMs * Math.pow(2, i) : this.config.retry.delayMs;
          console.log(`[ROTATOR] Retry in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this.saveStats();
    throw lastError;
  }

  getStats() {
    return Array.from(this.accounts.entries()).map(([id, acc]) => {
      const cfg = acc.config;
      return {
        id,
        email: cfg.auth ? cfg.auth.user : id,
        today: `${acc.stats.sentToday}/${cfg.dailyLimit}`,
        hour: `${acc.stats.sentHour}/${cfg.hourlyLimit}`,
        total: acc.stats.total,
        errors: acc.stats.errors,
        available: acc.stats.sentToday < cfg.dailyLimit && acc.stats.sentHour < cfg.hourlyLimit,
      };
    });
  }

  printStats() {
    console.log("\n=== STATS ===");
    this.getStats().forEach((s) => {
      console.log(`${s.email} ${s.available ? "✓" : "✗"}`);
      console.log(`  Today: ${s.today} | Hour: ${s.hour} | Total: ${s.total} | Errors: ${s.errors}`);
    });
    console.log("");
  }
}

module.exports = Rotator;
