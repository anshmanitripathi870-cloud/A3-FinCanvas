/* A³ FinCanvas — calculations.js
 * Pure functions only (no DOM, no storage) so they can be tested on their own.
 *
 * Money rules (single source of truth, used by Dashboard AND What-If):
 *   Current balance    = Opening balance + all income − all expenses
 *   Set aside (goals)  = sum of all goal transfers (adds minus withdrawals)
 *   Available to spend = Current balance − Set aside
 */
(function (root) {
  'use strict';

  var MAX_AMOUNT = 1e9;
  var EXPENSE_CATEGORIES = ['Food & Dining', 'Groceries', 'Transport', 'Rent & Housing', 'Bills & Utilities', 'Shopping', 'Entertainment', 'Health', 'Education', 'Travel', 'Subscriptions', 'Other'];
  var INCOME_CATEGORIES = ['Salary', 'Allowance', 'Freelance', 'Scholarship', 'Gift', 'Investment', 'Other'];

  /* ---------- helpers ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function uid() { return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(msg) { return { ok: false, error: msg }; }
  function str(v) { return v == null ? '' : String(v); }
  function money(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isValidDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var p = s.split('-').map(Number);
    if (p[0] < 2000 || p[0] > 2100) return false;
    var d = new Date(p[0], p[1] - 1, p[2]);
    return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
  }
  function monthKey(s) { return s.slice(0, 7); }
  function addMonths(key, n) {
    var y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function toNumber(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    var s = v.trim().replace(/,/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    var n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  /* ---------- validation ---------- */
  function validateAmount(v, o) {
    o = o || {};
    var label = o.label || 'Amount';
    var n = toNumber(v);
    if (isNaN(n)) return fail(str(v).trim() === '' ? label + ' is required.' : 'Enter a valid number for ' + label.toLowerCase() + ' (digits only).');
    if (n < 0 && !o.allowNegative) return fail(label + ' cannot be negative.');
    if (n === 0 && !o.allowZero) return fail(label + ' must be greater than zero.');
    if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return fail('Use at most 2 decimal places.');
    if (Math.abs(n) > (o.max || MAX_AMOUNT)) return fail(label + ' is too large (max ' + money(o.max || MAX_AMOUNT) + ').');
    return { ok: true, value: round2(n) };
  }

  function validateTransaction(input, opts) {
    opts = opts || {};
    var errors = {};
    var type = input.type;
    if (type !== 'income' && type !== 'expense') errors.type = 'Choose income or expense.';
    var title = str(input.title).trim();
    if (!title) errors.title = 'Title is required.';
    else if (title.length > 80) errors.title = 'Keep the title under 80 characters.';
    var a = validateAmount(input.amount, { label: 'Amount' });
    if (!a.ok) errors.amount = a.error;
    var date = str(input.date).trim();
    if (!isValidDate(date)) errors.date = 'Pick a valid date.';
    else if (date > todayStr(opts.today)) errors.date = "Date can't be in the future.";
    var cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if ((type === 'income' || type === 'expense') && cats.indexOf(input.category) < 0) errors.category = 'Choose a category.';
    var note = str(input.note).trim();
    if (note.length > 200) errors.note = 'Keep the note under 200 characters.';
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, value: { type: type, title: title, amount: a.value, date: date, category: input.category, note: note } };
  }

  function validateOpeningBalance(v) {
    return validateAmount(v, { label: 'Opening balance', allowZero: true, allowNegative: true });
  }

  function validateGoal(input, ctx) {
    ctx = ctx || {};
    var errors = {};
    var name = str(input.name).trim();
    if (!name) errors.name = 'Goal name is required.';
    else if (name.length > 50) errors.name = 'Keep the name under 50 characters.';
    var t = validateAmount(input.target, { label: 'Target' });
    if (!t.ok) errors.target = t.error;
    var saved = 0;
    if (str(input.saved).trim() !== '') {
      var s = validateAmount(input.saved, { label: 'Already saved', allowZero: true });
      if (!s.ok) errors.saved = s.error;
      else {
        saved = s.value;
        if (t.ok && saved > t.value) errors.saved = 'Already saved cannot be more than the target.';
        else if (saved > 0 && saved > (ctx.available || 0)) errors.saved = 'That is more than your available money (' + money(Math.max(0, ctx.available || 0)) + ').';
      }
    }
    var date = str(input.date).trim();
    if (date) {
      if (!isValidDate(date)) errors.date = 'Pick a valid date.';
      else if (date < todayStr(ctx.today)) errors.date = 'Target date must be today or later.';
    }
    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, value: { name: name, target: t.value, saved: saved, date: date } };
  }

  function validateContribution(input, ctx) {
    var a = validateAmount(input, { label: 'Amount' });
    if (!a.ok) return a;
    if (a.value > ctx.remaining) return fail(ctx.remaining <= 0 ? 'This goal is already complete.' : 'Only ' + money(ctx.remaining) + ' left to reach the target.');
    if (a.value > ctx.available) return fail('Only ' + money(Math.max(0, ctx.available)) + ' available to set aside.');
    return a;
  }

  function validateWithdrawal(input, ctx) {
    var a = validateAmount(input, { label: 'Amount' });
    if (!a.ok) return a;
    if (a.value > ctx.saved) return fail('This goal only has ' + money(ctx.saved) + ' saved.');
    return a;
  }

  /* ---------- state ---------- */
  function emptyState() {
    return { version: 2, openingBalance: 0, allowance: 0, budgets: {}, goals: [], transactions: [] };
  }

  /* ---------- aggregation ---------- */
  function periodRange(key, today) {
    today = today || todayStr();
    var mk = monthKey(today), y = today.slice(0, 4);
    switch (key) {
      case 'month': return { from: mk + '-01', to: mk + '-31' };
      case 'lastMonth': var pm = addMonths(mk, -1); return { from: pm + '-01', to: pm + '-31' };
      case 'last3': return { from: addMonths(mk, -2) + '-01', to: mk + '-31' };
      case 'year': return { from: y + '-01-01', to: y + '-12-31' };
      default: return {};
    }
  }
  function inRange(t, r) { r = r || {}; return (!r.from || t.date >= r.from) && (!r.to || t.date <= r.to); }
  function sumType(txns, type, range) {
    var s = 0;
    txns.forEach(function (t) { if (t.type === type && inRange(t, range)) s += t.amount; });
    return round2(s);
  }
  function balance(state) {
    return round2(state.openingBalance + sumType(state.transactions, 'income') - sumType(state.transactions, 'expense'));
  }
  function allocated(state) { return sumType(state.transactions, 'transfer'); }
  function available(state) { return round2(balance(state) - allocated(state)); }
  function goalSaved(state, goalId) {
    var s = 0;
    state.transactions.forEach(function (t) { if (t.type === 'transfer' && t.goalId === goalId) s += t.amount; });
    return round2(s);
  }
  function savingsRate(inc, exp) { return inc > 0 ? Math.round((inc - exp) / inc * 100) : null; }

  function categoryTotals(txns, range, type) {
    var m = {};
    txns.forEach(function (t) { if (t.type === type && inRange(t, range)) m[t.category] = (m[t.category] || 0) + t.amount; });
    return Object.keys(m).map(function (k) { return { category: k, total: round2(m[k]) }; })
      .sort(function (a, b) { return b.total - a.total; });
  }
  function monthlySeries(txns, endKey, n) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var key = addMonths(endKey, -i), r = { from: key + '-01', to: key + '-31' };
      out.push({ key: key, income: sumType(txns, 'income', r), expense: sumType(txns, 'expense', r) });
    }
    return out;
  }
  function budgetStatus(state, mk) {
    var r = { from: mk + '-01', to: mk + '-31' };
    var spent = {};
    categoryTotals(state.transactions, r, 'expense').forEach(function (c) { spent[c.category] = c.total; });
    return Object.keys(state.budgets).filter(function (k) { return state.budgets[k] > 0; }).map(function (k) {
      var limit = state.budgets[k], s = spent[k] || 0, pct = Math.round(s / limit * 100);
      return { category: k, limit: limit, spent: s, pct: pct, status: pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
    }).sort(function (a, b) { return b.pct - a.pct; });
  }
  function goalProgress(state, goal, today) {
    today = today || todayStr();
    var saved = goalSaved(state, goal.id);
    var remaining = Math.max(0, round2(goal.target - saved));
    var out = { saved: saved, remaining: remaining, pct: goal.target > 0 ? Math.min(100, Math.floor(saved / goal.target * 100)) : 0, done: saved >= goal.target, overdue: false, perMonth: null };
    if (goal.date && !out.done) {
      var days = (new Date(goal.date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 864e5;
      if (days < 0) out.overdue = true;
      else out.perMonth = Math.ceil(remaining / Math.max(1, Math.ceil(days / 30.44)));
    }
    return out;
  }
  function avgMonthlyNet(state, today) {
    var mk = monthKey(today || todayStr());
    var rows = monthlySeries(state.transactions, addMonths(mk, -1), 3).filter(function (r) { return r.income > 0 || r.expense > 0; });
    if (!rows.length) return 0;
    var sum = 0; rows.forEach(function (r) { sum += r.income - r.expense; });
    return round2(sum / rows.length);
  }
  function whatIf(state, o) {
    var av = available(state), amount = o.amount, after = round2(av - amount), avg = avgMonthlyNet(state, o.today);
    return {
      available: av, after: after, avgNet: avg,
      verdict: after < 0 ? 'no' : (amount > av * 0.5 ? 'caution' : 'yes'),
      pctOfAvailable: av > 0 ? Math.round(amount / av * 100) : null,
      monthsToAfford: (after < 0 && avg > 0) ? Math.ceil(-after / avg) : null,
      recurringNet: o.recurring ? round2(avg - amount) : null
    };
  }

  /* ---------- backup / restore ---------- */
  function exportObject(state) {
    return { app: 'A3 FinCanvas', version: 2, exportedAt: new Date().toISOString(), data: state };
  }

  function validateBackup(raw) {
    var errors = [];
    function err(m) { if (errors.length < 12) errors.push(m); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['This is not a FinCanvas backup (expected a JSON object).'] };
    var d = (raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)) ? raw.data : raw;
    if (!Array.isArray(d.transactions)) err('Missing the "transactions" list.');
    if (d.goals != null && !Array.isArray(d.goals)) err('"goals" must be a list.');
    if (d.budgets != null && (typeof d.budgets !== 'object' || Array.isArray(d.budgets))) err('"budgets" must be an object.');
    if (errors.length) return { ok: false, errors: errors };

    var state = emptyState();
    if (d.openingBalance != null) {
      var ob = validateOpeningBalance(d.openingBalance);
      if (!ob.ok) err('Opening balance: ' + ob.error); else state.openingBalance = ob.value;
    }
    if (d.allowance != null) {
      var al = validateAmount(d.allowance, { label: 'Allowance', allowZero: true });
      if (!al.ok) err('Allowance: ' + al.error); else state.allowance = al.value;
    }
    if (d.budgets) {
      Object.keys(d.budgets).forEach(function (k) {
        if (EXPENSE_CATEGORIES.indexOf(k) < 0) return;
        var b = validateAmount(d.budgets[k], { label: 'Budget for ' + k, allowZero: true });
        if (!b.ok) err(b.error); else if (b.value > 0) state.budgets[k] = b.value;
      });
    }

    var goalIds = {}, legacy = [];
    (d.goals || []).forEach(function (g, i) {
      var n = 'Goal #' + (i + 1) + ': ';
      if (!g || typeof g !== 'object') return err(n + 'not a valid goal.');
      var name = str(g.name).trim().slice(0, 50);
      if (!name) err(n + 'missing name.');
      var t = validateAmount(g.target, { label: 'target' });
      if (!t.ok) err(n + t.error);
      var date = str(g.date).trim();
      if (date && !isValidDate(date)) err(n + 'invalid target date.');
      var id = str(g.id).trim() || uid();
      if (goalIds[id]) err(n + 'duplicate id.');
      goalIds[id] = 1;
      if (name && t.ok) state.goals.push({ id: id, name: name, target: t.value, date: date, created: str(g.created) || todayStr() });
      if (g.saved != null && Number(g.saved) > 0 && t.ok) legacy.push({ goalId: id, amount: Math.min(Number(g.saved), t.value) });
    });

    var seen = {};
    d.transactions.forEach(function (t, i) {
      var n = 'Transaction #' + (i + 1) + ': ';
      if (!t || typeof t !== 'object') return err(n + 'not a valid record.');
      if (['income', 'expense', 'transfer'].indexOf(t.type) < 0) return err(n + 'type must be income, expense or transfer.');
      var a = validateAmount(t.amount, { label: 'amount', allowNegative: t.type === 'transfer' });
      if (!a.ok) return err(n + a.error);
      var date = str(t.date).trim();
      if (!isValidDate(date)) return err(n + 'invalid date "' + date.slice(0, 20) + '".');
      var id = str(t.id).trim() || uid();
      if (seen[id]) return err(n + 'duplicate id.');
      seen[id] = 1;
      var rec = { id: id, type: t.type, title: str(t.title).trim().slice(0, 80) || (t.type === 'transfer' ? 'Goal transfer' : 'Untitled'), amount: a.value, date: date, category: str(t.category), note: str(t.note).trim().slice(0, 200) };
      if (t.type === 'transfer') {
        if (!goalIds[t.goalId]) return err(n + 'refers to a goal that is not in the file.');
        rec.goalId = t.goalId; rec.category = 'Savings';
      } else {
        var cats = t.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
        if (cats.indexOf(rec.category) < 0) rec.category = 'Other';
      }
      state.transactions.push(rec);
    });
    if (errors.length) return { ok: false, errors: errors };
    legacy.forEach(function (l) {
      state.transactions.push({ id: uid(), type: 'transfer', title: 'Imported goal savings', amount: round2(l.amount), date: todayStr(), category: 'Savings', note: '', goalId: l.goalId });
    });
    return { ok: true, state: state };
  }

  function sig(t) { return [t.type, t.date, t.amount, t.title, t.category, t.goalId || ''].join('|'); }
  function mergeStates(current, incoming) {
    var out = clone(current), ids = {}, sigs = {}, goalIds = {};
    var added = { transactions: 0, goals: 0 }, skipped = { transactions: 0, goals: 0 };
    out.transactions.forEach(function (t) { ids[t.id] = 1; sigs[sig(t)] = 1; });
    out.goals.forEach(function (g) { goalIds[g.id] = 1; });
    incoming.goals.forEach(function (g) {
      if (goalIds[g.id]) { skipped.goals++; return; }
      out.goals.push(clone(g)); goalIds[g.id] = 1; added.goals++;
    });
    incoming.transactions.forEach(function (t) {
      if (ids[t.id] || sigs[sig(t)] || (t.type === 'transfer' && !goalIds[t.goalId])) { skipped.transactions++; return; }
      out.transactions.push(clone(t)); ids[t.id] = 1; sigs[sig(t)] = 1; added.transactions++;
    });
    Object.keys(incoming.budgets).forEach(function (k) { if (out.budgets[k] == null) out.budgets[k] = incoming.budgets[k]; });
    return { state: out, added: added, skipped: skipped };
  }

  function csvCell(v, isText) {
    var s = str(v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(state) {
    var names = {}; state.goals.forEach(function (g) { names[g.id] = g.name; });
    var rows = [['Date', 'Type', 'Title', 'Category', 'Amount', 'Note', 'Goal'].join(',')];
    state.transactions.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (t) {
      rows.push([csvCell(t.date), csvCell(t.type), csvCell(t.title, true), csvCell(t.category, true), csvCell(t.amount), csvCell(t.note, true), csvCell(t.goalId ? names[t.goalId] || '' : '', true)].join(','));
    });
    return rows.join('\n');
  }

  var Calc = {
    MAX_AMOUNT: MAX_AMOUNT, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES, INCOME_CATEGORIES: INCOME_CATEGORIES,
    uid: uid, clone: clone, round2: round2, toNumber: toNumber, todayStr: todayStr, isValidDate: isValidDate, monthKey: monthKey, addMonths: addMonths,
    validateAmount: validateAmount, validateTransaction: validateTransaction, validateOpeningBalance: validateOpeningBalance,
    validateGoal: validateGoal, validateContribution: validateContribution, validateWithdrawal: validateWithdrawal,
    emptyState: emptyState, periodRange: periodRange, inRange: inRange, sumType: sumType,
    balance: balance, allocated: allocated, available: available, goalSaved: goalSaved, savingsRate: savingsRate,
    categoryTotals: categoryTotals, monthlySeries: monthlySeries, budgetStatus: budgetStatus, goalProgress: goalProgress,
    avgMonthlyNet: avgMonthlyNet, whatIf: whatIf,
    exportObject: exportObject, validateBackup: validateBackup, mergeStates: mergeStates, toCSV: toCSV
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
