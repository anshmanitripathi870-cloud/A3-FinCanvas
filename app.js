/* A³ FinCanvas — app.js (interface and events). Money rules live in calculations.js. */
(function () {
  'use strict';
  var Calc = window.Calc, Store = window.Store;

  /* ---------- helpers ---------- */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  var inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(n) { n = Number(n) || 0; return Number.isInteger(n) ? inr0.format(n) : inr2.format(n); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function monthName(key) { var p = key.split('-').map(Number); return new Date(p[0], p[1] - 1, 1).toLocaleDateString('en-IN', { month: 'short' }); }

  var ICONS = { 'Food & Dining': '🍽️', 'Groceries': '🛒', 'Transport': '🚌', 'Rent & Housing': '🏠', 'Bills & Utilities': '💡', 'Shopping': '🛍️', 'Entertainment': '🎬', 'Health': '💊', 'Education': '📚', 'Travel': '✈️', 'Subscriptions': '🔁', 'Other': '📦', 'Salary': '💼', 'Allowance': '🎒', 'Freelance': '💻', 'Scholarship': '🎓', 'Gift': '🎁', 'Investment': '📈', 'Savings': '🐷' };
  var PALETTE = ['#4f46e5', '#0891b2', '#d97706', '#059669', '#db2777', '#7c3aed', '#2563eb', '#ea580c', '#0d9488', '#9333ea', '#65a30d', '#64748b'];
  var PERIODS = [['month', 'This month'], ['lastMonth', 'Last month'], ['last3', 'Last 3 months'], ['year', 'This year'], ['all', 'All time']];
  var NAV = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: '🏠' },
    { id: 'transactions', label: 'Transactions', short: 'Activity', icon: '🧾' },
    { id: 'budgets', label: 'Budgets', short: 'Budgets', icon: '🎯' },
    { id: 'goals', label: 'Savings goals', short: 'Goals', icon: '🐷' },
    { id: 'whatif', label: 'What-If', short: 'What-If', icon: '🔮' },
    { id: 'settings', label: 'Backup & settings', short: 'Settings', icon: '⚙️' }
  ];

  var S = { user: null, data: null, view: 'dashboard', period: 'month', filters: { q: '', type: 'all', cat: 'all' }, limit: 50, authMode: 'login', bannerHidden: false, charts: [] };

  function toast(msg, type) {
    var t = document.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg;
    $('#toast').appendChild(t); setTimeout(function () { t.remove(); }, type === 'error' ? 6000 : 3500);
  }
  function persist() { if (!Store.save(S.user.id, S.data)) toast('Could not save: browser storage is blocked or full. Export a backup now.', 'error'); }

  /* ---------- forms ---------- */
  function amountField(name, label, value, hint) {
    return '<div class="field"><label for="f_' + name + '">' + label + '</label><div class="prefix"><span>₹</span><input id="f_' + name + '" name="' + name + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(value) + '"></div>' +
      (hint ? '<p class="hint">' + hint + '</p>' : '') + '<p class="err" data-for="' + name + '" role="alert"></p></div>';
  }
  function textField(name, label, value, extra) {
    extra = extra || {};
    return '<div class="field"><label for="f_' + name + '">' + label + '</label><input id="f_' + name + '" name="' + name + '" type="' + (extra.type || 'text') + '" value="' + esc(value) + '" autocomplete="off" ' + (extra.attrs || '') + '>' +
      (extra.hint ? '<p class="hint">' + extra.hint + '</p>' : '') + '<p class="err" data-for="' + name + '" role="alert"></p></div>';
  }
  function catOptions(type, selected) {
    var list = type === 'income' ? Calc.INCOME_CATEGORIES : Calc.EXPENSE_CATEGORIES;
    return '<option value="">Select a category…</option>' + list.map(function (c) { return '<option' + (c === selected ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
  }
  function setErrors(form, errs) {
    $$('.err', form).forEach(function (p) { p.textContent = ''; });
    $$('[aria-invalid]', form).forEach(function (i) { i.removeAttribute('aria-invalid'); });
    var first = null;
    Object.keys(errs || {}).forEach(function (k) {
      var p = form.querySelector('.err[data-for="' + k + '"]'); if (p) p.textContent = errs[k];
      var inp = form.querySelector('[name="' + k + '"]'); if (inp) { inp.setAttribute('aria-invalid', 'true'); if (!first) first = inp; }
    });
    if (first && first.focus) first.focus();
  }
  function openForm(title, body, submitLabel, handler, opts) {
    opts = opts || {};
    var m = $('#modal');
    m.innerHTML = '<form novalidate><div class="modal-head"><h2>' + esc(title) + '</h2><button type="button" class="icon-btn tiny" data-close aria-label="Close">✕</button></div><div class="modal-body">' + body + '</div><div class="modal-foot"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn ' + (opts.danger ? 'danger' : 'primary') + '">' + esc(submitLabel) + '</button></div></form>';
    var form = $('form', m);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var vals = {}; new FormData(form).forEach(function (v, k) { vals[k] = typeof v === 'string' ? v : ''; });
      var res = handler(vals, form);
      if (res && res.errors) { setErrors(form, res.errors); return; }
      m.close();
    });
    if (opts.onReady) opts.onReady(form);
    m.showModal();
    var f = form.querySelector('input:not([type=radio]):not([type=hidden]),select'); if (f && !opts.noFocus) f.focus();
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      var d = $('#confirm'), done = false;
      d.innerHTML = '<div class="confirm-box"><h2>' + esc(title) + '</h2><p class="muted">' + esc(text) + '</p><div class="btn-row"><button class="btn ghost" data-no>Cancel</button><button class="btn ' + (danger ? 'danger' : 'primary') + '" data-ok>' + esc(okLabel || 'Yes, continue') + '</button></div></div>';
      function fin(v) { if (done) return; done = true; if (d.open) d.close(); resolve(v); }
      $('[data-ok]', d).onclick = function () { fin(true); };
      $('[data-no]', d).onclick = function () { fin(false); };
      d.addEventListener('close', function h() { d.removeEventListener('close', h); fin(false); });
      d.showModal();
      $('[data-no]', d).focus();
    });
  }

  /* ---------- derived ---------- */
  function goalById(id) { return S.data.goals.filter(function (g) { return g.id === id; })[0]; }
  function sorted(txns) {
    return txns.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) { return a.t.date < b.t.date ? 1 : a.t.date > b.t.date ? -1 : b.i - a.i; }).map(function (x) { return x.t; });
  }
  function txnRow(t, withActions) {
    var cls = t.type === 'income' ? 'pos' : t.type === 'expense' ? 'neg-t' : 'info-t', amt, sub, title = t.title, ico = ICONS[t.category] || '📦';
    if (t.type === 'income') amt = '+' + money(t.amount);
    else if (t.type === 'expense') amt = '−' + money(t.amount);
    else { var g = goalById(t.goalId); amt = (t.amount > 0 ? '→ ' : '← ') + money(Math.abs(t.amount)); sub = 'Goal: ' + (g ? g.name : 'removed goal'); }
    sub = (sub || t.category) + ' · ' + fmtDate(t.date) + (t.note ? ' · ' + t.note : '');
    var acts = '';
    if (withActions && t.type !== 'transfer') acts = '<div class="acts"><button class="icon-btn tiny" data-action="edit-txn" data-id="' + esc(t.id) + '" aria-label="Edit ' + esc(t.title) + '">✎</button><button class="icon-btn tiny" data-action="del-txn" data-id="' + esc(t.id) + '" aria-label="Delete ' + esc(t.title) + '">🗑</button></div>';
    else if (withActions) acts = '<div class="acts"><span class="badge">goal</span></div>';
    return '<div class="row"><div class="ico" aria-hidden="true">' + ico + '</div><div><div class="ttl">' + esc(title) + '</div><div class="sub">' + esc(sub) + '</div></div><div class="amt ' + cls + '">' + esc(amt) + '</div>' + acts + '</div>';
  }
  function empty(icon, title, text, btn) {
    return '<div class="empty"><div class="big" aria-hidden="true">' + icon + '</div><strong>' + esc(title) + '</strong><p>' + esc(text) + '</p>' + (btn || '') + '</div>';
  }
  function destroyCharts() { S.charts.forEach(function (c) { try { c.destroy(); } catch (e) { /* ignore */ } }); S.charts = []; }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* ================= VIEWS ================= */
  var VIEWS = {};

  VIEWS.dashboard = function () {
    var d = S.data, today = Calc.todayStr(), range = Calc.periodRange(S.period, today), mk = today.slice(0, 7);
    var inc = Calc.sumType(d.transactions, 'income', range), exp = Calc.sumType(d.transactions, 'expense', range);
    var net = Calc.round2(inc - exp), bal = Calc.balance(d), alloc = Calc.allocated(d), av = Calc.available(d), rate = Calc.savingsRate(inc, exp);
    var label = PERIODS.filter(function (p) { return p[0] === S.period; })[0][1].toLowerCase();
    var cats = Calc.categoryTotals(d.transactions, range, 'expense');
    var html = '<div class="stack">';
    if (!S.bannerHidden) html += '<div class="banner" role="note"><span aria-hidden="true">🧪</span><p><b>Prototype.</b> Your data stays in this browser only' + (S.user.demo ? '.' : ' and is encrypted with your password.') + ' Never enter card numbers, PINs or OTPs.</p><button class="icon-btn tiny" data-action="hide-banner" aria-label="Dismiss notice">✕</button></div>';
    html += '<section class="card eq" aria-label="Your money right now">' +
      '<div class="eq-item"><span class="lbl">Current balance</span><strong class="num">' + money(bal) + '</strong><small>Opening ' + money(d.openingBalance) + ' + all income − all expenses</small></div><span class="op" aria-hidden="true">−</span>' +
      '<div class="eq-item"><span class="lbl">Set aside for goals</span><strong class="num">' + money(alloc) + '</strong><small>' + d.goals.length + ' goal' + (d.goals.length === 1 ? '' : 's') + '</small></div><span class="op" aria-hidden="true">=</span>' +
      '<div class="eq-item hero' + (av < 0 ? ' neg' : '') + '"><span class="lbl">Available to spend</span><strong class="num">' + money(av) + '</strong><small>' + (av < 0 ? 'Over by ' + money(-av) : 'Free to use, after goals') + '</small></div></section>';
    if (av < 0) html += '<div class="alert bad" role="alert">Your expenses and goal savings add up to more than your balance. Check your <button class="link" data-action="nav" data-view="settings">opening balance</button> or move money back from a goal.</div>';
    if (!d.transactions.length && !d.openingBalance) html += '<div class="alert info">New here? Start by setting your <button class="link" data-action="nav" data-view="settings">opening balance</button> (what you have in the bank today), then add your first transaction.</div>';
    html += '<div class="grid4">' +
      '<div class="card stat"><span class="lbl">Income · ' + esc(label) + '</span><strong class="pos num">' + money(inc) + '</strong></div>' +
      '<div class="card stat"><span class="lbl">Expenses · ' + esc(label) + '</span><strong class="neg-t num">' + money(exp) + '</strong></div>' +
      '<div class="card stat"><span class="lbl">Net · ' + esc(label) + '</span><strong class="num ' + (net < 0 ? 'neg-t' : 'pos') + '">' + (net < 0 ? '−' : '') + money(Math.abs(net)) + '</strong></div>' +
      '<div class="card stat"><span class="lbl">Savings rate</span><strong class="num">' + (rate == null ? '—' : rate + '%') + '</strong></div></div>';
    if (cats[0] && exp > 0) html += '<p class="muted">💡 Biggest spend ' + esc(label) + ': <b>' + esc(cats[0].category) + '</b> (' + money(cats[0].total) + ', ' + Math.round(cats[0].total / exp * 100) + '% of expenses).</p>';
    if (S.user.mode === 'student' && d.allowance > 0) {
      var spentM = Calc.sumType(d.transactions, 'expense', Calc.periodRange('month', today)), left = Calc.round2(d.allowance - spentM);
      var now = new Date(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(), daysLeft = dim - now.getDate() + 1;
      var pct = Math.min(100, Math.round(spentM / d.allowance * 100));
      html += '<section class="card"><h2>🎒 This month’s allowance <span class="badge ' + (left < 0 ? 'bad' : 'good') + '">' + (left < 0 ? 'Over by ' + money(-left) : money(left) + ' left') + '</span></h2><div class="progress ' + (pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok') + '"><i style="width:' + pct + '%"></i></div><p class="muted" style="margin-top:10px">Spent ' + money(spentM) + ' of ' + money(d.allowance) + '. ' + (left > 0 ? 'Safe to spend about <b>' + money(Math.floor(left / daysLeft)) + '/day</b> for the next ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + '.' : 'Try to hold off on extras until next month.') + '</p></section>';
    }
    html += '<div class="grid2"><section class="card"><h2>Spending by category</h2>' + (cats.length ? '<div class="chart-box"><canvas id="chCat" role="img" aria-label="Doughnut chart of spending by category"></canvas></div><div class="legend" id="catLegend"></div>' : empty('📊', 'No expenses in this period', 'Add an expense to see where your money goes.')) + '</section>' +
      '<section class="card"><h2>Income vs expenses · last 6 months</h2><div class="chart-box"><canvas id="chMonths" role="img" aria-label="Bar chart of income and expenses for the last six months"></canvas></div></section></div>';
    var buds = Calc.budgetStatus(d, mk).slice(0, 4);
    html += '<div class="grid2"><section class="card"><h2>Budgets this month <button class="link" data-action="nav" data-view="budgets">Manage</button></h2>' +
      (buds.length ? buds.map(function (b) { return '<div class="brow"><div class="t"><span>' + (ICONS[b.category] || '') + ' ' + esc(b.category) + '</span><span class="num">' + money(b.spent) + ' / ' + money(b.limit) + '</span></div><div class="progress ' + b.status + '"><i style="width:' + Math.min(100, b.pct) + '%"></i></div>' + (b.status === 'over' ? '<small class="neg-t">Over by ' + money(b.spent - b.limit) + '</small>' : b.status === 'warn' ? '<small style="color:var(--warn)">' + b.pct + '% used: nearly at your cap</small>' : '') + '</div>'; }).join('') : empty('🎯', 'No budgets yet', 'Set a monthly cap for categories like food or shopping.', '<button class="btn ghost sm" data-action="nav" data-view="budgets">Set budgets</button>')) + '</section>' +
      '<section class="card"><h2>Recent transactions <button class="link" data-action="nav" data-view="transactions">View all</button></h2>' +
      (d.transactions.length ? '<div class="list">' + sorted(d.transactions).slice(0, 5).map(function (t) { return txnRow(t, false); }).join('') + '</div>' : empty('🧾', 'Nothing here yet', 'Your latest income and expenses will show up here.', '<button class="btn primary sm" data-action="add-txn">Add transaction</button>')) + '</section></div></div>';

    return {
      html: html, after: function () {
        if (!window.Chart) { var cb = $$('.chart-box'); cb.forEach(function (b) { b.innerHTML = '<p class="muted">Charts could not load (offline?). Your numbers above are still correct.</p>'; }); return; }
        var txt = css('--text-2'), grid = css('--border');
        if (cats.length) {
          var colors = cats.map(function (c, i) { return PALETTE[i % PALETTE.length]; });
          S.charts.push(new Chart($('#chCat'), { type: 'doughnut', data: { labels: cats.map(function (c) { return c.category; }), datasets: [{ data: cats.map(function (c) { return c.total; }), backgroundColor: colors, borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '64%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return ' ' + c.label + ': ' + money(c.parsed); } } } } } }));
          $('#catLegend').innerHTML = cats.slice(0, 6).map(function (c, i) { return '<div><i style="background:' + colors[i] + '"></i><span>' + esc(c.category) + '</span><span>' + money(c.total) + '</span></div>'; }).join('');
        }
        var ms = Calc.monthlySeries(d.transactions, mk, 6);
        S.charts.push(new Chart($('#chMonths'), { type: 'bar', data: { labels: ms.map(function (m) { return monthName(m.key); }), datasets: [{ label: 'Income', data: ms.map(function (m) { return m.income; }), backgroundColor: '#059669', borderRadius: 6 }, { label: 'Expenses', data: ms.map(function (m) { return m.expense; }), backgroundColor: '#dc2626', borderRadius: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: txt } }, tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + money(c.parsed.y); } } } }, scales: { x: { ticks: { color: txt }, grid: { display: false } }, y: { ticks: { color: txt, callback: function (v) { return v >= 1000 ? v / 1000 + 'k' : v; } }, grid: { color: grid }, beginAtZero: true } } } }));
      }
    };
  };

  VIEWS.transactions = function () {
    var cats = Calc.EXPENSE_CATEGORIES.concat(Calc.INCOME_CATEGORIES.filter(function (c) { return Calc.EXPENSE_CATEGORIES.indexOf(c) < 0; }), ['Savings']);
    var f = S.filters;
    var html = '<div class="stack"><div class="filters"><div><label class="sr" for="fq">Search</label><input id="fq" class="search" type="search" placeholder="Search title, category or note…" data-filter="q" value="' + esc(f.q) + '"></div>' +
      '<div><label class="sr" for="ftype">Type</label><select id="ftype" class="select" style="width:100%" data-filter="type">' + [['all', 'All types'], ['income', 'Income'], ['expense', 'Expenses'], ['transfer', 'Goal transfers']].map(function (o) { return '<option value="' + o[0] + '"' + (f.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="sr" for="fcat">Category</label><select id="fcat" class="select" style="width:100%" data-filter="cat"><option value="all">All categories</option>' + cats.map(function (c) { return '<option' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="card"><div id="txnSummary" class="sumline" style="margin-top:0"></div><div id="txnList" class="list"></div><div id="txnMore" style="text-align:center;margin-top:10px"></div></div></div>';
    return { html: html, after: renderTxnList };
  };
  function renderTxnList() {
    var f = S.filters, q = f.q.trim().toLowerCase(), range = Calc.periodRange(S.period);
    var rows = sorted(S.data.transactions.filter(function (t) {
      return Calc.inRange(t, range) && (f.type === 'all' || t.type === f.type) && (f.cat === 'all' || t.category === f.cat) && (!q || (t.title + ' ' + t.category + ' ' + t.note).toLowerCase().indexOf(q) >= 0);
    }));
    var inc = 0, exp = 0; rows.forEach(function (t) { if (t.type === 'income') inc += t.amount; else if (t.type === 'expense') exp += t.amount; });
    $('#txnSummary').innerHTML = '<span><b>' + rows.length + '</b> transaction' + (rows.length === 1 ? '' : 's') + '</span><span class="pos">Income ' + money(Calc.round2(inc)) + '</span><span class="neg-t">Expenses ' + money(Calc.round2(exp)) + '</span>';
    var list = $('#txnList');
    if (!S.data.transactions.length) list.innerHTML = empty('🧾', 'No transactions yet', 'Add your first income or expense to get started.', '<button class="btn primary" data-action="add-txn">Add transaction</button>');
    else if (!rows.length) list.innerHTML = empty('🔍', 'No matches', 'Try a different time period, category or search word.');
    else list.innerHTML = rows.slice(0, S.limit).map(function (t) { return txnRow(t, true); }).join('');
    $('#txnMore').innerHTML = rows.length > S.limit ? '<button class="btn ghost" data-action="more">Show more (' + (rows.length - S.limit) + ' left)</button>' : '';
  }

  VIEWS.budgets = function () {
    var mk = Calc.todayStr().slice(0, 7), st = {};
    Calc.budgetStatus(S.data, mk).forEach(function (b) { st[b.category] = b; });
    var spentAll = {}; Calc.categoryTotals(S.data.transactions, { from: mk + '-01', to: mk + '-31' }, 'expense').forEach(function (c) { spentAll[c.category] = c.total; });
    var over = Object.keys(st).filter(function (k) { return st[k].status === 'over'; }), warn = Object.keys(st).filter(function (k) { return st[k].status === 'warn'; });
    var html = '<div class="stack"><div class="alert info">Set a monthly spending cap per category. Budgets reset each calendar month. Leave blank or enter 0 to remove a cap.</div>';
    if (over.length) html += '<div class="alert bad" role="alert">Over budget: <b>' + over.map(esc).join(', ') + '</b>.</div>';
    if (warn.length) html += '<div class="alert warn">Close to the cap (80%+): <b>' + warn.map(esc).join(', ') + '</b>.</div>';
    html += '<section class="card">' + Calc.EXPENSE_CATEGORIES.map(function (c) {
      var lim = S.data.budgets[c] || '', b = st[c], spent = spentAll[c] || 0;
      return '<div class="bud" data-cat="' + esc(c) + '"><div><strong>' + (ICONS[c] || '') + ' ' + esc(c) + '</strong><div class="sub muted" style="font-size:13px">Spent this month: ' + money(spent) + '</div></div>' +
        '<div>' + (b ? '<div class="progress ' + b.status + '"><i style="width:' + Math.min(100, b.pct) + '%"></i></div><small class="muted">' + b.pct + '% of ' + money(b.limit) + '</small>' : '<small class="muted">No cap set</small>') + '</div>' +
        '<div><div class="inp"><div class="prefix"><span>₹</span><input type="text" inputmode="decimal" aria-label="Monthly cap for ' + esc(c) + '" placeholder="No cap" value="' + esc(lim) + '"></div><button class="btn ghost sm" data-action="save-budget">Save</button></div><p class="err" role="alert"></p></div></div>';
    }).join('') + '</section></div>';
    return { html: html };
  };

  VIEWS.goals = function () {
    var d = S.data, av = Calc.available(d), today = Calc.todayStr();
    var html = '<div class="stack"><div class="alert info">💡 Money you add to a goal is <b>set aside</b>: it leaves <b>Available to spend</b> on the dashboard and What-If, so it’s never counted twice. Available right now: <b>' + money(av) + '</b>.</div>' +
      '<div><button class="btn primary" data-action="new-goal">＋ New savings goal</button></div>';
    if (!d.goals.length) html += '<div class="card">' + empty('🎯', 'No savings goals yet', 'Create one, such as a laptop, a trip or an emergency fund.') + '</div>';
    else html += '<div class="goals">' + d.goals.map(function (g) {
      var p = Calc.goalProgress(d, g, today);
      var meta = p.done ? '<span class="badge good">🎉 Goal reached</span>' : p.overdue ? '<span class="badge bad">Target date passed</span>' : g.date ? '<span class="badge">By ' + fmtDate(g.date) + (p.perMonth ? ' · ~' + money(p.perMonth) + '/month' : '') + '</span>' : '<span class="badge">No deadline</span>';
      return '<article class="card goal"><h3><span>' + esc(g.name) + '</span><span class="badge ' + (p.done ? 'good' : '') + '">' + p.pct + '%</span></h3>' +
        '<div><div class="big num">' + money(p.saved) + '</div><small class="muted">of ' + money(g.target) + ' · ' + (p.done ? 'complete' : money(p.remaining) + ' to go') + '</small></div>' +
        '<div class="progress ' + (p.done ? 'ok' : '') + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + p.pct + '" aria-label="' + esc(g.name) + ' progress"><i style="width:' + p.pct + '%"></i></div>' + meta +
        '<div class="acts"><button class="btn primary sm" data-action="goal-add" data-id="' + esc(g.id) + '"' + (p.done ? ' disabled' : '') + '>Add money</button><button class="btn ghost sm" data-action="goal-withdraw" data-id="' + esc(g.id) + '"' + (p.saved <= 0 ? ' disabled' : '') + '>Withdraw</button><button class="btn danger-ghost sm" data-action="goal-del" data-id="' + esc(g.id) + '">Delete</button></div></article>';
    }).join('') + '</div>';
    return { html: html + '</div>' };
  };

  VIEWS.whatif = function () {
    var av = Calc.available(S.data);
    var html = '<div class="grid2"><section class="card"><h2>Can I afford it?</h2><form id="wiForm" novalidate onsubmit="return false">' +
      textField('item', 'What do you want to buy? (optional)', '', { attrs: 'maxlength="60" placeholder="e.g. Running shoes"' }) +
      amountField('amount', 'Price', '', '') +
      '<fieldset class="field"><legend>How often?</legend><div class="seg"><label><input type="radio" name="freq" value="once" checked><span>One-time</span></label><label><input type="radio" name="freq" value="monthly"><span>Every month</span></label></div></fieldset>' +
      '</form><p class="hint">Uses the same <b>Available to spend</b> number as your dashboard (' + money(av) + '), so money set aside for goals is excluded.</p></section>' +
      '<section class="card"><h2>Result</h2><div id="wiResult"></div></section></div>';
    return { html: html, after: updateWhatIf };
  };
  function updateWhatIf() {
    var f = $('#wiForm'); if (!f) return;
    var box = $('#wiResult'), raw = f.amount.value, name = f.item.value.trim() || 'this purchase';
    var rec = f.querySelector('input[name=freq]:checked').value === 'monthly';
    f.amount.removeAttribute('aria-invalid'); f.querySelector('.err').textContent = '';
    if (raw.trim() === '') { box.innerHTML = empty('🔮', 'Enter a price', 'Type an amount to see how it affects your spendable money.'); return; }
    var v = Calc.validateAmount(raw, { label: 'Price' });
    if (!v.ok) { f.amount.setAttribute('aria-invalid', 'true'); f.querySelector('.err').textContent = v.error; box.innerHTML = empty('⚠️', 'Check the price', v.error); return; }
    var r = Calc.whatIf(S.data, { amount: v.value, recurring: rec });
    var title = r.verdict === 'yes' ? '✅ Yes, you can afford ' + esc(name) : r.verdict === 'caution' ? '⚠️ Affordable, but it’s a big bite' : '⛔ Not affordable right now';
    var lines = [];
    if (r.verdict === 'caution') lines.push('This uses ' + r.pctOfAvailable + '% of your available money.');
    if (r.verdict === 'no') lines.push('You’re short by ' + money(-r.after) + '.');
    if (r.monthsToAfford) lines.push('At your recent saving pace (about ' + money(r.avgNet) + '/month) you could afford it in roughly ' + r.monthsToAfford + ' month' + (r.monthsToAfford === 1 ? '' : 's') + '.');
    else if (r.verdict === 'no') lines.push('There’s no positive monthly saving in your recent history to estimate a timeline from.');
    if (rec) lines.push(r.recurringNet >= 0 ? 'Paid every month, you’d still save about ' + money(r.recurringNet) + '/month on your recent average.' : 'Paid every month, you’d overspend by about ' + money(-r.recurringNet) + '/month on your recent average (' + money(r.avgNet) + '/month saved today).');
    box.innerHTML = '<div class="verdict ' + r.verdict + '">' + title + '</div><div class="trio"><div><small>Available now</small><strong class="num">' + money(r.available) + '</strong></div><div><small>' + (rec ? 'After 1st payment' : 'After purchase') + '</small><strong class="num ' + (r.after < 0 ? 'neg-t' : '') + '">' + (r.after < 0 ? '−' : '') + money(Math.abs(r.after)) + '</strong></div><div><small>Price</small><strong class="num">' + money(v.value) + '</strong></div></div>' + (lines.length ? '<ul class="plain-list">' + lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '');
  }

  VIEWS.settings = function () {
    var d = S.data, hasBk = Store.hasBackup(S.user.id);
    var html = '<div class="stack"><div class="set-grid"><div class="stack">' +
      '<section class="card"><h2>Opening balance</h2><p class="muted" style="margin-bottom:12px">What you had in your account <b>before</b> your first recorded transaction. Current balance = opening balance + income − expenses.</p><form data-form="opening" novalidate><div class="formline">' + amountField('opening', 'Opening balance', d.openingBalance, 'Can be negative if you started in overdraft.') + '<button class="btn primary" style="margin-top:23px">Save</button></div></form></section>' +
      (S.user.mode === 'student' ? '<section class="card"><h2>Monthly allowance</h2><p class="muted" style="margin-bottom:12px">Student mode: shows how much you can spend per day this month. Enter 0 to hide it.</p><form data-form="allowance" novalidate><div class="formline">' + amountField('allowance', 'Allowance', d.allowance, '') + '<button class="btn primary" style="margin-top:23px">Save</button></div></form></section>' : '') +
      '<section class="card"><h2>Account</h2><div class="kv"><div><b>' + esc(S.user.name) + '</b>' + (S.user.email ? ' · ' + esc(S.user.email) : '') + '</div></div>' +
      (S.user.demo ? '<p class="hint" style="margin-top:10px">You’re using the demo account. Changes here are saved only in this browser.</p>' : '<div class="field" style="margin:14px 0 0"><label for="modeSel">I am a…</label><select id="modeSel" data-action-change="mode"><option value="student"' + (S.user.mode === 'student' ? ' selected' : '') + '>🎓 Student</option><option value="professional"' + (S.user.mode === 'professional' ? ' selected' : '') + '>💼 Professional</option></select></div>') +
      (S.user.demo ? '<div class="alert warn" style="margin-top:14px">🧪 <b>Demo data is not encrypted.</b> Create an account to get an encrypted, password-protected profile.</div>' : '<div class="alert good" style="margin-top:14px">🔒 <b>Your data is encrypted</b> on this device (AES-256) with your password, and the app locks itself after 5 minutes of inactivity. <b>If you forget your password, your data can’t be recovered</b> — keep a backup.</div><div class="alert warn" style="margin-top:10px">🧪 <b>Prototype.</b> This is still a browser-only profile, not a bank-grade system. Never enter card numbers, PINs, OTPs or account passwords.</div>') + '</section></div>' +
      '<div class="stack"><section class="card"><h2>Backup &amp; restore</h2><p class="muted" style="margin-bottom:14px">Download a copy of your data, or bring one back. Restoring always shows a preview first, and your current data is saved so you can undo. <b>Exported files are not encrypted</b>, so keep them somewhere private.</p><div class="btn-row"><button class="btn primary" data-action="export-json">⬇ Export JSON backup</button><button class="btn ghost" data-action="export-csv">⬇ Export CSV</button><button class="btn ghost" data-action="restore-pick">⬆ Restore from JSON</button></div>' +
      (hasBk ? '<div class="alert info" style="margin-top:14px">A copy of your data from before the last restore/reset is saved. <button class="link" data-action="undo-restore">Undo it</button></div>' : '') + '</section>' +
      '<section class="card"><h2>Danger zone</h2><p class="muted" style="margin-bottom:12px">Remove all transactions, goals and budgets from this browser. A safety copy is kept so you can undo.</p><button class="btn danger-ghost" data-action="reset">Erase my data</button></section></div></div></div>';
    return { html: html };
  };

  /* ================= RENDER ================= */
  function render() {
    if (!S.user) { showAuth(); return; }
    $('#auth').hidden = true; $('#app').hidden = false;
    var nav = NAV.map(function (n) { return '<button class="nav-btn" data-action="nav" data-view="' + n.id + '"' + (S.view === n.id ? ' aria-current="page"' : '') + '><span class="ic" aria-hidden="true">' + n.icon + '</span><span>' + '@L@' + '</span></button>'; });
    $('#sideNav').innerHTML = nav.map(function (h, i) { return h.replace('@L@', NAV[i].label); }).join('');
    $('#bottomNav').innerHTML = nav.map(function (h, i) { return h.replace('@L@', NAV[i].short); }).join('');
    $('#viewTitle').textContent = NAV.filter(function (n) { return n.id === S.view; })[0].label;
    $('#period').hidden = !(S.view === 'dashboard' || S.view === 'transactions'); $('label[for=period]').hidden = $('#period').hidden;
    $('#period').innerHTML = PERIODS.map(function (p) { return '<option value="' + p[0] + '"' + (S.period === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('');
    $('#avatar').textContent = S.user.name.trim().charAt(0).toUpperCase() || 'U';
    $('#whoName').textContent = S.user.name; $('#whoMode').textContent = (S.user.mode === 'student' ? 'Student' : 'Professional') + (S.user.demo ? ' · demo' : '');
    destroyCharts();
    var v = VIEWS[S.view](); $('#view').innerHTML = v.html; if (v.after) v.after();
  }
  function go(view) { S.view = view; render(); window.scrollTo(0, 0); }

  /* ================= ACTIONS ================= */
  function txnForm(t) {
    var edit = !!t; t = t || { type: 'expense', title: '', amount: '', date: Calc.todayStr(), category: '', note: '' };
    var body = '<div class="field"><div class="seg" role="radiogroup" aria-label="Type"><label><input type="radio" name="type" value="expense"' + (t.type === 'expense' ? ' checked' : '') + '><span>Expense</span></label><label><input type="radio" name="type" value="income"' + (t.type === 'income' ? ' checked' : '') + '><span>Income</span></label></div><p class="err" data-for="type"></p></div>' +
      textField('title', 'Title', t.title, { attrs: 'maxlength="80" placeholder="e.g. Lunch with friends"' }) + amountField('amount', 'Amount', t.amount, '') +
      textField('date', 'Date', t.date, { type: 'date', attrs: 'max="' + Calc.todayStr() + '"' }) +
      '<div class="field"><label for="f_category">Category</label><select id="f_category" name="category">' + catOptions(t.type, t.category) + '</select><p class="err" data-for="category" role="alert"></p></div>' +
      textField('note', 'Note (optional)', t.note, { attrs: 'maxlength="200"' });
    openForm(edit ? 'Edit transaction' : 'Add transaction', body, edit ? 'Save changes' : 'Save', function (v) {
      var r = Calc.validateTransaction(v); if (!r.ok) return { errors: r.errors };
      if (edit) Object.assign(t, r.value); else S.data.transactions.push(Object.assign({ id: Calc.uid() }, r.value));
      persist(); render(); toast(edit ? 'Transaction updated' : 'Transaction added', 'good');
      if (Calc.available(S.data) < 0) toast('Heads up: you now have less than ₹0 available to spend.', 'warn');
    }, {
      onReady: function (form) {
        form.addEventListener('change', function (e) {
          if (e.target.name === 'type') { $('#f_category', form).innerHTML = catOptions(e.target.value, ''); }
        });
      }
    });
  }

  function newGoal() {
    var av = Calc.available(S.data);
    var body = textField('name', 'Goal name', '', { attrs: 'maxlength="50" placeholder="e.g. New laptop"' }) + amountField('target', 'Target', '', '') +
      amountField('saved', 'Already saved (optional)', '', 'Moves this amount out of your available money (' + money(Math.max(0, av)) + ' available).') +
      textField('date', 'Target date (optional)', '', { type: 'date', attrs: 'min="' + Calc.todayStr() + '"' });
    openForm('New savings goal', body, 'Create goal', function (v) {
      var r = Calc.validateGoal(v, { available: av }); if (!r.ok) return { errors: r.errors };
      var g = { id: Calc.uid(), name: r.value.name, target: r.value.target, date: r.value.date, created: Calc.todayStr() };
      S.data.goals.push(g);
      if (r.value.saved > 0) S.data.transactions.push({ id: Calc.uid(), type: 'transfer', title: 'Added to goal', amount: r.value.saved, date: Calc.todayStr(), category: 'Savings', note: '', goalId: g.id });
      persist(); render(); toast('Goal created', 'good');
    });
  }

  function goalMove(id, withdraw) {
    var g = goalById(id); if (!g) return;
    var p = Calc.goalProgress(S.data, g), av = Calc.available(S.data);
    var hint = withdraw ? 'Up to ' + money(p.saved) + ' saved in this goal. It returns to Available to spend.' : 'Up to ' + money(Math.min(p.remaining, Math.max(0, av))) + ' (' + money(p.remaining) + ' left on the goal, ' + money(Math.max(0, av)) + ' available).';
    openForm((withdraw ? 'Withdraw from ' : 'Add to ') + g.name, amountField('amount', 'Amount', '', hint), withdraw ? 'Withdraw' : 'Add money', function (v) {
      var r = withdraw ? Calc.validateWithdrawal(v.amount, { saved: p.saved }) : Calc.validateContribution(v.amount, { remaining: p.remaining, available: av });
      if (!r.ok) return { errors: { amount: r.error } };
      S.data.transactions.push({ id: Calc.uid(), type: 'transfer', title: withdraw ? 'Withdrawn from goal' : 'Added to goal', amount: withdraw ? -r.value : r.value, date: Calc.todayStr(), category: 'Savings', note: '', goalId: g.id });
      persist(); render(); toast(withdraw ? 'Moved back to available money' : 'Money set aside for ' + g.name, 'good');
    });
  }

  function showRestoreErrors(errors, fname) {
    openForm('Can’t restore this file', '<p>The file <b>' + esc(fname) + '</b> has problems, so nothing was changed:</p><ul class="plain-list">' + errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>', 'OK', function () { }, {});
    $('#modal .btn.ghost').hidden = true;
  }
  function handleFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('That file is too large for a backup (over 5 MB).', 'error'); return; }
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read that file.', 'error'); };
    rd.onload = function () {
      var raw; try { raw = JSON.parse(String(rd.result)); } catch (e) { showRestoreErrors(['This file is not valid JSON, so it can’t be a FinCanvas backup.'], file.name); return; }
      var res = Calc.validateBackup(raw);
      if (!res.ok) { showRestoreErrors(res.errors, file.name); return; }
      var inc = res.state, cur = S.data;
      var merged = Calc.mergeStates(cur, inc);
      var body = '<p>The file <b>' + esc(file.name) + '</b> looks valid. It contains:</p><ul class="plain-list"><li><b>' + inc.transactions.length + '</b> transactions</li><li><b>' + inc.goals.length + '</b> savings goals</li><li><b>' + Object.keys(inc.budgets).length + '</b> budgets</li><li>Opening balance ' + money(inc.openingBalance) + '</li></ul><p class="muted" style="margin:12px 0 10px">You currently have ' + cur.transactions.length + ' transactions and ' + cur.goals.length + ' goals. Choose how to restore:</p>' +
        '<label class="radio-card"><input type="radio" name="how" value="replace" checked><span><b>Replace</b> my current data<small>Everything now is swapped for the file’s contents.</small></span></label>' +
        '<label class="radio-card"><input type="radio" name="how" value="merge"><span><b>Merge</b> into my current data<small>Adds ' + merged.added.transactions + ' new transactions and ' + merged.added.goals + ' goals; skips ' + merged.skipped.transactions + ' duplicate transactions. Opening balance stays as is.</small></span></label>' +
        '<p class="hint">A safety copy of your current data is saved first, so you can undo from Backup &amp; settings.</p>';
      openForm('Restore from backup', body, 'Restore', function (v) {
        Store.saveBackup(S.user.id, S.data);
        S.data = v.how === 'merge' ? merged.state : inc;
        persist(); render(); toast(v.how === 'merge' ? 'Merged ' + merged.added.transactions + ' transactions' : 'Backup restored', 'good');
      }, { noFocus: true });
    };
    rd.readAsText(file);
  }

  var ACTIONS = {
    'nav': function (el) { go(el.dataset.view); },
    'hide-banner': function () { S.bannerHidden = true; render(); },
    'theme': function () {
      var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('fincanvas.theme', t); } catch (e) { /* ignore */ }
      render();
    },
    'add-txn': function () { txnForm(); },
    'edit-txn': function (el) { var t = S.data.transactions.filter(function (x) { return x.id === el.dataset.id; })[0]; if (t) txnForm(t); },
    'del-txn': async function (el) {
      var t = S.data.transactions.filter(function (x) { return x.id === el.dataset.id; })[0]; if (!t) return;
      if (await confirmBox('Delete this transaction?', t.title + ' · ' + money(t.amount) + ' on ' + fmtDate(t.date) + '. This can’t be undone (export a backup first if unsure).', 'Delete', true)) {
        S.data.transactions = S.data.transactions.filter(function (x) { return x.id !== t.id; }); persist(); render(); toast('Transaction deleted');
      }
    },
    'more': function () { S.limit += 50; renderTxnList(); },
    'new-goal': newGoal,
    'goal-add': function (el) { goalMove(el.dataset.id, false); },
    'goal-withdraw': function (el) { goalMove(el.dataset.id, true); },
    'goal-del': async function (el) {
      var g = goalById(el.dataset.id); if (!g) return; var saved = Calc.goalSaved(S.data, g.id);
      if (await confirmBox('Delete “' + g.name + '”?', saved > 0 ? money(saved) + ' set aside for this goal will go back into Available to spend.' : 'This goal has no money set aside.', 'Delete goal', true)) {
        S.data.goals = S.data.goals.filter(function (x) { return x.id !== g.id; });
        S.data.transactions = S.data.transactions.filter(function (t) { return t.goalId !== g.id; }); persist(); render(); toast('Goal deleted');
      }
    },
    'save-budget': function (el) {
      var row = el.closest('.bud'), inp = $('input', row), err = $('.err', row), cat = row.dataset.cat;
      inp.removeAttribute('aria-invalid'); err.textContent = '';
      if (inp.value.trim() === '') { delete S.data.budgets[cat]; persist(); render(); toast('Cap removed for ' + cat); return; }
      var r = Calc.validateAmount(inp.value, { label: 'Cap', allowZero: true });
      if (!r.ok) { inp.setAttribute('aria-invalid', 'true'); err.textContent = r.error; inp.focus(); return; }
      if (r.value === 0) delete S.data.budgets[cat]; else S.data.budgets[cat] = r.value;
      persist(); render(); toast(r.value === 0 ? 'Cap removed for ' + cat : 'Cap saved for ' + cat, 'good');
    },
    'export-json': function () { Store.download('fincanvas-backup-' + Calc.todayStr() + '.json', JSON.stringify(Calc.exportObject(S.data), null, 2), 'application/json'); toast('Backup downloaded', 'good'); },
    'export-csv': function () { Store.download('fincanvas-transactions-' + Calc.todayStr() + '.csv', Calc.toCSV(S.data), 'text/csv'); toast('CSV downloaded', 'good'); },
    'restore-pick': function () { var f = $('#file'); f.value = ''; f.click(); },
    'undo-restore': async function () {
      var b = Store.takeBackup(S.user.id); if (!b) { toast('No safety copy found.', 'error'); return; }
      if (await confirmBox('Undo the last restore or reset?', 'Your current data will be replaced by the saved safety copy.', 'Undo it')) { S.data = b; Store.clearBackup(S.user.id); persist(); render(); toast('Previous data brought back', 'good'); }
    },
    'reset': async function () {
      if (await confirmBox('Erase all your data?', 'All transactions, goals and budgets in this browser will be removed. A safety copy is kept so you can undo.', 'Erase data', true)) {
        Store.saveBackup(S.user.id, S.data); S.data = Calc.emptyState(); persist(); render(); toast('Data erased. You can undo from this page.');
      }
    },
    'logout': function () { Store.clearSession(); Store.lock(); S.user = null; S.data = null; destroyCharts(); render(); }
  };

  document.addEventListener('click', function (e) {
    var close = e.target.closest('#modal [data-close]'); if (close) { $('#modal').close(); return; }
    if (e.target === $('#modal')) { $('#modal').close(); return; }
    var el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
    var fn = ACTIONS[el.dataset.action]; if (fn) fn(el, e);
  });
  document.addEventListener('input', function (e) {
    if (e.target.closest('#wiForm')) updateWhatIf();
    var fk = e.target.dataset && e.target.dataset.filter;
    if (fk) { S.filters[fk] = e.target.value; S.limit = 50; renderTxnList(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'period') { S.period = e.target.value; S.limit = 50; render(); }
    if (e.target.id === 'modeSel') { S.user.mode = e.target.value; Store.setMode(S.user.id, e.target.value); render(); toast('Mode updated', 'good'); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]'); if (!f) return;
    e.preventDefault();
    var kind = f.dataset.form, name = kind === 'opening' ? 'opening' : 'allowance';
    var r = kind === 'opening' ? Calc.validateOpeningBalance(f.elements[name].value) : Calc.validateAmount(f.elements[name].value, { label: 'Allowance', allowZero: true });
    if (!r.ok) { setErrors(f, (function () { var o = {}; o[name] = r.error; return o; })()); return; }
    setErrors(f, {});
    if (kind === 'opening') S.data.openingBalance = r.value; else S.data.allowance = r.value;
    persist(); render(); toast(kind === 'opening' ? 'Opening balance saved' : 'Allowance saved', 'good');
  });
  $('#file').addEventListener('change', function (e) { handleFile(e.target.files[0]); });

  /* ================= AUTH ================= */
  function showAuth() { $('#app').hidden = true; $('#auth').hidden = false; setAuthMode(S.authMode); }
  function setAuthMode(m) {
    S.authMode = m; var su = m === 'signup';
    $$('[data-auth-tab]').forEach(function (b) { var on = b.dataset.authTab === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    $$('.signup-only').forEach(function (n) { n.hidden = !su; });
    $('#authTitle').textContent = su ? 'Create your account' : 'Welcome back 👋';
    $('#authSub').textContent = su ? 'It takes less than a minute.' : 'Log in to continue to your dashboard.';
    $('#authBtn').textContent = su ? 'Create account' : 'Log in';
    $('#a_pw').setAttribute('autocomplete', su ? 'new-password' : 'current-password');
    setErrors($('#authForm'), {});
  }
  $$('[data-auth-tab]').forEach(function (b) { b.addEventListener('click', function () { setAuthMode(b.dataset.authTab); }); });
  $('#authForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var form = e.target, fd = {}; new FormData(form).forEach(function (v, k) { fd[k] = v; });
    var btn = $('#authBtn'); btn.disabled = true;
    try {
      var res = S.authMode === 'login' ? await Store.login(fd.email, fd.password) : await Store.register(fd);
      if (res.errors) { setErrors(form, res.errors); return; }
      form.reset(); startSession(res.user, S.authMode === 'signup');
    } catch (err) { setErrors(form, { password: 'Something went wrong. Please try again.' }); }
    finally { btn.disabled = false; }
  });
  $('#demoBtn').addEventListener('click', function () { startSession(Store.startDemo(), false); });

  function startSession(user, isNew) {
    S.user = user; Store.setSession(user.id);
    var res = Store.load(user.id); S.data = res.state; S.view = isNew ? 'settings' : 'dashboard';
    render(); window.scrollTo(0, 0);
    if (res.corrupt) toast('Your saved data couldn’t be read, so you’re starting fresh. A raw copy was kept in this browser.', 'warn');
    else if (isNew) toast('Welcome! Start by setting your opening balance.', 'good');
    else toast('Welcome, ' + user.name.split(' ')[0] + '!');
    if (Store.isMemoryOnly()) toast('Browser storage is blocked. Your data will be lost when you close this tab.', 'warn');
  }

  /* ================= INIT ================= */
  /* ---------- app lock: encrypted accounts need the password again after a reload or idle time ---------- */
  var IDLE_MS = 5 * 60 * 1000, lastActive = Date.now();
  function showLocked(u, why) {
    S.authMode = 'login'; render();
    $('#a_email').value = u.email || '';
    $('#authSub').textContent = '🔒 ' + (why || 'Your data is encrypted. Enter your password to unlock it.');
    var pw = $('#a_pw'); if (pw) pw.focus();
  }
  function lockNow(why) {
    if (!S.user || S.user.demo) return;
    var u = S.user, m = $('#modal'), c = $('#confirm');
    try { if (m.open) m.close(); if (c.open) c.close(); } catch (e) { /* ignore */ }
    Store.lock(); S.user = null; S.data = null; destroyCharts();
    showLocked(u, why);
  }
  function checkIdle() { if (S.user && !S.user.demo && Date.now() - lastActive > IDLE_MS) lockNow('Locked after 5 minutes of inactivity. Enter your password to continue.'); }
  ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach(function (ev) { window.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true, capture: true }); });
  setInterval(checkIdle, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkIdle(); });
  window.addEventListener('fincanvas:savefail', function () { toast('Could not save: browser storage is blocked or full. Export a backup now.', 'error'); });

  (function init() {
    var id = Store.getSession(), u = id && Store.getUser(id), locked = !!(u && Store.needsUnlock(u.id));
    if (u && !locked) { S.user = u; var res = Store.load(u.id); S.data = res.state; if (res.corrupt) toast('Your saved data couldn’t be read, so you’re starting fresh.', 'warn'); }
    if (locked) showLocked(u); else render();
  })();
})();
