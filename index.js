/**
 * eSewa ePay v2 + MySQL
 * Routes:
 *   GET  /pay     → Sign in or continue to course picker
 *   POST /signin  → Create a session from name + email
 *   POST /pay     → Save PENDING transaction, redirect to eSewa
 *   GET  /success → Verify with eSewa API, save COMPLETE to DB
 *   GET  /failure → Mark transaction FAILED in DB
 *
 * Setup:
 *   1. npm install express axios mysql2
 *   2. Set NGROK_URL and DB password below
 *   3. node index.js
 *   4. Visit http://localhost:3000/pay
 */

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use("/frontend", express.static(path.join(__dirname, "frontend")));

// ─── CONFIG ────────────────────────────────────────────────────

const NGROK_URL =
  process.env.NGROK_URL ||
  "https://lynsey-proaction-curtailedly.ngrok-free.dev";

const ESEWA = {
  productCode: "EPAYTEST",
  secretKey: "8gBm/:&EnhH.1/q",
  paymentUrl: "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
  statusUrl: "https://rc.esewa.com.np/api/epay/transaction/status/",
};

const DB_CONFIG = {
  host: "localhost",
  user: "root",
  password: "Utm@dbkey101", // ← paste your MySQL root password here
  database: "course_platform",
};

const CONTENT_ROOT = path.join(__dirname, "content");
const SESSION_COOKIE = "esewa_session";
const SESSION_TTL_DAYS = 7;

// ─── DATABASE ──────────────────────────────────────────────────

// Allow executing multiple statements from course_platform_schema.sql when initializing the DB
const pool = mysql.createPool(
  Object.assign({}, DB_CONFIG, { multipleStatements: true }),
);

async function initDatabaseFromSchema() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    await pool.query(sql);
    console.log("✅ Database schema applied schema.sql)");
  } catch (err) {
    console.error("❌ Failed to apply schema.sql:", err.message);
  }
}

async function syncCompletedPurchases() {
  try {
    const [transactions] = await pool.query(
      `SELECT t.user_id, t.course_id, t.transaction_uuid, t.transaction_code, t.amount, t.paid_at, t.created_at
       FROM transactions t
       WHERE t.status = 'COMPLETE'`,
    );

    for (const transaction of transactions) {
      await pool.query(
        `INSERT INTO enrollments (user_id, course_id, access_granted)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE access_granted = VALUES(access_granted)`,
        [transaction.user_id, transaction.course_id],
      );

      const [[enrollment]] = await pool.query(
        "SELECT enrollment_id FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
        [transaction.user_id, transaction.course_id],
      );

      if (enrollment) {
        await pool.query(
          `INSERT INTO payments (enrollment_id, transaction_uuid, amount, status, esewa_ref, paid_at)
           VALUES (?, ?, ?, 'COMPLETE', ?, ?)
           ON DUPLICATE KEY UPDATE
             amount = VALUES(amount),
             status = VALUES(status),
             esewa_ref = VALUES(esewa_ref),
             paid_at = VALUES(paid_at)`,
          [
            enrollment.enrollment_id,
            transaction.transaction_uuid,
            transaction.amount,
            transaction.transaction_code,
            transaction.paid_at || transaction.created_at,
          ],
        );
      }
    }
  } catch (err) {
    console.error("❌ Failed to sync completed purchases:", err.message);
  }
}

pool
  .getConnection()
  .then(async (conn) => {
    console.log("✅ MySQL connected");
    conn.release();
    await initDatabaseFromSchema();
    await syncCompletedPurchases();
  })
  .catch((err) => {
    console.error("❌ MySQL error:", err.message);
    process.exit(1);
  });

// ─── HMAC SIGNATURE ────────────────────────────────────────────

function generateSignature(totalAmount, transactionUuid) {
  const msg = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${ESEWA.productCode}`;
  return crypto
    .createHmac("sha256", ESEWA.secretKey)
    .update(msg)
    .digest("base64");
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader.split(";").reduce((accumulator, part) => {
    const index = part.indexOf("=");
    if (index === -1) {
      return accumulator;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) {
      accumulator[key] = decodeURIComponent(value);
    }

    return accumulator;
  }, {});
}

function setSessionCookie(response, token) {
  const maxAgeSeconds = SESSION_TTL_DAYS * 24 * 60 * 60;
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secureFlag}`,
  );
}

function clearSessionCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`,
  );
}

async function createSession(userId) {
  const sessionToken = generateSessionToken();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await pool.query(
    `INSERT INTO sessions (user_id, session_token, expires_at, last_seen_at)
     VALUES (?, ?, ?, NOW())`,
    [userId, sessionToken, expiresAt],
  );

  return sessionToken;
}

async function getSessionUser(request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];

  if (!token) {
    return null;
  }

  const [[session]] = await pool.query(
    `SELECT s.user_id, s.expires_at, u.user_id, u.name, u.email
     FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.session_token = ?
     LIMIT 1`,
    [token],
  );

  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await pool
      .query("DELETE FROM sessions WHERE session_token = ?", [token])
      .catch(() => {});
    return null;
  }

  await pool
    .query("UPDATE sessions SET last_seen_at = NOW() WHERE session_token = ?", [
      token,
    ])
    .catch(() => {});

  return {
    id: session.user_id,
    name: session.name,
    email: session.email,
    token,
  };
}

// ─── PAGE TEMPLATE ─────────────────────────────────────────────

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/frontend/assets/css/styles.css">
  <style>
    .backend-main {
      width: min(980px, calc(100% - 32px));
      margin: 40px auto 56px;
    }

    .backend-card {
      background: rgba(255, 255, 255, 0.84);
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 20px 50px rgba(15, 23, 42, 0.12);
      border: 1px solid rgba(148, 163, 184, 0.18);
    }

    body.dark .backend-card {
      background: rgba(30, 41, 59, 0.86);
      border-color: rgba(148, 163, 184, 0.16);
    }

    .backend-card h1,
    .backend-card h2 {
      margin-top: 0;
    }

    .backend-lead,
    .backend-meta,
    .backend-card p,
    .backend-card li {
      line-height: 1.7;
    }

    .backend-card form {
      margin-top: 20px;
    }

    .backend-card .btn,
    .backend-card .primary-btn {
      display: inline-block;
      border: none;
      border-radius: 12px;
      padding: 12px 18px;
      font-weight: 700;
      cursor: pointer;
      background: var(--accent-color);
      color: #fff;
      text-decoration: none;
    }

    .backend-card .btn:hover,
    .backend-card .primary-btn:hover {
      background: var(--accent-hover);
    }

    .backend-card .field {
      margin-bottom: 16px;
    }

    .backend-card .error {
      margin: 0 0 16px;
      padding: 12px 14px;
      border-radius: 12px;
      background: rgba(248, 113, 113, 0.12);
      color: #b91c1c;
      font-weight: 700;
    }

    .backend-card label {
      display: block;
      margin-bottom: 8px;
      font-weight: 700;
    }

    .backend-card input,
    .backend-card select {
      width: 100%;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid rgba(148, 163, 184, 0.4);
      background: rgba(255, 255, 255, 0.92);
      color: #111827;
    }

    body.dark .backend-card input,
    body.dark .backend-card select {
      background: rgba(15, 23, 42, 0.9);
      color: #f8fafc;
      border-color: rgba(148, 163, 184, 0.24);
    }

    .backend-error {
      margin: 0 0 16px;
      color: #b91c1c;
      font-weight: 700;
    }

    .backend-note {
      margin-top: 16px;
      padding: 14px 16px;
      border-radius: 14px;
      background: rgba(59, 130, 246, 0.1);
    }

    @media (max-width: 768px) {
      .backend-main {
        width: min(980px, calc(100% - 20px));
        margin-top: 24px;
      }

      .backend-card {
        padding: 22px;
        border-radius: 20px;
      }
    }
  </style>
</head>
<body>
  <nav>
      <div class="nav-left">
        <img src="/frontend/assets/images/logo.jpg" alt="" class="logo" />
        <span class="brand-name">Parajulillb</span>
      </div>

      <div class="nav-center">
        <a href="/frontend/user/home.html">
        <button>Home</button>
        </a>
      </div>

      <div class="nav-right">
        <div class="theme-switcher">
            <button onclick="setTheme('light')">☀️ </button>
            <button onclick="setTheme('dark')">🌙 </button>
            <button onclick="setTheme('sepia')">📜 </button>
        </div>

      </div>
    </nav>

  <main class="backend-main">
    <section class="backend-card">
      ${body}
    </section>
  </main>

  <footer class="footer">
    <div class="copyright">
        © 2025 ParajLiLLB. All rights reserved.
    </div>
  </footer>

  <script src="/frontend/assets/js/script.js"></script>
</body>
</html>`;
}

// ─── GET /pay — OTP sign-in first, then course picker ──────────

app.get("/pay", async (req, res) => {
  const sessionUser = await getSessionUser(req).catch((err) => {
    console.error("Session lookup failed:", err.message);
    return null;
  });

  let courses = [];
  try {
    [courses] = await pool.query(
      "SELECT course_id, title, price FROM courses ORDER BY course_id ASC",
    );
  } catch (err) {
    console.error("Failed to load courses:", err.message);
  }

  const options = courses
    .map(
      (c) =>
        `<option value="${c.course_id}">${escapeHtml(c.title)} (NPR ${Number(c.price).toFixed(0)})</option>`,
    )
    .join("");

  let hasPurchases = false;
  if (sessionUser) {
    try {
      const paid = await loadPaidCourses(sessionUser.id);
      hasPurchases = Array.isArray(paid) && paid.length > 0;
    } catch (err) {
      console.error("Failed to check paid courses:", err.message);
    }
  }

  const step = sessionUser ? "2" : "1";
  const errorMessage = req.query.error
    ? `<p class="error">${escapeHtml(req.query.error)}</p>`
    : "";

  res.send(
    page(
      "Buy a Course",
      `
      ${errorMessage}
      
      <h1>Verify your email first <br></h1>
      <p class="backend-lead">Please verify the Gmail account you want to use for course access. 
              Open the OTP verification page, sign in with that Gmail address,
              enter the OTP we emailed to you.
              Use that Gmail address to use for course access.
              After verification, the backend will create your session automatically. <br></p>
      ${
        sessionUser
          ? `
          <p class="backend-meta">Signed in as <strong>${escapeHtml(sessionUser.name)}</strong> 
          (${escapeHtml(sessionUser.email)}).</p>
          <form method="POST" action="/pay">
            <div class="field">
              <label for="course_id">Select Course</label>
              <select id="course_id" name="course_id" required>
                <option value="">— choose a course —</option>
                ${options}
              </select>
            </div>
            <button class="primary-btn" type="submit">Proceed to eSewa</button>
          </form>
          ${hasPurchases ? `<p class="backend-note"><a href="/my-courses">View your dashboard</a></p>` : ""}
          <p class="backend-note"><a href="/logout">Sign out</a></p>
        `
          : `
          <a class="primary-btn" href="http://localhost:3001/">Open OTP verification</a>
            `
      }
    `,
    ),
  );
});

app.post("/signin", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();

  if (!name || !email) {
    return res.redirect("/pay?error=Full+name+and+email+are+required.");
  }

  let userId;
  try {
    const passwordHash = crypto.randomBytes(24).toString("hex");
    await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash)",
      [name, email, passwordHash],
    );
    const [[user]] = await pool.query(
      "SELECT user_id FROM users WHERE email = ?",
      [email],
    );
    userId = user.user_id;
  } catch (err) {
    console.error("User sign-in failed:", err.message);
    return res.redirect("/pay?error=Could+not+sign+you+in.+Please+try+again.");
  }

  try {
    await pool.query("DELETE FROM sessions WHERE user_id = ?", [userId]);
    const sessionToken = await createSession(userId);
    setSessionCookie(res, sessionToken);
  } catch (err) {
    console.error("Session creation failed:", err.message);
    return res.redirect(
      "/pay?error=Could+not+create+a+session.+Please+try+again.",
    );
  }

  return res.redirect("/pay?step=2");
});

// ─── POST /pay — save PENDING, redirect to eSewa ───────────────

app.post("/pay", async (req, res) => {
  const sessionUser = await getSessionUser(req).catch((err) => {
    console.error("Session lookup failed:", err.message);
    return null;
  });

  if (!sessionUser) {
    return res.redirect("/pay?error=Please+sign+in+before+choosing+a+course.");
  }

  const courseId = String((req.body && req.body.course_id) || "").trim();
  if (!courseId) {
    return res.redirect("/pay?error=Please+select+a+course.");
  }

  let course;
  try {
    const [[row]] = await pool.query(
      "SELECT course_id, title, price FROM courses WHERE course_id = ?",
      [courseId],
    );
    if (!row) return res.redirect("/pay?error=Invalid+course+selected.");
    course = row;
  } catch (err) {
    console.error("Course lookup failed:", err.message);
    return res.redirect("/pay?error=Database+error.+Please+try+again.");
  }

  const transactionUuid = `txn-${Date.now()}-${sessionUser.id}`;
  const totalAmount = Number(course.price).toFixed(2);

  try {
    await pool.query(
      "INSERT INTO transactions (user_id, course_id, transaction_uuid, amount, status) VALUES (?, ?, ?, ?, ?)",
      [
        sessionUser.id,
        course.course_id,
        transactionUuid,
        totalAmount,
        "PENDING",
      ],
    );

    await pool.query(
      `INSERT INTO enrollments (user_id, course_id, access_granted)
       VALUES (?, ?, 0)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), course_id = VALUES(course_id)`,
      [sessionUser.id, course.course_id],
    );

    const [[enrollment]] = await pool.query(
      "SELECT enrollment_id FROM enrollments WHERE user_id = ? AND course_id = ? LIMIT 1",
      [sessionUser.id, course.course_id],
    );

    if (!enrollment) {
      throw new Error("Could not create enrollment.");
    }

    await pool.query(
      `INSERT INTO payments (enrollment_id, transaction_uuid, amount, status)
       VALUES (?, ?, ?, 'PENDING')
       ON DUPLICATE KEY UPDATE
         transaction_uuid = VALUES(transaction_uuid),
         amount = VALUES(amount),
         status = VALUES(status),
         esewa_ref = NULL,
         paid_at = NULL`,
      [enrollment.enrollment_id, transactionUuid, totalAmount],
    );
  } catch (err) {
    console.error("Transaction insert failed:", err.message);
    return res.redirect(
      "/pay?error=Could+not+initiate+payment.+Please+try+again.",
    );
  }

  const signature = generateSignature(totalAmount, transactionUuid);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  INITIATING PAYMENT");
  console.log(`  User   : ${sessionUser.name} <${sessionUser.email}>`);
  console.log(`  Course : ${course.title}`);
  console.log(`  UUID   : ${transactionUuid}`);
  console.log(`  Amount : NPR ${totalAmount}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Redirecting to eSewa…</title>
  <style>
    body { font-family: sans-serif; display: flex; justify-content: center;
           align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .msg { text-align: center; color: #555; }
    .spinner { width: 40px; height: 40px; border: 4px solid #ddd;
               border-top-color: #60BB46; border-radius: 50%;
               animation: spin 0.8s linear infinite; margin: 0 auto 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="msg">
    <div class="spinner"></div>
    <p>Redirecting to eSewa payment gateway…</p>
  </div>
  <form id="esewaForm" method="POST" action="${ESEWA.paymentUrl}">
    <input type="hidden" name="amount"                      value="${totalAmount}">
    <input type="hidden" name="tax_amount"                  value="0">
    <input type="hidden" name="total_amount"                value="${totalAmount}">
    <input type="hidden" name="service_charge"              value="0">
    <input type="hidden" name="delivery_charge"             value="0">
    <input type="hidden" name="transaction_uuid"            value="${transactionUuid}">
    <input type="hidden" name="product_code"                value="${ESEWA.productCode}">
    <input type="hidden" name="product_service_charge"      value="0">
    <input type="hidden" name="product_delivery_charge"     value="0">
    <input type="hidden" name="success_url"                 value="${NGROK_URL}/success">
    <input type="hidden" name="failure_url"                 value="${NGROK_URL}/failure">
    <input type="hidden" name="signed_field_names"          value="total_amount,transaction_uuid,product_code">
    <input type="hidden" name="signature"                   value="${signature}">
  </form>
  <script>setTimeout(() => document.getElementById('esewaForm').submit(), 500);</script>
</body>
</html>`);
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeCourseFolder(courseId) {
  return path.resolve(CONTENT_ROOT, String(courseId));
}

async function canAccessCourse(userId, courseId) {
  if (!userId || !courseId) {
    return false;
  }

  const [[row]] = await pool.query(
    `SELECT 1
     FROM enrollments e
     JOIN payments p ON p.enrollment_id = e.enrollment_id
     WHERE e.user_id = ?
       AND e.course_id = ?
       AND p.status = 'COMPLETE'
     LIMIT 1`,
    [userId, courseId],
  );

  return Boolean(row);
}

async function loadPaidCourses(userId) {
  const [courses] = await pool.query(
    `SELECT DISTINCT c.course_id, c.title, c.price
     FROM enrollments e
     JOIN payments p ON p.enrollment_id = e.enrollment_id
     JOIN courses c ON c.course_id = e.course_id
     WHERE e.user_id = ?
       AND p.status = 'COMPLETE'
     ORDER BY c.title`,
    [userId],
  );

  return courses;
}

async function loadCourseById(courseId) {
  const [[course]] = await pool.query(
    "SELECT course_id, title, price FROM courses WHERE course_id = ?",
    [courseId],
  );

  return course || null;
}

function listCourseFiles(courseFolder) {
  if (!fs.existsSync(courseFolder)) {
    return [];
  }

  return fs
    .readdirSync(courseFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

// ─── GET /success — verify + save COMPLETE to DB ───────────────

app.get("/success", async (req, res) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  SUCCESS REDIRECT RECEIVED");

  const { data: base64Data } = req.query;
  if (!base64Data) return res.status(400).send("Missing data parameter.");

  // Decode eSewa's base64 payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(base64Data, "base64").toString("utf-8"));
    console.log("  Decoded:", JSON.stringify(payload));
  } catch (err) {
    return res.status(400).send("Failed to decode eSewa response.");
  }

  const { transaction_uuid, product_code, total_amount, transaction_code } =
    payload;

  let payment;
  try {
    const [[row]] = await pool.query(
      `SELECT p.payment_id, p.enrollment_id, p.transaction_uuid, p.amount, p.status, p.paid_at, e.user_id, e.course_id
       FROM payments p
       JOIN enrollments e ON e.enrollment_id = p.enrollment_id
       WHERE p.transaction_uuid = ?
       LIMIT 1`,
      [transaction_uuid],
    );

    if (row) {
      payment = row;
    } else {
      // Fallback: recover from legacy transactions table and re-link payments row.
      const [[tx]] = await pool.query(
        `SELECT user_id, course_id, transaction_uuid, amount
         FROM transactions
         WHERE transaction_uuid = ?
         LIMIT 1`,
        [transaction_uuid],
      );

      if (!tx) {
        return res.status(400).send("Transaction not found.");
      }

      await pool.query(
        `INSERT INTO enrollments (user_id, course_id, access_granted)
         VALUES (?, ?, 0)
         ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), course_id = VALUES(course_id)`,
        [tx.user_id, tx.course_id],
      );

      const [[enrollment]] = await pool.query(
        `SELECT enrollment_id
         FROM enrollments
         WHERE user_id = ? AND course_id = ?
         LIMIT 1`,
        [tx.user_id, tx.course_id],
      );

      if (!enrollment) {
        return res.status(400).send("Transaction not found.");
      }

      await pool.query(
        `INSERT INTO payments (enrollment_id, transaction_uuid, amount, status)
         VALUES (?, ?, ?, 'PENDING')
         ON DUPLICATE KEY UPDATE
           transaction_uuid = VALUES(transaction_uuid),
           amount = VALUES(amount),
           status = VALUES(status)`,
        [enrollment.enrollment_id, tx.transaction_uuid, tx.amount],
      );

      const [[recovered]] = await pool.query(
        `SELECT p.payment_id, p.enrollment_id, p.transaction_uuid, p.amount, p.status, p.paid_at, e.user_id, e.course_id
         FROM payments p
         JOIN enrollments e ON e.enrollment_id = p.enrollment_id
         WHERE p.transaction_uuid = ?
         LIMIT 1`,
        [transaction_uuid],
      );

      if (!recovered) {
        return res.status(400).send("Transaction not found.");
      }

      payment = recovered;
    }
  } catch (err) {
    console.error("DB lookup failed:", err.message);
    return res.status(500).send("Database error.");
  }

  let verifyData;
  try {
    const resp = await axios.get(ESEWA.statusUrl, {
      params: { product_code, transaction_uuid, total_amount },
    });
    verifyData = resp.data;
    console.log("  eSewa verify:", JSON.stringify(verifyData));
  } catch (err) {
    console.error("eSewa API error:", err.response?.data || err.message);
    return res.status(500).send("Could not verify payment with eSewa.");
  }

  if (verifyData.status === "COMPLETE") {
    try {
      await pool.query(
        `UPDATE payments
           SET status = 'COMPLETE', esewa_ref = ?, paid_at = NOW()
           WHERE payment_id = ?`,
        [transaction_code, payment.payment_id],
      );

      await pool.query(
        `UPDATE enrollments
         SET access_granted = 1
         WHERE enrollment_id = ?`,
        [payment.enrollment_id],
      );

      await pool
        .query(
          `UPDATE transactions
         SET status = 'COMPLETE', transaction_code = ?, esewa_response = ?, paid_at = NOW()
         WHERE transaction_uuid = ?`,
          [
            transaction_code,
            JSON.stringify(verifyData),
            payment.transaction_uuid,
          ],
        )
        .catch(() => {});

      const [[user]] = await pool.query(
        "SELECT * FROM users WHERE user_id = ?",
        [payment.user_id],
      );
      const [[course]] = await pool.query(
        "SELECT * FROM courses WHERE course_id = ?",
        [payment.course_id],
      );

      const currentSession = await getSessionUser(req).catch((err) => {
        console.error("Session lookup failed:", err.message);
        return null;
      });

      if (!currentSession) {
        try {
          const sessionToken = await createSession(user.user_id);
          setSessionCookie(res, sessionToken);
        } catch (err) {
          console.error("Post-payment session creation failed:", err.message);
        }
      }

      console.log(`  ✅ COMPLETE — ${user.name} bought ${course.title}`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return res.redirect("/my-courses?payment=success");
    } catch (err) {
      console.error("DB update failed:", err.message);
      return res.status(500).send("Could not save payment result.");
    }
  }

  await pool
    .query(
      "UPDATE payments SET status = 'FAILED', esewa_ref = ? WHERE payment_id = ?",
      [transaction_code, payment.payment_id],
    )
    .catch((err) => console.error("DB update error:", err.message));

  await pool
    .query(
      "UPDATE transactions SET status = 'FAILED', esewa_response = ? WHERE transaction_uuid = ?",
      [JSON.stringify(verifyData), payment.transaction_uuid],
    )
    .catch((err) => console.error("DB update error:", err.message));

  console.log(`  ❌ NOT COMPLETE — status: ${verifyData.status}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  return res.send(
    page(
      "Payment Not Completed",
      `
    <p class="big">❌</p>
    <h1>Payment Not Completed</h1>
    <p>eSewa status: <strong>${verifyData.status}</strong></p>
    <a href="/pay?step=2">Try again</a>
  `,
    ),
  );
});

// ─── GET /failure — mark FAILED in DB ─────────────────────────

app.get("/failure", async (req, res) => {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ❌ PAYMENT FAILED OR CANCELLED");
  console.log("  Params:", req.query);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (req.query.data) {
    try {
      const p = JSON.parse(
        Buffer.from(req.query.data, "base64").toString("utf-8"),
      );
      if (p.transaction_uuid) {
        await pool.query(
          "UPDATE transactions SET status = 'FAILED' WHERE transaction_uuid = ?",
          [p.transaction_uuid],
        );
        await pool
          .query(
            "UPDATE payments SET status = 'FAILED' WHERE transaction_uuid = ?",
            [p.transaction_uuid],
          )
          .catch((err) =>
            console.error("Payment failure update failed:", err.message),
          );
      }
    } catch (_) {}
  }

  res.send(
    page(
      "Payment Failed",
      `
    <p class="big">❌</p>
    <h1>Payment Failed or Cancelled</h1>
    <p>No money has been charged.</p>
    <a href="/pay?step=2">Try again</a>
  `,
    ),
  );
});

// ─── GET /logout — clear session and sign out ────────────────

app.get("/logout", async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];

  if (token) {
    await pool
      .query("DELETE FROM sessions WHERE session_token = ?", [token])
      .catch((err) => {
        console.error("Logout cleanup failed:", err.message);
      });
  }

  clearSessionCookie(res);
  return res.redirect("/pay");
});

// ─── GET /my-courses — personal dashboard for signed-in user ──

app.get("/my-courses", async (req, res) => {
  const sessionUser = await getSessionUser(req).catch((err) => {
    console.error("Session lookup failed:", err.message);
    return null;
  });

  if (!sessionUser) {
    return res.redirect("/pay?error=Please+sign+in+to+view+your+courses.");
  }

  try {
    const courses = await loadPaidCourses(sessionUser.id);
    const items = courses.length
      ? `<ul>${courses
          .map(
            (course) => `
          <li>
            <strong>${escapeHtml(course.title)}</strong>
            <br><a href="/courses/${course.course_id}">Open course materials</a>
          </li>
        `,
          )
          .join("")}</ul>`
      : "<p>No completed purchases found yet.</p>";

    const successBanner =
      req.query.payment === "success"
        ? '<p class="meta">Your payment was verified and your course has been added to your dashboard.</p>'
        : "";

    return res.send(
      page(
        "My Courses",
        `
      <h1>My Dashboard</h1>
      <p class="meta">Signed in as: ${escapeHtml(sessionUser.name)} (${escapeHtml(sessionUser.email)})</p>
      ${successBanner}
      ${items}
      <p><a href="/pay?step=2">Buy another course</a></p>
      <p><a href="/logout">Sign out</a></p>
    `,
      ),
    );
  } catch (err) {
    console.error("Failed to load paid courses:", err.message);
    return res
      .status(500)
      .send(page("My Courses", "<p>Could not load courses right now.</p>"));
  }
});

// ─── GET /courses/:courseId — protected course landing page ────

app.get("/courses/:courseId", async (req, res) => {
  const { courseId } = req.params;
  const sessionUser = await getSessionUser(req).catch((err) => {
    console.error("Session lookup failed:", err.message);
    return null;
  });

  if (!sessionUser) {
    return res.redirect("/pay?error=Please+sign+in+to+open+your+course.");
  }

  try {
    const allowed = await canAccessCourse(sessionUser.id, courseId);
    if (!allowed) {
      return res.status(403).send(
        page(
          "Access Denied",
          `
        <p class="big">🔒</p>
        <h1>Access Denied</h1>
        <p>This course is available only to paid users.</p>
        <p class="meta">Use the dashboard to continue.</p>
        <a href="/my-courses">Go back</a>
      `,
        ),
      );
    }

    const course = await loadCourseById(courseId);
    if (!course) {
      return res.status(404).send(
        page(
          "Course Not Found",
          `
        <p class="big">❓</p>
        <h1>Course Not Found</h1>
        <a href="/my-courses">Go back</a>
      `,
        ),
      );
    }

    const courseFolder = safeCourseFolder(courseId);
    const files = listCourseFiles(courseFolder);

    const fileList = files.length
      ? `<ul>${files
          .map(
            (fileName) => `
          <li>
            <a href="/courses/${courseId}/files/${encodeURIComponent(fileName)}">${escapeHtml(fileName)}</a>
          </li>
        `,
          )
          .join("")}</ul>`
      : "<p>No materials uploaded yet for this course.</p>";

    return res.send(
      page(
        `${course.title}`,
        `
      <h1>${escapeHtml(course.title)}</h1>
      <p class="meta">Paid access confirmed for ${escapeHtml(sessionUser.email)}</p>
      <p class="meta">Price: NPR ${Number(course.price).toFixed(0)}</p>
      ${fileList}
      <p><a href="/my-courses">Back to My Dashboard</a></p>
    `,
      ),
    );
  } catch (err) {
    console.error("Course access failed:", err.message);
    return res
      .status(500)
      .send(page("Course Access", "<p>Could not load course right now.</p>"));
  }
});

// ─── GET /courses/:courseId/files/:fileName — protected file ──

app.get("/courses/:courseId/files/:fileName", async (req, res) => {
  const { courseId, fileName } = req.params;
  const sessionUser = await getSessionUser(req).catch((err) => {
    console.error("Session lookup failed:", err.message);
    return null;
  });

  if (!sessionUser) {
    return res.status(401).send("Please sign in first.");
  }

  try {
    const allowed = await canAccessCourse(sessionUser.id, courseId);
    if (!allowed) {
      return res.status(403).send("Access denied.");
    }

    const courseFolder = safeCourseFolder(courseId);
    const requestedPath = path.resolve(courseFolder, fileName);

    if (!requestedPath.startsWith(courseFolder + path.sep)) {
      return res.status(400).send("Invalid file path.");
    }

    if (!fs.existsSync(requestedPath) || !fs.statSync(requestedPath).isFile()) {
      return res.status(404).send("File not found.");
    }

    return res.sendFile(requestedPath);
  } catch (err) {
    console.error("File access failed:", err.message);
    return res.status(500).send("Could not load file.");
  }
});

// ─── START ─────────────────────────────────────────────────────

app.listen(3000, () => {
  console.log("\n╔════════════════════════════════════════╗");
  console.log("║   eSewa + MySQL — Running              ║");
  console.log("╚════════════════════════════════════════╝");
  console.log(`\n  Local : http://localhost:3000/pay`);
  console.log(`  ngrok : ${NGROK_URL}`);
  console.log("\n  ⚠️  Update NGROK_URL if you restarted ngrok.\n");
});
