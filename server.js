// ============================================
// server.js
require('dotenv').config();
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const Rotator = require("./rotator");
const config = require("./config");
const net = require("net");
const firebase = require("./db/firebase");

const rotator = new Rotator(config);

// ─── SMTP Virtual Users cache ────────────────────────────────────────────────
// Để tránh query Firebase mỗi lần client kết nối, cache smtpUsers
// và refresh định kỳ mỗi 60 giây.
let _smtpUsersCache = [];   // [{ username, password, enabled }]
let _smtpUsersCacheTime = 0;
const SMTP_USERS_CACHE_TTL = 60_000; // 60s

async function getSmtpUsersCache() {
  const now = Date.now();
  if (now - _smtpUsersCacheTime > SMTP_USERS_CACHE_TTL) {
    const users = await firebase.getSmtpUsers();
    if (users) {
      _smtpUsersCache = users;
      _smtpUsersCacheTime = now;
      console.log(`[AUTH] Refreshed smtpUsers cache: ${users.length} user(s)`);
    }
  }
  return _smtpUsersCache;
}

const INTERNAL_PORT = parseInt(process.env.PORT_SMTP_INT || "2626", 10);
const EXTERNAL_PORT = parseInt(process.env.PORT_SMTP_EXT || "2525", 10);

const server = new SMTPServer({
  ...config.smtpServer,
  logger: true,
  hideSTARTTLS: true,
  disableReverseLookup: true,

  async onAuth(auth, session, callback) {
    const username = auth.username || "";
    console.log("[SMTP] AUTH user =", username || "(none)");

    // 1️⃣ Kiểm tra trực tiếp qua email account (override gửi bằng account đó)
    const matchedAccount = rotator.findAccountByEmail(username);
    if (matchedAccount) {
      if (matchedAccount.config.auth.pass === auth.password) {
        session.overrideAccountId = matchedAccount.config.id;
        console.log(`[AUTH] ✓ Authenticated as account: ${username}`);
        return callback(null, { user: username });
      }
      // username khớp account nhưng sai password — từ chối ngay
      console.warn(`[AUTH] ✗ Wrong password for account: ${username}`);
      return callback(new Error("Invalid username or password"));
    }

    // 2️⃣ Kiểm tra qua SMTP virtual users (Gitea, ứng dụng khác)
    try {
      const smtpUsers = await getSmtpUsersCache();
      const virtualUser = smtpUsers.find(
        u => u.username === username && u.enabled !== false
      );
      if (virtualUser) {
        if (virtualUser.password === auth.password) {
          // session.overrideAccountId KHÔNG set => rotator sẽ gửi theo rule thông thường
          session.virtualUser = virtualUser.username;
          console.log(`[AUTH] ✓ Authenticated as virtual user: ${username}`);
          return callback(null, { user: username });
        }
        console.warn(`[AUTH] ✗ Wrong password for virtual user: ${username}`);
        return callback(new Error("Invalid username or password"));
      }
    } catch (err) {
      console.error('[AUTH] Error checking smtpUsers:', err.message);
    }

    // 3️⃣ Fallback: authOptional
    if (config.smtpServer.authOptional) {
      callback(null, { user: username || "anonymous" });
    } else {
      console.warn(`[AUTH] ✗ No matching user found: ${username}`);
      callback(new Error("Invalid username or password"));
    }
  },
  
  onData(stream, session, callback) {
    simpleParser(stream, async (err, parsed) => {
      if (err) {
        console.error("[SMTP] Parse error:", err);
        return callback(new Error("Parse failed"));
      }

      try {
        const headerFromAddr = parsed.from?.value?.[0]?.address || session.envelope?.mailFrom?.address || "";
        const headerFromName = parsed.from?.value?.[0]?.name || "";
        const rcpts = parsed.to?.value?.map((v) => v.address) || session.envelope?.rcptTo?.map((r) => r.address) || [];
        if (!rcpts.length) throw new Error("No recipient found");

        let replyTo = null;
        const replyToHdr = parsed.headers.get("reply-to");
        if (replyToHdr) {
          if (typeof replyToHdr === "string") {
            replyTo = replyToHdr;
          } else if (replyToHdr?.value?.length) {
            replyTo = replyToHdr.value.map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address)).join(", ");
          }
        } else if (parsed.replyTo?.value?.length) {
          replyTo = parsed.replyTo.value.map((a) => (a.name ? `"${a.name}" <${a.address}>` : a.address)).join(", ");
        }

        const passHeaders = {};
        ["message-id", "in-reply-to", "references", "list-id"].forEach((h) => {
          const v = parsed.headers.get(h);
          if (v) passHeaders[h] = typeof v === "string" ? v : String(v);
        });

        const email = {
          from: headerFromName ? `"${headerFromName}" <${headerFromAddr}>` : headerFromAddr || "noreply@yourdomain.com",
          to: rcpts.join(", "),
          subject: parsed.subject || "(no subject)",
          text: parsed.text,
          html: parsed.html,
        };
        if (replyTo) email.replyTo = replyTo;
        if (Object.keys(passHeaders).length) email.headers = passHeaders;

        console.log("\n=== INCOMING ===");
        console.log(`  FROM: ${email.from}`);
        console.log(`  TO  : ${email.to}`);
        if (email.replyTo) console.log(`  REPLY-TO: ${email.replyTo}`);
        console.log(`  SUBJ: ${email.subject}`);

        if (session.overrideAccountId) {
          await rotator.sendWithAccount(email, session.overrideAccountId);
        } else {
          await rotator.send(email);
        }
        
        callback();
      } catch (error) {
        console.error("[SMTP] Send error:", error);
        callback(new Error(error.message));
      }
    });
  },
});

server.listen(INTERNAL_PORT, () => {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  SMTP Rotation Proxy (internal)      ║");
  console.log("╚══════════════════════════════════════╝\n");
  console.log(`[SMTP] ✓ SMTPServer listening on ${INTERNAL_PORT}`);
  console.log(`[SMTP] ✓ ${rotator.accounts.size} accounts loaded`);
  console.log(`[SMTP] ✓ ${rotator.config.rules ? rotator.config.rules.length : 0} routing rules\n`);
  rotator.printStats();
});

// =========================
// Shim TCP tại EXTERNAL_PORT
// =========================
function fixSmtpLine(line) {
  const raw = line.replace(/\r?\n$/, "");

  let m = raw.match(/^MAIL FROM:([^<>\s][^\s\r\n]*)(\s.*)?$/i);
  if (m) {
    const addr = m[1].trim();
    const tail = m[2] ? m[2] : "";
    const fixed = `MAIL FROM:<${addr}>${tail}`;
    console.log("[SHIM] [FIX]", raw, "=>", fixed);
    return fixed + "\r\n";
  }

  m = raw.match(/^RCPT TO:([^<>\s][^\s\r\n]*)(\s.*)?$/i);
  if (m) {
    const addr = m[1].trim();
    const tail = m[2] ? m[2] : "";
    const fixed = `RCPT TO:<${addr}>${tail}`;
    console.log("[SHIM] [FIX]", raw, "=>", fixed);
    return fixed + "\r\n";
  }

  return raw + "\r\n";
}

function makeLineSplitter(onLine) {
  let buf = "";
  return (chunk, writer) => {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx + 1);
      buf = buf.slice(idx + 1);
      const out = onLine(line);
      writer(out);
    }
  };
}

const shim = net.createServer((client) => {
  const clientIp = client.remoteAddress;
  console.log(`[SHIM] Client ${clientIp} connected`);
  const startTime = Date.now();

  client.setTimeout(60000); // 60s timeout
  client.on('timeout', () => {
    console.log(`[SHIM] Client ${clientIp} timeout`);
    client.end();
  });

  const upstream = net.connect(INTERNAL_PORT, "127.0.0.1");

  const writeUp = (s) => upstream.write(s);
  const splitClient = makeLineSplitter(fixSmtpLine);

  client.on("data", (data) => splitClient(data, writeUp));
  upstream.on("data", (data) => client.write(data));

  const closeBoth = () => {
    const ms = Date.now() - startTime;
    console.log(`[SHIM] Client ${clientIp} disconnected after ${ms}ms`);
    try {
      client.destroy();
    } catch {}
    try {
      upstream.destroy();
    } catch {}
  };
  
  client.on("error", closeBoth);
  upstream.on("error", closeBoth);
  client.on("close", closeBoth);
  upstream.on("close", closeBoth);
});

shim.listen(EXTERNAL_PORT, () => {
  console.log(`[SHIM] Shim listening on ${EXTERNAL_PORT} -> 127.0.0.1:${INTERNAL_PORT}`);
  console.log(`[SHIM] Point Gitea SMTP_ADDR to 127.0.0.1 and SMTP_PORT to ${EXTERNAL_PORT}`);
});

// =========================
// Graceful Shutdown
// =========================
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('\n[SERVER] Received shutdown signal. Waiting max 10s for active emails...');
  setTimeout(() => {
    console.log('[SERVER] Timeout reached. Exiting forcefully.');
    process.exit(0);
  }, 10000);

  // Close shim and SMTP servers
  shim.close(() => {
    server.close(() => {
      console.log('[SERVER] Servers closed gracefully. Exiting.');
      process.exit(0);
    });
  });
}

// =========================
// Mount Express API & UI
// =========================
try {
  const apiApp = require('./api/index');
  const API_PORT = process.env.PORT_API || 3000;
  apiApp.listen(API_PORT, () => {
    console.log(`[API] ✓ API & UI listening on port ${API_PORT}`);
  });
} catch (err) {
  console.error('[API] Failed to mount Express app. Did you create api/index.js?', err.message);
}
