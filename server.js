require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const {
  GOOGLE_CLIENT_ID,
  ALLOWED_DOMAIN = 'falcongames.com',
  ADMIN_EMAILS = '',
  SESSION_SECRET,
  PORT = 3000,
  NODE_ENV = 'development',
} = process.env;

if (!GOOGLE_CLIENT_ID) {
  console.error('LỖI: thiếu GOOGLE_CLIENT_ID trong .env — xem README.md để tạo OAuth Client ID.');
  process.exit(1);
}
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  console.error('LỖI: thiếu hoặc SESSION_SECRET quá ngắn trong .env — đặt một chuỗi ngẫu nhiên dài (>=32 ký tự).');
  process.exit(1);
}

const adminEmails = ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const allowedDomain = ALLOWED_DOMAIN.trim().toLowerCase();
const isProd = NODE_ENV === 'production';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
app.set('trust proxy', 1); // để cookie "secure" hoạt động đúng sau reverse proxy (Nginx) có SSL
app.use(express.json());
app.use(cookieParser());

const COOKIE_NAME = 'falcon_org_session';
const SESSION_TTL = '12h';

function signSession(payload) {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: SESSION_TTL });
}
function readSession(req) {
  const tok = req.cookies && req.cookies[COOKIE_NAME];
  if (!tok) return null;
  try {
    return jwt.verify(tok, SESSION_SECRET);
  } catch (e) {
    return null;
  }
}
function setSessionCookie(res, payload) {
  const token = signSession(payload);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 12 * 60 * 60 * 1000,
  });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// ---- Xác thực đăng nhập Google (thật) ----
// Nhận ID token do Google Identity Services trả về sau khi người dùng đăng
// nhập, xác minh CHỮ KÝ của Google (chống giả mạo) rồi kiểm tra domain email.
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ ok: false, error: 'Thiếu credential.' });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token Google không hợp lệ.' });
  }
  const email = (payload.email || '').toLowerCase().trim();
  const emailVerified = !!payload.email_verified;
  const hd = (payload.hd || '').toLowerCase().trim();
  const domainOk = hd ? hd === allowedDomain : email.endsWith('@' + allowedDomain);
  if (!emailVerified || !domainOk) {
    return res.status(403).json({ ok: false, error: `Chỉ tài khoản Google @${allowedDomain} mới được truy cập.` });
  }
  const role = adminEmails.includes(email) ? 'admin' : 'staff';
  setSessionCookie(res, { email, role });
  res.json({ ok: true, email, role });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  const s = readSession(req);
  if (!s) return res.json({ authenticated: false });
  res.json({ authenticated: true, email: s.email, role: s.role });
});

function requireAuth(req, res, next) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  req.user = s;
  next();
}

// ---- Dữ liệu tổ chức: chỉ trả về cho phiên đã xác thực ----
app.get('/api/org-data', requireAuth, (req, res) => {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'data', 'org-data.json'), 'utf-8');
    const json = JSON.parse(raw);
    res.json(json);
  } catch (e) {
    console.error('Không đọc được data/org-data.json:', e);
    res.status(500).json({ error: 'Lỗi đọc dữ liệu.' });
  }
});

// index.html cần chèn GOOGLE_CLIENT_ID động nên xử lý riêng, không dùng static cho file này
app.get('/', (req, res) => {
  const tplPath = path.join(__dirname, 'public', 'index.template.html');
  fs.readFile(tplPath, 'utf-8', (err, tpl) => {
    if (err) return res.status(500).send('Thiếu public/index.template.html');
    const html = tpl
      .replace(/%%GOOGLE_CLIENT_ID%%/g, GOOGLE_CLIENT_ID)
      .replace(/%%ALLOWED_DOMAIN%%/g, allowedDomain);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  });
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.listen(PORT, () => {
  console.log(`Falcon org chart server đang chạy tại http://localhost:${PORT}`);
});
