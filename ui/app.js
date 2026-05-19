const API_BASE = '/api';

const app = {
  secret: sessionStorage.getItem('api_secret') || '',
  accounts: [],
  rules: [],
  stats: {},
  settings: {},
  currentView: 'accounts',

  async init() {
    if (!this.secret) {
      document.getElementById('auth-overlay').classList.remove('hidden');
    } else {
      await this.checkHealth();
    }

    // Setup navigation
    document.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const view = e.target.dataset.view;
        this.switchView(view);
      });
    });

    // Setup Auth form
    document.getElementById('auth-submit').addEventListener('click', () => {
      const val = document.getElementById('auth-secret').value;
      if (val) {
        this.secret = val;
        sessionStorage.setItem('api_secret', val);
        this.checkHealth();
      }
    });
  },

  async fetchApi(endpoint, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['X-API-Secret'] = this.secret;
    if (!options.headers['Content-Type'] && !(options.body instanceof FormData)) {
      options.headers['Content-Type'] = 'application/json';
    }

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, options);
      if (res.status === 401) {
        document.getElementById('auth-overlay').classList.remove('hidden');
        sessionStorage.removeItem('api_secret');
        throw new Error('Unauthorized');
      }
      
      // Blob response for downloads
      if (res.headers.get('content-disposition')) {
         return res;
      }
      
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'API Error');
      }
      return json;
    } catch (err) {
      if (err.message !== 'Unauthorized') {
        this.showToast(err.message, true);
      }
      throw err;
    }
  },

  showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast ${isError ? 'error' : ''}`;
    setTimeout(() => t.classList.add('hidden'), 3000);
  },

  async checkHealth() {
    try {
      // Don't need auth for health check
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      const badge = document.getElementById('health-badge');
      if (data.status === 'ok') {
        badge.textContent = 'Healthy';
        badge.className = 'health-badge ok';
        document.getElementById('auth-overlay').classList.add('hidden');
        this.switchView('accounts');
      } else {
        badge.textContent = 'Error';
        badge.className = 'health-badge error';
      }
    } catch (e) {
      // maybe auth failed later when fetching accounts, but health is ok
      this.switchView('accounts');
    }
  },

  switchView(view) {
    this.currentView = view;
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`view-${view}`).classList.remove('hidden');
    document.querySelector(`.nav-item[data-view="${view}"]`).classList.add('active');
    document.getElementById('page-title').textContent = view.charAt(0).toUpperCase() + view.slice(1);

    if (view === 'accounts') this.fetchAccounts();
    if (view === 'rules') this.fetchRules();
    if (view === 'stats') this.fetchStats();
    if (view === 'settings') this.fetchSettings();
  },

  closeModals() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  },

  // Accounts
  async fetchAccounts() {
    const res = await this.fetchApi('/accounts');
    this.accounts = res.data;
    this.renderAccounts();
  },

  renderAccounts() {
    const tbody = document.querySelector('#accounts-table tbody');
    tbody.innerHTML = '';
    this.accounts.forEach(acc => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${acc.provider}</td>
        <td>${acc.auth.user}</td>
        <td>${acc.dailyLimit}</td>
        <td>${acc.hourlyLimit}</td>
        <td>-</td>
        <td>-</td>
        <td>${acc.enabled ? 'Yes' : 'No'}</td>
        <td>
          <button class="btn btn-secondary" onclick="app.editAccount('${acc.id}')">Edit</button>
          <button class="btn btn-danger" onclick="app.deleteAccount('${acc.id}')">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  },

  showAddAccountModal() {
    document.getElementById('account-form').reset();
    document.getElementById('account-id').value = '';
    document.getElementById('account-modal-title').textContent = 'Add Account';
    this.onProviderChange();
    document.getElementById('account-modal').classList.remove('hidden');
  },

  editAccount(id) {
    const acc = this.accounts.find(a => a.id === id);
    if (!acc) return;
    document.getElementById('account-form').reset();
    document.getElementById('account-id').value = acc.id;
    document.getElementById('account-modal-title').textContent = 'Edit Account';
    
    document.getElementById('account-provider').value = acc.provider;
    document.getElementById('account-user').value = acc.auth.user;
    document.getElementById('account-pass').value = acc.auth.pass;
    document.getElementById('account-daily').value = acc.dailyLimit;
    document.getElementById('account-hourly').value = acc.hourlyLimit;
    document.getElementById('account-from-name').value = acc.fromName || '';
    document.getElementById('account-from-address').value = acc.fromAddress || '';
    document.getElementById('account-enabled').checked = acc.enabled;
    
    if (acc.provider === 'custom') {
      document.getElementById('account-host').value = acc.host || '';
      document.getElementById('account-port').value = acc.port || '';
      document.getElementById('account-secure').checked = acc.secure;
    }
    this.onProviderChange();
    document.getElementById('account-modal').classList.remove('hidden');
  },

  onProviderChange() {
    const prov = document.getElementById('account-provider').value;
    const customFields = document.getElementById('custom-smtp-fields');
    if (prov === 'custom') {
      customFields.classList.remove('hidden');
    } else {
      customFields.classList.add('hidden');
    }
  },

  async saveAccount(e) {
    e.preventDefault();
    const id = document.getElementById('account-id').value;
    const data = {
      provider: document.getElementById('account-provider').value,
      auth: {
        user: document.getElementById('account-user').value,
        pass: document.getElementById('account-pass').value,
      },
      dailyLimit: parseInt(document.getElementById('account-daily').value, 10),
      hourlyLimit: parseInt(document.getElementById('account-hourly').value, 10),
      fromName: document.getElementById('account-from-name').value,
      fromAddress: document.getElementById('account-from-address').value,
      enabled: document.getElementById('account-enabled').checked
    };

    if (data.provider === 'custom') {
      data.host = document.getElementById('account-host').value;
      data.port = parseInt(document.getElementById('account-port').value, 10);
      data.secure = document.getElementById('account-secure').checked;
    }

    try {
      if (id) {
        await this.fetchApi(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        this.showToast('Account updated');
      } else {
        await this.fetchApi('/accounts', { method: 'POST', body: JSON.stringify(data) });
        this.showToast('Account created');
      }
      this.closeModals();
      this.fetchAccounts();
    } catch(e) {}
  },

  async deleteAccount(id) {
    if (!confirm('Are you sure you want to delete this account?')) return;
    try {
      await this.fetchApi(`/accounts/${id}`, { method: 'DELETE' });
      this.showToast('Account deleted');
      this.fetchAccounts();
    } catch(e) {}
  },

  async testAccount() {
    const id = document.getElementById('account-id').value;
    if (!id) {
      this.showToast('Please save the account before testing', true);
      return;
    }
    const to = prompt("Enter email address to send test to:");
    if (!to) return;
    try {
      this.showToast('Sending test email...');
      await this.fetchApi(`/accounts/${id}/test`, { method: 'POST', body: JSON.stringify({ to }) });
      this.showToast('Test email sent successfully');
    } catch(e) {}
  },

  // Rules
  async fetchRules() {
    const res = await this.fetchApi('/rules');
    this.rules = res.data;
    
    // need accounts to populate select
    if (this.accounts.length === 0) {
      const resAcc = await this.fetchApi('/accounts');
      this.accounts = resAcc.data;
    }
    this.renderRules();
  },

  renderRules() {
    const list = document.getElementById('rules-list');
    list.innerHTML = '';
    this.rules.forEach(rule => {
      const el = document.createElement('div');
      el.className = 'rule-item';
      el.innerHTML = `
        <div class="rule-info">
          <strong>${rule.name}</strong> (Order: ${rule.order})
          <div class="rule-meta">
            Match: Subj: ${rule.match?.subject || '*'} | From: ${rule.match?.from || '*'} | To: ${rule.match?.to || '*'}
            <br>Accounts: ${rule.accounts ? rule.accounts.length : 0} | Enabled: ${rule.enabled}
          </div>
        </div>
        <div class="rule-actions">
          <button class="btn btn-secondary" onclick="app.editRule('${rule.id}')">Edit</button>
          <button class="btn btn-danger" onclick="app.deleteRule('${rule.id}')">Delete</button>
        </div>
      `;
      list.appendChild(el);
    });
  },

  showAddRuleModal() {
    document.getElementById('rule-form').reset();
    document.getElementById('rule-id').value = '';
    document.getElementById('rule-modal-title').textContent = 'Add Rule';
    this.populateRuleAccounts([]);
    document.getElementById('rule-modal').classList.remove('hidden');
  },

  editRule(id) {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return;
    document.getElementById('rule-form').reset();
    document.getElementById('rule-id').value = rule.id;
    document.getElementById('rule-modal-title').textContent = 'Edit Rule';
    
    document.getElementById('rule-name').value = rule.name;
    document.getElementById('rule-order').value = rule.order;
    document.getElementById('rule-match-subject').value = rule.match?.subject || '';
    document.getElementById('rule-match-from').value = rule.match?.from || '';
    document.getElementById('rule-match-to').value = rule.match?.to || '';
    document.getElementById('rule-enabled').checked = rule.enabled;
    
    this.populateRuleAccounts(rule.accounts || []);
    document.getElementById('rule-modal').classList.remove('hidden');
  },

  populateRuleAccounts(selectedIds) {
    const sel = document.getElementById('rule-accounts');
    sel.innerHTML = '';
    this.accounts.forEach(acc => {
      const opt = document.createElement('option');
      opt.value = acc.id;
      opt.textContent = `${acc.auth.user} (${acc.provider})`;
      if (selectedIds.includes(acc.id)) opt.selected = true;
      sel.appendChild(opt);
    });
  },

  async saveRule(e) {
    e.preventDefault();
    const id = document.getElementById('rule-id').value;
    const sel = document.getElementById('rule-accounts');
    const accounts = Array.from(sel.selectedOptions).map(opt => opt.value);
    
    const data = {
      name: document.getElementById('rule-name').value,
      order: parseInt(document.getElementById('rule-order').value, 10),
      match: {
        subject: document.getElementById('rule-match-subject').value,
        from: document.getElementById('rule-match-from').value,
        to: document.getElementById('rule-match-to').value,
      },
      accounts,
      enabled: document.getElementById('rule-enabled').checked
    };

    try {
      if (id) {
        await this.fetchApi(`/rules/${id}`, { method: 'PUT', body: JSON.stringify(data) });
        this.showToast('Rule updated');
      } else {
        await this.fetchApi('/rules', { method: 'POST', body: JSON.stringify(data) });
        this.showToast('Rule created');
      }
      this.closeModals();
      this.fetchRules();
    } catch(e) {}
  },

  async deleteRule(id) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      await this.fetchApi(`/rules/${id}`, { method: 'DELETE' });
      this.showToast('Rule deleted');
      this.fetchRules();
    } catch(e) {}
  },

  // Stats
  async fetchStats() {
    const res = await this.fetchApi('/stats');
    this.stats = res.data || {};
    
    if (this.accounts.length === 0) {
       const resAcc = await this.fetchApi('/accounts');
       this.accounts = resAcc.data;
    }
    this.renderStats();
  },

  renderStats() {
    const tbody = document.querySelector('#stats-table tbody');
    tbody.innerHTML = '';
    
    let totalSent = 0;
    let totalErrors = 0;
    let availableCount = 0;

    this.accounts.forEach(acc => {
      const s = this.stats[acc.id] || { sentToday: 0, sentHour: 0, total: 0, errors: 0 };
      totalSent += s.sentToday || 0;
      totalErrors += s.errors || 0;
      
      const isAvailable = (s.sentToday || 0) < acc.dailyLimit && (s.sentHour || 0) < acc.hourlyLimit;
      if (isAvailable && acc.enabled) availableCount++;
      
      const pctDaily = Math.min(100, Math.round(((s.sentToday||0) / acc.dailyLimit) * 100));
      
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${acc.auth.user}</td>
        <td>
          ${s.sentToday || 0}/${acc.dailyLimit}
          <div class="progress-bg"><div class="progress-fill ${pctDaily >= 90 ? 'danger' : ''}" style="width: ${pctDaily}%"></div></div>
        </td>
        <td>${s.sentHour || 0}/${acc.hourlyLimit}</td>
        <td>${s.total || 0}</td>
        <td>${s.errors || 0}</td>
        <td>${isAvailable ? 'Yes' : 'No'}</td>
        <td>
          <button class="btn btn-secondary" onclick="app.resetStats('${acc.id}')">Reset</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const summary = document.getElementById('stats-summary');
    summary.innerHTML = `
      <div class="stat-card"><h3>${this.accounts.length}</h3><p>Total Accounts</p></div>
      <div class="stat-card"><h3>${availableCount}</h3><p>Available Accounts</p></div>
      <div class="stat-card"><h3>${totalSent}</h3><p>Sent Today</p></div>
      <div class="stat-card"><h3>${totalErrors}</h3><p>Total Errors</p></div>
    `;
  },

  async resetStats(id) {
    if (!confirm('Reset stats for this account?')) return;
    try {
      await this.fetchApi('/stats/reset', { method: 'POST', body: JSON.stringify({ accountId: id }) });
      this.showToast('Stats reset');
      this.fetchStats();
    } catch(e) {}
  },

  async resetAllStats() {
    if (!confirm('Reset stats for ALL accounts?')) return;
    try {
      await this.fetchApi('/stats/reset', { method: 'POST', body: JSON.stringify({}) });
      this.showToast('All stats reset');
      this.fetchStats();
    } catch(e) {}
  },

  // Import / Export
  toggleExportDropdown() {
    document.getElementById('export-dropdown').classList.toggle('hidden');
  },
  
  async exportData(format) {
    this.toggleExportDropdown();
    const url = `${API_BASE}/export?format=${format}`;
    window.open(url, '_blank');
  },

  showImportModal() {
    document.getElementById('import-form').reset();
    document.getElementById('import-modal').classList.remove('hidden');
  },

  async submitImport(e) {
    e.preventDefault();
    const file = document.getElementById('import-file').files[0];
    if (!file) return;
    
    const overwrite = document.getElementById('import-overwrite').checked;
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      this.showToast('Importing...');
      const res = await this.fetchApi(`/import?overwrite=${overwrite}`, {
        method: 'POST',
        body: formData,
        headers: { 'X-API-Secret': this.secret } // Content-Type is auto generated for FormData
      });
      const info = res.data;
      this.showToast(`Imported ${info.imported}, skipped ${info.skipped}. Errors: ${info.errors.length}`);
      this.closeModals();
      this.fetchAccounts();
    } catch(e) {}
  },

  // Settings
  async fetchSettings() {
    const res = await this.fetchApi('/settings');
    this.settings = res.data;
    
    const form = document.getElementById('settings-form');
    form.elements['retryMaxAttempts'].value = this.settings.retryMaxAttempts || 3;
    form.elements['retryDelayMs'].value = this.settings.retryDelayMs || 5000;
    form.elements['retryExponentialBackoff'].checked = this.settings.retryExponentialBackoff || false;
    form.elements['defaultDailyLimit'].value = this.settings.defaultDailyLimit || 400;
    form.elements['defaultHourlyLimit'].value = this.settings.defaultHourlyLimit || 100;
  },

  async saveSettings(e) {
    e.preventDefault();
    const form = document.getElementById('settings-form');
    const data = {
      retryMaxAttempts: parseInt(form.elements['retryMaxAttempts'].value, 10),
      retryDelayMs: parseInt(form.elements['retryDelayMs'].value, 10),
      retryExponentialBackoff: form.elements['retryExponentialBackoff'].checked,
      defaultDailyLimit: parseInt(form.elements['defaultDailyLimit'].value, 10),
      defaultHourlyLimit: parseInt(form.elements['defaultHourlyLimit'].value, 10)
    };
    try {
      await this.fetchApi('/settings', { method: 'PUT', body: JSON.stringify(data) });
      this.showToast('Settings saved');
    } catch(e) {}
  }
};

window.onload = () => app.init();
