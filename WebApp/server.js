const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const API_ROOT = 'https://web.spaggiari.eu/rest/w1';
const LOGIN_URL = 'https://web.spaggiari.eu/auth-p7/app/default/AuthApi4.php?a=aLoginPwd';
const attempts = new Map();
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

function send(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(JSON.stringify(body));
}

function rateLimited(req) {
  const now = Date.now();
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const entry = attempts.get(ip);
  if (!entry || now - entry.start > 15 * 60 * 1000) {
    attempts.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > 12;
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw new Error('body_too_large');
  }
  return JSON.parse(raw);
}

function getCookieHeader(response) {
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return setCookies.map(value => value.split(';', 1)[0]).filter(Boolean).join('; ');
}

function extractGrades(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.grades || payload?.data?.grades || [];
  if (!Array.isArray(rows)) throw new Error('grade_format');
  const result = [];
  for (const item of rows) {
    const subject = item.subjectDesc;
    const rawDate = item.evtDate;
    let date = typeof rawDate === 'string' ? rawDate.slice(0, 10) : '';
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(rawDate || '')) {
      const [day, month, year] = rawDate.split('/');
      date = `${year}-${month}-${day}`;
    }
    const rawGrade = item.decimalValue ?? item.displayValue;
    const gradeText = String(rawGrade ?? '').replace(',', '.').replaceAll('/', '.');
    const grade = Number(gradeText);
    if (typeof subject !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(grade) || grade < 0 || grade > 10) continue;
    result.push({ subject, date, grade, assessment: item.componentDesc || item.evtCode || '' });
  }
  return result;
}

async function classevivaGrades(username, password) {
  const form = new URLSearchParams({ cid: '', uid: username.trim(), pwd: password, pin: '', target: '' });
  const login = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded; charset=utf-8', 'Accept':'application/json' },
    body: form.toString(),
    signal: AbortSignal.timeout(15000)
  });
  if (!login.ok) throw new Error(login.status === 401 || login.status === 403 ? 'credentials' : 'upstream');
  let loginData;
  try { loginData = await login.json(); } catch { throw new Error('credentials'); }
  if (loginData?.data?.auth?.loggedIn !== true) throw new Error('credentials');

  const cookie = getCookieHeader(login);
  const headers = { 'Accept':'application/json' };
  if (cookie) headers.Cookie = cookie;
  let studentId = loginData.data?.auth?.accountInfo?.id;
  if (!studentId) {
    const identity = await fetch(`${API_ROOT}/misc/whoami`, { headers, signal: AbortSignal.timeout(15000) });
    if (!identity.ok) throw new Error('session');
    const who = await identity.json();
    studentId = who?.id?.value ?? who?.id;
  }
  if (studentId == null || !/^\d+$/.test(String(studentId))) throw new Error('session');
  const response = await fetch(`${API_ROOT}/students/${encodeURIComponent(studentId)}/grades26`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'session' : 'upstream');
  let payload;
  try { payload = await response.json(); } catch { throw new Error('grade_format'); }
  if (payload?.error?.code === 401) throw new Error('session');
  return extractGrades(payload);
}

async function handleApi(req, res) {
  const expectedOrigin = `https://${req.headers.host}`;
  const localhostOrigin = `http://${req.headers.host}`;
  const origin = req.headers.origin;
  if (origin && origin !== expectedOrigin && origin !== localhostOrigin) return send(res, 403, { error:'origin' });
  if (req.method !== 'POST') return send(res, 405, { error:'method' });
  if (rateLimited(req)) return send(res, 429, { error:'rate_limit' });

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { error:'request' }); }
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 160 || password.length > 256) return send(res, 400, { error:'credentials' });

  try {
    const grades = await classevivaGrades(username, password);
    return send(res, 200, { grades });
  } catch (error) {
    const code = ['credentials','session','grade_format'].includes(error.message) ? error.message : 'unavailable';
    const status = code === 'credentials' ? 401 : code === 'session' ? 401 : code === 'grade_format' ? 502 : 502;
    return send(res, status, { error:code });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/api/login' || req.url === '/api/grades') return handleApi(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error:'method' });
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { pathname = '/'; }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(`${ROOT}${path.sep}`)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control':'no-cache',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'X-Frame-Options':'DENY'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
});

server.listen(PORT);
