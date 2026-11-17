/* A³ FinCanvas — storage.js
 * Browser-only storage: local profiles, per-profile data, pre-restore backup, file downloads, demo data.
 *
 * IMPORTANT: this is a LOCAL PROFILE, not real authentication. Anyone with access to this browser
 * can read or change its storage. Before public launch use a real backend/auth provider
 * (e.g. Supabase, Firebase Auth) and enforce access rules on the server.
 *
 * ENCRYPTION (v3): for real (non-demo) accounts the saved data and the pre-restore backup are stored
 * as AES-256-GCM ciphertext. The key is derived from the account password with PBKDF2 using a SEPARATE
 * salt from the login hash, lives only in memory, and is dropped on lock/logout. The decrypted state is
 * held in memory so the rest of the app keeps its simple synchronous load()/save() API; writes are
 * encrypted and stored in order in the background. A forgotten password cannot be recovered.
 */
(function (root) {
  'use strict';
  var Calc = root.Calc;
  var K = { users: 'fincanvas.users.v2', session: 'fincanvas.session.v2', data: 'fincanvas.data.v2.', backup: 'fincanvas.prerestore.v2.', corrupt: 'fincanvas.corrupt.v2.' };
  var ITER = 150000;
  var mem = {}, memoryOnly = false;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { memoryOnly = true; return mem[k] == null ? null : mem[k]; } }
  function set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { memoryOnly = true; mem[k] = v; return false; } }
  function del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }
  function readJSON(k, fallback) { try { var v = get(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

  /* ---------- password hashing (salted PBKDF2) ---------- */
  function b64(buf) { var s = ''; new Uint8Array(buf).forEach(function (b) { s += String.fromCharCode(b); }); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  async function hashPw(pw, saltB64) {
    var enc = new TextEncoder();
    var key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITER, hash: 'SHA-256' }, key, 256);
    return b64(bits);
  }
  function cryptoOk() { return !!(root.crypto && root.crypto.subtle); }

  /* ---------- encryption vault ---------- */
  var vault = { id: null, key: null };      // key lives in memory only
  var cache = {}, bcache = {};              // decrypted state / backup per user id (while unlocked)
  var chain = Promise.resolve();            // serialises background writes so the newest save always wins
  var encoder = new TextEncoder(), decoder = new TextDecoder();
  function deriveKey(pw, saltB64) {
    return crypto.subtle.importKey('raw', encoder.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function aad(userId, kind) { return encoder.encode('fincanvas:v3:' + userId + ':' + kind); }
  async function encryptText(key, text, userId, kind) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(userId, kind) }, key, encoder.encode(text));
    return JSON.stringify({ v: 3, iv: b64(iv), ct: b64(ct) });
  }
  async function decryptEnvelope(key, env, userId, kind) {
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: aad(userId, kind) }, key, unb64(env.ct));
    return decoder.decode(pt);
  }
  function isEnvelope(o) { return !!(o && o.v === 3 && typeof o.iv === 'string' && typeof o.ct === 'string'); }
  function writeFailed() { try { root.dispatchEvent(new Event('fincanvas:savefail')); } catch (e) { /* ignore */ } }
  // Queue an encrypted write. The key is captured now so locking right after a save can't lose it.
  function queueEncrypted(storageKey, text, userId, kind) {
    var key = vault.key; if (!key) return;
    chain = chain.then(function () { return encryptText(key, text, userId, kind); })
      .then(function (env) { if (!set(storageKey, env)) writeFailed(); })
      .catch(writeFailed);
  }
  function queueDelete(storageKey) { chain = chain.then(function () { del(storageKey); }); }
  function unlocked(id) { return !!(vault.key && vault.id === id); }

  /* ---------- users ---------- */
  function users() { return readJSON(K.users, []); }
  function saveUsers(list) { return set(K.users, JSON.stringify(list)); }
  function publicUser(u) { return { id: u.id, name: u.name, email: u.email || '', mode: u.mode, demo: !!u.demo }; }
  function getUser(id) {
    if (id === 'demo') return { id: 'demo', name: 'Demo User', email: '', mode: 'student', demo: true };
    var u = users().filter(function (x) { return x.id === id; })[0];
    return u ? publicUser(u) : null;
  }
  function setMode(id, mode) {
    if (id === 'demo') return;
    var list = users(); list.forEach(function (u) { if (u.id === id) u.mode = mode; }); saveUsers(list);
  }

  async function register(f) {
    var errors = {};
    var name = String(f.name || '').trim(), email = String(f.email || '').trim().toLowerCase(), pw = String(f.password || '');
    if (name.length < 2) errors.name = 'Enter your name (at least 2 characters).';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Enter a valid email address.';
    if (pw.length < 8) errors.password = 'Use at least 8 characters.';
    else if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) errors.password = 'Include at least one letter and one number.';
    if (!errors.email && users().some(function (u) { return u.email === email; })) errors.email = 'An account with this email already exists in this browser.';
    if (Object.keys(errors).length) return { errors: errors };
    if (!cryptoOk()) return { errors: { password: 'Secure hashing is unavailable. Open the site over https.' } };
    var salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    var dsalt = b64(crypto.getRandomValues(new Uint8Array(16)));   // separate salt for the data-encryption key
    var u = { id: Calc.uid(), name: name, email: email, mode: f.mode === 'professional' ? 'professional' : 'student', salt: salt, dsalt: dsalt, hash: await hashPw(pw, salt) };
    var list = users(); list.push(u);
    if (!saveUsers(list)) return { errors: { email: 'Could not save — browser storage is blocked or full.' } };
    try { await openVault(u, pw); } catch (e) { return { errors: { password: 'Could not set up encryption on this device.' } }; }
    return { user: publicUser(u) };
  }

  var fails = { n: 0, until: 0 };
  async function login(emailIn, pw) {
    if (Date.now() < fails.until) return { errors: { password: 'Too many attempts. Wait ' + Math.ceil((fails.until - Date.now()) / 1000) + 's and try again.' } };
    var email = String(emailIn || '').trim().toLowerCase();
    if (!email) return { errors: { email: 'Enter your email.' } };
    if (!pw) return { errors: { password: 'Enter your password.' } };
    if (!cryptoOk()) return { errors: { password: 'Secure hashing is unavailable. Open the site over https.' } };
    var u = users().filter(function (x) { return x.email === email; })[0];
    var ok = false;
    if (u) ok = (await hashPw(pw, u.salt)) === u.hash;
    if (!ok) {
      fails.n++; if (fails.n >= 5) { fails.until = Date.now() + 30000; fails.n = 0; }
      return { errors: { password: 'Incorrect email or password.' } };
    }
    fails.n = 0;
    try { await openVault(u, pw); } catch (e) { return { errors: { password: 'Could not unlock your data on this device. Please try again.' } }; }
    return { user: publicUser(u) };
  }

  /* Derive the key, decrypt this user's data into memory, and migrate any older plaintext data. */
  async function openVault(u, pw) {
    var legacy = !u.dsalt;
    if (legacy) {
      u.dsalt = b64(crypto.getRandomValues(new Uint8Array(16)));
      var list = users(); list.forEach(function (x) { if (x.id === u.id) x.dsalt = u.dsalt; }); saveUsers(list);
    }
    vault = { id: u.id, key: await deriveKey(pw, u.dsalt) };
    var out = await readProtected(u.id, K.data + u.id, 'data');
    cache[u.id] = out.state || Calc.emptyState(); cache[u.id + ':corrupt'] = out.corrupt;
    var bk = await readProtected(u.id, K.backup + u.id, 'backup');
    bcache[u.id] = bk.state ? JSON.stringify(bk.state) : null;
  }
  // Reads one stored item (encrypted or legacy plaintext) -> { state, corrupt }. Plaintext is re-saved encrypted.
  async function readProtected(userId, storageKey, kind) {
    var raw = get(storageKey); if (!raw) return { state: null, corrupt: false };
    var obj; try { obj = JSON.parse(raw); } catch (e) { obj = null; }
    var plain = null, wasPlain = false;
    try {
      if (isEnvelope(obj)) plain = JSON.parse(await decryptEnvelope(vault.key, obj, userId, kind));
      else if (obj) { plain = obj; wasPlain = true; }
    } catch (e) { plain = null; }
    var res = plain ? Calc.validateBackup(plain) : { ok: false };
    if (res.ok) { if (wasPlain) queueEncrypted(storageKey, JSON.stringify(res.state), userId, kind); return { state: res.state, corrupt: false }; }
    set(K.corrupt + userId + (kind === 'backup' ? '.backup' : ''), raw);   // keep the unreadable copy instead of destroying it
    return { state: null, corrupt: kind === 'data' };
  }
  // Forget the key and decrypted data (logout / auto-lock). Queued writes already hold what they need.
  function lock() { vault = { id: null, key: null }; cache = {}; bcache = {}; }
  // Real accounts must enter their password once per visit (this also migrates older plaintext accounts).
  function needsUnlock(id) { return id !== 'demo' && !unlocked(id); }

  function setSession(id) { set(K.session, id); }
  function getSession() { return get(K.session); }
  function clearSession() { del(K.session); }

  /* ---------- data ---------- */
  function load(userId) {
    if (userId !== 'demo') {
      if (!unlocked(userId)) return { state: Calc.emptyState(), corrupt: false, locked: true };
      return { state: cache[userId] || Calc.emptyState(), corrupt: !!cache[userId + ':corrupt'] };
    }
    var raw = get(K.data + userId);
    if (!raw) return { state: Calc.emptyState(), corrupt: false };
    try {
      var res = Calc.validateBackup(JSON.parse(raw));
      if (res.ok) return { state: res.state, corrupt: false };
    } catch (e) { /* fall through */ }
    set(K.corrupt + userId, raw); // keep the unreadable copy instead of destroying it
    return { state: Calc.emptyState(), corrupt: true };
  }
  function save(userId, state) {
    if (userId === 'demo') return set(K.data + userId, JSON.stringify(state)) && !memoryOnly;
    if (!unlocked(userId)) return false;
    cache[userId] = state; cache[userId + ':corrupt'] = false;
    queueEncrypted(K.data + userId, JSON.stringify(state), userId, 'data');
    return !memoryOnly;
  }
  function saveBackup(userId, state) {
    var txt = JSON.stringify(state);
    if (userId === 'demo') return set(K.backup + userId, txt);
    if (!unlocked(userId)) return false;
    bcache[userId] = txt; queueEncrypted(K.backup + userId, txt, userId, 'backup'); return true;
  }
  function hasBackup(userId) {
    if (userId !== 'demo') return !!bcache[userId];
    return !!get(K.backup + userId);
  }
  function takeBackup(userId) {
    var src = userId === 'demo' ? readJSON(K.backup + userId, null) : (bcache[userId] ? JSON.parse(bcache[userId]) : null);
    var res = Calc.validateBackup(src);
    return res.ok ? res.state : null;
  }
  function clearBackup(userId) {
    if (userId !== 'demo') bcache[userId] = null;
    if (userId === 'demo') del(K.backup + userId); else queueDelete(K.backup + userId);
  }

  /* ---------- file downloads ---------- */
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime + ';charset=utf-8' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* ---------- demo ---------- */
  function seedDemo() {
    var st = Calc.emptyState(), today = new Date(), todayS = Calc.todayStr(today);
    st.openingBalance = 8000; st.allowance = 12000;
    st.budgets = { 'Food & Dining': 4500, 'Entertainment': 1500, 'Shopping': 2500, 'Transport': 1000 };
    var tpl = [
      [1, 'income', 'Monthly allowance', 12000, 'Allowance'], [3, 'expense', 'Hostel mess', 3500, 'Food & Dining'],
      [5, 'expense', 'Metro card recharge', 600, 'Transport'], [8, 'expense', 'Snacks & chai', 420, 'Food & Dining'],
      [11, 'expense', 'Textbooks', 1250, 'Education'], [14, 'expense', 'Movie night', 500, 'Entertainment'],
      [17, 'expense', 'Mobile recharge', 299, 'Bills & Utilities'], [20, 'expense', 'Groceries', 860, 'Groceries'],
      [22, 'expense', 'Streaming plan', 199, 'Subscriptions'], [24, 'income', 'Freelance gig', 3000, 'Freelance'],
      [26, 'expense', 'New headphones', 1799, 'Shopping']
    ];
    [2, 1, 0].forEach(function (back) {
      var d = new Date(today.getFullYear(), today.getMonth() - back, 1), mk = Calc.todayStr(d).slice(0, 7);
      tpl.forEach(function (r) {
        var date = mk + '-' + (r[0] < 10 ? '0' : '') + r[0];
        if (date <= todayS) st.transactions.push({ id: Calc.uid(), type: r[1], title: r[2], amount: r[3], date: date, category: r[4], note: '' });
      });
    });
    var g1 = Calc.uid(), g2 = Calc.uid();
    var d4 = new Date(today.getFullYear(), today.getMonth() + 4, 15);
    st.goals.push({ id: g1, name: 'New Laptop', target: 60000, date: '', created: todayS });
    st.goals.push({ id: g2, name: 'Goa Trip', target: 25000, date: Calc.todayStr(d4), created: todayS });
    var back2 = Calc.todayStr(new Date(today.getFullYear(), today.getMonth() - 2, 12));
    [[g1, 8000], [g1, 4000], [g2, 3000]].forEach(function (x) {
      st.transactions.push({ id: Calc.uid(), type: 'transfer', title: 'Added to goal', amount: x[1], date: back2, category: 'Savings', note: '', goalId: x[0] });
    });
    return st;
  }
  function startDemo() {
    var cur = load('demo');
    if (!get(K.data + 'demo') || !cur.state.transactions.length) save('demo', seedDemo());
    return getUser('demo');
  }
  function resetDemo() { save('demo', seedDemo()); }

  root.Store = {
    register: register, login: login, getUser: getUser, setMode: setMode,
    setSession: setSession, getSession: getSession, clearSession: clearSession, lock: lock, needsUnlock: needsUnlock,
    flush: function () { return chain; },
    load: load, save: save, saveBackup: saveBackup, hasBackup: hasBackup, takeBackup: takeBackup, clearBackup: clearBackup,
    download: download, startDemo: startDemo, resetDemo: resetDemo, isMemoryOnly: function () { return memoryOnly; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
