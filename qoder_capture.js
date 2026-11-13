// qoder_capture.js -- Qoder web session cookie one-click refresh.
//
// Why: the dt- API token only returns the total Credits balance. Per-pack
// expiry (the "expiring credits" line) is only available from qoder.com's
// web endpoint /api/v2/me/usages/big_model_credits, which requires the
// browser login session + window.csrfToken.
//
// Usage: double-click refresh_qoder_cookie.bat, log in to qoder.com in the
// popped-up Edge window. The script validates the cookie against the real
// API, writes qoder_cookie.txt locally, then closes the window and exits.
//
// 本机部署（2026-11-13 改造）：原脚本校验成功后会调用 push_qoder_cookie.py，
// 把登录态 SFTP 推到原作者的 112 服务器 /opt/wb-checkin/。本机签到中心的
// _qd_cookie() 是「每次现读盘不缓存」，cookie 落盘即生效，完全不需要外发。
// 现默认走本机模式；确需远程部署时显式设 QODER_PUSH_REMOTE=1 才恢复旧行为。
const { chromium } = require('./runtime_env').loadPlaywright();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROFILE = path.join(__dirname, 'qoder_profile');
const COOKIE_TXT = path.join(__dirname, 'qoder_cookie.txt');
const COOKIE_JSON = path.join(__dirname, 'qoder_cookie.json');
const TARGET = 'https://qoder.com/account/usage?client=qoder&sourceType=IDE';
const API = 'https://qoder.com/api/v2/me/usages/big_model_credits';
const LOCAL_PY = 'D:/Dev/python.exe';
const PY = process.env.PYTHON_PATH ||
  (fs.existsSync(LOCAL_PY) ? LOCAL_PY : require('./runtime_env').resolvePython());
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MAX_MS = 6 * 60 * 1000;
let pushed = false;

function qoderCookies(all) {
  const map = new Map();
  for (const c of all) {
    const d = (c.domain || '').replace(/^\./, '');
    if (d === 'qoder.com' || d.endsWith('.qoder.com')) map.set(c.name, c.value);
  }
  return map;
}

function buildHeader(map) {
  return [...map].map(([k, v]) => k + '=' + v).join('; ');
}

function saveCookies(all) {
  const rows = all.filter((c) => {
    const d = (c.domain || '').replace(/^\./, '');
    return d === 'qoder.com' || d.endsWith('.qoder.com');
  });
  const header = rows.map((c) => c.name + '=' + c.value).join('; ');
  if (fs.existsSync(COOKIE_TXT)) {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    try { fs.copyFileSync(COOKIE_TXT, COOKIE_TXT + '.bak_' + ts); } catch (e) {}
  }
  fs.writeFileSync(COOKIE_JSON, JSON.stringify(rows, null, 2));
  fs.writeFileSync(COOKIE_TXT, header + '\n');
  return header;
}

async function getCsrf(page, html) {
  try {
    const v = await page.evaluate(() => (typeof window !== 'undefined' ? window.csrfToken || '' : ''));
    if (v) return v;
  } catch (e) {}
  const src = html || '';
  const m = src.match(/window\.csrfToken\s*=\s*'([^']+)'/);
  return m ? m[1] : '';
}

function packList(data) {
  if (!data) return [];
  const group = (k) => (data[k] && Array.isArray(data[k].quota_detail) ? data[k].quota_detail : []);
  let packs = group('resource_package_quota').concat(group('dedicated_resource_package_quota'));
  if (!packs.length) packs = group('total_quota');
  return packs;
}

async function check(page, header, csrf) {
  const r = await fetch(API, {
    headers: {
      Cookie: header,
      'X-CSRF-TOKEN': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
      Origin: 'https://qoder.com',
      Referer: 'https://qoder.com/account/usage',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) {}
  const packs = packList(data);
  const expiring = packs.filter((x) => x && x.expires_at != null &&
    Number(x.remaining_value || x.remainingValue || 0) > 0);
  console.log('[check] HTTP ' + r.status + ' packs=' + packs.length + ' expiring=' + expiring.length);
  return r.status === 200 && !!data;
}

function push(ctx) {
  if (pushed) return;
  pushed = true;
  // 默认本机模式：cookie 已由 saveCookies() 写入同目录，web_server 现读盘即生效。
  // 不调用 push_qoder_cookie.py，避免把 qoder.com 登录态外发到第三方服务器。
  if (process.env.QODER_PUSH_REMOTE !== '1') {
    console.log('[done] cookie 已写入 qoder_cookie.txt（本机模式，未向外推送）');
    console.log('[done] 签到中心现读盘生效，刷新页面即可看到「将过期积分」');
    (async () => { try { await ctx.close(); } catch (e) {} })();
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  console.log('[push] QODER_PUSH_REMOTE=1，上传 cookie 到远程服务器 ...');
  execFile(PY, ['push_qoder_cookie.py'], { cwd: __dirname }, async (err, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.log(stderr);
    if (err) {
      console.log('[push] FAILED: ' + err.message);
      console.log('[push] retry manually: python push_qoder_cookie.py');
    } else {
      console.log('[push] OK. Qoder card will show expiring credits on next refresh.');
    }
    try { await ctx.close(); } catch (e) {}
    setTimeout(() => process.exit(err ? 1 : 0), 1200);
  });
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: 'msedge',
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || await ctx.newPage();
  console.log('READY: Edge opened. Please log in to qoder.com (scan QR / account).');
  console.log('       This isolated window closes automatically after success.');
  try {
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('[nav] ' + e.message);
  }
  const deadline = Date.now() + MAX_MS;
  let html = '';
  const readHtml = async () => {
    try { html = await page.content(); } catch (e) {}
    return html;
  };
  const tick = async () => {
    try {
      const all = await ctx.cookies();
      const map = qoderCookies(all);
      if (map.size > 0) {
        const csrf = await getCsrf(page, await readHtml());
        const header = buildHeader(map);
        if (await check(page, header, csrf)) {
          clearInterval(timer);
          saveCookies(all);
          push(ctx);
          return;
        }
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 用户关掉 Edge 窗口后不要空转刷错误日志：直接收尾退出。
      // 需要重新登录时再运行一次 refresh_qoder_cookie.bat / node qoder_capture.js 即可。
      if (/has been closed|Target closed|browser has disconnected/i.test(msg)) {
        clearInterval(timer);
        console.log('[exit] Edge 窗口已关闭，采集结束；需要重新登录时再运行一次即可。');
        setTimeout(() => process.exit(3), 800);
        return;
      }
      console.log('[tick] ' + msg);
    }
    if (Date.now() > deadline) {
      clearInterval(timer);
      console.log('TIMEOUT: not logged in within 6 minutes. Run refresh_qoder_cookie.bat again.');
      try { await ctx.close(); } catch (e) {}
      setTimeout(() => process.exit(2), 1000);
    }
  };
  const timer = setInterval(tick, 5000);
  await tick();
})().catch((e) => { console.log('FATAL', e); process.exit(1); });
