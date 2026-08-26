// == phucmaxreg v3.4 - AUTO IP ROTATION EVERY 7 ACCOUNTS ==

(function () {
  'use strict';

  let savedAccounts = [];
  let tempEmail = '';
  let recoveryEmail = '';
  let mtToken = '';
  let mtPassword = '';
  let currentCode = '';
  let currentUsername = '';
  let currentPassword = '';
  let pollTimer = null;
  let overlayEl = null;
  let autoMode = false;
  let isRegistering = false;
  let allExtractedCodes = [];
  let codeRequestedAt = 0;
  let registrationCount = 0;
  let isAutoRetrying = false;
  let ipRotationNeeded = false;

  let nameTemplate = '';
  let nameCounter = 1;
  let pwdTemplate = '@Phucmax';

  const MAILTM_API = 'https://api.mail.tm';
  const LOG_PREFIX = '[phucmaxreg]';
  const IP_ROTATION_INTERVAL = 7; // Rotate IP every 7 accounts

  function log(...args) { console.log(LOG_PREFIX, ...args); }

  function randomStr(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let r = '';
    for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
    return r;
  }

  function randomAlphanumeric(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let r = '';
    for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length));
    return r;
  }

  function generateStrongPassword() {
    const digits = '0123456789';
    const uppers = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const d = digits.charAt(Math.floor(Math.random() * digits.length));
    const u = uppers.charAt(Math.floor(Math.random() * uppers.length));
    const r1 = alnum.charAt(Math.floor(Math.random() * alnum.length));
    const r2 = alnum.charAt(Math.floor(Math.random() * alnum.length));
    const suffix = [d, u, r1, r2].sort(() => Math.random() - 0.5).join('');
    return pwdTemplate + suffix;
  }

  function generateUsername() {
    if (nameTemplate && nameTemplate.trim()) {
      const name = nameTemplate.trim() + nameCounter;
      nameCounter++;
      chrome.storage.sync.set({ nameCounter });
      return name;
    }
    const prefixes = ['pro', 'vip', 'win', 'top', 'god', 'max', 'new', 'hot', 'fun', 'sky', 'ace', 'ice', 'red', 'fox', 'big', 'xpro'];
    return prefixes[Math.floor(Math.random() * prefixes.length)] + randomStr(5);
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy');
      document.body.removeChild(ta); return true;
    }
  }

  function stripHtml(html) {
    if (!html) return '';
    try { return new DOMParser().parseFromString(html, 'text/html').body.textContent || ''; }
    catch { return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }
  }

  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function syncGet(keys) {
    return new Promise(r => chrome.storage.sync.get(keys, r));
  }

  function syncSet(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(obj, () => {
        if (chrome.runtime.lastError) {
          chrome.storage.local.set(obj, resolve);
        } else resolve();
      });
    });
  }

  function apiFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const msg = { type: 'FETCH_JSON', url, method: opts.method || 'GET' };
      if (opts.token) msg.token = opts.token;
      if (opts.body) msg.body = opts.body;

      const doDirectFetch = () => {
        const fo = { method: msg.method, cache: 'no-store', headers: { 'Content-Type': 'application/json' } };
        if (opts.token) fo.headers['Authorization'] = `Bearer ${opts.token}`;
        if (opts.body) fo.body = JSON.stringify(opts.body);
        fetch(url, fo)
          .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
          .then(resolve).catch(reject);
      };

      try {
        chrome.runtime.sendMessage(msg, (response) => {
          if (chrome.runtime.lastError || !response) { doDirectFetch(); return; }
          if (!response.ok) return reject(new Error(response.error || 'Fetch lỗi'));
          resolve(response.data);
        });
      } catch (e) { doDirectFetch(); }
    });
  }

  function detectGarenaBlock() {
    const bodyText = (document.body && document.body.innerText || '').toLowerCase();
    const title = document.title.toLowerCase();
    const blockKeywords = [
      'access denied', 'blocked', 'too many requests', 'rate limit',
      'bị chặn', 'từ chối', '403', '429', 'forbidden',
      'your ip', 'suspicious', 'captcha', 'robot'
    ];
    const hasForm = document.querySelector('input[type="password"], input[placeholder*="truy cập"], input[placeholder*="username"]');
    const blocked = blockKeywords.some(kw => bodyText.includes(kw) || title.includes(kw));
    return blocked || (!hasForm && document.readyState === 'complete');
  }

  function detectSuccessPage() {
    const bodyText = (document.body && document.body.innerText) || '';
    const hasSuccessText =
      bodyText.includes('Cảm ơn vì đã tạo tài khoản') ||
      bodyText.includes('đăng kí thành công') ||
      bodyText.includes('đã đăng ký thành công') ||
      bodyText.includes('Bạn đã đăng kí thành công') ||
      bodyText.includes('Thank you for registering');
    const noPasswordInput = !document.querySelector('input[type="password"]');
    return hasSuccessText || (noPasswordInput && bodyText.includes('Garena') && bodyText.includes('thành công'));
  }

  function showBlockWarning() {
    const old = document.getElementById('gt-block-warning');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = 'gt-block-warning';
    div.innerHTML = `
      <div class="gt-block-icon">🚫</div>
      <div class="gt-block-title">BỊ GARENA CHẶN!</div>
      <div class="gt-block-msg">
        Garena đã chặn nội dung. <b>KHÔNG</b> tải lại trang!<br><br>
        ✅ Cách xử lý:<br>
        1. Xóa dữ liệu ứng dụng Garena (Site Data)<br>
        2. Đổi IP (dùng VPN khác)<br>
        3. Mở lại trang đăng ký để chạy tiếp
      </div>
      <button id="gt-block-dismiss">Đã hiểu, đóng</button>
    `;
    document.body.appendChild(div);
    document.getElementById('gt-block-dismiss').addEventListener('click', () => div.remove());
  }

  function showIPRotationWarning() {
    const old = document.getElementById('gt-ip-rotation-warning');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id = 'gt-ip-rotation-warning';
    div.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: #1f2937; border: 2px solid #f59e0b; border-radius: 8px;
      padding: 20px; color: white; z-index: 9999; max-width: 400px; text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5); font-family: monospace;
    `;
    div.innerHTML = `
      <div style="font-size: 32px; margin-bottom: 10px;">🔄</div>
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">ĐỔI IP NGAY!</div>
      <div style="font-size: 14px; line-height: 1.6; margin-bottom: 15px;">
        Đã tạo được 7 tài khoản.<br>
        Bây giờ bạn PHẢI đổi IP (VPN, Proxy, hoặc reset modem).<br><br>
        <strong>⚠ Không đổi = Garena sẽ chặn!</strong>
      </div>
      <div style="font-size: 12px; color: #9ca3af; margin-bottom: 15px;">
        Chạy script này từ browser khác hoặc VPN mới sau khi đổi IP.
      </div>
      <button id="gt-ip-dismiss" style="
        background: #f59e0b; color: black; border: none; padding: 10px 20px;
        border-radius: 4px; font-weight: bold; cursor: pointer; font-size: 14px;
      ">Tôi đã đổi IP, tiếp tục</button>
    `;
    document.body.appendChild(div);
    document.getElementById('gt-ip-dismiss').addEventListener('click', () => {
      div.remove();
      ipRotationNeeded = false;
      generateNewAccount();
    });
  }

  async function createMailTmAccount() {
    const stored = await new Promise(r => chrome.storage.local.get(['mtEmail', 'mtPassword', 'mtToken'], r));
    if (stored.mtEmail && stored.mtToken) {
      try {
        await apiFetch(`${MAILTM_API}/messages?page=1`, { token: stored.mtToken });
        tempEmail = stored.mtEmail; mtToken = stored.mtToken; mtPassword = stored.mtPassword || '';
        log('Khôi phục mail.tm:', tempEmail);
        return { email: tempEmail };
      } catch (e) {
        if (stored.mtPassword) {
          try {
            const td = await apiFetch(`${MAILTM_API}/token`, { method: 'POST', body: { address: stored.mtEmail, password: stored.mtPassword } });
            mtToken = td.token; tempEmail = stored.mtEmail; mtPassword = stored.mtPassword;
            chrome.storage.local.set({ mtToken });
            return { email: tempEmail };
          } catch (e2) { log('Token hết hạn, tạo mới...'); }
        }
      }
    }

    const domainsData = await apiFetch(`${MAILTM_API}/domains`);
    const allDomains = domainsData['hydra:member'] || [];
    const domains = allDomains.filter(d => d.isActive !== false && !d.isPrivate);
    if (!domains.length) throw new Error('Không có domain mail.tm nào khả dụng');

    const shuffled = [...domains].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(4, shuffled.length); i++) {
      const domain = shuffled[i].domain;
      const login = randomStr(10) + Math.floor(Math.random() * 1000);
      const pass = 'Gt' + randomStr(8) + 'A1!';
      const address = `${login}@${domain}`;
      log(`Thử tạo mail.tm (lần ${i + 1}):`, address);
      try {
        await apiFetch(`${MAILTM_API}/accounts`, { method: 'POST', body: { address, password: pass } });
        const tokenData = await apiFetch(`${MAILTM_API}/token`, { method: 'POST', body: { address, password: pass } });
        tempEmail = address; mtToken = tokenData.token; mtPassword = pass;
        chrome.storage.local.set({ mtEmail: tempEmail, mtPassword, mtToken });
        log('mail.tm sẵn sàng:', tempEmail);
        return { email: tempEmail };
      } catch (e) {
        log(`Domain ${domain} thất bại (${e.message}), thử domain khác...`);
        await new Promise(r => setTimeout(r, 500));
      }
    }
    throw new Error('Tất cả domain mail.tm thất bại – thử lại sau');
  }

  async function refreshMailTmAccount() {
    chrome.storage.local.remove(['mtEmail', 'mtPassword', 'mtToken']);
    tempEmail = ''; mtToken = ''; mtPassword = '';
    return createMailTmAccount();
  }

  async function checkMailTmInbox() {
    if (!mtToken) return [];
    const data = await apiFetch(`${MAILTM_API}/messages?page=1`, { token: mtToken });
    return data['hydra:member'] || [];
  }

  async function readMailTmMessage(id) {
    return apiFetch(`${MAILTM_API}/messages/${id}`, { token: mtToken });
  }

  function normalizeInboxMsg(m) {
    return {
      id: m.id,
      from: (m.from && m.from.address) ? m.from.address : (m.from || ''),
      subject: m.subject || '',
      timestamp: m.createdAt ? new Date(m.createdAt).getTime() : 0
    };
  }

  function normalizeFullMsg(m) {
    const htmlBody = Array.isArray(m.html) ? m.html.join('') : (m.html || '');
    return { from: (m.from && m.from.address) ? m.from.address : '', subject: m.subject || '', htmlBody, textBody: m.text || '' };
  }

  function extractAllCodesFromText(text) {
    const results = [];
    if (!text) return results;
    const re1 = /(?<!\d)(\d{8})(?!\d)/g;
    let m;
    while ((m = re1.exec(text)) !== null) {
      const idx = m.index;
      const before = text.substring(Math.max(0, idx - 60), idx);
      const after = text.substring(idx + 8, Math.min(text.length, idx + 68));
      results.push({ code: m[1], ctx: `...${before.trim().slice(-35)}»${m[1]}«${after.trim().slice(0, 35)}...`, strategy: 'continuous' });
    }
    const re2 = /(\d{4})[-\s.](\d{4})/g;
    while ((m = re2.exec(text)) !== null) {
      const combined = m[1] + m[2];
      if (!results.some(r => r.code === combined))
        results.push({ code: combined, ctx: `(tách 4+4: ${m[0]})`, strategy: 'split' });
    }
    return results;
  }

  function scoreCode(code, fullText) {
    let score = 0;
    const idx = fullText.indexOf(code);
    if (idx === -1) return 0;
    const before = fullText.substring(Math.max(0, idx - 120), idx).toLowerCase();
    const after = fullText.substring(idx + 8, Math.min(fullText.length, idx + 128)).toLowerCase();
    const ctx = before + ' ' + after;
    for (const kw of ['mã xác thực', 'verification code', 'mã otp', 'mã kích hoạt', 'xác thực email', 'mã của bạn', 'your code', 'authentication code', 'confirm code', 'mã xác minh', 'verify your email']) {
      if (ctx.includes(kw)) { score += 30; break; }
    }
    for (const kw of ['code', 'mã', 'otp', 'xác thực', 'verify', 'garena', 'xác minh', 'kích hoạt', 'bảo mật']) { if (ctx.includes(kw)) score += 10; }
    if (before.match(/(mã|code|otp)\s*[:.>\s]*\s*$/i)) score += 25;
    if ((before.match(/\d/g) || []).length > 8) score -= 8;
    if ((after.match(/\d/g) || []).length > 8) score -= 8;
    if (before.endsWith('\n') || before.endsWith('\r')) score += 10;
    if (after.startsWith('\n') || after.startsWith('\r')) score += 10;
    return score;
  }

  function findBestCodes(normalizedMsg) {
    const textPlain = normalizedMsg.textBody || '';
    const textHtml = stripHtml(normalizedMsg.htmlBody || '');
    const fullText = textPlain + '\n' + textHtml;
    const all = extractAllCodesFromText(fullText);
    const unique = [];
    const seen = new Set();
    for (const item of all) {
      if (!seen.has(item.code)) { seen.add(item.code); item.score = scoreCode(item.code, fullText); unique.push(item); }
    }
    unique.sort((a, b) => b.score - a.score);
    return unique;
  }

  function isGarenaEmail(msg) {
    const from = (msg.from || '').toLowerCase();
    const subject = (msg.subject || '').toLowerCase();
    return from.includes('garena') ||
      (subject.includes('garena') && (subject.includes('code') || subject.includes('xác thực') || subject.includes('verify')));
  }

  function clickSendCodeButton() {
    const buttons = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      if (text.includes('gửi mã xác thực') || text.includes('gửi mã') || text.includes('nhận mã')) { clickElement(btn); return true; }
    }
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      if ((text.includes('mã') && (text.includes('gửi') || text.includes('nhận') || text.includes('lấy'))) ||
          text.includes('xác thực') || text.includes('verify') || text.includes('send code')) { clickElement(btn); return true; }
    }
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const pl = (inp.placeholder || '').toLowerCase(), n = (inp.name || '').toLowerCase();
      if (pl.includes('email') || pl.includes('tên truy cập') || n.includes('email') || n.includes('username')) {
        const parent = inp.closest('div, form, section');
        if (parent) {
          for (const btn of parent.querySelectorAll('button')) {
            const text = (btn.textContent || '').toLowerCase().trim();
            if (text.length < 30 && text.length > 0 && btn.offsetWidth > 0) { clickElement(btn); return true; }
          }
        }
      }
    }
    const visibleBtns = [];
    for (const btn of buttons) {
      const r = btn.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top > 50 && r.top < 600) {
        const text = (btn.textContent || btn.value || '').toLowerCase().trim();
        if (text.length > 0) visibleBtns.push({ btn, text, top: r.top });
      }
    }
    visibleBtns.sort((a, b) => a.top - b.top);
    for (const c of visibleBtns.slice(0, 5)) {
      if (!['đăng nhập', 'sign in', 'login', 'đăng ký', 'register', 'facebook', 'google', 'apple'].some(s => c.text.includes(s))) {
        clickElement(c.btn); return true;
      }
    }
    return false;
  }

  function clickElement(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0 }));
    el.click();
    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
      el.focus();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    }
  }

  function clickRegisterButton() {
    const buttons = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      if (text.includes('đăng ký ngay') || text.includes('đăng ký') || text.includes('register') ||
          text.includes('sign up') || text.includes('tạo tài khoản') || text.includes('hoàn tất')) {
        clickElement(btn); return true;
      }
    }
    return false;
  }

  function clickConfirmCodeButton() {
    const codeInput = findCodeInput();
    if (codeInput) {
      const parent = codeInput.closest('div, form, section, td, tr') || codeInput.parentElement;
      if (parent) {
        const btns = parent.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]');
        for (const btn of btns) {
          const text = (btn.textContent || btn.value || '').toLowerCase().trim();
          if (text.includes('xác nhận') || text.includes('confirm') || text.includes('verify') ||
              text.includes('ok') || text.includes('kiểm tra') || text.includes('tiếp tục')) {
            clickElement(btn); return true;
          }
        }
      }
    }
    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase().trim();
      if ((text.includes('xác nhận') || text.includes('confirm') || text.includes('verify')) &&
          !text.includes('đăng ký') && !text.includes('register') && !text.includes('sign up')) {
        clickElement(btn); return true;
      }
    }
    return false;
  }

  function findCodeInput() {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const p = (input.placeholder || '').toLowerCase(), n = (input.name || '').toLowerCase(), id = (input.id || '').toLowerCase();
      if (p.includes('code') || p.includes('mã') || p.includes('otp') || p.includes('xác thực') ||
          n.includes('code') || n.includes('otp') || n.includes('captcha') ||
          id.includes('code') || id.includes('otp') || id.includes('captcha')) return input;
    }
    for (const input of inputs) {
      if (input.maxLength === 8 && input.type !== 'password' && input.type !== 'email' && input.type !== 'hidden' && input.offsetWidth > 0) return input;
    }
    return null;
  }

  function setInputValue(input, value) {
    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, value);
    } catch (e) {
      input.value = value;
    }
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('keyup', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function autoFillGarenaForm() {
    const inputs = document.querySelectorAll('input');
    const vis = [];
    inputs.forEach(inp => { const r = inp.getBoundingClientRect(); if (r.width > 0 && r.height > 0) vis.push(inp); });
    let uf = null, pf = null, cf = null, ef = null;
    for (const inp of vis) {
      const t = inp.type || '', pl = (inp.placeholder || '').toLowerCase(), n = (inp.name || '').toLowerCase();
      if (t === 'text' || t === 'email') {
        if (pl.includes('tên truy cập') || pl.includes('username') || n.includes('username') || n.includes('account')) uf = inp;
        else if (pl.includes('email') || n.includes('email')) ef = inp;
      }
      if (t === 'password') { if (!pf) pf = inp; else cf = inp; }
    }
    if (uf && currentUsername) setInputValue(uf, currentUsername);
    if (pf && currentPassword) setInputValue(pf, currentPassword);
    if (cf && currentPassword) setInputValue(cf, currentPassword);
    if (ef && tempEmail) {
      setInputValue(ef, tempEmail);
      setTimeout(() => {
        ef.focus();
        ef.dispatchEvent(new Event('input', { bubbles: true }));
        ef.dispatchEvent(new Event('blur', { bubbles: true }));
      }, 200);
    }
  }

  function waitAndClickSendCode(maxMs) {
    const start = Date.now();
    const check = () => {
      const allBtns = document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]');
      for (const btn of allBtns) {
        const text = (btn.textContent || btn.value || '').toLowerCase().trim();
        const isDisabled = btn.disabled || btn.getAttribute('disabled') != null ||
                           btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true';
        if ((text.includes('nhận mã') || text.includes('gửi mã') || text.includes('send code')) && !isDisabled) {
          clickElement(btn);
          _afterSendCodeClicked();
          return true;
        }
      }
      for (const btn of allBtns) {
        const text = (btn.textContent || btn.value || '').toLowerCase().trim();
        if (text.includes('nhận mã') || text.includes('gửi mã')) {
          clickElement(btn);
          _afterSendCodeClicked();
          return true;
        }
      }
      if (Date.now() - start < maxMs) {
        setStatus(`⏳ Chờ NHẬN MÃ... (${Math.floor((Date.now() - start) / 1000)}s)`, '#f59e0b');
        setTimeout(check, 400);
        return false;
      }
      const ok = clickSendCodeButton();
      if (ok) _afterSendCodeClicked();
      else { setStatus('❌ Không tìm thấy nút NHẬN MÃ — nhấn tay 📨', '#ef4444'); updateStepStatus(2, '❌'); }
      return ok;
    };
    check();
  }

  function autoFillCode(code) {
    const input = findCodeInput();
    if (input) { setInputValue(input, code); return true; }
    return false;
  }

  function saveSessionState() {
    chrome.storage.local.set({ sessionUsername: currentUsername, sessionPassword: currentPassword, sessionCodeRequestedAt: codeRequestedAt, sessionCode: currentCode });
  }

  function saveAccount(username, password) {
    if (!username || !password) return;
    if (savedAccounts.some(a => a.username === username)) return;
    const account = { username, password, email: tempEmail, recoveryEmail, timestamp: new Date().toLocaleString('vi-VN') };
    savedAccounts.unshift(account);
    if (savedAccounts.length > 200) savedAccounts.pop();
    syncSet({ savedAccounts });
    renderDanhSach();
  }

  function setStatus(msg, color) {
    const st = document.getElementById('gt-status-text'), dot = document.getElementById('gt-dot');
    if (st) st.textContent = msg;
    if (dot && color) dot.style.background = color;
  }

  function updateStepStatus(step, status) {
    const el = document.getElementById('gt-status-step' + step);
    if (el) el.textContent = status;
  }

  function resetSteps() {
    for (let i = 1; i <= 5; i++) { const el = document.getElementById('gt-status-step' + i); if (el) el.textContent = '⏳'; }
  }

  async function pollInbox() {
    try {
      const rawMessages = await checkMailTmInbox();
      const messages = rawMessages.map(normalizeInboxMsg);
      const codeSection = document.getElementById('gt-code-section');
      const resultsDiv = document.getElementById('gt-gmail-results');

      if (!messages.length) {
        const waited = codeRequestedAt > 0 ? ` (đã đợi ${Math.floor((Date.now() - codeRequestedAt) / 1000)}s)` : '';
        setStatus(`📭 Hộp thư trống${waited}`, '#6b7280');
        if (codeSection) codeSection.style.display = 'none';
        if (resultsDiv) resultsDiv.innerHTML = `<div class="gt-msg-info">Chưa có email nào.</div>`;
        return;
      }

      const newMsgs = messages.filter(m => !(codeRequestedAt > 0 && m.timestamp > 0 && m.timestamp < codeRequestedAt));

      if (newMsgs.length === 0) {
        const waited = codeRequestedAt > 0 ? ` (đã đợi ${Math.floor((Date.now() - codeRequestedAt) / 1000)}s)` : '';
        setStatus(`📬 ${messages.length} thư (tất cả cũ)${waited}`, '#6b7280');
        if (codeSection) codeSection.style.display = 'none';
        if (resultsDiv) resultsDiv.innerHTML = `<div class="gt-msg-info">Có ${messages.length} thư nhưng tất cả đều cũ.</div>`;
        return;
      }

      const garenaMsgs = newMsgs.filter(isGarenaEmail);

      if (garenaMsgs.length === 0) {
        setStatus(`📬 ${newMsgs.length} thư mới – không phải từ Garena`, '#f59e0b');
        if (codeSection) codeSection.style.display = 'none';
        if (resultsDiv) {
          resultsDiv.innerHTML = newMsgs.slice(-5).reverse().map(m =>
            `<div class="gt-msg-item gt-msg-other">
              <span class="gt-msg-from-small">📨 ${escHtml(m.from)}</span>
              <span class="gt-msg-subject-small">📌 ${escHtml(m.subject || '(không tiêu đề)')}</span>
            </div>`).join('');
        }
        return;
      }

      const latest = garenaMsgs[garenaMsgs.length - 1];
      const rawFull = await readMailTmMessage(latest.id);
      if (!rawFull) return;
      const fullMsg = normalizeFullMsg(rawFull);

      setStatus(`✅ Thư từ Garena: "${fullMsg.subject}"`, '#22c55e');
      updateStepStatus(3, '✅ Nhận được');

      allExtractedCodes = findBestCodes(fullMsg);
      const bodyPreview = stripHtml(fullMsg.htmlBody || fullMsg.textBody || '').trim().slice(0, 600);

      if (resultsDiv) {
        let html = `<div class="gt-msg-item gt-msg-garena">
          <div class="gt-msg-from">📨 ${escHtml(fullMsg.from)}</div>
          <div class="gt-msg-subject">📌 ${escHtml(fullMsg.subject)}</div>`;
        if (bodyPreview) html += `<div class="gt-msg-body">${escHtml(bodyPreview)}</div>`;

        if (allExtractedCodes.length > 0) {
          html += `<div class="gt-codes-label">🔢 Tìm thấy ${allExtractedCodes.length} mã tiềm năng:</div><div class="gt-codes-list">`;
          allExtractedCodes.forEach((item, i) => {
            const isBest = i === 0;
            html += `<div class="gt-code-candidate ${isBest ? 'gt-code-best' : ''}" data-code="${item.code}">
              <span class="gt-code-num">${item.code}</span>
              <span class="gt-code-score">${item.score}đ</span>
              <span class="gt-code-ctx">${escHtml(item.ctx.slice(0, 70))}</span>
              <button class="gt-btn-tiny gt-use-code" data-code="${item.code}">${isBest ? '★ Dùng' : 'Dùng'}</button>
            </div>`;
          });
          html += `</div>`;
          selectCode(allExtractedCodes[0].code);
        } else {
          html += `<div class="gt-warning">⚠ Email từ Garena nhưng không tìm thấy mã 8 chữ số!</div>`;
        }

        html += `</div>`;
        resultsDiv.innerHTML = html;

        resultsDiv.querySelectorAll('.gt-use-code').forEach(btn => {
          btn.addEventListener('click', () => selectCode(btn.dataset.code));
        });
      }
    } catch (e) {
      log('pollInbox error:', e);
      setStatus(`❌ Lỗi: ${e.message}`, '#ef4444');
    }
  }

  function selectCode(code) {
    currentCode = code;
    const el = document.getElementById('gt-code');
    if (el) el.textContent = code;
    const codeSection = document.getElementById('gt-code-section');
    if (codeSection) codeSection.style.display = 'block';
    document.querySelectorAll('.gt-code-candidate').forEach(c => c.classList.remove('gt-code-selected'));
    document.querySelectorAll(`.gt-code-candidate[data-code="${code}"]`).forEach(c => c.classList.add('gt-code-selected'));
    autoFillCode(code);
    saveSessionState();
    setStatus(`✅ Đã điền mã: ${code}`, '#22c55e');
    updateStepStatus(4, '✅ Đã điền');
    showToast(`✓ Đã điền mã: ${code}`);

    setTimeout(() => {
      clickConfirmCodeButton();
      updateStepStatus(4, '✅ Xác nhận');
    }, 600);

    if (autoMode && !isRegistering) {
      if (codeRequestedAt === 0) codeRequestedAt = Date.now() - 1000;
      isRegistering = true;
      setStatus(`✅ Mã ${code}! Đang xác nhận → đăng ký tự động...`, '#22c55e');

      const tryConfirm = (n) => {
        clickConfirmCodeButton();
        if (n > 0) setTimeout(() => tryConfirm(n - 1), 600);
      };
      tryConfirm(2);

      const tryRegister = (attempt, maxAttempts) => {
        if (attempt > maxAttempts) {
          setStatus(`⚠ Có mã nhưng không nhấn được Đăng Ký — nhấn tay nút 📝`, '#f59e0b');
          isRegistering = false;
          return;
        }
        setTimeout(() => {
          clickConfirmCodeButton();
          setTimeout(() => {
            const clicked = clickRegisterButton();
            if (clicked) {
              registrationCount++;
              saveAccount(currentUsername, currentPassword);
              chrome.storage.local.remove(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode', 'mtEmail', 'mtPassword', 'mtToken']);
              
              // CHECK IP ROTATION
              if (registrationCount % IP_ROTATION_INTERVAL === 0) {
                setStatus(`✅ [#${registrationCount}] Đủ 7 acc - PHẢI ĐỔI IP!`, '#ef4444');
                updateStepStatus(5, '✅');
                showToast(`✓ Đã tạo ${registrationCount} acc - ĐỔI IP NGAY!`);
                isRegistering = false;
                ipRotationNeeded = true;
                showIPRotationWarning();
              } else {
                setStatus(`✅ [#${registrationCount}/${IP_ROTATION_INTERVAL}] Tiếp tục...`, '#22c55e');
                updateStepStatus(5, '✅ Xong');
                showToast(`✓ [#${registrationCount}] Xong - tiếp tục`);
                isRegistering = false;
                setTimeout(() => window.location.reload(), 2000);
              }
            } else {
              tryRegister(attempt + 1, maxAttempts);
            }
          }, 500);
        }, attempt === 0 ? 1500 : 1200);
      };
      tryRegister(0, 5);
    }
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    setTimeout(pollInbox, 2000);
    pollTimer = setInterval(pollInbox, 8000);
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  async function initOverlay() {
    if (document.getElementById('garena-tools-overlay')) return;

    if (detectSuccessPage()) {
      const localStored = await new Promise(r => chrome.storage.local.get(['sessionUsername', 'sessionPassword'], r));
      if (localStored.sessionUsername && localStored.sessionPassword) {
        const syncStored = await syncGet(['savedAccounts']);
        if (syncStored.savedAccounts) savedAccounts = syncStored.savedAccounts;
        saveAccount(localStored.sessionUsername, localStored.sessionPassword);
        await new Promise(r => setTimeout(r, 600));
        chrome.storage.local.remove(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode', 'mtEmail', 'mtPassword', 'mtToken']);
        log(`✅ [#${registrationCount}] Trang thành công – tải lại`);
      }
      setTimeout(() => window.location.reload(), 1500);
      return;
    }

    setTimeout(() => { if (detectGarenaBlock()) showBlockWarning(); }, 3000);

    overlayEl = document.createElement('div');
    overlayEl.id = 'garena-tools-overlay';
    overlayEl.innerHTML = `
      <div id="gt-header">
        <span id="gt-title">PHUC là bố của Garena</span>
        <div id="gt-tabs">
          <button class="gt-tab active" data-tab="tao-acc">Tạo ACC</button>
          <button class="gt-tab" data-tab="template">Mẫu</button>
          <button class="gt-tab" data-tab="email">Email</button>
          <button class="gt-tab" data-tab="danh-sach">DS</button>
        </div>
        <button id="gt-minimize">−</button>
      </div>
      <div id="gt-body">

        <div id="gt-tab-tao-acc" class="gt-tab-content active">
          <div class="gt-section-title">TẠO TÀI KHOẢN </div>
          <div class="gt-auto-stat">
            <span id="gt-reg-count">Đã tạo: <strong>0</strong>/7</span>
          </div>
          <div class="gt-field-row">
            <span class="gt-field-label">TÊN ĐN</span>
            <span class="gt-field-value" id="gt-username">---</span>
            <button class="gt-copy-btn" data-target="gt-username">Chép</button>
          </div>
          <div class="gt-field-row">
            <span class="gt-field-label">MẬT KHẨU</span>
            <span class="gt-field-value" id="gt-password">---</span>
            <button class="gt-copy-btn" data-target="gt-password">Chép</button>
          </div>
          <div class="gt-field-row">
            <span class="gt-field-label">EMAIL (tạm)</span>
            <span class="gt-field-value" id="gt-email-display">Đang tạo...</span>
            <button class="gt-copy-btn" id="gt-copy-email-btn">Chép</button>
          </div>
          <div class="gt-flow">
            <div class="gt-flow-step"><span class="gt-step-num">1</span><span class="gt-step-label">Điền form</span><span class="gt-step-status" id="gt-status-step1">⏳</span></div>
            <div class="gt-flow-step"><span class="gt-step-num">2</span><span class="gt-step-label">Gửi mã</span><span class="gt-step-status" id="gt-status-step2">⏳</span></div>
            <div class="gt-flow-step"><span class="gt-step-num">3</span><span class="gt-step-label">Đợi email</span><span class="gt-step-status" id="gt-status-step3">⏳</span></div>
            <div class="gt-flow-step"><span class="gt-step-num">4</span><span class="gt-step-label">Lấy mã</span><span class="gt-step-status" id="gt-status-step4">⏳</span></div>
            <div class="gt-flow-step"><span class="gt-step-num">5</span><span class="gt-step-label">Đăng ký</span><span class="gt-step-status" id="gt-status-step5">⏳</span></div>
          </div>
          <div class="gt-auto-row">
            <input type="checkbox" id="gt-auto-toggle">
            <label for="gt-auto-toggle"><strong>Tự động / Tắt</strong></label>
          </div>
          <div class="gt-btn-row">
            <button id="gt-generate" class="gt-btn gt-btn-primary">🔄 Tạo mới</button>
            <button id="gt-send-code" class="gt-btn gt-btn-warning">📨 Gửi mã</button>
            <button id="gt-save" class="gt-btn gt-btn-success">💾 Lưu</button>
          </div>
          <div id="gt-code-section" style="display:none; margin-top:10px;">
            <div class="gt-section-title">MÃ GARENA</div>
            <div class="gt-field-row gt-code-row">
              <span class="gt-field-label">MÃ</span>
              <span class="gt-field-value" id="gt-code">---</span>
              <button class="gt-copy-btn" data-target="gt-code">Chép</button>
            </div>
            <div class="gt-manual-row">
              <input type="text" id="gt-manual-code" placeholder="Nhập mã thủ công...">
              <button id="gt-apply-manual-code" class="gt-btn gt-btn-accent">OK</button>
            </div>
            <div class="gt-confirm-reg-row">
              <button id="gt-confirm-btn" class="gt-btn gt-btn-accent" style="flex:1;">✅ Xác Nhận</button>
              <button id="gt-submit-reg" class="gt-btn gt-btn-success" style="flex:1;">📝 Đăng Ký</button>
            </div>
          </div>
        </div>

        <div id="gt-tab-template" class="gt-tab-content">
          <div class="gt-section-title">TÊN MẪU</div>
          <div class="gt-template-row">
            <input type="text" id="gt-name-template" placeholder="Nhập tên mẫu (vd: phucmax)">
            <span class="gt-counter-label">Số TT: <strong id="gt-counter-display">1</strong></span>
          </div>
          <div class="gt-template-actions">
            <button id="gt-save-template" class="gt-btn gt-btn-primary">💾 Lưu</button>
            <button id="gt-reset-counter" class="gt-btn gt-btn-warning">🔄 Reset</button>
          </div>
          <div class="gt-template-preview" id="gt-template-preview">Xem trước: ---</div>

          <div class="gt-section-title" style="margin-top:14px;">MẬT KHẨU MẪU</div>
          <div class="gt-pwd-template-row">
            <input type="text" id="gt-pwd-template" placeholder="Mẫu MK (mặc định @Phucmax)">
          </div>
          <div class="gt-template-actions">
            <button id="gt-save-pwd-template" class="gt-btn gt-btn-primary">💾 Lưu</button>
            <button id="gt-reset-pwd-template" class="gt-btn gt-btn-warning">↩ Reset</button>
          </div>
          <div class="gt-template-preview" id="gt-pwd-preview">Xem trước: ---</div>
        </div>

        <div id="gt-tab-email" class="gt-tab-content">
          <div class="gt-section-title">EMAIL TẠM THỜI (mail.tm)</div>
          <div class="gt-email-row"><span id="gt-email-display2">Đang tạo...</span></div>
          <div class="gt-email-actions">
            <button id="gt-refresh-email" class="gt-btn gt-btn-small">🔄 Email mới</button>
            <button id="gt-copy-email2" class="gt-btn gt-btn-small">📋 Chép</button>
            <button id="gt-check-now" class="gt-btn gt-btn-small">📬 Check</button>
          </div>
          <div class="gt-gmail-status">
            <span class="gt-dot" id="gt-dot"></span>
            <span id="gt-status-text">Đang tạo email...</span>
          </div>
          <div id="gt-gmail-results" class="gt-gmail-results"></div>
        </div>

        <div id="gt-tab-danh-sach" class="gt-tab-content">
          <div class="gt-ds-actions">
            <button id="gt-export-txt" class="gt-btn gt-btn-success">📥 Tải TXT</button>
            <button id="gt-clear-all" class="gt-btn gt-btn-danger">❌ Xóa hết</button>
          </div>
          <div id="gt-account-list"></div>
        </div>

      </div>
    `;

    document.body.appendChild(overlayEl);

    let isDragging = false, dragOffX = 0, dragOffY = 0;
    const header = overlayEl.querySelector('#gt-header');
    header.addEventListener('mousedown', e => {
      isDragging = true;
      dragOffX = e.clientX - overlayEl.getBoundingClientRect().left;
      dragOffY = e.clientY - overlayEl.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      overlayEl.style.right = 'auto';
      overlayEl.style.left = (e.clientX - dragOffX) + 'px';
      overlayEl.style.top = (e.clientY - dragOffY) + 'px';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    overlayEl.querySelectorAll('.gt-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        overlayEl.querySelectorAll('.gt-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        overlayEl.querySelectorAll('.gt-tab-content').forEach(c => c.classList.remove('active'));
        const target = document.getElementById('gt-tab-' + tab.dataset.tab);
        if (target) target.classList.add('active');
      });
    });

    document.getElementById('gt-auto-toggle').addEventListener('change', function () {
      autoMode = this.checked; syncSet({ autoMode });
      showToast(autoMode ? '✓ Tự động: BẬT' : 'Tự động: TẮT');
    });

    document.getElementById('gt-generate').addEventListener('click', generateNewAccount);

    document.getElementById('gt-save').addEventListener('click', () => {
      if (currentUsername && currentPassword) {
        saveAccount(currentUsername, currentPassword);
        chrome.storage.local.remove(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode', 'mtEmail', 'mtPassword', 'mtToken']);
        showToast('✓ Đã lưu');
      }
    });

    document.getElementById('gt-send-code').addEventListener('click', () => {
      setStatus('📨 Đang bấm nút gửi mã...', '#f59e0b');
      const tryManual = (attempt, delays) => {
        if (attempt >= delays.length) {
          setStatus('❌ Không tìm thấy nút!', '#ef4444');
          showToast('❌ Không tìm thấy'); return;
        }
        setTimeout(() => {
          if (clickSendCodeButton()) {
            codeRequestedAt = Date.now(); saveSessionState();
            setStatus('📨 Đã gửi!', '#f59e0b');
            updateStepStatus(2, '✅'); updateStepStatus(3, '⏳');
            showToast('Đã gửi');
          } else { tryManual(attempt + 1, delays); }
        }, delays[attempt]);
      };
      if (!clickSendCodeButton()) {
        tryManual(0, [1000, 2500, 4000]);
      } else {
        codeRequestedAt = Date.now(); saveSessionState();
        setStatus('📨 Đã gửi!', '#f59e0b');
        updateStepStatus(2, '✅'); updateStepStatus(3, '⏳');
        showToast('Đã gửi');
      }
    });

    document.getElementById('gt-confirm-btn').addEventListener('click', () => {
      const confirmed = clickConfirmCodeButton();
      showToast(confirmed ? '✓ Xác nhận' : '❌ Không tìm');
      if (confirmed) updateStepStatus(4, '✅');
    });

    document.getElementById('gt-submit-reg').addEventListener('click', () => {
      clickConfirmCodeButton();
      setTimeout(() => {
        const ok = clickRegisterButton();
        if (ok) {
          updateStepStatus(5, '✅');
          registrationCount++;
          saveAccount(currentUsername, currentPassword);
          chrome.storage.local.remove(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode', 'mtEmail', 'mtPassword', 'mtToken']);
          
          if (registrationCount % IP_ROTATION_INTERVAL === 0) {
            setStatus(`✅ ĐỦ 7 ACC - ĐỔI IP!`, '#ef4444');
            showToast(`✓ [#${registrationCount}] ĐỔI IP NGAY!`);
            ipRotationNeeded = true;
            showIPRotationWarning();
          } else {
            setTimeout(() => window.location.reload(), 2000);
          }
        }
      }, 800);
    });

    document.getElementById('gt-apply-manual-code').addEventListener('click', () => {
      const input = document.getElementById('gt-manual-code'), code = input.value.trim();
      if (code.length >= 4) { selectCode(code); input.value = ''; } else showToast('Tối thiểu 4 ký tự');
    });
    document.getElementById('gt-manual-code').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('gt-apply-manual-code').click();
    });

    overlayEl.querySelectorAll('.gt-copy-btn[data-target]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const el = document.getElementById(btn.dataset.target);
        if (el && el.textContent && el.textContent !== '---') {
          await copyToClipboard(el.textContent);
          const orig = btn.textContent; btn.textContent = '✓';
          setTimeout(() => (btn.textContent = orig), 1200);
        }
      });
    });

    document.getElementById('gt-copy-email-btn').addEventListener('click', async () => {
      if (tempEmail) { await copyToClipboard(tempEmail); showToast('Chép'); }
    });
    document.getElementById('gt-copy-email2').addEventListener('click', async () => {
      if (tempEmail) { await copyToClipboard(tempEmail); showToast('Chép'); }
    });

    document.getElementById('gt-refresh-email').addEventListener('click', async () => {
      try {
        stopPolling(); codeRequestedAt = 0; currentCode = ''; allExtractedCodes = [];
        chrome.storage.local.remove(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode']);
        const result = await refreshMailTmAccount();
        document.getElementById('gt-email-display').textContent = result.email;
        document.getElementById('gt-email-display2').textContent = result.email;
        document.getElementById('gt-gmail-results').innerHTML = '';
        document.getElementById('gt-code-section').style.display = 'none';
        showToast('Email mới');
        startPolling();
      } catch (e) { 
        showToast('❌ Tải lại');
        setTimeout(() => window.location.reload(), 3000);
      }
    });

    document.getElementById('gt-check-now').addEventListener('click', () => { pollInbox(); showToast('Check...'); });

    document.getElementById('gt-export-txt').addEventListener('click', exportTxt);
    document.getElementById('gt-clear-all').addEventListener('click', () => {
      if (confirm('Xóa tất cả?')) {
        savedAccounts = [];
        syncSet({ savedAccounts });
        renderDanhSach();
        showToast('Xóa xong');
      }
    });
    document.getElementById('gt-minimize').addEventListener('click', () => {
      overlayEl.classList.toggle('minimized');
      document.getElementById('gt-minimize').textContent = overlayEl.classList.contains('minimized') ? '+' : '−';
    });

    document.getElementById('gt-save-template').addEventListener('click', () => {
      const val = document.getElementById('gt-name-template').value.trim();
      nameTemplate = val;
      syncSet({ nameTemplate, nameCounter });
      updateTemplatePreview();
      showToast(val ? `✓ Tên: "${val}"` : '✓ Ngẫu nhiên');
    });

    document.getElementById('gt-reset-counter').addEventListener('click', () => {
      nameCounter = 1;
      syncSet({ nameCounter });
      document.getElementById('gt-counter-display').textContent = '1';
      updateTemplatePreview();
      showToast('✓ Reset');
    });

    document.getElementById('gt-save-pwd-template').addEventListener('click', () => {
      const val = document.getElementById('gt-pwd-template').value.trim();
      if (val) {
        pwdTemplate = val;
        syncSet({ pwdTemplate });
        updatePwdPreview();
        showToast(`✓ MK: "${val}"`);
      } else showToast('Nhập');
    });

    document.getElementById('gt-reset-pwd-template').addEventListener('click', () => {
      pwdTemplate = '@Phucmax';
      document.getElementById('gt-pwd-template').value = '@Phucmax';
      syncSet({ pwdTemplate });
      updatePwdPreview();
      showToast('✓ Reset');
    });

    document.getElementById('gt-name-template').addEventListener('input', updateTemplatePreview);
    document.getElementById('gt-pwd-template').addEventListener('input', updatePwdPreview);

    const stored = await syncGet(['savedAccounts', 'autoMode', 'nameTemplate', 'nameCounter', 'pwdTemplate']);
    const localStored = await new Promise(r => chrome.storage.local.get(['sessionUsername', 'sessionPassword', 'sessionCodeRequestedAt', 'sessionCode'], r));

    if (stored.savedAccounts) savedAccounts = stored.savedAccounts;
    if (stored.autoMode === undefined) {
      autoMode = true;
      document.getElementById('gt-auto-toggle').checked = true;
      syncSet({ autoMode: true });
    } else if (stored.autoMode) {
      autoMode = true;
      document.getElementById('gt-auto-toggle').checked = true;
    }
    if (stored.nameTemplate !== undefined) {
      nameTemplate = stored.nameTemplate;
      document.getElementById('gt-name-template').value = nameTemplate;
    }
    if (stored.nameCounter !== undefined) {
      nameCounter = stored.nameCounter;
      document.getElementById('gt-counter-display').textContent = nameCounter;
    }
    if (stored.pwdTemplate !== undefined) {
      pwdTemplate = stored.pwdTemplate;
      document.getElementById('gt-pwd-template').value = pwdTemplate;
    }

    updateTemplatePreview();
    updatePwdPreview();
    renderDanhSach();

    try {
      const result = await createMailTmAccount();
      document.getElementById('gt-email-display').textContent = result.email;
      document.getElementById('gt-email-display2').textContent = result.email;
      setStatus('✅ Email ready', '#6b7280');

      if (localStored.sessionUsername && localStored.sessionPassword) {
        currentUsername = localStored.sessionUsername;
        currentPassword = localStored.sessionPassword;
        codeRequestedAt = localStored.sessionCodeRequestedAt || 0;
        currentCode = localStored.sessionCode || '';

        document.getElementById('gt-username').textContent = currentUsername;
        document.getElementById('gt-password').textContent = currentPassword;

        if (currentCode) {
          document.getElementById('gt-code').textContent = currentCode;
          document.getElementById('gt-code-section').style.display = 'block';
          updateStepStatus(4, '✅');
        }

        autoFillGarenaForm();
        updateStepStatus(1, '✅');
        showToast('🔄 Khôi phục');

        if (codeRequestedAt > 0) {
          updateStepStatus(2, '✅'); updateStepStatus(3, '⏳');
          setStatus('🔄 Đợi email...', '#f59e0b');
        } else if (autoMode) {
          setTimeout(() => {
            if (clickSendCodeButton()) {
              codeRequestedAt = Date.now(); saveSessionState();
              setStatus('📨 Đã gửi!', '#f59e0b');
              updateStepStatus(2, '✅'); updateStepStatus(3, '⏳');
            }
          }, 1500);
        }
        startPolling();
      } else {
        generateNewAccount();
        startPolling();
      }
    } catch (e) {
      document.getElementById('gt-email-display').textContent = 'Lỗi: ' + e.message;
      setStatus('❌ ' + e.message, '#ef4444');
      showToast('❌ Tải lại');
      setTimeout(() => window.location.reload(), 5000);
    }
  }

  function updateTemplatePreview() {
    const inp = document.getElementById('gt-name-template');
    const preview = document.getElementById('gt-template-preview');
    const val = (inp && inp.value.trim()) || nameTemplate;
    if (preview) {
      if (val) {
        preview.textContent = `Xem trước: ${val}${nameCounter}, ${val}${nameCounter + 1}, ${val}${nameCounter + 2}...`;
        preview.style.color = '#4ade80';
      } else {
        preview.textContent = 'Xem trước: ngẫu nhiên';
        preview.style.color = '#94a3b8';
      }
    }
  }

  function updatePwdPreview() {
    const inp = document.getElementById('gt-pwd-template');
    const preview = document.getElementById('gt-pwd-preview');
    const val = (inp && inp.value.trim()) || pwdTemplate;
    if (preview) {
      preview.textContent = `Xem trước: ${val}Ab3x`;
      preview.style.color = '#4ade80';
    }
  }

  function generateNewAccount() {
    if (ipRotationNeeded) {
      showIPRotationWarning();
      return;
    }

    currentUsername = generateUsername();
    currentPassword = generateStrongPassword();
    currentCode = ''; allExtractedCodes = []; codeRequestedAt = 0;
    resetSteps(); saveSessionState();

    document.getElementById('gt-username').textContent = currentUsername;
    document.getElementById('gt-password').textContent = currentPassword;
    if (tempEmail) {
      document.getElementById('gt-email-display').textContent = tempEmail;
      document.getElementById('gt-email-display2').textContent = tempEmail;
    }
    document.getElementById('gt-code-section').style.display = 'none';
    document.getElementById('gt-gmail-results').innerHTML = '';

    autoFillGarenaForm();
    updateStepStatus(1, '✅');
    setStatus('✅ Form filled', '#6b7280');
    const remaining = IP_ROTATION_INTERVAL - (registrationCount % IP_ROTATION_INTERVAL);
    document.getElementById('gt-reg-count').innerHTML = `Đã tạo: <strong>${registrationCount % IP_ROTATION_INTERVAL}/${IP_ROTATION_INTERVAL}</strong>`;
    showToast(`Tạo: ${currentUsername} (${remaining} lần nữa đổi IP)`);

    if (autoMode) {
      updateStepStatus(2, '⏳');
      setStatus('⏳ Chờ nút gửi mã...', '#f59e0b');
      setTimeout(() => waitAndClickSendCode(12000), 1200);
    }
  }

  function _afterSendCodeClicked() {
    codeRequestedAt = Date.now(); saveSessionState();
    setStatus('📨 Đã gửi! Đợi email...', '#f59e0b');
    updateStepStatus(2, '✅'); updateStepStatus(3, '⏳');
    showToast('📨 Sent');
  }

  function renderDanhSach() {
    const list = document.getElementById('gt-account-list');
    if (!list) return;
    if (savedAccounts.length === 0) { list.innerHTML = '<div class="gt-empty">Trống</div>'; return; }
    list.innerHTML = '';
    savedAccounts.forEach((acc, i) => {
      const item = document.createElement('div');
      item.className = 'gt-account-item';
      item.innerHTML = `
        <div class="gt-account-info">
          <div class="gt-account-time">#${i + 1} · ${acc.timestamp}</div>
          <div class="gt-account-detail">${escHtml(acc.username)}|${escHtml(acc.password)}|${escHtml(acc.email)}</div>
        </div>
        <div class="gt-account-actions"><button class="gt-copy-btn gt-copy-account" data-idx="${i}">Copy</button></div>`;
      list.appendChild(item);
      item.querySelector('.gt-copy-account').addEventListener('click', async () => {
        await copyToClipboard(`${savedAccounts[i].username}|${savedAccounts[i].password}|${savedAccounts[i].email}`);
        showToast('Copied #' + (i + 1));
      });
    });
  }

  function exportTxt() {
    if (savedAccounts.length === 0) { showToast('Trống'); return; }
    let content = '=== GARENA ACCOUNTS - phucmaxreg v3.4 ===\n';
    content += 'Xuất: ' + new Date().toLocaleString('vi-VN') + '\n' + '='.repeat(45) + '\n\n';
    savedAccounts.forEach((acc) => {
      content += `${acc.username}|${acc.password}|${acc.email}\n`;
    });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'garena_' + Date.now() + '.txt'; a.click();
    URL.revokeObjectURL(url);
    showToast('Tải (' + savedAccounts.length + ')');
  }

  function showToast(msg) {
    let toast = document.getElementById('gt-toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'gt-toast'; document.body.appendChild(toast); }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOverlay);
  } else {
    initOverlay();
  }
})();