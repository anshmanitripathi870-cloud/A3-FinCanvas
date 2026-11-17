/* A³ FinCanvas — fx.js : motion & graphics layer.
   Purely additive: it never touches app data or logic, only decorates what app.js renders.
   Remove the <link>/<script> tags for fx.css / fx.js and the app works exactly as before. */
(function () {
  'use strict';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };

  /* ---------- ambient background blobs ---------- */
  if (!reduce) {
    var bg = document.createElement('div'); bg.className = 'fx-bg'; bg.setAttribute('aria-hidden', 'true');
    bg.innerHTML = '<i></i><i></i><i></i>';
    document.body.insertBefore(bg, document.body.firstChild);
  }

  /* ---------- Chart.js defaults: smoother, staggered, nicer hover ---------- */
  var inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  if (window.Chart && !reduce) {
    var C = window.Chart;
    Object.assign(C.defaults.animation, {
      duration: 1100, easing: 'easeOutQuart',
      delay: function (ctx) { return ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 90 + ctx.datasetIndex * 70 : 0; }
    });
    C.defaults.elements.arc.hoverOffset = 12;
    C.defaults.plugins.tooltip.cornerRadius = 10;
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.displayColors = true;
    C.defaults.plugins.tooltip.boxPadding = 4;
    C.defaults.transitions.active.animation.duration = 220;

    // Centre label for doughnut charts: total spent, fading in after the sweep
    C.register({
      id: 'fxCenter',
      afterDraw: function (chart) {
        if (chart.config.type !== 'doughnut') return;
        var ds = chart.data.datasets[0]; if (!ds) return;
        var total = ds.data.reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
        var meta = chart.getDatasetMeta(0), arc = meta && meta.data && meta.data[0]; if (!arc) return;
        var ctx = chart.ctx, cs = getComputedStyle(document.documentElement);
        var started = chart.$fxT0 || (chart.$fxT0 = performance.now());
        var a = Math.min(1, Math.max(0, (performance.now() - started - 500) / 500));
        if (a <= 0) return;
        ctx.save(); ctx.globalAlpha = a; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = cs.getPropertyValue('--muted').trim() || '#94a3b8'; ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillText('Total spent', arc.x, arc.y - 14);
        ctx.fillStyle = cs.getPropertyValue('--text').trim() || '#0f172a'; ctx.font = '800 22px Inter, system-ui, sans-serif';
        ctx.fillText(inrFmt.format(total), arc.x, arc.y + 10);
        ctx.restore();
      }
    });
  }

  /* ---------- count-up numbers ---------- */
  var prevVals = {};            // key -> last numeric value shown (so edits tick from old → new)
  function parseNum(text) {
    var m = text.match(/\d[\d,]*(?:\.\d+)?/); if (!m) return null;
    return { i: m.index, len: m[0].length, v: parseFloat(m[0].replace(/,/g, '')), dec: (m[0].split('.')[1] || '').length };
  }
  function countUp(el, from, dur) {
    var orig = el.textContent, p = parseNum(orig); if (!p) return;
    var pre = orig.slice(0, p.i), post = orig.slice(p.i + p.len), to = p.v;
    if (from === to) return;
    var f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec });
    var t0 = null; dur = dur || 900;
    el.classList.add('fx-counting');
    (function step(ts) {
      if (!el.isConnected) return;
      if (t0 === null) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur), cur = from + (to - from) * ease(k);
      el.textContent = pre + f.format(k < 1 ? cur : to) + post;
      if (k < 1) requestAnimationFrame(step); else { el.textContent = orig; el.classList.remove('fx-counting'); }
    })(performance.now());
  }
  function runCounters(root, fresh, viewKey) {
    $$('.eq-item strong, .stat strong, .goal .big', root).forEach(function (el, i) {
      var p = parseNum(el.textContent); if (!p) return;
      var key = viewKey + '#' + i, old = prevVals[key];
      prevVals[key] = p.v;
      if (fresh) countUp(el, 0, 1000 + Math.min(i, 6) * 60);
      else if (typeof old === 'number' && old !== p.v) countUp(el, old, 700);
    });
  }

  /* ---------- staggered scroll-reveal for each freshly shown view ---------- */
  var io = null;
  function reveal(root) {
    var seen = new Set(), targets = [];
    $$('.stack > *, .grid2 > *, .grid4 > *, .goals > *, .set-grid > *, .set-grid .stack > *', root).forEach(function (n) { if (!seen.has(n)) { seen.add(n); targets.push(n); } });
    if (!targets.length) return;
    if (io) io.disconnect();
    var batch = 0;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var n = en.target; io.unobserve(n);
        n.style.setProperty('--fx-d', (batch++ % 6) * 0.08 + 's');
        n.classList.add('fx-in');
        n.addEventListener('animationend', function done(e) {
          if (e.target !== n) return;
          n.removeEventListener('animationend', done); n.classList.remove('fx-hide', 'fx-in'); n.style.removeProperty('--fx-d');
        });
        setTimeout(function () { batch = 0; }, 400);
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -4% 0px' });
    targets.forEach(function (n) { n.classList.add('fx-hide'); io.observe(n); });
  }
  function animateBars(root) {
    $$('.progress i', root).forEach(function (bar, i) {
      var w = bar.style.width; if (!w) return;
      bar.style.width = '0%';
      setTimeout(function () { bar.style.width = w; }, 250 + i * 70);
    });
  }

  /* ---------- watch the view container ---------- */
  var lastKey = '', lastGoalsDone = null;
  var view = $('#view');
  function onViewChanged() {
    var title = ($('#viewTitle') || {}).textContent || '', per = ($('#period') || {}).value || '';
    var key = title + '|' + per, fresh = key !== lastKey; lastKey = key;
    if (!reduce) {
      runCounters(view, fresh, title);
      if (fresh) { reveal(view); animateBars(view); }
    }
    // celebrate a goal that has just been completed
    if (title === 'Savings goals') {
      var done = $$('.goal .badge.good', view).length;
      if (lastGoalsDone !== null && done > lastGoalsDone && !fresh) confetti();
      lastGoalsDone = done;
    } else lastGoalsDone = null;
  }
  if (view) new MutationObserver(onViewChanged).observe(view, { childList: true });

  // forget "last view" when the app is hidden (logout) so the next login animates fresh
  var appEl = $('#app');
  if (appEl) new MutationObserver(function () { if (appEl.hidden) { lastKey = ''; prevVals = {}; } }).observe(appEl, { attributes: true, attributeFilter: ['hidden'] });

  /* ---------- what-if verdict: animate only when the verdict changes ---------- */
  var wiLast = '';
  document.addEventListener('input', function (e) {
    if (!e.target.closest || !e.target.closest('#wiForm')) return;
    requestAnimationFrame(function () {
      var v = $('#wiResult .verdict'); if (!v) { wiLast = ''; return; }
      var cls = v.className.replace('verdict', '').trim();
      if (cls !== wiLast) { wiLast = cls; v.classList.add('fx-new'); }
    });
  });

  /* ---------- pointer effects: glow, tilt, ripple, hero parallax ---------- */
  if (!reduce && finePointer) {
    document.addEventListener('pointermove', function (e) {
      var card = e.target.closest && e.target.closest('.card, .eq-item.hero');
      if (card) {
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', (e.clientX - r.left) + 'px'); card.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }
      var tilt = e.target.closest && e.target.closest('.stat, .goal, .hero-card');
      if (tilt && !tilt.closest('dialog')) {
        var b = tilt.getBoundingClientRect(), x = (e.clientX - b.left) / b.width - .5, y = (e.clientY - b.top) / b.height - .5;
        tilt.classList.add('fx-tilting');
        tilt.style.transform = 'perspective(700px) rotateX(' + (-y * 7).toFixed(2) + 'deg) rotateY(' + (x * 9).toFixed(2) + 'deg) translateY(-3px)';
      }
      var hero = $('.auth-hero');
      if (hero && !$('#auth').hidden) {
        var hb = hero.getBoundingClientRect();
        hero.style.setProperty('--px', ((e.clientX - hb.left) / hb.width - .5).toFixed(3));
        hero.style.setProperty('--py', ((e.clientY - hb.top) / hb.height - .5).toFixed(3));
        var coins = $('.fx-coins', hero); if (coins) { coins.style.setProperty('--px', hero.style.getPropertyValue('--px')); coins.style.setProperty('--py', hero.style.getPropertyValue('--py')); }
      }
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      var tilt = e.target.closest && e.target.closest('.stat, .goal, .hero-card');
      if (tilt && !tilt.contains(e.relatedTarget)) { tilt.style.transform = ''; tilt.classList.remove('fx-tilting'); }
    });
  }
  document.addEventListener('pointerdown', function (e) {
    if (reduce) return;
    var btn = e.target.closest && e.target.closest('.btn'); if (!btn || btn.disabled) return;
    var r = btn.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2.2;
    var s = document.createElement('span'); s.className = 'fx-ripple';
    s.style.cssText = 'width:' + size + 'px;height:' + size + 'px;left:' + (e.clientX - r.left - size / 2) + 'px;top:' + (e.clientY - r.top - size / 2) + 'px';
    btn.appendChild(s); setTimeout(function () { s.remove(); }, 650);
  });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-action=theme]');
    if (!t || reduce) return;
    t.classList.remove('spin'); void t.offsetWidth; t.classList.add('spin');
    var h = document.documentElement; h.classList.add('fx-theme'); setTimeout(function () { h.classList.remove('fx-theme'); }, 600);
  }, true);

  /* ---------- login hero: coins + counter ---------- */
  // keep coins to the edges/right so they don't drift across the headline text
  function coinLeft() { return Math.random() < .3 ? Math.round(Math.random() * 10) : 62 + Math.round(Math.random() * 32); }
  function buildCoins() {
    var hero = $('.auth-hero'); if (!hero || $('.fx-coins', hero) || reduce) return;
    var wrap = document.createElement('div'); wrap.className = 'fx-coins'; wrap.setAttribute('aria-hidden', 'true');
    var n = window.innerWidth < 960 ? 6 : 12, html = '';
    for (var i = 0; i < n; i++) {
      var s = 22 + Math.round(Math.random() * 40), t = 14 + Math.random() * 14, d = -Math.random() * t;
      html += '<span class="fx-coin' + (s < 32 ? ' sm' : '') + '" style="--s:' + s + 'px;--t:' + t.toFixed(1) + 's;--d:' + d.toFixed(1) + 's;--dx:' + Math.round((Math.random() - .5) * 120) + 'px;left:' + coinLeft() + '%">₹</span>';
    }
    wrap.innerHTML = html; hero.insertBefore(wrap, hero.firstChild);
  }
  function heroCounter() {
    var s = $('.hero-card strong'); if (!s || reduce) return;
    if (!s.dataset.fx) { s.dataset.fx = s.textContent; }
    s.textContent = s.dataset.fx;
    setTimeout(function () { countUp(s, 0, 1800); }, 900);
  }
  buildCoins();
  var authEl = $('#auth');
  if (authEl) {
    new MutationObserver(function () { if (!authEl.hidden) heroCounter(); }).observe(authEl, { attributes: true, attributeFilter: ['hidden'] });
    if (!authEl.hidden) heroCounter();
  }

  /* ---------- confetti ---------- */
  function confetti() {
    if (reduce) return;
    var cv = $('#fxConfetti');
    if (!cv) { cv = document.createElement('canvas'); cv.id = 'fxConfetti'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv); }
    var dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr, ctx = cv.getContext('2d');
    var colors = ['#4f46e5', '#0891b2', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6'], ps = [];
    for (var i = 0; i < 150; i++) {
      var side = i % 2 ? 1 : -1;
      ps.push({ x: W / 2 + side * W * .05, y: H * .62, vx: (Math.random() * 9 + 3) * side * dpr * (Math.random() > .5 ? 1 : -.6), vy: -(Math.random() * 15 + 9) * dpr,
        g: .38 * dpr, w: (5 + Math.random() * 6) * dpr, h: (3 + Math.random() * 5) * dpr, r: Math.random() * 6.28, vr: (Math.random() - .5) * .35, c: colors[i % colors.length], life: 1 });
    }
    var t0 = performance.now();
    (function frame(now) {
      var el = now - t0; ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.vy += p.g; p.vx *= .992; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life = Math.max(0, 1 - Math.max(0, el - 1600) / 1400);
        ctx.save(); ctx.globalAlpha = p.life; ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (el < 3000) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }
  window.FinFX = { confetti: confetti };
})();
