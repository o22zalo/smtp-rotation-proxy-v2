// db/firebase.js
// Khởi tạo Firebase Admin SDK
// Export các helper: getAccounts(), setAccount(), deleteAccount(),
//                    getRules(), setRule(), deleteRule(),
//                    getStats(), updateStats(), resetStats()
//                    getSettings(), updateSettings()
// Nếu Firebase chưa sẵn sàng (env chưa set), fallback về config.js local

const admin = require('firebase-admin');

function isFirebaseReady() {
  return !!(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY &&
    process.env.FIREBASE_DATABASE_URL
  );
}

if (isFirebaseReady()) {
  try {
    const privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/(^"|"$)/g, '');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    console.log('[DB] Firebase Admin initialized');
  } catch (err) {
    console.error('[DB] Firebase Admin init error:', err);
  }
} else {
  console.log('[DB] Firebase not ready, will use local fallback');
}

const db = isFirebaseReady() ? admin.database() : null;

// getAccounts() trả về array đã sắp xếp theo createdAt
async function getAccounts() {
  if (!db) return null;
  try {
    const ref = db.ref('smtp-proxy/accounts');
    const snapshot = await ref.once('value');
    const data = snapshot.val() || {};
    const accounts = Object.values(data).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return accounts;
  } catch (err) {
    console.error('[DB] getAccounts error:', err);
    return null;
  }
}

async function setAccount(id, accountData) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/accounts/${id}`).set(accountData);
    return true;
  } catch (err) {
    console.error('[DB] setAccount error:', err);
    return false;
  }
}

async function deleteAccount(id) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/accounts/${id}`).remove();
    return true;
  } catch (err) {
    console.error('[DB] deleteAccount error:', err);
    return false;
  }
}

// getRules() trả về array đã sắp xếp theo order
async function getRules() {
  if (!db) return null;
  try {
    const ref = db.ref('smtp-proxy/rules');
    const snapshot = await ref.once('value');
    const data = snapshot.val() || {};
    const rules = Object.values(data).sort((a, b) => (a.order || 0) - (b.order || 0));
    return rules;
  } catch (err) {
    console.error('[DB] getRules error:', err);
    return null;
  }
}

async function setRule(id, ruleData) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/rules/${id}`).set(ruleData);
    return true;
  } catch (err) {
    console.error('[DB] setRule error:', err);
    return false;
  }
}

async function deleteRule(id) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/rules/${id}`).remove();
    return true;
  } catch (err) {
    console.error('[DB] deleteRule error:', err);
    return false;
  }
}

async function getStats() {
  if (!db) return null;
  try {
    const ref = db.ref('smtp-proxy/stats');
    const snapshot = await ref.once('value');
    return snapshot.val() || {};
  } catch (err) {
    console.error('[DB] getStats error:', err);
    return null;
  }
}

async function updateStats(accountId, statsData) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/stats/${accountId}`).update(statsData);
    return true;
  } catch (err) {
    console.error('[DB] updateStats error:', err);
    return false;
  }
}

async function resetStats(accountId = null) {
  if (!db) return false;
  try {
    const now = Date.now();
    if (accountId) {
      await db.ref(`smtp-proxy/stats/${accountId}`).update({
        sentToday: 0,
        sentHour: 0,
        lastResetDay: now,
        lastResetHour: now
      });
    } else {
      const stats = await getStats();
      if (!stats) return false;
      const updates = {};
      for (const id of Object.keys(stats)) {
        updates[`${id}/sentToday`] = 0;
        updates[`${id}/sentHour`] = 0;
        updates[`${id}/lastResetDay`] = now;
        updates[`${id}/lastResetHour`] = now;
      }
      await db.ref('smtp-proxy/stats').update(updates);
    }
    return true;
  } catch (err) {
    console.error('[DB] resetStats error:', err);
    return false;
  }
}

async function getSettings() {
  if (!db) return null;
  try {
    const ref = db.ref('smtp-proxy/settings');
    const snapshot = await ref.once('value');
    return snapshot.val() || {};
  } catch (err) {
    console.error('[DB] getSettings error:', err);
    return null;
  }
}

async function updateSettings(settingsData) {
  if (!db) return false;
  try {
    await db.ref('smtp-proxy/settings').update(settingsData);
    return true;
  } catch (err) {
    console.error('[DB] updateSettings error:', err);
    return false;
  }
}

// ─── SMTP Users (virtual proxy credentials) ─────────────────────────────────
// Path: smtp-proxy/smtpUsers/{id}
// Dùng để Gitea / bất kỳ client nào xác thực vào SMTP proxy
// với tài khoản riêng, không cần biết email account thực.

async function getSmtpUsers() {
  if (!db) return null;
  try {
    const ref = db.ref('smtp-proxy/smtpUsers');
    const snapshot = await ref.once('value');
    const data = snapshot.val() || {};
    return Object.values(data).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } catch (err) {
    console.error('[DB] getSmtpUsers error:', err);
    return null;
  }
}

async function setSmtpUser(id, userData) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/smtpUsers/${id}`).set(userData);
    return true;
  } catch (err) {
    console.error('[DB] setSmtpUser error:', err);
    return false;
  }
}

async function deleteSmtpUser(id) {
  if (!db) return false;
  try {
    await db.ref(`smtp-proxy/smtpUsers/${id}`).remove();
    return true;
  } catch (err) {
    console.error('[DB] deleteSmtpUser error:', err);
    return false;
  }
}

module.exports = {
  isFirebaseReady,
  getAccounts,
  setAccount,
  deleteAccount,
  getRules,
  setRule,
  deleteRule,
  getStats,
  updateStats,
  resetStats,
  getSettings,
  updateSettings,
  getSmtpUsers,
  setSmtpUser,
  deleteSmtpUser
};
