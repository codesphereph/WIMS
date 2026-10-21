/* CPU WIMS — application (router, portals, views, real-time sync, PWA install). */
(function () {
  'use strict';
  const CFG = Object.assign({ APP_NAME: 'Warehouse Inventory Management System (WIMS)', SHORT_NAME: 'CPU WIMS', ORG_NAME: 'Central Philippine University', ORG_PLACE: 'Iloilo City', CURRENCY: 'PHP', LOCALE: 'en-PH', POLL_SECONDS: 10 }, window.WMS_CONFIG || {});
  const I = window.Icons;
  const APP_VERSION = '1.1.1';

  const ROLE_META = {
    requisitioner: { label: 'Requisition Portal', short: 'Requisitioner', desc: 'Request supplies and track approvals', icon: 'clipboard', cls: 'c-blue' },
    custodian: { label: 'Custodian Portal', short: 'Custodian', desc: 'Receive, issue, count and monitor stock', icon: 'box', cls: 'c-amber' },
    admin: { label: 'Admin Portal', short: 'Administrator', desc: 'Approvals, analytics, users and settings', icon: 'shield', cls: 'c-violet' }
  };

  const S = {
    session: null, data: emptyData(), version: null, A: null, view: null, sub: null, query: {},
    charts: [], lastSync: 0, online: navigator.onLine, syncing: false, anim: true, pendingRender: false,
    cart: [], seen: {}, knownTxn: null, knownReq: null, lowSet: null, freshTxn: new Set(), filters: {},
    pollTimer: null, liveTimer: null, simTimer: null, deferredPrompt: null, portal: 'custodian', countDraft: {}
  };
  function emptyData() { return { items: [], transactions: [], requisitions: [], counts: [], users: [], settings: {} }; }

  /* =============================== UTILITIES =============================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* quota */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  const user = () => (S.session ? S.session.user : null);
  const role = () => (user() ? user().role : null);
  const setting = (k) => (S.data.settings && S.data.settings[k] !== undefined ? S.data.settings[k] : undefined);
  const currency = () => setting('currency') || CFG.CURRENCY;
  const company = () => setting('companyName') || 'CPU Central Warehouse';
  const brandHTML = () => '<div class="brand"><div class="brand-mark"></div><div class="brand-txt"><b>' + esc(CFG.SHORT_NAME) + '</b><small>' + esc(CFG.ORG_NAME) + '</small></div></div>';
  const fmtCache = {};
  function nf(key, opts) { if (!fmtCache[key]) { try { fmtCache[key] = new Intl.NumberFormat(CFG.LOCALE, opts); } catch (e) { fmtCache[key] = new Intl.NumberFormat('en-US', Object.assign({}, opts, { style: 'decimal' })); } } return fmtCache[key]; }
  const money = (n, dec) => nf('m' + currency() + (dec === 0 ? 0 : 2), { style: 'currency', currency: currency(), minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec === 0 ? 0 : 2 }).format(+n || 0);
  const moneyShort = (n) => nf('ms' + currency(), { style: 'currency', currency: currency(), notation: 'compact', maximumFractionDigits: 1 }).format(+n || 0);
  const qty = (n) => nf('q', { maximumFractionDigits: 2 }).format(+n || 0);
  const pct = (n, d) => ((+n || 0) * 100).toFixed(d || 0) + '%';
  const signed = (n, f) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
  function fdate(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleDateString(CFG.LOCALE, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function fdt(s) { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? esc(s) : d.toLocaleString(CFG.LOCALE, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function rel(s) {
    const t = typeof s === 'number' ? s : Date.parse(s); if (!t) return '—';
    const d = (Date.now() - t) / 1000;
    if (d < 45) return 'just now'; if (d < 3600) return Math.round(d / 60) + 'm ago';
    if (d < 86400) return Math.round(d / 3600) + 'h ago'; if (d < 604800) return Math.round(d / 86400) + 'd ago';
    return fdate(t);
  }
  const initials = (n) => String(n || '?').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const cover = (r) => (r.cover === Infinity ? 'No usage' : r.cover <= 0 ? '0 days' : (r.cover < 1 ? '<1 day' : Math.round(r.cover) + ' days'));
  const debounce = (fn, ms) => { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; };
  const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const cssv = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  const CAT_PAIRS = [['#e8efff', '#1f5eff'], ['#fff3dc', '#b26b00'], ['#e0f7f3', '#0f8a7b'], ['#efebff', '#6a48f0'], ['#fdeaea', '#c62f34'], ['#e5f4fc', '#1c7fb5'], ['#fff0e2', '#c2620a'], ['#eef1f5', '#4a5b75']];
  const CAT_PAIRS_DARK = [['#1a2a4f', '#7ea4ff'], ['#3a2a0c', '#ffbf55'], ['#0f3a35', '#3fd8c3'], ['#241d4a', '#a993ff'], ['#3a1619', '#ff7d82'], ['#0f2d42', '#6cc3f2'], ['#3a230c', '#ffad5c'], ['#1e2a3f', '#a5b4cc']];
  const PALETTE = ['#1f5eff', '#f5a524', '#12a594', '#7c5cff', '#e0393e', '#2f9fd8', '#f08c1c', '#8a9bb5', '#16a34a', '#c026d3'];
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function catColor(c) { const set = document.documentElement.dataset.theme === 'dark' ? CAT_PAIRS_DARK : CAT_PAIRS; return set[hashStr(c || 'General') % set.length]; }
  function thumb(it, cls) { const [bg, fg] = catColor(it.category); return '<div class="thumb ' + (cls || '') + '" style="background:' + bg + ';color:' + fg + '">' + esc(initials(it.name)) + '</div>'; }

  const STATUS_CHIP = { 'In Stock': 'c-green', 'Low Stock': 'c-amber', 'Out of Stock': 'c-red', Overstock: 'c-blue' };
  const MOVE_CHIP = { Fast: 'c-green', Slow: 'c-amber', 'Non-moving': 'c-gray' };
  const COND_CHIP = { Good: 'c-green', Damaged: 'c-red', 'Non-functional': 'c-red', Obsolete: 'c-gray' };
  const REQ_CHIP = { Pending: 'c-amber', Endorsed: 'c-blue', Approved: 'c-violet', 'Partially Issued': 'c-blue', Issued: 'c-green', Rejected: 'c-red', Cancelled: 'c-gray' };
  const PRIO_CHIP = { Low: 'c-gray', Normal: 'c-blue', High: 'c-amber', Urgent: 'c-red' };
  const SALV_CHIP = { 'Recommend Salvage': 'c-red', 'Recommend Disposal': 'c-gray', 'Review for Salvage': 'c-amber' };
  const ABC_CHIP = { A: 'c-violet', B: 'c-blue', C: 'c-gray' };
  const TXN = {
    IN: { label: 'Stock In', icon: 'in', cls: 'c-green' }, OUT: { label: 'Stock Out', icon: 'out', cls: 'c-amber' },
    ADJ: { label: 'Adjustment', icon: 'scale', cls: 'c-blue' }, SALVAGE: { label: 'Salvage', icon: 'recycle', cls: 'c-red' },
    COND: { label: 'Condition', icon: 'tool', cls: 'c-violet' }
  };
  const chip = (t, cls, dot) => '<span class="chip ' + (cls || '') + '">' + (dot === false ? '' : '<i class="dot"></i>') + esc(t) + '</span>';
  const empty = (icon, title, text, extra) => '<div class="empty"><div class="e-ic">' + I(icon, 26) + '</div><b>' + esc(title) + '</b>' + esc(text || '') + (extra || '') + '</div>';

  /* =============================== TOASTS / MODALS =============================== */
  function toast(title, o) {
    o = o || {};
    const map = { success: ['check', 'c-green'], error: ['alert', 'c-red'], warn: ['alert', 'c-amber'], info: ['info', 'c-blue'], live: ['activity', 'c-violet'] };
    const [ic, cls] = map[o.type || 'info'];
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<div class="t-ic ' + cls + '">' + I(ic, 16) + '</div><div class="grow"><b>' + esc(title) + '</b>' + (o.body ? '<span class="muted small">' + esc(o.body) + '</span>' : '') + '</div>';
    el.addEventListener('click', () => { if (o.href) location.hash = o.href; dismiss(); });
    $('#toasts').appendChild(el);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    function dismiss() { el.classList.add('out'); setTimeout(() => el.remove(), 260); }
    setTimeout(dismiss, o.timeout || 4200);
  }
  const toastErr = (e) => toast(e && e.message ? e.message : 'Something went wrong', { type: 'error' });

  function modal(o) {
    const root = $('#modal-root');
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal ' + (o.wide ? 'wide' : '') + '" role="dialog" aria-modal="true"><div class="modal-h"><div class="grow"><h3>' + o.title + '</h3>' +
      (o.sub ? '<div class="sub">' + o.sub + '</div>' : '') + '</div><button class="btn btn-ghost btn-icon" data-close aria-label="Close">' + I('x') + '</button></div>' +
      '<div class="modal-b">' + (o.body || '') + '</div>' + (o.foot ? '<div class="modal-f">' + o.foot + '</div>' : '') + '</div>';
    root.appendChild(bg);
    document.body.style.overflow = 'hidden';
    const m = { el: bg, $: (s) => bg.querySelector(s), $$: (s) => $$(s, bg), charts: [] };
    m.close = function () {
      m.charts.forEach((c) => c.destroy());
      bg.remove();
      if (!root.children.length) document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose();
      if (!root.children.length && S.pendingRender) { S.pendingRender = false; renderView(true); }
    };
    function onKey(e) { if (e.key === 'Escape' && root.lastChild === bg) m.close(); }
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) m.close(); });
    bg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) m.close(); });
    const first = bg.querySelector('.modal-b input:not([type=checkbox]), .modal-b textarea');
    if (first && matchMedia('(min-width: 900px)').matches) setTimeout(() => first.focus(), 60);
    return m;
  }
  const modalOpen = () => !!$('#modal-root .modal-bg');

  function ask(title, msg, o) {
    o = o || {};
    return new Promise((resolve) => {
      let done = false;
      const m = modal({
        title: esc(title),
        body: '<p style="margin:0 0 12px">' + msg + '</p>' + (o.input ? '<label class="field"><span>' + esc(o.inputLabel || 'Note') + (o.required ? ' *' : ' (optional)') + '</span><textarea class="input" id="askInput" placeholder="' + esc(o.placeholder || '') + '"></textarea></label>' : ''),
        foot: '<button class="btn" data-close>Cancel</button><button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" id="askOk">' + esc(o.ok || 'Confirm') + '</button>',
        onClose: () => { if (!done) resolve(null); }
      });
      m.$('#askOk').addEventListener('click', () => {
        const v = o.input ? m.$('#askInput').value.trim() : '';
        if (o.required && !v) { m.$('#askInput').focus(); m.$('#askInput').style.borderColor = 'var(--danger)'; return; }
        done = true; m.close(); resolve({ value: v });
      });
    });
  }

  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn._h = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>' + esc(btn.dataset.busy || 'Saving…'); }
    try { return await fn(); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = btn._h; } }
  }

  function downloadCSV(name, headers, rows) {
    const e = (v) => { const s = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = [headers.map(e).join(',')].concat(rows.map((r) => r.map(e).join(','))).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name + '-' + todayISO() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('Export ready', { type: 'success', body: a.download });
  }

  /* =============================== CHARTS =============================== */
  function chart(id, cfg, host) {
    const c = document.getElementById(id);
    if (!c) return null;
    if (!window.Chart) { c.parentElement.innerHTML = '<div class="no-chart">Charts are loading…</div>'; return null; }
    Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = cssv('--muted');
    Chart.defaults.borderColor = cssv('--border');
    const ch = new Chart(c, cfg);
    (host || S.charts).push(ch);
    return ch;
  }
  function destroyCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
  function axisOpts(o) {
    o = o || {};
    const valueTicks = { maxTicksLimit: 6 };
    if (o.money) valueTicks.callback = (v) => moneyShort(v);
    const catTicks = { maxRotation: 0, autoSkip: true, maxTicksLimit: o.horizontal ? 12 : 8 };
    if (o.horizontal) catTicks.callback = function (v) { const l = String(this.getLabelForValue(v)); return l.length > 24 ? l.slice(0, 23) + '…' : l; };
    const val = { grid: { color: cssv('--border') }, border: { display: false }, ticks: valueTicks, beginAtZero: true };
    const cat = { grid: { display: false }, border: { display: false }, ticks: catTicks };
    return o.horizontal ? { x: val, y: cat } : { x: cat, y: val };
  }
  function barOpts(o) {
    o = o || {};
    return {
      responsive: true, maintainAspectRatio: false, animation: S.anim ? { duration: 700 } : false,
      indexAxis: o.horizontal ? 'y' : 'x', interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: o.legend !== false, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 14 } },
        tooltip: { callbacks: { label: (ctx) => (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + (o.money ? money(ctx.parsed[o.horizontal ? 'x' : 'y']) : qty(ctx.parsed[o.horizontal ? 'x' : 'y'])) } }
      },
      scales: axisOpts(o)
    };
  }
  function doughnutOpts(o) {
    o = o || {};
    return {
      responsive: true, maintainAspectRatio: false, cutout: '68%', animation: S.anim ? { duration: 800 } : false,
      plugins: {
        legend: { position: matchMedia('(max-width: 600px)').matches ? 'bottom' : 'right', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 12 } },
        tooltip: { callbacks: { label: (ctx) => ctx.label + ': ' + (o.money ? money(ctx.parsed) : qty(ctx.parsed)) } }
      }
    };
  }
  function sparkline(arr, color) {
    const w = 130, h = 44, max = Math.max(1, ...arr);
    const pts = arr.map((v, i) => [(i / Math.max(1, arr.length - 1)) * w, h - 4 - (v / max) * (h - 10)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + d + ' L' + w + ' ' + h + ' L0 ' + h + 'Z" fill="' + color + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2"/></svg>';
  }
  function countUp(root) {
    if (!S.anim) return;
    $$('[data-count]', root).forEach((el) => {
      const target = +el.dataset.count; const f = el.dataset.fmt; const t0 = performance.now();
      const fmt = (v) => (f === 'money' ? money(v, 0) : f === 'pct' ? pct(v) : Math.round(v).toLocaleString(CFG.LOCALE));
      (function step(t) { const p = Math.min(1, (t - t0) / 900); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(target * e); if (p < 1) requestAnimationFrame(step); })(t0);
    });
  }

  /* =============================== SESSION & SYNC =============================== */
  async function call(action, payload) {
    try { return await API.call(action, payload, S.session && S.session.token); } catch (e) {
      if (e.code === 'AUTH' && S.session) { toast('Session expired', { type: 'warn', body: 'Please sign in again.' }); logout(true); }
      throw e;
    }
  }

  async function sync(force) {
    if (!S.session || S.syncing) return;
    S.syncing = true;
    try {
      const r = await call('sync', { since: force ? '' : S.version });
      S.online = true; S.lastSync = Date.now();
      if (r.changed) {
        S.data = { items: r.items || [], transactions: r.transactions || [], requisitions: r.requisitions || [], counts: r.counts || [], users: r.users || [], settings: r.settings || {} };
        S.version = r.version;
        recompute();
        detectEvents();
        LS.set('sp_snap', { v: S.version, u: user().id, d: S.data });
        onDataChanged();
      }
    } catch (e) {
      if (e.code === 'NETWORK') S.online = false; else if (e.code !== 'AUTH') console.warn('sync', e);
    } finally { S.syncing = false; updateLive(); }
  }
  function recompute() { S.A = Analytics.compute(S.data, S.data.settings); }

  async function write(action, payload, btn, okMsg) {
    try {
      const res = await busy(btn, () => call(action, payload));
      if (okMsg) toast(okMsg.title || okMsg, { type: 'success', body: okMsg.body });
      await sync(true);
      return res;
    } catch (e) { toastErr(e); throw e; }
  }

  function detectEvents() {
    const d = S.data; const me = user().name; const r = role();
    const lowNow = new Set(S.A.low.concat(S.A.out).map((x) => x.id));
    if (S.knownTxn === null) {
      S.knownTxn = new Set(d.transactions.map((t) => t.id));
      S.knownReq = {}; d.requisitions.forEach((q) => { S.knownReq[q.id] = q.status; });
      S.lowSet = lowNow;
      return;
    }
    const fresh = d.transactions.filter((t) => !S.knownTxn.has(t.id));
    fresh.forEach((t) => S.knownTxn.add(t.id));
    S.freshTxn = new Set(fresh.map((t) => t.id));
    const others = fresh.filter((t) => t.userName !== me && t.type !== 'COND');
    if (others.length && r !== 'requisitioner') {
      const t = others[others.length - 1];
      const title = TXN[t.type].label + ': ' + qty(Math.abs(t.qty)) + ' × ' + t.itemName;
      const body = t.userName + ' · ' + money(Math.abs(t.totalCost)) + (others.length > 1 ? ' · +' + (others.length - 1) + ' more' : '');
      toast(title, { type: 'live', body, href: '#/movements' });
      notifyOS(title, body);
    }
    if (r !== 'requisitioner') {
      lowNow.forEach((id) => {
        if (!S.lowSet.has(id)) { const it = S.A.byId[id]; if (it) { const t = (it.qty <= 0 ? 'Out of stock: ' : 'Low stock: ') + it.name; toast(t, { type: 'warn', body: qty(it.qty) + ' ' + it.unit + ' left · reorder at ' + it.reorderLevel, href: '#/alerts' }); notifyOS(t, qty(it.qty) + ' ' + it.unit + ' left'); } }
      });
    }
    S.lowSet = lowNow;
    d.requisitions.forEach((q) => {
      const prev = S.knownReq[q.id];
      if (prev === q.status) return;
      S.knownReq[q.id] = q.status;
      const last = q.history[q.history.length - 1] || {};
      if (last.by === me) return;
      let msg = null;
      if (r === 'requisitioner') msg = 'Your request ' + q.reqNo + ' is now ' + q.status;
      else if (r === 'custodian' && q.status === 'Pending') msg = 'New requisition ' + q.reqNo + ' from ' + q.requesterName;
      else if (r === 'custodian' && q.status === 'Approved') msg = q.reqNo + ' approved — ready to issue';
      else if (r === 'admin' && q.status === 'Endorsed') msg = q.reqNo + ' endorsed — awaiting your approval';
      else if (r === 'admin' && q.status === 'Pending' && !prev) msg = 'New requisition ' + q.reqNo + ' from ' + q.requesterName;
      if (msg) { toast(msg, { type: q.status === 'Rejected' ? 'warn' : 'info', body: q.purpose, href: '#/requests' }); notifyOS(msg, q.purpose); }
    });
  }

  function notifyOS(title, body) {
    if (!document.hidden || !('Notification' in window) || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png', tag: 'sp-' + title }));
    } else { try { new Notification(title, { body, icon: 'icons/icon-192.png' }); } catch (e) { /* ignore */ } }
  }

  function onDataChanged() {
    renderNav();
    const v = VIEWS[S.view];
    if (!v || !S.A) return;
    if (v.form) { if (v.onSync) v.onSync(); return; }
    if (modalOpen() || isTyping()) { S.pendingRender = true; return; }
    renderView(true);
  }
  function isTyping() { const a = document.activeElement; const vw = $('#view'); return !!(a && vw && vw.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }

  function updateLive() {
    const el = $('#live'); if (!el) return;
    const sec = pollSeconds();
    const age = S.lastSync ? Math.round((Date.now() - S.lastSync) / 1000) : null;
    el.classList.toggle('off', !S.online);
    el.classList.toggle('stale', S.online && (age === null || age > sec * 3));
    el.querySelector('span').textContent = !S.online ? 'Offline' : age === null ? 'Connecting…' : 'Live · ' + (age < 2 ? 'now' : age + 's');
    el.title = API.isDemo ? 'Demo data — synced across tabs in this browser' : 'Synced with Google Sheets every ' + sec + 's';
    const ob = $('#offline'); if (ob) ob.classList.toggle('hidden', S.online);
  }
  const pollSeconds = () => Math.max(3, +setting('pollSeconds') || CFG.POLL_SECONDS);

  function startTimers() {
    stopTimers();
    S.pollTimer = setInterval(() => { if (!document.hidden) sync(); }, pollSeconds() * 1000);
    S.liveTimer = setInterval(updateLive, 1000);
    if (API.isDemo) {
      const tick = () => {
        S.simTimer = setTimeout(() => {
          if (LS.get('sp_sim', true) && S.session && !document.hidden) { window.DemoBackend.simulateActivity(); sync(); }
          tick();
        }, 18000 + Math.random() * 22000);
      };
      tick();
    }
  }
  function stopTimers() { clearInterval(S.pollTimer); clearInterval(S.liveTimer); clearTimeout(S.simTimer); }

  function logout(silent) {
    if (!silent && S.session) call('logout', {}).catch(() => {});
    stopTimers(); destroyCharts();
    S.session = null; S.data = emptyData(); S.A = null; S.version = null; S.knownTxn = null;
    LS.del('sp_session'); LS.del('sp_snap');
    $('#modal-root').innerHTML = ''; document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    renderLogin();
  }

  /* =============================== THEME =============================== */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    LS.set('sp_theme', t);
    const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'dark' ? '#0a111e' : '#10218b';
  }
  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    const b = $('[data-act=theme]'); if (b) b.innerHTML = I(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
    if (S.session) renderView(true); else renderLogin();
  }

  /* =============================== LOGIN =============================== */
  function renderLogin() {
    document.title = CFG.SHORT_NAME + ' — Sign in';
    const portals = ['requisitioner', 'custodian', 'admin'];
    $('#app').innerHTML =
      '<div class="login">' +
      '<section class="login-hero">' + brandHTML() +
      '<div class="stack" style="gap:18px"><div class="org-seal"><img src="icons/cpu-logo.png" alt="Central Philippine University seal"><div><b>' + esc(CFG.ORG_NAME) + '</b><span>' + esc(CFG.ORG_PLACE) + ' · Scientia et Fides</span></div></div>' +
      '<h1>Warehouse Inventory <em>Management System</em></h1><div class="wims-tag">WIMS</div>' +
      '<p class="lead">Live warehouse monitoring for what comes in and what goes out, with cost, variance analysis, fast-mover insights, low-stock alerts and salvage recommendations.</p>' +
      '<svg class="pulse-line" viewBox="0 0 600 60" preserveAspectRatio="none"><path d="M0 32 H170 L190 32 L205 8 L222 54 L240 4 L258 50 L272 32 H600"/></svg>' +
      '<div class="hero-stats"><div class="hero-stat"><b>3 portals</b><span>Requisition · Custodian · Admin</span></div><div class="hero-stat"><b>Live sync</b><span>Updates every few seconds</span></div><div class="hero-stat"><b>Install it</b><span>Phone, tablet or desktop</span></div></div></div>' +
      '<div class="small" style="color:#aab4e6;position:relative;z-index:1">© ' + new Date().getFullYear() + ' ' + esc(CFG.ORG_NAME) + ' · ' + esc(CFG.SHORT_NAME) + ' v' + APP_VERSION + '</div></section>' +
      '<section class="login-panel"><div class="login-card"><h2>Welcome back</h2><p class="muted" style="margin:4px 0 0">Choose your portal, then sign in.</p>' +
      '<div class="portal-grid">' + portals.map((p) => { const m = ROLE_META[p]; return '<button type="button" class="portal ' + (S.portal === p ? 'active' : '') + '" data-portal="' + p + '"><span class="portal-ic ' + m.cls + '">' + I(m.icon, 22) + '</span><span><b>' + m.label + '</b><small>' + m.desc + '</small></span><span class="check">' + I('check', 13) + '</span></button>'; }).join('') + '</div>' +
      '<form id="loginForm" class="stack" autocomplete="on"><label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" required></label>' +
      '<label class="field"><span>PIN / Password</span><div class="search" style="position:relative"><input class="input" name="pin" type="password" autocomplete="current-password" required style="padding-right:44px"><button type="button" class="btn btn-ghost btn-icon btn-sm" id="pinEye" style="position:absolute;right:4px;top:5px" aria-label="Show PIN">' + I('eye', 16) + '</button></div></label>' +
      '<div class="small" id="loginErr" style="color:var(--danger);min-height:18px"></div>' +
      '<button class="btn btn-primary btn-lg btn-block" id="loginBtn" data-busy="Signing in…">' + I('lock', 17) + ' <span id="loginLbl">Enter ' + ROLE_META[S.portal].label + '</span></button></form>' +
      (API.isDemo ? '<div class="demo-note">' + I('info', 16) + '<div><b>Demo mode.</b> Sample data lives in this browser. Tapping a portal fills in its demo account. Open two portals in separate tabs to see live updates between them.</div></div>' : '') +
      '<div class="login-foot"><span>' + (API.isDemo ? 'Demo data' : 'Connected to Google Sheets') + '</span><span class="row" style="gap:4px"><button class="btn btn-ghost btn-sm" data-act="server">' + I('database', 15) + ' Data source</button><button class="btn btn-ghost btn-sm btn-icon" data-act="theme" aria-label="Toggle theme">' + I(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 16) + '</button></span></div>' +
      '</div></section></div>';

    const form = $('#loginForm');
    const fillDemo = () => { if (!API.isDemo) return; const acc = window.DemoBackend.accounts.find((a) => a.role === S.portal); form.username.value = acc.username; form.pin.value = acc.pin; };
    fillDemo();
    $$('.portal').forEach((b) => b.addEventListener('click', () => {
      S.portal = b.dataset.portal; LS.set('sp_portal', S.portal);
      $$('.portal').forEach((x) => x.classList.toggle('active', x === b));
      $('#loginLbl').textContent = 'Enter ' + ROLE_META[S.portal].label;
      $('#loginErr').textContent = '';
      fillDemo();
    }));
    $('#pinEye').addEventListener('click', () => { const t = form.pin.type === 'password'; form.pin.type = t ? 'text' : 'password'; $('#pinEye').innerHTML = I(t ? 'eyeOff' : 'eye', 16); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#loginErr').textContent = '';
      if (!form.reportValidity()) return;
      try {
        const r = await busy($('#loginBtn'), () => API.call('login', { username: form.username.value, pin: form.pin.value }));
        if (r.user.role !== S.portal) {
          API.call('logout', {}, r.token).catch(() => {});
          $('#loginErr').textContent = 'This account belongs to the ' + ROLE_META[r.user.role].label + '. Select that portal to continue.';
          return;
        }
        S.session = { token: r.token, user: r.user };
        LS.set('sp_session', S.session);
        location.hash = '';
        enterApp();
        toast('Welcome, ' + r.user.name.split(' ')[0] + '!', { type: 'success', body: ROLE_META[r.user.role].label });
      } catch (err) { $('#loginErr').textContent = err.message; }
    });
  }

  function serverModal() {
    const cur = API.url || '';
    const m = modal({
      title: 'Data source',
      sub: 'Connect the app to your Google Sheets backend (Apps Script Web App).',
      body: '<div class="stack"><div class="callout ' + (API.isDemo ? 'c-amber' : 'c-green') + '">' + I(API.isDemo ? 'info' : 'check', 16) + '<div>' + (API.isDemo ? 'Currently using <b>demo data</b> stored in this browser.' : 'Connected to <b>Google Sheets</b>.') + '</div></div>' +
        '<label class="field"><span>Apps Script Web App URL</span><input class="input mono" id="srvUrl" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(cur) + '"><span class="hint">Deploy → Manage deployments → Web app URL. Leave empty for demo mode.</span></label>' +
        '<div id="srvMsg" class="small"></div></div>',
      foot: '<button class="btn" id="srvTest">' + I('zap', 16) + ' Test</button><button class="btn" id="srvDemo">Use demo</button><button class="btn btn-primary" id="srvSave">Save &amp; reload</button>'
    });
    const msg = (t, ok) => { m.$('#srvMsg').innerHTML = '<span style="color:var(--' + (ok ? 'success' : 'danger') + ')">' + esc(t) + '</span>'; };
    m.$('#srvTest').addEventListener('click', async (e) => {
      const u = m.$('#srvUrl').value.trim(); if (!u) return msg('Enter a URL first.', false);
      try { await busy(e.currentTarget, () => API.test(u)); msg('Connection OK — the backend responded.', true); } catch (err) { msg('Could not connect: ' + err.message, false); }
    });
    m.$('#srvDemo').addEventListener('click', () => { API.setUrl(''); LS.del('sp_session'); LS.del('sp_snap'); location.reload(); });
    m.$('#srvSave').addEventListener('click', () => {
      const u = m.$('#srvUrl').value.trim();
      if (u && !/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) return msg('That does not look like an Apps Script URL.', false);
      API.setUrl(u); LS.del('sp_session'); LS.del('sp_snap'); location.reload();
    });
  }

  /* =============================== SHELL & NAV =============================== */
  const VIEWS = {
    dashboard: { title: 'Dashboard', icon: 'dashboard', roles: ['custodian', 'admin'], render: vDashboard },
    home: { title: 'Home', icon: 'home', roles: ['requisitioner'], render: vHome },
    catalog: { title: 'Catalog', icon: 'grid', roles: ['requisitioner', 'custodian', 'admin'], render: vCatalog, form: true, onSync: () => renderCatalogGrid() },
    requests: { title: () => ({ requisitioner: 'My Requests', custodian: 'Requisition Queue', admin: 'Approvals' }[role()]), icon: 'clipboard', roles: ['requisitioner', 'custodian', 'admin'], render: vRequests },
    inventory: { title: 'Inventory', icon: 'box', roles: ['custodian', 'admin'], render: vInventory },
    receive: { title: 'Stock In', icon: 'in', roles: ['custodian', 'admin'], render: (el) => vMove(el, 'IN'), form: true, onSync: () => renderMoveSide('IN') },
    issue: { title: 'Stock Out', icon: 'out', roles: ['custodian', 'admin'], render: (el) => vMove(el, 'OUT'), form: true, onSync: () => renderMoveSide('OUT') },
    counts: { title: 'Physical Count', icon: 'scan', roles: ['custodian', 'admin'], render: vCounts, form: true, onSync: () => renderCountHistory() },
    analytics: { title: 'Analytics', icon: 'chart', roles: ['custodian', 'admin'], render: vAnalytics },
    variance: { title: 'Variance Analysis', icon: 'scale', roles: ['custodian', 'admin'], render: vVariance },
    salvage: { title: 'Salvage & Condition', icon: 'recycle', roles: ['custodian', 'admin'], render: vSalvage },
    movements: { title: 'Movements', icon: 'list', roles: ['custodian', 'admin'], render: vMovements },
    alerts: { title: 'Alerts', icon: 'bell', roles: ['requisitioner', 'custodian', 'admin'], render: vAlerts },
    users: { title: 'Users', icon: 'users', roles: ['admin'], render: vUsers },
    settings: { title: 'Settings', icon: 'settings', roles: ['admin'], render: vSettings, form: true },
    profile: { title: 'My Account', icon: 'user', roles: ['requisitioner', 'custodian', 'admin'], render: vProfile, form: true }
  };
  const NAV = {
    requisitioner: [[null, ['home', 'catalog', 'requests', 'alerts']], ['Account', ['profile']]],
    custodian: [['Overview', ['dashboard', 'alerts']], ['Operations', ['requests', 'receive', 'issue', 'counts', 'inventory']], ['Insights', ['movements', 'analytics', 'variance', 'salvage']], ['Account', ['profile']]],
    admin: [['Overview', ['dashboard', 'alerts']], ['Approvals & Stock', ['requests', 'inventory', 'receive', 'issue', 'counts']], ['Insights', ['analytics', 'variance', 'salvage', 'movements']], ['Administration', ['users', 'settings', 'profile']]]
  };
  const BOTTOM = { requisitioner: ['home', 'catalog', 'requests', 'alerts', 'profile'], custodian: ['dashboard', 'requests', 'inventory', 'receive', 'more'], admin: ['dashboard', 'requests', 'inventory', 'analytics', 'more'] };
  const SHORT = { dashboard: 'Home', requests: { requisitioner: 'Requests', custodian: 'Queue', admin: 'Approvals' }, receive: 'Stock In', issue: 'Stock Out', analytics: 'Insights', profile: 'Account' };
  const vTitle = (id) => { const t = VIEWS[id].title; return typeof t === 'function' ? t() : t; };
  const shortTitle = (id) => { const s = SHORT[id]; return s ? (typeof s === 'object' ? s[role()] : s) : vTitle(id); };

  function navBadge(id) {
    if (!S.A) return 0;
    const A = S.A; const r = role();
    if (id === 'requests') return r === 'admin' ? A.reqs.endorsed + A.reqs.pending : r === 'custodian' ? A.reqs.pending + A.reqs.approved + A.reqs.partial : 0;
    if (id === 'alerts') return computeAlerts().filter((a) => !S.seen[a.id]).length;
    if (id === 'counts') return r === 'admin' ? A.counts.pending.length : 0;
    return 0;
  }

  function enterApp() {
    S.seen = LS.get('sp_seen_' + user().id, {});
    S.cart = LS.get('sp_cart_' + user().id, []);
    S.countDraft = LS.get('sp_count_' + user().id, {});
    const snap = LS.get('sp_snap', null);
    if (snap && snap.u === user().id) { S.data = snap.d; S.version = null; recompute(); }
    renderShell();
    route();
    sync(true);
    startTimers();
    setTimeout(() => maybeShowInstall(false), 1200);
  }

  function renderShell() {
    const u = user(); const rm = ROLE_META[u.role];
    $('#app').innerHTML =
      '<div class="shell"><aside class="sidebar">' + brandHTML() +
      '<div class="portal-tag"><span class="portal-ic ' + rm.cls + '" style="width:32px;height:32px;border-radius:9px">' + I(rm.icon, 17) + '</span><div style="min-width:0"><b>' + rm.label + '</b><span id="coName">' + esc(company()) + '</span></div></div>' +
      '<nav class="nav" id="sideNav"></nav>' +
      '<div class="side-foot"><div class="avatar">' + esc(initials(u.name)) + '</div><div class="who"><b>' + esc(u.name) + '</b><span>' + rm.short + (u.department ? ' · ' + esc(u.department) : '') + '</span></div><button class="btn btn-ghost btn-icon btn-sm" data-act="logout" title="Sign out">' + I('logout', 16) + '</button></div></aside>' +
      '<div class="main"><div id="offline" class="offline-bar hidden">' + I('wifiOff', 14) + ' You are offline — showing the last synced data.</div>' +
      '<header class="topbar" id="topbar"><a class="mob-brand" href="#/" aria-label="Home"></a><h1 id="viewTitle"></h1><div class="grow"></div>' +
      (API.isDemo ? '<span class="mode-pill" title="Demo data stored in this browser">DEMO</span>' : '') +
      '<button class="live" id="live" data-act="sync" title="Sync now"><i></i><span>Connecting…</span></button>' +
      '<button class="btn btn-ghost btn-icon top-btn" data-act="theme" title="Toggle theme">' + I(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon') + '</button>' +
      '<a class="btn btn-ghost btn-icon top-btn" href="#/alerts" title="Alerts">' + I('bell') + '<span class="badge hidden" id="bellBadge"></span></a></header>' +
      '<main class="content" id="view"></main></div><nav class="bottom-nav" id="bottomNav"></nav></div>';
    window.onscroll = () => { const t = $('#topbar'); if (t) t.classList.toggle('scrolled', window.scrollY > 4); };
    renderNav();
  }

  function renderNav() {
    const r = role(); if (!r || !$('#sideNav')) return;
    const link = (id) => { const b = navBadge(id); return '<a href="#/' + id + '" class="' + (S.view === id ? 'active' : '') + '">' + I(VIEWS[id].icon, 18) + '<span>' + esc(vTitle(id)) + '</span>' + (b ? '<span class="badge">' + b + '</span>' : '') + '</a>'; };
    $('#sideNav').innerHTML = NAV[r].map(([sec, ids]) => (sec ? '<div class="nav-sec">' + sec + '</div>' : '<div style="height:8px"></div>') + ids.map(link).join('')).join('');
    $('#bottomNav').innerHTML = BOTTOM[r].map((id) => {
      if (id === 'more') { const inMore = NAV[r].flatMap((x) => x[1]).filter((v) => BOTTOM[r].indexOf(v) < 0); const b = inMore.reduce((a, v) => a + navBadge(v), 0); return '<a href="#" data-act="more" class="' + (inMore.indexOf(S.view) >= 0 ? 'active' : '') + '">' + I('more', 22) + '<span>More</span>' + (b ? '<span class="badge">' + b + '</span>' : '') + '</a>'; }
      const b = navBadge(id);
      return '<a href="#/' + id + '" class="' + (S.view === id ? 'active' : '') + '">' + I(VIEWS[id].icon, 22) + '<span>' + esc(shortTitle(id)) + '</span>' + (b ? '<span class="badge">' + b + '</span>' : '') + '</a>';
    }).join('');
    updateBadges();
  }
  function updateBadges() {
    const n = navBadge('alerts'); const b = $('#bellBadge');
    if (b) { b.textContent = n > 99 ? '99+' : n; b.classList.toggle('hidden', !n); }
    if (navigator.setAppBadge) { try { n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { /* ignore */ } }
    const co = $('#coName'); if (co) co.textContent = company();
  }
  function moreSheet() {
    const r = role();
    const ids = NAV[r].flatMap((x) => x[1]).filter((v) => BOTTOM[r].indexOf(v) < 0);
    const m = modal({ title: 'More', body: '<div class="sheet-grid">' + ids.map((id) => { const b = navBadge(id); return '<a href="#/' + id + '">' + I(VIEWS[id].icon, 22) + esc(vTitle(id)) + (b ? '<span class="badge">' + b + '</span>' : '') + '</a>'; }).join('') + '<a href="#" data-act="logout">' + I('logout', 22) + 'Sign out</a></div>' });
    m.$$('a').forEach((a) => a.addEventListener('click', () => m.close()));
  }

  /* =============================== ROUTER =============================== */
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const [view, sub] = (path || '').split('/');
    const q = {}; new URLSearchParams(qs || '').forEach((v, k) => { q[k] = v; });
    return { view, sub, q };
  }
  function route() {
    if (!S.session) return;
    const p = parseHash(); const r = role();
    let v = p.view;
    if (!VIEWS[v] || VIEWS[v].roles.indexOf(r) < 0) v = r === 'requisitioner' ? 'home' : 'dashboard';
    S.view = v; S.sub = p.sub; S.query = p.q;
    while ($('#modal-root').firstChild) $('#modal-root').firstChild.remove();
    document.body.style.overflow = '';
    renderView(false);
    renderNav();
  }
  function renderView(isSync) {
    const el = $('#view'); if (!el || !S.session) return;
    destroyCharts();
    const v = VIEWS[S.view];
    $('#viewTitle').textContent = vTitle(S.view);
    document.title = vTitle(S.view) + ' · ' + CFG.SHORT_NAME;
    if (!S.A) { el.innerHTML = '<div class="empty" style="padding-top:80px"><div class="e-ic">' + I('refresh', 26, 'spin-ic') + '</div><b>Loading your warehouse…</b>Fetching the latest stock data.</div>'; return; }
    const y = window.scrollY;
    S.anim = !isSync;
    el.classList.remove('view-enter'); if (!isSync) { void el.offsetWidth; el.classList.add('view-enter'); }
    try { v.render(el); } catch (e) { console.error(e); el.innerHTML = empty('alert', 'This page failed to load', e.message); }
    countUp(el);
    requestAnimationFrame(() => { $$('[data-target]', el).forEach((c) => { c.style.strokeDashoffset = c.dataset.target; }); $$('[data-w]', el).forEach((b) => { b.style.width = b.dataset.w; }); });
    if (isSync) window.scrollTo(0, y); else window.scrollTo(0, 0);
    if (S.view === 'alerts') markAlertsSeen();
    updateBadges();
  }

  /* =============================== SHARED BLOCKS =============================== */
  function kpi(k) {
    return '<div class="card kpi" ' + (k.href ? 'data-act="go" data-href="' + k.href + '"' : '') + '><div class="k-top"><span class="k-label">' + esc(k.label) + '</span><span class="k-ic ' + k.cls + '">' + I(k.icon, 17) + '</span></div>' +
      '<div class="k-val" ' + (k.num !== undefined ? 'data-count="' + k.num + '" data-fmt="' + (k.fmt || 'int') + '"' : '') + '>' + k.val + '</div><div class="k-sub">' + (k.sub || '') + '</div>' + (k.spark ? sparkline(k.spark, k.color) : '') + '</div>';
  }
  function itemCell(it, extra) { return '<div class="item-cell">' + thumb(it) + '<div style="min-width:0"><b>' + esc(it.name) + '</b><small>' + esc(it.sku) + (extra ? ' · ' + extra : '') + '</small></div></div>'; }
  function qtyBar(r) {
    const max = Math.max(r.reorderLevel * 2, r.maxLevel || 0, r.qty, 1);
    const col = r.status === 'Out of Stock' ? 'var(--danger)' : r.status === 'Low Stock' ? 'var(--warn)' : r.status === 'Overstock' ? 'var(--info)' : 'var(--success)';
    return '<div class="qty-bar"><b>' + qty(r.qty) + ' <span class="muted small">' + esc(r.unit) + '</span></b><div class="bar-track"><div class="bar-fill" style="width:' + Math.min(100, (r.qty / max) * 100) + '%;background:' + col + '"></div></div></div>';
  }
  function txnText(t) {
    const q = qty(Math.abs(t.qty)) + ' ' + '× <b>' + esc(t.itemName) + '</b>';
    switch (t.type) {
      case 'IN': return 'Received ' + q + (t.party ? ' from ' + esc(t.party) : '');
      case 'OUT': return 'Issued ' + q + (t.party ? ' to ' + esc(t.party) : '');
      case 'ADJ': return 'Adjusted ' + (t.qty >= 0 ? '+' : '−') + q;
      case 'SALVAGE': return esc(t.party || 'Salvaged') + ' ' + q;
      case 'COND': return 'Condition · <b>' + esc(t.itemName) + '</b> ' + esc(t.remarks);
      default: return esc(t.type) + ' ' + q;
    }
  }
  function feedItem(t) {
    const m = TXN[t.type] || TXN.ADJ;
    const sign = t.type === 'IN' ? '+' : t.type === 'ADJ' ? (t.qty >= 0 ? '+' : '−') : t.type === 'COND' ? '' : '−';
    return '<li class="' + (S.freshTxn.has(t.id) ? 'new' : '') + '"><div class="f-ic ' + m.cls + '">' + I(m.icon, 16) + '</div><div class="f-body"><div>' + txnText(t) + '</div><div class="f-meta">' + esc(t.userName) + (t.ref ? ' · ' + esc(t.ref) : '') + ' · ' + rel(t.ts) + '</div></div>' +
      (t.type === 'COND' ? '' : '<div class="f-amt">' + sign + money(Math.abs(t.totalCost), 0) + '<small>bal ' + qty(t.balanceAfter) + '</small></div>') + '</li>';
  }
  function gauge(h) {
    const sc = h.score; const r = 62; const c = 2 * Math.PI * r;
    const col = sc >= 80 ? 'var(--success)' : sc >= 60 ? 'var(--warn)' : 'var(--danger)';
    const label = sc >= 80 ? 'Healthy' : sc >= 60 ? 'Needs attention' : 'At risk';
    const meter = (l, v, colr) => '<div class="meter"><div class="m-top"><span>' + l + '</span><span>' + pct(v) + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + (S.anim ? '0' : pct(v)) + ';background:' + colr + '" data-w="' + pct(v) + '"></div></div></div>';
    return '<div class="gauge-wrap"><div class="gauge"><svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="' + r + '" stroke="var(--surface-3)" stroke-width="13" fill="none"/>' +
      '<circle class="bar" cx="75" cy="75" r="' + r + '" stroke="' + col + '" stroke-width="13" fill="none" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" style="stroke-dashoffset:' + (S.anim ? c : c * (1 - sc / 100)).toFixed(1) + '" data-target="' + (c * (1 - sc / 100)).toFixed(1) + '"/></svg>' +
      '<div class="g-val"><div><b>' + sc + '</b><span>' + label + '</span></div></div></div><div class="meters">' +
      meter('Stock availability', h.parts.stock, 'var(--success)') + meter('Count accuracy', h.parts.accuracy, 'var(--primary)') + meter('Items moving', h.parts.moving, 'var(--in)') + meter('Condition (non-salvage)', h.parts.salvage, 'var(--accent)') + '</div></div>';
  }
  function tabs(list, active, act) {
    return '<div class="tabs">' + list.map(([id, label, n]) => '<button class="tab ' + (id === active ? 'active' : '') + '" data-act="' + act + '" data-tab="' + id + '">' + esc(label) + (n !== undefined ? ' <span class="badge">' + n + '</span>' : '') + '</button>').join('') + '</div>';
  }
  function greet() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
  const firstName = () => user().name.split(' ')[0];
  const shortDay = (k) => { const d = new Date(k + 'T00:00:00'); return d.toLocaleDateString(CFG.LOCALE, { month: 'short', day: 'numeric' }); };

  /* =============================== DASHBOARD =============================== */
  function vDashboard(el) {
    const A = S.A; const f = A.flow; const r = role();
    const salvVal = A.salvage.reduce((a, x) => a + x.value, 0);
    const reqN = r === 'admin' ? A.reqs.endorsed + A.reqs.pending : A.reqs.pending + A.reqs.approved + A.reqs.partial;
    const k = [
      { label: 'Inventory Value', val: money(A.totals.value, 0), num: A.totals.value, fmt: 'money', sub: A.totals.skus + ' SKUs · ' + qty(A.totals.units) + ' units', icon: 'wallet', cls: 'c-blue', href: '#/inventory' },
      { label: 'Inflow · 30 days', val: money(f.in30Value, 0), num: f.in30Value, fmt: 'money', sub: f.in30Count + ' receipts', icon: 'in', cls: 'c-green', href: '#/movements?type=IN', spark: f.series.map((x) => x.inV), color: cssv('--in') },
      { label: 'Outflow · 30 days', val: money(f.out30Value, 0), num: f.out30Value, fmt: 'money', sub: f.out30Count + ' issuances', icon: 'out', cls: 'c-amber', href: '#/movements?type=OUT', spark: f.series.map((x) => x.outV), color: cssv('--out') },
      { label: 'Low Stock Alerts', val: A.low.length + A.out.length, num: A.low.length + A.out.length, sub: '<span class="chip ' + (A.out.length ? 'c-red' : 'c-green') + '" style="height:20px">' + A.out.length + ' out of stock</span>', icon: 'alert', cls: 'c-red', href: '#/alerts' },
      { label: r === 'admin' ? 'Awaiting Approval' : 'Requisitions to Act On', val: reqN, num: reqN, sub: r === 'admin' ? A.reqs.endorsed + ' endorsed · ' + A.reqs.pending + ' new' : A.reqs.pending + ' to endorse · ' + (A.reqs.approved + A.reqs.partial) + ' to issue', icon: 'clipboard', cls: 'c-violet', href: '#/requests' },
      { label: 'Salvage Candidates', val: A.salvage.length, num: A.salvage.length, sub: money(salvVal, 0) + ' book value', icon: 'recycle', cls: 'c-red', href: '#/salvage' },
      { label: 'Count Accuracy · 90d', val: A.counts.accuracy === null ? '—' : pct(A.counts.accuracy), num: A.counts.accuracy === null ? undefined : A.counts.accuracy, fmt: 'pct', sub: 'Net variance ' + signed(A.counts.net, (v) => money(v, 0)), icon: 'scale', cls: 'c-blue', href: '#/variance' },
      { label: 'Fast-Moving Items', val: A.fast.length, num: A.fast.length, sub: A.slow.length + ' slow · ' + A.nonMoving.length + ' non-moving', icon: 'zap', cls: 'c-green', href: '#/analytics' }
    ];
    const watch = A.out.concat(A.low).sort((a, b) => (a.qty / Math.max(1, a.reorderLevel)) - (b.qty / Math.max(1, b.reorderLevel)));
    const feed = S.data.transactions.slice(-14).reverse();
    el.innerHTML =
      '<div class="page-head"><div><h2>' + greet() + ', ' + esc(firstName()) + ' 👋</h2><p>' + new Date().toLocaleDateString(CFG.LOCALE, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + esc(company()) + '</p></div>' +
      '<div class="actions"><a class="btn" href="#/receive">' + I('in', 17) + ' Stock In</a><a class="btn" href="#/issue">' + I('out', 17) + ' Stock Out</a>' +
      (r === 'admin' ? '<a class="btn btn-accent" href="#/requests">' + I('clipboard', 17) + ' Review approvals</a>' : '<a class="btn btn-accent" href="#/counts">' + I('scan', 17) + ' Start count</a>') + '</div></div>' +
      '<div class="kpis">' + k.map(kpi).join('') + '</div>' +
      '<div class="grid g-main"><div class="card"><div class="card-h"><h3>' + I('activity', 17) + ' Stock flow</h3><span class="sub">Inflow vs outflow value · last 30 days</span></div><div class="card-b"><div class="chart-box"><canvas id="chFlow"></canvas></div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('shield', 17) + ' Inventory health</h3><span class="sub">Live score</span></div><div class="card-b">' + gauge(A.health) + '</div></div></div>' +
      '<div class="grid g-2 mt"><div class="card"><div class="card-h"><h3>' + I('layers', 17) + ' Value by category</h3><span class="sub">' + money(A.totals.value, 0) + '</span></div><div class="card-b"><div class="chart-box sm"><canvas id="chCat"></canvas></div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('zap', 17) + ' Top consumption</h3><span class="sub">Outflow value · last 90 days</span></div><div class="card-b"><div class="chart-box sm"><canvas id="chTop"></canvas></div></div></div></div>' +
      '<div class="grid g-main mt"><div class="card"><div class="card-h"><h3>' + I('alert', 17) + ' Low stock watchlist</h3><a class="btn btn-sm btn-ghost" href="#/analytics/reorder">Reorder planner ' + I('chevronRight', 14) + '</a></div><div class="card-b flush">' +
      (watch.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Cover</th><th class="num">Suggest</th><th></th></tr></thead><tbody>' +
        watch.slice(0, 8).map((x) => '<tr class="click" data-act="open-item" data-id="' + x.id + '"><td class="span2">' + itemCell(x) + '</td><td class="num" data-l="On hand">' + qtyBar(x) + '</td><td class="num" data-l="Reorder at">' + qty(x.reorderLevel) + '</td><td class="num" data-l="Cover">' + cover(x) + '</td><td class="num" data-l="Suggest"><b>' + qty(x.suggest) + '</b> <span class="muted small">' + money(x.suggestCost, 0) + '</span></td><td class="right"><a class="btn btn-sm" href="#/receive?item=' + x.id + '">' + I('in', 14) + ' Receive</a></td></tr>').join('') +
        '</tbody></table></div>' : empty('check', 'All stocked up', 'No items are at or below their reorder level.')) + '</div></div>' +
      '<div class="card"><div class="card-h"><h3><span class="live" style="height:24px;cursor:default"><i></i></span> Live activity</h3><a class="btn btn-sm btn-ghost" href="#/movements">All ' + I('chevronRight', 14) + '</a></div><div class="card-b flush"><ul class="feed">' + (feed.length ? feed.map(feedItem).join('') : '<li>' + empty('activity', 'No movements yet', '') + '</li>') + '</ul></div></div></div>';

    chart('chFlow', { type: 'bar', data: { labels: f.labels.map(shortDay), datasets: [
      { label: 'Inflow', data: f.series.map((x) => x.inV), backgroundColor: cssv('--in'), borderRadius: 4, maxBarThickness: 12 },
      { label: 'Outflow', data: f.series.map((x) => x.outV), backgroundColor: cssv('--out'), borderRadius: 4, maxBarThickness: 12 }] }, options: barOpts({ money: true }) });
    chart('chCat', { type: 'doughnut', data: { labels: A.categories.map((c) => c.name), datasets: [{ data: A.categories.map((c) => Math.round(c.value)), backgroundColor: PALETTE, borderWidth: 2, borderColor: cssv('--surface') }] }, options: doughnutOpts({ money: true }) });
    const top = A.rows.slice().sort((a, b) => b.outVal90 - a.outVal90).slice(0, 8).filter((x) => x.outVal90 > 0);
    chart('chTop', { type: 'bar', data: { labels: top.map((x) => x.name), datasets: [{ label: 'Outflow', data: top.map((x) => Math.round(x.outVal90)), backgroundColor: top.map((x) => (x.movement === 'Fast' ? cssv('--success') : cssv('--accent'))), borderRadius: 5, maxBarThickness: 16 }] }, options: barOpts({ money: true, horizontal: true, legend: false }) });
  }

  /* =============================== REQUISITIONER HOME =============================== */
  function vHome(el) {
    const reqs = S.data.requisitions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const open = reqs.filter((r) => ['Pending', 'Endorsed'].indexOf(r.status) >= 0).length;
    const ready = reqs.filter((r) => ['Approved', 'Partially Issued'].indexOf(r.status) >= 0).length;
    const month = new Date().toISOString().slice(0, 7);
    const issued = reqs.filter((r) => r.status === 'Issued' && r.updatedAt.slice(0, 7) === month).length;
    const freq = {};
    reqs.forEach((r) => r.lines.forEach((l) => { freq[l.itemId] = (freq[l.itemId] || 0) + 1; }));
    let fav = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).map((id) => S.A.byId[id]).filter(Boolean);
    if (fav.length < 6) fav = fav.concat(S.A.rows.filter((x) => x.condition === 'Good' && x.qty > 0 && fav.indexOf(x) < 0).sort((a, b) => b.reorderLevel - a.reorderLevel)).slice(0, 6);
    el.innerHTML =
      '<div class="hero"><div style="position:relative;z-index:1"><h2>Hi ' + esc(firstName()) + '! What do you need today?</h2><p>Browse the catalog, submit a requisition, and follow it from endorsement to release.</p></div>' +
      '<div class="actions"><a class="btn btn-accent btn-lg" href="#/catalog">' + I('plus', 18) + ' New requisition</a><a class="btn btn-lg" href="#/requests">' + I('clipboard', 18) + ' Track requests</a></div></div>' +
      '<div class="kpis">' +
      kpi({ label: 'In review', val: open, num: open, sub: 'Pending or endorsed', icon: 'clock', cls: 'c-amber', href: '#/requests' }) +
      kpi({ label: 'Approved · ready', val: ready, num: ready, sub: 'Waiting for release', icon: 'check', cls: 'c-violet', href: '#/requests' }) +
      kpi({ label: 'Released this month', val: issued, num: issued, sub: 'Fully issued', icon: 'truck', cls: 'c-green', href: '#/requests' }) +
      kpi({ label: 'Items in cart', val: S.cart.length, num: S.cart.length, sub: S.cart.length ? 'Ready to submit' : 'Cart is empty', icon: 'cart', cls: 'c-blue', href: '#/catalog' }) + '</div>' +
      '<div class="grid g-side"><div class="card"><div class="card-h"><h3>' + I('clipboard', 17) + ' Recent requests</h3><a class="btn btn-sm btn-ghost" href="#/requests">View all ' + I('chevronRight', 14) + '</a></div><div class="card-b"><div class="req-list">' +
      (reqs.length ? reqs.slice(0, 4).map(reqCard).join('') : empty('clipboard', 'No requests yet', 'Your requisitions will appear here.', '<div class="mt"><a class="btn btn-primary" href="#/catalog">' + I('plus', 16) + ' Create your first request</a></div>')) + '</div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('star', 17) + ' Quick add</h3><span class="sub">Frequently requested</span></div><div class="card-b flush">' +
      fav.map((x) => '<div class="list-row">' + thumb(x) + '<div class="grow"><b>' + esc(x.name) + '</b><div class="small muted">' + availText(x) + '</div></div><button class="btn btn-sm" data-act="cart-add" data-id="' + x.id + '" ' + (x.qty <= 0 ? 'disabled' : '') + '>' + I('plus', 14) + ' Add</button></div>').join('') + '</div></div></div>';
  }
  function availText(x) { return x.qty <= 0 ? '<span style="color:var(--danger)">Out of stock</span>' : qty(x.qty) + ' ' + esc(x.unit) + ' available'; }

  /* =============================== CATALOG & CART =============================== */
  function vCatalog(el) {
    const f = S.filters.cat = S.filters.cat || { q: '', cat: '' };
    const cats = Array.from(new Set(S.A.rows.filter((x) => x.condition === 'Good').map((x) => x.category))).sort();
    el.innerHTML =
      '<div class="page-head"><div><h2>Supply catalog</h2><p>Add items to your cart, then submit a requisition for endorsement and approval.</p></div><div class="actions"><a class="btn" href="#/requests">' + I('clipboard', 16) + ' My requests</a></div></div>' +
      '<div class="toolbar"><div class="search">' + I('search', 17) + '<input class="input" id="catQ" placeholder="Search items or SKU…" value="' + esc(f.q) + '"></div></div>' +
      '<div class="filter-chips" style="margin-bottom:16px"><button class="fchip ' + (!f.cat ? 'active' : '') + '" data-cat="">All</button>' + cats.map((c) => '<button class="fchip ' + (f.cat === c ? 'active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>' +
      '<div id="catGrid"></div><div id="fabHost"></div>';
    $('#catQ').addEventListener('input', debounce((e) => { f.q = e.target.value; renderCatalogGrid(); }, 150));
    $$('.fchip', el).forEach((b) => b.addEventListener('click', () => { f.cat = b.dataset.cat; $$('.fchip', el).forEach((x) => x.classList.toggle('active', x === b)); renderCatalogGrid(); }));
    renderCatalogGrid();
  }
  function renderCatalogGrid() {
    const g = $('#catGrid'); if (!g) return;
    const f = S.filters.cat; const q = f.q.trim().toLowerCase();
    const list = S.A.rows.filter((x) => x.condition === 'Good' && (!f.cat || x.category === f.cat) && (!q || (x.name + ' ' + x.sku + ' ' + x.category).toLowerCase().indexOf(q) >= 0)).sort((a, b) => a.name.localeCompare(b.name));
    g.innerHTML = list.length ? '<div class="cat-grid">' + list.map((x) => {
      const inCart = S.cart.find((c) => c.itemId === x.id);
      const av = x.qty <= 0 ? chip('Out of stock', 'c-red') : x.status === 'Low Stock' ? chip('Limited', 'c-amber') : chip('Available', 'c-green');
      return '<div class="card pcard"><div class="p-top">' + thumb(x) + '<div style="min-width:0"><h4>' + esc(x.name) + '</h4><div class="p-sku">' + esc(x.sku) + ' · ' + esc(x.category) + '</div></div></div>' +
        '<div class="row" style="justify-content:space-between">' + av + '<span class="small muted">' + qty(x.qty) + ' ' + esc(x.unit) + '</span></div>' +
        '<div class="p-foot">' + (inCart ? '<div class="stepper-qty"><button data-act="cart-dec" data-id="' + x.id + '" aria-label="Less">' + I('minus', 14) + '</button><input type="number" min="1" value="' + inCart.qty + '" data-cart-qty="' + x.id + '" aria-label="Quantity"><button data-act="cart-inc" data-id="' + x.id + '" aria-label="More">' + I('plus', 14) + '</button></div><span class="small" style="color:var(--success);font-weight:700">' + I('check', 13) + ' In cart</span>'
          : '<span class="small muted">' + esc(x.location ? 'Bin ' + x.location : '') + '</span><button class="btn btn-sm btn-primary" data-act="cart-add" data-id="' + x.id + '" ' + (x.qty <= 0 ? 'disabled' : '') + '>' + I('plus', 14) + ' Add</button>') + '</div></div>';
    }).join('') + '</div>' : empty('search', 'No items found', 'Try a different search or category.');
    $$('[data-cart-qty]', g).forEach((inp) => inp.addEventListener('change', () => setCart(inp.dataset.cartQty, Math.max(1, +inp.value || 1))));
    renderFab();
  }
  function renderFab() {
    const h = $('#fabHost'); if (!h) return;
    const n = S.cart.reduce((a, c) => a + 1, 0);
    h.innerHTML = n ? '<button class="fab" data-act="cart-open">' + I('cart', 20) + ' Review request <span class="badge">' + n + '</span></button>' : '';
  }
  function setCart(id, q) {
    const c = S.cart.find((x) => x.itemId === id);
    if (q <= 0) S.cart = S.cart.filter((x) => x.itemId !== id); else if (c) c.qty = q; else S.cart.push({ itemId: id, qty: q });
    LS.set('sp_cart_' + user().id, S.cart);
    if (S.view === 'catalog') renderCatalogGrid();
  }
  function cartModal() {
    const lines = S.cart.map((c) => ({ c, it: S.A.byId[c.itemId] })).filter((x) => x.it);
    const total = () => S.cart.reduce((a, c) => a + (S.A.byId[c.itemId] ? S.A.byId[c.itemId].unitCost * c.qty : 0), 0);
    const m = modal({
      title: 'New requisition', sub: lines.length + ' item' + (lines.length === 1 ? '' : 's') + ' · routed to the custodian for endorsement', wide: true,
      body: '<div class="stack"><div class="card" style="box-shadow:none">' + lines.map(({ c, it }) => '<div class="list-row">' + thumb(it) + '<div class="grow"><b>' + esc(it.name) + '</b><div class="small muted">' + esc(it.sku) + ' · ' + availText(it) + (c.qty > it.qty ? ' · <span style="color:var(--warn)">more than available</span>' : '') + '</div></div>' +
        '<div class="stepper-qty"><input type="number" min="1" value="' + c.qty + '" data-q="' + it.id + '" aria-label="Quantity"></div><span class="small muted" style="width:44px">' + esc(it.unit) + '</span><button class="btn btn-ghost btn-icon btn-sm" data-rm="' + it.id + '" aria-label="Remove">' + I('trash', 15) + '</button></div>').join('') + '</div>' +
        '<div class="grid-form"><label class="field full"><span>Purpose / justification *</span><textarea class="input" id="rqPurpose" placeholder="e.g. Preventive maintenance of conveyor line 2"></textarea></label>' +
        '<label class="field"><span>Department</span><input class="input" id="rqDept" value="' + esc(user().department || '') + '"></label>' +
        '<label class="field"><span>Priority</span><select class="input" id="rqPrio"><option>Low</option><option selected>Normal</option><option>High</option><option>Urgent</option></select></label>' +
        '<label class="field"><span>Needed by</span><input class="input" type="date" id="rqNeed" min="' + todayISO() + '"></label>' +
        '<div class="field"><span>Estimated value</span><div class="input" style="display:flex;align-items:center;font-weight:800" id="rqTotal">' + money(total()) + '</div></div></div></div>',
      foot: '<button class="btn" data-close>Keep browsing</button><button class="btn btn-accent" id="rqSubmit" data-busy="Submitting…">' + I('send', 16) + ' Submit requisition</button>'
    });
    m.$$('[data-q]').forEach((inp) => inp.addEventListener('input', () => { const c = S.cart.find((x) => x.itemId === inp.dataset.q); if (c) { c.qty = Math.max(1, +inp.value || 1); LS.set('sp_cart_' + user().id, S.cart); m.$('#rqTotal').textContent = money(total()); } }));
    m.$$('[data-rm]').forEach((b) => b.addEventListener('click', () => { setCart(b.dataset.rm, 0); m.close(); if (S.cart.length) cartModal(); }));
    m.$('#rqSubmit').addEventListener('click', async (e) => {
      const purpose = m.$('#rqPurpose').value.trim();
      if (!purpose) { m.$('#rqPurpose').focus(); m.$('#rqPurpose').style.borderColor = 'var(--danger)'; return toast('Please state the purpose', { type: 'warn' }); }
      try {
        const res = await write('createRequisition', { lines: S.cart, purpose, department: m.$('#rqDept').value, priority: m.$('#rqPrio').value, neededBy: m.$('#rqNeed').value }, e.currentTarget, null);
        S.cart = []; LS.set('sp_cart_' + user().id, S.cart);
        m.close();
        toast('Requisition submitted', { type: 'success', body: res.requisition.reqNo + ' is now pending endorsement.' });
        location.hash = '#/requests';
      } catch (err) { /* toasted */ }
    });
  }

  /* =============================== REQUISITIONS =============================== */
  function reqStage(r) {
    const acts = r.history.map((h) => h.action);
    let reached = 0;
    if (acts.indexOf('Endorsed') >= 0) reached = 1;
    if (acts.indexOf('Approved') >= 0) reached = 2;
    if (r.status === 'Issued') reached = 4;
    else if (r.status === 'Partially Issued') reached = 3;
    return reached;
  }
  function stepper(r) {
    const steps = ['Submitted', 'Endorsed', 'Approved', 'Issued'];
    const reached = reqStage(r);
    const bad = r.status === 'Rejected' || r.status === 'Cancelled';
    const doneMax = reached === 4 ? 3 : reached === 3 ? 2 : reached;
    return '<div class="stepper">' + steps.map((s, i) => {
      let cls = '';
      if (i <= doneMax) cls = 'done';
      else if (i === doneMax + 1) cls = bad ? 'bad' : 'current';
      const label = cls === 'bad' ? r.status : (i === 3 && reached === 3 ? 'Partial' : s);
      const ic = cls === 'done' ? I('check', 12) : cls === 'bad' ? I('x', 12) : String(i + 1);
      return (i ? '<div class="step-line ' + (cls === 'done' ? 'done' : '') + '"></div>' : '') + '<div class="step ' + cls + '"><span class="s-dot">' + ic + '</span><span>' + label + '</span></div>';
    }).join('') + '</div>';
  }
  const reqValue = (r) => r.lines.reduce((a, l) => a + l.qty * ((S.A.byId[l.itemId] || {}).unitCost || l.unitCost || 0), 0);
  function reqCard(r) {
    return '<div class="card req" data-act="open-req" data-id="' + r.id + '"><div class="req-top"><span class="reqno">' + esc(r.reqNo) + '</span>' + chip(r.status, REQ_CHIP[r.status]) + chip(r.priority, PRIO_CHIP[r.priority], false) + '<span class="grow"></span><span class="small muted">' + rel(r.createdAt) + '</span></div>' +
      '<div class="req-purpose">' + esc(r.purpose) + '</div><div class="req-meta"><span>' + I('user', 13) + esc(r.requesterName) + '</span><span>' + I('layers', 13) + esc(r.department || '—') + '</span><span>' + I('box', 13) + r.lines.length + ' item' + (r.lines.length === 1 ? '' : 's') + '</span>' +
      (role() !== 'requisitioner' ? '<span>' + I('wallet', 13) + money(reqValue(r), 0) + '</span>' : '') + (r.neededBy ? '<span>' + I('clock', 13) + 'Need by ' + fdate(r.neededBy) + '</span>' : '') + '</div>' + stepper(r) + '</div>';
  }
  function vRequests(el) {
    const r = role();
    const all = S.data.requisitions.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const is = (...st) => (x) => st.indexOf(x.status) >= 0;
    const T = {
      requisitioner: [['active', 'Active', is('Pending', 'Endorsed', 'Approved', 'Partially Issued')], ['done', 'Completed', is('Issued', 'Rejected', 'Cancelled')], ['all', 'All', () => true]],
      custodian: [['endorse', 'To endorse', is('Pending')], ['issue', 'To issue', is('Approved', 'Partially Issued')], ['waiting', 'With admin', is('Endorsed')], ['all', 'All', () => true]],
      admin: [['approve', 'For approval', is('Endorsed', 'Pending')], ['issue', 'Approved', is('Approved', 'Partially Issued')], ['closed', 'Closed', is('Issued', 'Rejected', 'Cancelled')], ['all', 'All', () => true]]
    }[r];
    const f = S.filters.req = S.filters.req || { tab: T[0][0], q: '' };
    if (!T.find((t) => t[0] === f.tab)) f.tab = T[0][0];
    const tab = T.find((t) => t[0] === f.tab);
    const q = f.q.toLowerCase();
    const list = all.filter(tab[2]).filter((x) => !q || (x.reqNo + ' ' + x.purpose + ' ' + x.requesterName + ' ' + x.department).toLowerCase().indexOf(q) >= 0);
    const head = { requisitioner: ['My requests', 'Track every requisition from submission to release.'], custodian: ['Requisition queue', 'Endorse new requests, then release stock once the admin approves.'], admin: ['Approvals', 'Approve or reject endorsed requisitions. Stock is released by the custodian.'] }[r];
    el.innerHTML = '<div class="page-head"><div><h2>' + head[0] + '</h2><p>' + head[1] + '</p></div><div class="actions">' + (r === 'requisitioner' ? '<a class="btn btn-accent" href="#/catalog">' + I('plus', 16) + ' New requisition</a>' : '<a class="btn" href="#/catalog">' + I('plus', 16) + ' Raise a request</a>') + '</div></div>' +
      tabs(T.map((t) => [t[0], t[1], all.filter(t[2]).length]), f.tab, 'req-tab') +
      '<div class="toolbar"><div class="search">' + I('search', 17) + '<input class="input" id="reqQ" placeholder="Search request no., purpose, requester…" value="' + esc(f.q) + '"></div></div>' +
      '<div class="req-list">' + (list.length ? list.map(reqCard).join('') : empty('clipboard', 'Nothing here', r === 'requisitioner' ? 'No requests in this list.' : 'You are all caught up. 🎉')) + '</div>';
    $('#reqQ').addEventListener('input', debounce((e) => { f.q = e.target.value; const pos = e.target.selectionStart; renderView(true); const i = $('#reqQ'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 250));
  }
  function openReq(id) {
    const r = S.data.requisitions.find((x) => x.id === id); if (!r) return;
    const ro = role(); const me = user();
    const canSeeStock = ro !== 'requisitioner';
    const linesHtml = '<div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Requested</th><th class="num">Issued</th>' + (canSeeStock ? '<th class="num">On hand</th><th class="num">Value</th>' : '<th class="num">Availability</th>') + '</tr></thead><tbody>' +
      r.lines.map((l) => {
        const it = S.A.byId[l.itemId] || { name: l.name, sku: l.sku, qty: 0, unit: l.unit, unitCost: l.unitCost, category: '' };
        const rem = l.qty - (l.issuedQty || 0);
        const ok = it.qty >= rem;
        return '<tr><td>' + itemCell(it) + '</td><td class="num">' + qty(l.qty) + ' ' + esc(l.unit) + '</td><td class="num">' + qty(l.issuedQty || 0) + '</td>' +
          (canSeeStock ? '<td class="num">' + (rem > 0 ? chip(qty(it.qty), ok ? 'c-green' : 'c-amber', false) : '—') + '</td><td class="num">' + money(l.qty * it.unitCost, 0) + '</td>' : '<td class="num">' + (rem <= 0 ? chip('Released', 'c-green', false) : ok ? chip('In stock', 'c-green', false) : it.qty > 0 ? chip('Partial', 'c-amber', false) : chip('Out of stock', 'c-red', false)) + '</td>') + '</tr>';
      }).join('') + '</tbody></table></div>';
    const hist = '<ul class="timeline">' + r.history.map((h) => '<li><i style="background:' + ({ Submitted: 'var(--primary)', Endorsed: 'var(--info)', Approved: 'var(--violet)', Issued: 'var(--success)', 'Partially Issued': 'var(--in)', Rejected: 'var(--danger)', Cancelled: 'var(--muted)' }[h.action] || 'var(--primary)') + '"></i><b>' + esc(h.action) + '</b> by ' + esc(h.by) + ' <span class="muted small">· ' + (ROLE_META[h.role] ? ROLE_META[h.role].short : '') + ' · ' + fdt(h.at) + '</span>' + (h.note ? '<div class="t-note">' + esc(h.note) + '</div>' : '') + '</li>').join('') + '</ul>';
    const btns = [];
    const st = r.status;
    if (ro === 'requisitioner' && r.requesterId === me.id && (st === 'Pending' || st === 'Endorsed')) btns.push(['cancel', 'Cancel request', 'btn']);
    if (ro === 'custodian' && st === 'Pending') { btns.push(['reject', 'Reject', 'btn']); btns.push(['endorse', 'Endorse', 'btn btn-primary']); }
    if (ro === 'admin' && (st === 'Pending' || st === 'Endorsed')) { btns.push(['reject', 'Reject', 'btn']); btns.push(['approve', 'Approve', 'btn btn-success']); }
    if (ro === 'admin' && st === 'Approved') btns.push(['reject', 'Reject', 'btn']);
    if ((ro === 'custodian' || ro === 'admin') && (st === 'Approved' || st === 'Partially Issued')) btns.push(['issue', st === 'Partially Issued' ? 'Issue balance' : 'Issue stock', 'btn btn-accent']);
    const m = modal({
      title: esc(r.reqNo) + ' ' + chip(st, REQ_CHIP[st]), sub: esc(r.purpose), wide: true,
      body: '<div class="stack"><div class="dl"><div><span>Requester</span><b>' + esc(r.requesterName) + '</b></div><div><span>Department</span><b>' + esc(r.department || '—') + '</b></div><div><span>Priority</span><b>' + esc(r.priority) + '</b></div>' +
        '<div><span>Submitted</span><b>' + fdt(r.createdAt) + '</b></div><div><span>Needed by</span><b>' + fdate(r.neededBy) + '</b></div><div><span>' + (canSeeStock ? 'Est. value' : 'Items') + '</span><b>' + (canSeeStock ? money(reqValue(r)) : r.lines.length) + '</b></div></div>' +
        stepper(r) + '<div class="card" style="box-shadow:none;overflow:hidden">' + linesHtml + '</div><h4 style="margin-top:4px">Activity</h4>' + hist + '</div>',
      foot: '<button class="btn" data-close>Close</button>' + btns.map((b) => '<button class="' + b[2] + '" data-ra="' + b[0] + '">' + esc(b[1]) + '</button>').join('')
    });
    m.$$('[data-ra]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.ra;
      if (a === 'issue') { m.close(); return issueReqModal(r); }
      const cfg = {
        endorse: ['Endorse ' + r.reqNo + '?', 'The request will go to the admin for approval.', { ok: 'Endorse', input: true, inputLabel: 'Note to admin' }],
        approve: ['Approve ' + r.reqNo + '?', 'The custodian will be notified to release the stock.', { ok: 'Approve', input: true, inputLabel: 'Approval note' }],
        reject: ['Reject ' + r.reqNo + '?', 'The requester will see your reason.', { ok: 'Reject', danger: true, input: true, required: true, inputLabel: 'Reason', placeholder: 'Why is this being rejected?' }],
        cancel: ['Cancel ' + r.reqNo + '?', 'This withdraws your request.', { ok: 'Cancel request', danger: true, input: true, inputLabel: 'Reason' }]
      }[a];
      const ans = await ask(cfg[0], cfg[1], cfg[2]);
      if (!ans) return;
      try {
        await write('requisitionAction', { id: r.id, action: a, note: ans.value }, null, { endorse: 'Requisition endorsed', approve: 'Requisition approved', reject: 'Requisition rejected', cancel: 'Request cancelled' }[a]);
        m.close();
      } catch (e) { /* toasted */ }
    }));
  }
  function issueReqModal(r) {
    const rows = r.lines.map((l) => { const it = S.A.byId[l.itemId]; const rem = l.qty - (l.issuedQty || 0); return { l, it, rem, def: it ? Math.max(0, Math.min(rem, it.qty)) : 0 }; }).filter((x) => x.rem > 0);
    const m = modal({
      title: 'Issue stock · ' + esc(r.reqNo), sub: 'To ' + esc(r.department || r.requesterName) + ' — quantities are deducted at average cost.', wide: true,
      body: '<div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th class="num">Balance due</th><th class="num">On hand</th><th class="num">Issue now</th><th class="num">Cost</th></tr></thead><tbody>' +
        rows.map((x) => '<tr><td>' + itemCell(x.it || { name: x.l.name, sku: x.l.sku }) + '</td><td class="num">' + qty(x.rem) + '</td><td class="num">' + qty(x.it ? x.it.qty : 0) + '</td><td class="num"><input class="input input-sm" style="width:90px;text-align:right" type="number" min="0" max="' + Math.min(x.rem, x.it ? x.it.qty : 0) + '" value="' + x.def + '" data-iq="' + x.l.itemId + '" data-cost="' + (x.it ? x.it.unitCost : 0) + '"></td><td class="num" data-ic="' + x.l.itemId + '">' + money(x.def * (x.it ? x.it.unitCost : 0)) + '</td></tr>').join('') +
        '</tbody></table></div><div class="sum mt"><div class="total"><span>Total issue cost</span><b id="isTotal"></b></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-accent" id="isGo" data-busy="Issuing…">' + I('out', 16) + ' Confirm release</button>'
    });
    const upd = () => { let t = 0; m.$$('[data-iq]').forEach((i) => { const v = Math.max(0, Math.min(+i.value || 0, +i.max)); const c = v * +i.dataset.cost; t += c; m.$('[data-ic="' + i.dataset.iq + '"]').textContent = money(c); }); m.$('#isTotal').textContent = money(t); };
    m.$$('[data-iq]').forEach((i) => i.addEventListener('input', upd)); upd();
    m.$('#isGo').addEventListener('click', async (e) => {
      const plan = {}; m.$$('[data-iq]').forEach((i) => { plan[i.dataset.iq] = Math.max(0, Math.min(+i.value || 0, +i.max)); });
      if (!Object.values(plan).some((v) => v > 0)) return toast('Nothing to issue', { type: 'warn' });
      try { const res = await write('requisitionAction', { id: r.id, action: 'issue', issue: plan }, e.currentTarget); m.close(); toast(res.requisition.status === 'Issued' ? 'Fully issued' : 'Partially issued', { type: 'success', body: r.reqNo + ' · stock deducted' }); } catch (err) { /* toasted */ }
    });
  }

  /* =============================== INVENTORY =============================== */
  function vInventory(el) {
    const f = S.filters.inv = S.filters.inv || { q: S.query.q || '', cat: '', status: S.query.status || '', move: '', cond: '', sort: 'name', dir: 1 };
    const rows = S.A.rows;
    const cats = Array.from(new Set(rows.map((x) => x.category))).sort();
    const opt = (v, l, cur) => '<option value="' + esc(v) + '" ' + (v === cur ? 'selected' : '') + '>' + esc(l) + '</option>';
    el.innerHTML = '<div class="page-head"><div><h2>Inventory</h2><p>All stock on hand with live status, movement class and condition.</p></div><div class="actions"><button class="btn" data-act="inv-export">' + I('download', 16) + ' Export CSV</button>' +
      (role() === 'admin' ? '<button class="btn btn-primary" data-act="item-new">' + I('plus', 16) + ' New item</button>' : '') + '</div></div>' +
      '<div class="toolbar"><div class="search">' + I('search', 17) + '<input class="input" id="invQ" placeholder="Search name, SKU, location…" value="' + esc(f.q) + '"></div>' +
      '<select class="input" id="invCat">' + opt('', 'All categories', f.cat) + cats.map((c) => opt(c, c, f.cat)).join('') + '</select>' +
      '<select class="input" id="invStatus">' + opt('', 'Any status', f.status) + ['In Stock', 'Low Stock', 'Out of Stock', 'Overstock'].map((c) => opt(c, c, f.status)).join('') + '</select>' +
      '<select class="input" id="invMove">' + opt('', 'Any movement', f.move) + ['Fast', 'Slow', 'Non-moving'].map((c) => opt(c, c, f.move)).join('') + '</select>' +
      '<select class="input" id="invCond">' + opt('', 'Any condition', f.cond) + ['Good', 'Damaged', 'Non-functional', 'Obsolete'].map((c) => opt(c, c, f.cond)).join('') + '</select></div>' +
      '<div class="card" id="invCard"></div>';
    const bind = (id, k) => $(id).addEventListener(id === '#invQ' ? 'input' : 'change', debounce((e) => { f[k] = e.target.value; renderInvTable(); }, id === '#invQ' ? 150 : 0));
    bind('#invQ', 'q'); bind('#invCat', 'cat'); bind('#invStatus', 'status'); bind('#invMove', 'move'); bind('#invCond', 'cond');
    renderInvTable();
  }
  function invFiltered() {
    const f = S.filters.inv; const q = f.q.trim().toLowerCase();
    const list = S.A.rows.filter((x) => (!q || (x.name + ' ' + x.sku + ' ' + x.location + ' ' + x.category).toLowerCase().indexOf(q) >= 0) && (!f.cat || x.category === f.cat) && (!f.status || x.status === f.status) && (!f.move || x.movement === f.move) && (!f.cond || x.condition === f.cond));
    const k = f.sort;
    list.sort((a, b) => { const va = a[k], vb = b[k]; return (typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb))) * f.dir; });
    return list;
  }
  function renderInvTable() {
    const c = $('#invCard'); if (!c) return;
    const f = S.filters.inv; const list = invFiltered();
    const th = (k, l, cls) => '<th class="sortable ' + (cls || '') + '" data-act="inv-sort" data-k="' + k + '">' + l + (f.sort === k ? (f.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>';
    const val = list.reduce((a, x) => a + x.value, 0);
    c.innerHTML = '<div class="stat-strip"><div><span>Items</span><b>' + list.length + '</b></div><div><span>Stock value</span><b>' + money(val, 0) + '</b></div><div><span>Low / out</span><b>' + list.filter((x) => x.status === 'Low Stock' || x.status === 'Out of Stock').length + '</b></div><div><span>Fast movers</span><b>' + list.filter((x) => x.movement === 'Fast').length + '</b></div></div>' +
      (list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr>' + th('name', 'Item') + th('category', 'Category') + th('location', 'Bin') + th('qty', 'On hand', 'num') + th('unitCost', 'Avg cost', 'num') + th('value', 'Value', 'num') + th('status', 'Status') + th('movement', 'Movement') + th('condition', 'Condition') + '</tr></thead><tbody>' +
        list.slice(0, 400).map((x) => '<tr class="click" data-act="open-item" data-id="' + x.id + '"><td class="span2">' + itemCell(x) + '</td><td data-l="Category" class="hide-m">' + esc(x.category) + '</td><td data-l="Bin" class="mono">' + esc(x.location || '—') + '</td><td class="num" data-l="On hand">' + qtyBar(x) + '</td><td class="num hide-m" data-l="Avg cost">' + money(x.unitCost) + '</td><td class="num" data-l="Value"><b>' + money(x.value, 0) + '</b></td>' +
          '<td data-l="Status">' + chip(x.status, STATUS_CHIP[x.status]) + '</td><td data-l="Movement">' + chip(x.movement, MOVE_CHIP[x.movement]) + ' ' + chip(x.abc, ABC_CHIP[x.abc], false) + '</td><td data-l="Condition">' + chip(x.condition, COND_CHIP[x.condition]) + '</td></tr>').join('') +
        '</tbody></table></div>' + (list.length > 400 ? '<div class="tfoot-note">Showing first 400 of ' + list.length + ' — refine your search.</div>' : '') : empty('search', 'No items match', 'Clear the filters to see all items.'));
  }
  function exportInventory() {
    downloadCSV('inventory', ['SKU', 'Item', 'Category', 'Unit', 'Bin', 'On hand', 'Reorder level', 'Avg cost', 'Std cost', 'Value', 'Status', 'Movement', 'ABC', 'Out 30d', 'Out 90d', 'Days cover', 'Condition', 'Salvage recommendation', 'Date acquired'],
      invFiltered().map((x) => [x.sku, x.name, x.category, x.unit, x.location, x.qty, x.reorderLevel, x.unitCost.toFixed(2), x.stdCost, x.value.toFixed(2), x.status, x.movement, x.abc, x.out30, x.out90, x.cover === Infinity ? '' : Math.round(x.cover), x.condition, x.salvage || '', x.dateAcquired]));
  }

  function openItem(id) {
    const x = S.A.byId[id] || S.data.items.find((i) => i.id === id); if (!x) return;
    const r = role();
    const hist = S.data.transactions.filter((t) => t.itemId === id);
    const recent = hist.slice(-10).reverse();
    const m = modal({
      title: '<span class="row">' + thumb(x) + '<span>' + esc(x.name) + '</span></span>', sub: '<span class="mono">' + esc(x.sku) + '</span> · ' + esc(x.category) + ' · Bin ' + esc(x.location || '—') + ' &nbsp;' + chip(x.status, STATUS_CHIP[x.status]) + ' ' + chip(x.condition, COND_CHIP[x.condition]) + (x.salvage ? ' ' + chip(x.salvage, SALV_CHIP[x.salvage]) : ''), wide: true,
      body: '<div class="stack"><div class="dl"><div><span>On hand</span><b>' + qty(x.qty) + ' ' + esc(x.unit) + '</b></div><div><span>Stock value</span><b>' + money(x.value) + '</b></div><div><span>Average cost</span><b>' + money(x.unitCost) + '</b></div>' +
        '<div><span>Standard cost</span><b>' + money(x.stdCost) + '</b></div><div><span>Reorder / Max</span><b>' + qty(x.reorderLevel) + ' / ' + (x.maxLevel ? qty(x.maxLevel) : '—') + '</b></div><div><span>Days of cover</span><b>' + cover(x) + '</b></div>' +
        '<div><span>Out · 30 / 90 days</span><b>' + qty(x.out30) + ' / ' + qty(x.out90) + '</b></div><div><span>Movement · ABC</span><b>' + x.movement + ' · Class ' + x.abc + '</b></div><div><span>Last movement</span><b>' + (x.lastMove ? rel(x.lastMove) : 'Never') + '</b></div>' +
        '<div><span>Acquired</span><b>' + fdate(x.dateAcquired) + '</b></div><div><span>Age</span><b>' + (x.ageDays / 365).toFixed(1) + ' yrs</b></div><div><span>Supplier</span><b>' + esc(x.supplier || '—') + '</b></div></div>' +
        (x.salvage ? '<div class="callout c-amber">' + I('recycle', 16) + '<div><b>' + x.salvage + '.</b> ' + esc(x.salvageReason) + '. Estimated recovery ' + money(x.salvageValue) + '.</div></div>' : '') +
        (x.suggest ? '<div class="callout c-blue">' + I('truck', 16) + '<div><b>Reorder suggested:</b> ' + qty(x.suggest) + ' ' + esc(x.unit) + ' (≈ ' + money(x.suggestCost, 0) + ') to cover lead time plus 30 days of usage.</div></div>' : '') +
        '<div class="card" style="box-shadow:none"><div class="card-h"><h3>Stock level</h3><span class="sub">Balance after each movement</span></div><div class="card-b"><div class="chart-box sm"><canvas id="chItem"></canvas></div></div></div>' +
        '<div class="card" style="box-shadow:none"><div class="card-h"><h3>Stock card</h3><span class="sub">' + hist.length + ' movements</span></div><div class="card-b flush"><ul class="feed">' + (recent.length ? recent.map(feedItem).join('') : '<li class="muted">No movements recorded.</li>') + '</ul></div></div></div>',
      foot: '<button class="btn" data-close>Close</button>' + (r !== 'requisitioner' ? '<button class="btn" data-ia="cond">' + I('tool', 15) + ' Condition</button>' : '') + (r === 'admin' ? '<button class="btn" data-ia="edit">' + I('edit', 15) + ' Edit</button>' + (x.qty > 0 ? '<button class="btn" data-ia="salvage">' + I('recycle', 15) + ' Salvage</button>' : '') : '') +
        '<a class="btn" href="#/issue?item=' + x.id + '">' + I('out', 15) + ' Stock out</a><a class="btn btn-primary" href="#/receive?item=' + x.id + '">' + I('in', 15) + ' Stock in</a>'
    });
    const pts = hist.filter((t) => t.type !== 'COND').slice(-60);
    if (pts.length) chart('chItem', { type: 'line', data: { labels: pts.map((t) => fdate(t.ts)), datasets: [{ label: 'Balance', data: pts.map((t) => t.balanceAfter), borderColor: cssv('--primary'), backgroundColor: cssv('--primary-soft'), fill: true, tension: .3, pointRadius: 0, stepped: false },
      { label: 'Reorder level', data: pts.map(() => x.reorderLevel), borderColor: cssv('--danger'), borderDash: [5, 5], pointRadius: 0, borderWidth: 1.5, fill: false }] },
      options: Object.assign(barOpts({}), { animation: { duration: 600 } }) }, m.charts);
    m.$$('[data-ia]').forEach((b) => b.addEventListener('click', () => { const a = b.dataset.ia; m.close(); if (a === 'edit') itemForm(x); if (a === 'cond') condModal(x); if (a === 'salvage') salvageModal(x); }));
    m.$$('a.btn').forEach((a) => a.addEventListener('click', () => m.close()));
  }

  function itemForm(x) {
    const isNew = !x; x = x || { condition: 'Good', unit: 'pc', dateAcquired: todayISO() };
    const cats = Array.from(new Set(S.data.items.map((i) => i.category))).sort();
    const f = (k, l, type, extra) => '<label class="field ' + ((extra && extra.full) ? 'full' : '') + '"><span>' + l + '</span><input class="input" name="' + k + '" type="' + (type || 'text') + '" value="' + esc(x[k] !== undefined ? x[k] : '') + '" ' + ((extra && extra.attrs) || '') + '></label>';
    const m = modal({
      title: isNew ? 'New item' : 'Edit item', sub: isNew ? 'Add a stock-keeping unit to the master list.' : esc(x.sku), wide: true,
      body: '<form id="itemF" class="grid-form">' + f('sku', 'SKU *', 'text', { attrs: 'required' }) + f('name', 'Item name *', 'text', { attrs: 'required' }) +
        '<label class="field"><span>Category</span><input class="input" name="category" list="catList" value="' + esc(x.category || '') + '"><datalist id="catList">' + cats.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></label>' +
        f('unit', 'Unit (pc, box, roll…)') + f('location', 'Bin / location') + f('supplier', 'Supplier') +
        f('stdCost', 'Standard cost', 'number', { attrs: 'min="0" step="0.01"' }) + f('reorderLevel', 'Reorder level', 'number', { attrs: 'min="0"' }) + f('maxLevel', 'Max level (0 = none)', 'number', { attrs: 'min="0"' }) +
        '<label class="field"><span>Condition</span><select class="input" name="condition">' + ['Good', 'Damaged', 'Non-functional', 'Obsolete'].map((c) => '<option ' + (c === x.condition ? 'selected' : '') + '>' + c + '</option>').join('') + '</select></label>' +
        f('dateAcquired', 'Date acquired', 'date') +
        (isNew ? f('openingQty', 'Opening quantity', 'number', { attrs: 'min="0"' }) + f('unitCost', 'Opening unit cost', 'number', { attrs: 'min="0" step="0.01"' }) : '<label class="field"><span>Status</span><label class="switch"><input type="checkbox" name="active" ' + (x.active !== false ? 'checked' : '') + '> Active</label></label>') +
        '<label class="field full"><span>Remarks</span><textarea class="input" name="remarks" style="min-height:60px">' + esc(x.remarks || '') + '</textarea></label></form>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="itemSave">' + I('check', 16) + ' Save item</button>'
    });
    m.$('#itemSave').addEventListener('click', async (e) => {
      const fm = m.$('#itemF'); if (!fm.reportValidity()) return;
      const p = {}; new FormData(fm).forEach((v, k) => { p[k] = v; });
      if (!isNew) { p.id = x.id; p.active = fm.active.checked; }
      try { await write('saveItem', p, e.currentTarget, isNew ? 'Item created' : 'Item updated'); m.close(); } catch (err) { /* toasted */ }
    });
  }
  function condModal(x) {
    const m = modal({
      title: 'Update condition', sub: esc(x.name),
      body: '<div class="stack"><div class="filter-chips" style="flex-wrap:wrap">' + ['Good', 'Damaged', 'Non-functional', 'Obsolete'].map((c) => '<button class="fchip ' + (c === x.condition ? 'active' : '') + '" data-c="' + c + '">' + c + '</button>').join('') + '</div>' +
        '<label class="field"><span>Inspection remarks</span><textarea class="input" id="cdRem" placeholder="What was found?"></textarea></label><div class="callout c-blue">' + I('info', 16) + '<div>Damaged and non-functional items are automatically recommended for salvage. Obsolete items are recommended for disposal.</div></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cdSave">Save condition</button>'
    });
    let sel = x.condition;
    m.$$('[data-c]').forEach((b) => b.addEventListener('click', () => { sel = b.dataset.c; m.$$('[data-c]').forEach((z) => z.classList.toggle('active', z === b)); }));
    m.$('#cdSave').addEventListener('click', async (e) => { try { await write('setCondition', { itemId: x.id, condition: sel, remarks: m.$('#cdRem').value }, e.currentTarget, 'Condition updated'); m.close(); } catch (err) { /* toasted */ } });
  }
  function salvageModal(x) {
    const rate = +setting('salvageRate') || 0.15;
    const m = modal({
      title: 'Salvage / dispose', sub: esc(x.name) + ' · ' + qty(x.qty) + ' ' + esc(x.unit) + ' on hand',
      body: '<div class="grid-form"><label class="field"><span>Quantity</span><input class="input" type="number" id="svQ" min="1" max="' + x.qty + '" value="' + x.qty + '"></label>' +
        '<label class="field"><span>Method</span><select class="input" id="svM"><option>Salvage</option><option>Disposal</option><option>Auction</option><option>Scrap sale</option><option>Donation</option><option>Return to supplier</option></select></label>' +
        '<label class="field"><span>Recovery amount</span><input class="input" type="number" id="svR" min="0" step="0.01"></label><label class="field"><span>Reference (e.g. IIRUP no.)</span><input class="input" id="svRef"></label>' +
        '<label class="field full"><span>Remarks</span><textarea class="input" id="svRem" style="min-height:60px"></textarea></label><div class="sum full"><div><span>Book value written off</span><b id="svBook"></b></div><div><span>Recovery</span><b id="svRec"></b></div><div class="total"><span>Net loss</span><b id="svNet"></b></div></div></div>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="svGo">' + I('recycle', 16) + ' Post salvage</button>'
    });
    let touched = false;
    const upd = () => { const q = Math.min(+m.$('#svQ').value || 0, x.qty); if (!touched) m.$('#svR').value = (q * x.unitCost * rate).toFixed(2); const book = q * x.unitCost; const rec = +m.$('#svR').value || 0; m.$('#svBook').textContent = money(book); m.$('#svRec').textContent = money(rec); m.$('#svNet').textContent = money(book - rec); };
    m.$('#svQ').addEventListener('input', upd); m.$('#svR').addEventListener('input', () => { touched = true; upd(); }); upd();
    m.$('#svGo').addEventListener('click', async (e) => {
      const ok = await ask('Post salvage?', 'This removes the quantity from stock and records the write-off.', { ok: 'Post', danger: true }); if (!ok) return;
      try { await write('salvage', { itemId: x.id, qty: +m.$('#svQ').value, method: m.$('#svM').value, recovery: +m.$('#svR').value || 0, ref: m.$('#svRef').value, remarks: m.$('#svRem').value }, e.currentTarget, 'Salvage posted'); m.close(); } catch (err) { /* toasted */ }
    });
  }

  /* =============================== ITEM PICKER =============================== */
  function pickItem(o) {
    const m = modal({ title: o.title || 'Select item', body: '<div class="search">' + I('search', 17) + '<input class="input" id="pkQ" placeholder="Search name, SKU or bin…"></div><div class="pick-list" id="pkList"></div>' });
    const render = () => {
      const q = m.$('#pkQ').value.trim().toLowerCase();
      const list = S.A.rows.filter((x) => (!o.filter || o.filter(x)) && (!q || (x.name + ' ' + x.sku + ' ' + x.location).toLowerCase().indexOf(q) >= 0)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 120);
      m.$('#pkList').innerHTML = list.length ? list.map((x) => '<div class="list-row click" data-pk="' + x.id + '">' + thumb(x) + '<div class="grow"><b>' + esc(x.name) + '</b><div class="small muted mono">' + esc(x.sku) + ' · Bin ' + esc(x.location || '—') + '</div></div><div class="right"><b>' + qty(x.qty) + '</b> <span class="small muted">' + esc(x.unit) + '</span><div>' + chip(x.status, STATUS_CHIP[x.status]) + '</div></div></div>').join('') : '<div class="empty">No matching items</div>';
    };
    m.$('#pkQ').addEventListener('input', render);
    m.$('#pkList').addEventListener('click', (e) => { const r = e.target.closest('[data-pk]'); if (r) { m.close(); o.onPick(r.dataset.pk); } });
    render();
    setTimeout(() => m.$('#pkQ').focus(), 80);
  }

  /* =============================== STOCK IN / OUT =============================== */
  function vMove(el, type) {
    const isIn = type === 'IN';
    const st = S.filters['mv' + type] = { itemId: S.query.item && S.A.byId[S.query.item] ? S.query.item : '' };
    const parties = Array.from(new Set(S.data.transactions.filter((t) => t.type === type && t.party).map((t) => t.party))).slice(-40);
    el.innerHTML = '<div class="page-head"><div><h2>' + (isIn ? 'Stock In · Receiving' : 'Stock Out · Issuance') + '</h2><p>' + (isIn ? 'Record deliveries. Average cost updates automatically (moving weighted average).' : 'Release stock at average cost. Use the Requisition Queue for approved requests.') + '</p></div>' +
      '<div class="actions"><a class="btn" href="#/' + (isIn ? 'issue' : 'receive') + '">' + I(isIn ? 'out' : 'in', 16) + ' Switch to ' + (isIn ? 'Stock Out' : 'Stock In') + '</a></div></div>' +
      '<div class="grid g-side"><div class="card"><div class="card-h"><h3>' + I(isIn ? 'in' : 'out', 17) + (isIn ? ' Receiving slip' : ' Issue slip') + '</h3></div><div class="card-b"><form id="mvF" class="stack">' +
      '<button type="button" class="btn picker-btn" id="mvPick"></button>' +
      '<div class="grid-form"><label class="field"><span>Quantity *</span><input class="input" type="number" name="qty" min="0.01" step="any" required></label>' +
      (isIn ? '<label class="field"><span>Unit cost *</span><input class="input" type="number" name="unitCost" min="0" step="0.01" required></label>' : '<label class="field"><span>Unit cost (average)</span><input class="input" id="mvAvg" disabled></label>') +
      '<label class="field"><span>' + (isIn ? 'Supplier' : 'Issued to (dept / person)') + '</span><input class="input" name="party" list="mvParties"><datalist id="mvParties">' + parties.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist></label>' +
      '<label class="field"><span>' + (isIn ? 'DR / PO / Invoice no.' : 'RIS / Slip no.') + '</span><input class="input" name="ref"></label>' +
      '<label class="field full"><span>Remarks</span><input class="input" name="remarks"></label></div>' +
      '<div id="mvSum"></div><button class="btn btn-lg ' + (isIn ? 'btn-primary' : 'btn-accent') + '" id="mvGo" data-busy="Posting…">' + I('check', 18) + ' Post ' + (isIn ? 'receipt' : 'issuance') + '</button></form></div></div>' +
      '<div class="stack" id="mvSide"></div></div>';
    const form = $('#mvF');
    const setItem = (id) => {
      st.itemId = id; const x = S.A.byId[id];
      $('#mvPick').classList.toggle('has', !!x);
      $('#mvPick').innerHTML = x ? '<span class="row grow" style="text-align:left">' + thumb(x) + '<span class="grow"><b>' + esc(x.name) + '</b><span class="small muted" style="display:block">' + esc(x.sku) + ' · ' + qty(x.qty) + ' ' + esc(x.unit) + ' on hand · ' + x.status + '</span></span><span class="small muted">Change</span></span>' : '<span class="row grow">' + I('search', 18) + '<span class="grow"><b>Select an item</b><span class="small muted" style="display:block">Search by name, SKU or bin</span></span></span>';
      if (x && isIn) form.unitCost.value = (x.stdCost || x.unitCost || 0).toFixed(2);
      if (x && !isIn) { $('#mvAvg').value = money(x.unitCost); form.qty.max = x.qty; }
      if (x && isIn && !form.party.value) form.party.value = x.supplier || '';
      updSum();
    };
    const updSum = () => {
      const x = S.A.byId[st.itemId]; const q = +form.qty.value || 0; const box = $('#mvSum');
      if (!x) { box.innerHTML = ''; return; }
      if (isIn) {
        const c = +form.unitCost.value || 0; const nq = x.qty + q; const avg = nq ? (x.qty * x.unitCost + q * c) / nq : c;
        const ppv = x.stdCost ? (c - x.stdCost) * q : 0;
        box.innerHTML = '<div class="sum"><div><span>Total cost</span><b>' + money(q * c) + '</b></div><div><span>New balance</span><b>' + qty(nq) + ' ' + esc(x.unit) + '</b></div><div><span>New average cost</span><b>' + money(avg) + '</b></div>' +
          (x.stdCost && q ? '<div><span>Price variance vs standard</span><b class="' + (ppv > 0 ? 'neg' : 'pos') + '">' + signed(ppv, money) + (ppv > 0 ? ' unfavorable' : ppv < 0 ? ' favorable' : '') + '</b></div>' : '') + '</div>';
      } else {
        const left = x.qty - q;
        box.innerHTML = '<div class="sum"><div><span>Issue cost (at average)</span><b>' + money(q * x.unitCost) + '</b></div><div><span>Remaining balance</span><b class="' + (left < 0 ? 'neg' : '') + '">' + qty(left) + ' ' + esc(x.unit) + '</b></div></div>' +
          (left < 0 ? '<div class="callout c-red mt">' + I('alert', 16) + '<div>Not enough stock — only ' + qty(x.qty) + ' available.</div></div>' : left <= x.reorderLevel && q > 0 ? '<div class="callout c-amber mt">' + I('alert', 16) + '<div>This will put the item at or below its reorder level (' + qty(x.reorderLevel) + ').</div></div>' : '') +
          (x.condition !== 'Good' ? '<div class="callout c-amber mt">' + I('tool', 16) + '<div>Item condition is <b>' + esc(x.condition) + '</b>.</div></div>' : '');
      }
    };
    $('#mvPick').addEventListener('click', () => pickItem({ title: isIn ? 'Receive which item?' : 'Issue which item?', filter: isIn ? null : (x) => x.qty > 0, onPick: setItem }));
    form.addEventListener('input', updSum);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!st.itemId) return toast('Select an item first', { type: 'warn' });
      if (!form.reportValidity()) return;
      const p = { itemId: st.itemId, qty: +form.qty.value, party: form.party.value, ref: form.ref.value, remarks: form.remarks.value };
      if (isIn) p.unitCost = +form.unitCost.value;
      const x = S.A.byId[st.itemId];
      try {
        await write(isIn ? 'stockIn' : 'stockOut', p, $('#mvGo'), { title: (isIn ? 'Received ' : 'Issued ') + qty(p.qty) + ' ' + x.unit, body: x.name });
        form.qty.value = ''; form.ref.value = ''; form.remarks.value = '';
        setItem(st.itemId);
      } catch (err) { /* toasted */ }
    });
    setItem(st.itemId);
    renderMoveSide(type);
  }
  function renderMoveSide(type) {
    const side = $('#mvSide'); if (!side) return;
    const isIn = type === 'IN';
    const recent = S.data.transactions.filter((t) => t.type === type).slice(-8).reverse();
    const st = S.filters['mv' + type];
    if (st && st.itemId && $('#mvPick')) { const x = S.A.byId[st.itemId]; if (x) { const s = $('#mvPick .small'); if (s) s.textContent = x.sku + ' · ' + qty(x.qty) + ' ' + x.unit + ' on hand · ' + x.status; } }
    let extra = '';
    if (isIn) {
      const sug = S.A.reorder.slice(0, 6);
      extra = '<div class="card"><div class="card-h"><h3>' + I('truck', 17) + ' Needs replenishment</h3><a class="btn btn-sm btn-ghost" href="#/analytics/reorder">Planner</a></div><div class="card-b flush">' +
        (sug.length ? sug.map((x) => '<div class="list-row click" data-act="mv-prefill" data-id="' + x.id + '">' + thumb(x) + '<div class="grow"><b>' + esc(x.name) + '</b><div class="small muted">' + qty(x.qty) + ' left · suggest ' + qty(x.suggest) + ' ' + esc(x.unit) + '</div></div>' + chip(x.status, STATUS_CHIP[x.status]) + '</div>').join('') : '<div class="empty">Nothing to reorder 🎉</div>') + '</div></div>';
    } else {
      const ready = S.data.requisitions.filter((r) => r.status === 'Approved' || r.status === 'Partially Issued');
      extra = '<div class="card"><div class="card-h"><h3>' + I('clipboard', 17) + ' Approved requisitions</h3><a class="btn btn-sm btn-ghost" href="#/requests">Queue</a></div><div class="card-b flush">' +
        (ready.length ? ready.map((r) => '<div class="list-row click" data-act="open-req" data-id="' + r.id + '"><div class="grow"><b class="mono">' + esc(r.reqNo) + '</b><div class="small muted">' + esc(r.department) + ' · ' + r.lines.length + ' items · ' + esc(r.purpose) + '</div></div>' + chip(r.status, REQ_CHIP[r.status]) + '</div>').join('') : '<div class="empty">No approved requisitions waiting.</div>') + '</div></div>';
    }
    side.innerHTML = extra + '<div class="card"><div class="card-h"><h3>' + I('clock', 17) + ' Recent ' + (isIn ? 'receipts' : 'issuances') + '</h3></div><div class="card-b flush"><ul class="feed">' + (recent.length ? recent.map(feedItem).join('') : '<li class="muted">None yet</li>') + '</ul></div></div>';
  }

  /* =============================== PHYSICAL COUNT =============================== */
  function vCounts(el) {
    const f = S.filters.cnt = S.filters.cnt || { cat: '', q: '', blind: false, htab: role() === 'admin' ? 'Pending' : 'all' };
    const cats = Array.from(new Set(S.A.rows.map((x) => x.category))).sort();
    el.innerHTML = '<div class="page-head"><div><h2>Physical count</h2><p>Count what is on the shelf. Variances are routed to the admin for posting as adjustments.</p></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('scan', 17) + ' Count sheet</h3><span class="sub" id="cntInfo"></span></div><div class="card-b" style="padding-bottom:0"><div class="toolbar">' +
      '<div class="search">' + I('search', 17) + '<input class="input" id="cntQ" placeholder="Search item or bin…" value="' + esc(f.q) + '"></div>' +
      '<select class="input" id="cntCat"><option value="">All categories</option>' + cats.map((c) => '<option ' + (c === f.cat ? 'selected' : '') + '>' + esc(c) + '</option>').join('') + '</select>' +
      '<label class="switch" title="Hide system quantity while counting"><input type="checkbox" id="cntBlind" ' + (f.blind ? 'checked' : '') + '> Blind count</label>' +
      '<div class="grow"></div><button class="btn" data-act="cnt-clear">Clear</button><button class="btn btn-primary" id="cntGo" data-busy="Submitting…">' + I('send', 16) + ' Submit count</button></div></div><div id="cntSheet"></div></div>' +
      '<div class="card mt" id="cntHist"></div>';
    $('#cntQ').addEventListener('input', debounce((e) => { f.q = e.target.value; renderCountSheet(); }, 150));
    $('#cntCat').addEventListener('change', (e) => { f.cat = e.target.value; renderCountSheet(); });
    $('#cntBlind').addEventListener('change', (e) => { f.blind = e.target.checked; renderCountSheet(); });
    $('#cntGo').addEventListener('click', async (e) => {
      const entries = Object.keys(S.countDraft).filter((id) => S.countDraft[id].counted !== '' && S.countDraft[id].counted !== undefined && S.A.byId[id]).map((id) => ({ itemId: id, countedQty: +S.countDraft[id].counted, remarks: S.countDraft[id].remarks || '' }));
      if (!entries.length) return toast('Enter at least one counted quantity', { type: 'warn' });
      const ok = await ask('Submit ' + entries.length + ' count' + (entries.length > 1 ? 's' : '') + '?', 'Items with a variance will be sent to the admin for review.', { ok: 'Submit' }); if (!ok) return;
      try {
        const res = await write('submitCount', { entries }, e.currentTarget);
        const v = res.counts.filter((c) => c.variance !== 0).length;
        toast('Count submitted', { type: 'success', body: res.counts.length + ' items · ' + v + ' with variance' });
        S.countDraft = {}; LS.set('sp_count_' + user().id, S.countDraft); renderCountSheet();
      } catch (err) { /* toasted */ }
    });
    renderCountSheet(); renderCountHistory();
  }
  function renderCountSheet() {
    const box = $('#cntSheet'); if (!box) return;
    const f = S.filters.cnt; const q = f.q.toLowerCase();
    const list = S.A.rows.filter((x) => (!f.cat || x.category === f.cat) && (!q || (x.name + ' ' + x.sku + ' ' + x.location).toLowerCase().indexOf(q) >= 0)).sort((a, b) => String(a.location).localeCompare(String(b.location)) || a.name.localeCompare(b.name));
    box.innerHTML = '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th>Bin</th><th class="num">System</th><th class="num">Counted</th><th class="num">Variance</th><th class="num">Value</th><th>Remarks</th></tr></thead><tbody>' +
      list.map((x) => { const d = S.countDraft[x.id] || {}; return '<tr data-row="' + x.id + '"><td class="span2">' + itemCell(x) + '</td><td class="mono" data-l="Bin">' + esc(x.location || '—') + '</td><td class="num" data-l="System">' + (f.blind ? '<span class="muted">•••</span>' : qty(x.qty)) + '</td>' +
        '<td class="num" data-l="Counted"><input class="input input-sm" style="width:96px;text-align:right" type="number" min="0" step="any" data-cq="' + x.id + '" value="' + esc(d.counted !== undefined ? d.counted : '') + '" placeholder="—"></td>' +
        '<td class="num" data-l="Variance" data-cv="' + x.id + '"></td><td class="num" data-l="Value" data-cvv="' + x.id + '"></td><td data-l="Remarks" class="span2"><input class="input input-sm" data-cr="' + x.id + '" value="' + esc(d.remarks || '') + '" placeholder="Optional"></td></tr>'; }).join('') + '</tbody></table></div>';
    const upd = (id) => {
      const x = S.A.byId[id]; const d = S.countDraft[id]; const vc = box.querySelector('[data-cv="' + id + '"]'); const vv = box.querySelector('[data-cvv="' + id + '"]');
      if (!d || d.counted === '' || d.counted === undefined) { vc.innerHTML = '<span class="muted">—</span>'; vv.innerHTML = ''; return; }
      const v = +d.counted - x.qty;
      vc.innerHTML = f.blind ? '<span class="muted">hidden</span>' : '<b class="' + (v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v === 0 ? '✓ 0' : signed(v, qty)) + '</b>';
      vv.innerHTML = f.blind || v === 0 ? '' : '<span class="' + (v < 0 ? 'neg' : 'pos') + '">' + signed(v * x.unitCost, money) + '</span>';
    };
    const save = debounce(() => LS.set('sp_count_' + user().id, S.countDraft), 300);
    $$('[data-cq]', box).forEach((i) => { upd(i.dataset.cq); i.addEventListener('input', () => { const id = i.dataset.cq; S.countDraft[id] = Object.assign(S.countDraft[id] || {}, { counted: i.value }); if (i.value === '' && !S.countDraft[id].remarks) delete S.countDraft[id]; upd(id); save(); info(); }); });
    $$('[data-cr]', box).forEach((i) => i.addEventListener('input', () => { const id = i.dataset.cr; S.countDraft[id] = Object.assign(S.countDraft[id] || {}, { remarks: i.value }); save(); }));
    const info = () => { const n = Object.values(S.countDraft).filter((d) => d.counted !== '' && d.counted !== undefined).length; const el = $('#cntInfo'); if (el) el.textContent = n + ' counted · ' + list.length + ' on sheet'; };
    info();
  }
  function renderCountHistory() {
    const box = $('#cntHist'); if (!box) return;
    const f = S.filters.cnt; const isAdmin = role() === 'admin';
    const all = S.data.counts.slice().sort((a, b) => b.ts.localeCompare(a.ts));
    const T = [['Pending', 'Pending review'], ['Posted', 'Posted'], ['Matched', 'Matched'], ['Voided', 'Voided'], ['all', 'All']];
    const list = all.filter((c) => f.htab === 'all' || c.status === f.htab).slice(0, 300);
    const stChip = { Pending: 'c-amber', Posted: 'c-green', Matched: 'c-blue', Voided: 'c-gray' };
    box.innerHTML = '<div class="card-h"><h3>' + I('clock', 17) + ' Count history</h3>' + (isAdmin && f.htab === 'Pending' && list.length ? '<div class="actions"><button class="btn btn-sm" data-act="cnt-review" data-d="void">Void selected</button><button class="btn btn-sm btn-success" data-act="cnt-review" data-d="post">' + I('check', 14) + ' Post selected</button></div>' : '') + '</div>' +
      '<div class="card-b" style="padding-bottom:0">' + tabs(T.map((t) => [t[0], t[1], t[0] === 'all' ? all.length : all.filter((c) => c.status === t[0]).length]), f.htab, 'cnt-tab') + '</div>' +
      (list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr>' + (isAdmin && f.htab === 'Pending' ? '<th><input type="checkbox" id="cntAll" checked aria-label="Select all"></th>' : '') + '<th>Date</th><th>Item</th><th class="num">System</th><th class="num">Counted</th><th class="num">Variance</th><th class="num">Value</th><th>Remarks</th><th>By</th><th>Status</th></tr></thead><tbody>' +
        list.map((c) => '<tr>' + (isAdmin && f.htab === 'Pending' ? '<td data-l="Select"><input type="checkbox" data-cs="' + c.id + '" checked></td>' : '') + '<td data-l="Date" class="nowrap">' + fdt(c.ts) + '</td><td class="span2"><b>' + esc(c.itemName) + '</b> <span class="small muted mono">' + esc(c.sku) + '</span></td><td class="num" data-l="System">' + qty(c.systemQty) + '</td><td class="num" data-l="Counted">' + qty(c.countedQty) + '</td>' +
          '<td class="num" data-l="Variance"><b class="' + (c.variance < 0 ? 'neg' : c.variance > 0 ? 'pos' : '') + '">' + signed(c.variance, qty) + '</b></td><td class="num" data-l="Value" class="' + (c.varianceValue < 0 ? 'neg' : '') + '">' + signed(c.varianceValue, money) + '</td><td data-l="Remarks">' + esc(c.remarks || '—') + '</td><td data-l="By">' + esc(c.countedBy) + '</td><td data-l="Status">' + chip(c.status, stChip[c.status]) + '</td></tr>').join('') + '</tbody></table></div>'
        : '<div class="card-b">' + empty('check', 'Nothing here', f.htab === 'Pending' ? 'No variances waiting for review.' : '') + '</div>');
    const all2 = $('#cntAll'); if (all2) all2.addEventListener('change', () => $$('[data-cs]', box).forEach((c) => { c.checked = all2.checked; }));
  }

  /* =============================== ANALYTICS =============================== */
  function vAnalytics(el) {
    const A = S.A; const tab = ['fsn', 'abc', 'reorder', 'aging'].indexOf(S.sub) >= 0 ? S.sub : 'fsn';
    let body = '';
    const cls = (r) => '<td data-l="Class">' + chip(r.movement, MOVE_CHIP[r.movement]) + (r.dead ? ' ' + chip('Dead stock', 'c-red', false) : '') + '</td>';
    if (tab === 'fsn') {
      const sv = (a) => a.reduce((s, r) => s + r.value, 0);
      const f = S.filters.fsn || '';
      const list = A.rows.filter((r) => !f || r.movement === f).sort((a, b) => b.turnover - a.turnover || b.out90 - a.out90);
      body = '<div class="kpis">' + kpi({ label: 'Fast moving', val: A.fast.length, num: A.fast.length, sub: money(sv(A.fast), 0) + ' on hand', icon: 'zap', cls: 'c-green' }) + kpi({ label: 'Slow moving', val: A.slow.length, num: A.slow.length, sub: money(sv(A.slow), 0) + ' on hand', icon: 'clock', cls: 'c-amber' }) +
        kpi({ label: 'Non-moving · 90d', val: A.nonMoving.length, num: A.nonMoving.length, sub: money(sv(A.nonMoving), 0) + ' tied up', icon: 'box', cls: 'c-gray' }) + kpi({ label: 'Dead stock · ' + A.settings.nonMovingDays + 'd+', val: A.deadStock.length, num: A.deadStock.length, sub: money(sv(A.deadStock), 0) + ' idle value', icon: 'alert', cls: 'c-red' }) + '</div>' +
        '<div class="grid g-side"><div class="card"><div class="card-h"><h3>Movement ranking</h3><div class="filter-chips">' + ['', 'Fast', 'Slow', 'Non-moving'].map((c) => '<button class="fchip ' + (f === c ? 'active' : '') + '" data-act="fsn-f" data-v="' + c + '">' + (c || 'All') + '</button>').join('') + '</div></div><div class="card-b flush"><div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th class="num">Out 30d</th><th class="num">Out 90d</th><th class="num">Turnover</th><th class="num">Daily use</th><th class="num">Cover</th><th>Class</th></tr></thead><tbody>' +
        list.map((r) => '<tr class="click" data-act="open-item" data-id="' + r.id + '"><td class="span2">' + itemCell(r) + '</td><td class="num" data-l="Out 30d">' + qty(r.out30) + '</td><td class="num" data-l="Out 90d">' + qty(r.out90) + '</td><td class="num" data-l="Turnover"><b>' + r.turnover.toFixed(2) + '×</b></td><td class="num" data-l="Daily use">' + r.daily.toFixed(2) + '</td><td class="num" data-l="Cover">' + cover(r) + '</td>' + cls(r) + '</tr>').join('') + '</tbody></table></div></div></div>' +
        '<div class="stack"><div class="card"><div class="card-h"><h3>Movement mix</h3><span class="sub">by item count</span></div><div class="card-b"><div class="chart-box sm"><canvas id="chFsn"></canvas></div></div></div>' +
        '<div class="card"><div class="card-b small"><b>How it is classified</b><p class="muted" style="margin:6px 0 0">Turnover = units issued in the last 90 days ÷ average stock. <b>Fast</b> ≥ ' + A.settings.fastTurnover + '×, <b>Slow</b> below that, <b>Non-moving</b> = nothing issued in 90 days. <b>Dead stock</b> = no movement for ' + A.settings.nonMovingDays + '+ days. Thresholds are set by the admin in Settings.</p></div></div></div></div>';
    } else if (tab === 'abc') {
      const g = (c) => A.rows.filter((r) => r.abc === c);
      const tot = A.rows.reduce((s, r) => s + r.outVal90, 0) || 1;
      const share = (c) => g(c).reduce((s, r) => s + r.outVal90, 0) / tot;
      const list = A.rows.slice().sort((a, b) => b.outVal90 - a.outVal90);
      body = '<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + ['A', 'B', 'C'].map((c) => kpi({ label: 'Class ' + c + ' items', val: g(c).length, num: g(c).length, sub: pct(share(c)) + ' of consumption value', icon: c === 'A' ? 'star' : 'layers', cls: ABC_CHIP[c] })).join('') + '</div>' +
        '<div class="card"><div class="card-h"><h3>Pareto · 90-day consumption value</h3><span class="sub">A = top 80% · B = next 15% · C = last 5%</span></div><div class="card-b"><div class="chart-box lg"><canvas id="chAbc"></canvas></div></div></div>' +
        '<div class="card mt"><div class="card-b flush"><div class="table-wrap"><table class="t responsive"><thead><tr><th>#</th><th>Item</th><th class="num">Consumption</th><th class="num">Share</th><th class="num">Cumulative</th><th>Class</th></tr></thead><tbody>' +
        list.map((r, i) => '<tr class="click" data-act="open-item" data-id="' + r.id + '"><td data-l="Rank">' + (i + 1) + '</td><td class="span2">' + itemCell(r) + '</td><td class="num" data-l="Consumption"><b>' + money(r.outVal90, 0) + '</b></td><td class="num" data-l="Share">' + pct(r.outVal90 / tot, 1) + '</td><td class="num" data-l="Cumulative">' + pct(r.cumPct, 1) + '</td><td data-l="Class">' + chip('Class ' + r.abc, ABC_CHIP[r.abc], false) + '</td></tr>').join('') + '</tbody></table></div></div></div>';
    } else if (tab === 'reorder') {
      const list = A.reorder; const budget = list.reduce((s, r) => s + r.suggestCost, 0);
      body = '<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + kpi({ label: 'Items to reorder', val: list.length, num: list.length, sub: A.out.length + ' already out of stock', icon: 'truck', cls: 'c-amber' }) +
        kpi({ label: 'Estimated budget', val: money(budget, 0), num: budget, fmt: 'money', sub: 'at standard cost', icon: 'wallet', cls: 'c-blue' }) + kpi({ label: 'Supplier lead time', val: A.settings.leadTimeDays + ' days', sub: 'Plus 30 days of cover', icon: 'clock', cls: 'c-gray' }) + '</div>' +
        '<div class="card"><div class="card-h"><h3>Reorder planner</h3><div class="actions"><button class="btn btn-sm" data-act="reorder-export">' + I('download', 14) + ' Export PO list</button></div></div><div class="card-b flush">' +
        (list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Daily use</th><th class="num">Cover</th><th class="num">Suggested</th><th class="num">Est. cost</th><th></th></tr></thead><tbody>' +
          list.map((r) => '<tr><td class="span2">' + itemCell(r, esc(r.supplier || '')) + '</td><td class="num" data-l="On hand">' + qtyBar(r) + '</td><td class="num" data-l="Reorder at">' + qty(r.reorderLevel) + '</td><td class="num" data-l="Daily use">' + r.daily.toFixed(2) + '</td><td class="num" data-l="Cover">' + (r.cover < A.settings.leadTimeDays ? '<b class="neg">' + cover(r) + '</b>' : cover(r)) + '</td><td class="num" data-l="Suggested"><b>' + qty(r.suggest) + '</b> ' + esc(r.unit) + '</td><td class="num" data-l="Est. cost">' + money(r.suggestCost, 0) + '</td><td class="right"><a class="btn btn-sm" href="#/receive?item=' + r.id + '">' + I('in', 14) + ' Receive</a></td></tr>').join('') + '</tbody></table></div>'
          : empty('check', 'Nothing to reorder', 'All items have enough cover.')) + '</div></div>';
    } else {
      const old = A.rows.filter((r) => r.qty > 0 && r.idleDays > 90).sort((a, b) => b.idleDays - a.idleDays);
      body = '<div class="grid g-side"><div class="card"><div class="card-h"><h3>Stock aging</h3><span class="sub">Value by days since last movement</span></div><div class="card-b"><div class="chart-box"><canvas id="chAge"></canvas></div></div></div>' +
        '<div class="card"><div class="card-b flush">' + A.aging.map((b) => '<div class="list-row"><div class="grow"><b>' + b.label + '</b><div class="small muted">' + b.items + ' items</div></div><b>' + money(b.value, 0) + '</b></div>').join('') + '</div></div></div>' +
        '<div class="card mt"><div class="card-h"><h3>Idle more than 90 days</h3></div><div class="card-b flush">' + (old.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th class="num">Idle</th><th class="num">Age</th><th class="num">Qty</th><th class="num">Value</th><th>Condition</th><th>Recommendation</th></tr></thead><tbody>' +
          old.map((r) => '<tr class="click" data-act="open-item" data-id="' + r.id + '"><td class="span2">' + itemCell(r) + '</td><td class="num" data-l="Idle"><b>' + Math.round(r.idleDays) + ' d</b></td><td class="num" data-l="Age">' + (r.ageDays / 365).toFixed(1) + ' y</td><td class="num" data-l="Qty">' + qty(r.qty) + '</td><td class="num" data-l="Value">' + money(r.value, 0) + '</td><td data-l="Condition">' + chip(r.condition, COND_CHIP[r.condition]) + '</td><td data-l="Recommendation">' + (r.salvage ? chip(r.salvage, SALV_CHIP[r.salvage]) : '<span class="muted">Keep</span>') + '</td></tr>').join('') + '</tbody></table></div>' : empty('check', 'No idle stock', '')) + '</div></div>';
    }
    el.innerHTML = '<div class="page-head"><div><h2>Analytics</h2><p>Fast/slow/non-moving, ABC value classes, reorder planning and aging — recalculated live.</p></div></div>' +
      tabs([['fsn', 'Fast · Slow · Non-moving'], ['abc', 'ABC analysis'], ['reorder', 'Reorder planner', A.reorder.length], ['aging', 'Aging']], tab, 'an-tab') + body;
    if (tab === 'fsn') chart('chFsn', { type: 'doughnut', data: { labels: ['Fast', 'Slow', 'Non-moving'], datasets: [{ data: [A.fast.length, A.slow.length, A.nonMoving.length], backgroundColor: [cssv('--success'), cssv('--accent'), '#8a9bb5'], borderWidth: 2, borderColor: cssv('--surface') }] }, options: doughnutOpts() });
    if (tab === 'abc') {
      const top = A.rows.slice().sort((a, b) => b.outVal90 - a.outVal90).filter((r) => r.outVal90 > 0).slice(0, 25);
      const o = barOpts({ money: true }); o.scales.y2 = { position: 'right', min: 0, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: (v) => v + '%' } };
      o.plugins.tooltip.callbacks.label = (ctx) => ctx.dataset.yAxisID === 'y2' ? 'Cumulative: ' + ctx.parsed.y.toFixed(1) + '%' : 'Consumption: ' + money(ctx.parsed.y);
      o.scales.x.ticks.display = !matchMedia('(max-width: 700px)').matches;
      chart('chAbc', { type: 'bar', data: { labels: top.map((r) => r.name), datasets: [
        { type: 'line', label: 'Cumulative %', data: top.map((r) => +(r.cumPct * 100).toFixed(1)), yAxisID: 'y2', borderColor: cssv('--danger'), pointRadius: 2, borderWidth: 2, tension: .25 },
        { label: 'Consumption', data: top.map((r) => Math.round(r.outVal90)), backgroundColor: top.map((r) => ({ A: cssv('--violet'), B: cssv('--info'), C: '#8a9bb5' }[r.abc])), borderRadius: 4 }] }, options: o });
    }
    if (tab === 'aging') chart('chAge', { type: 'bar', data: { labels: A.aging.map((b) => b.label), datasets: [{ label: 'Value', data: A.aging.map((b) => Math.round(b.value)), backgroundColor: [cssv('--success'), cssv('--in'), cssv('--accent'), cssv('--out'), cssv('--danger')], borderRadius: 6, maxBarThickness: 46 }] }, options: barOpts({ money: true, legend: false }) });
  }

  /* =============================== VARIANCE =============================== */
  function vVariance(el) {
    const A = S.A; const tab = S.sub === 'cost' ? 'cost' : 'count'; const C = A.counts; const P = A.ppv;
    let body;
    if (tab === 'count') {
      const list = C.list.filter((c) => c.variance !== 0).sort((a, b) => Math.abs(b.varianceValue) - Math.abs(a.varianceValue));
      const cats = Object.keys(C.byCategory);
      const stChip = { Pending: 'c-amber', Posted: 'c-green', Matched: 'c-blue', Voided: 'c-gray' };
      body = '<div class="kpis">' + kpi({ label: 'Record accuracy', val: C.accuracy === null ? '—' : pct(C.accuracy, 1), sub: C.matched + ' of ' + C.total + ' counts matched', icon: 'shield', cls: 'c-blue' }) +
        kpi({ label: 'Net variance', val: signed(C.net, (v) => money(v, 0)), sub: 'Last 90 days', icon: 'scale', cls: C.net < 0 ? 'c-red' : 'c-green' }) +
        kpi({ label: 'Shrinkage (loss)', val: money(C.shrink, 0), sub: C.list.filter((c) => c.variance < 0).length + ' items short', icon: 'trendDown', cls: 'c-red' }) +
        kpi({ label: 'Overage', val: money(C.overage, 0), sub: C.pending.length + ' pending posting', icon: 'trendUp', cls: 'c-green', href: '#/counts' }) + '</div>' +
        '<div class="grid g-side"><div class="card"><div class="card-h"><h3>Count variances</h3><a class="btn btn-sm" href="#/counts">' + I('scan', 14) + ' Physical count</a></div><div class="card-b flush">' +
        (list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th class="num">System</th><th class="num">Counted</th><th class="num">Variance</th><th class="num">%</th><th class="num">Value</th><th>Status</th></tr></thead><tbody>' +
          list.map((c) => '<tr><td class="span2"><b>' + esc(c.itemName) + '</b><div class="small muted">' + fdt(c.ts) + ' · ' + esc(c.remarks || 'No remarks') + '</div></td><td class="num" data-l="System">' + qty(c.systemQty) + '</td><td class="num" data-l="Counted">' + qty(c.countedQty) + '</td><td class="num" data-l="Variance"><b class="' + (c.variance < 0 ? 'neg' : 'pos') + '">' + signed(c.variance, qty) + '</b></td><td class="num" data-l="%">' + (c.systemQty ? pct(c.variance / c.systemQty, 1) : '—') + '</td><td class="num" data-l="Value"><b class="' + (c.varianceValue < 0 ? 'neg' : 'pos') + '">' + signed(c.varianceValue, money) + '</b></td><td data-l="Status">' + chip(c.status, stChip[c.status]) + '</td></tr>').join('') + '</tbody></table></div>'
          : empty('check', 'No variances', 'All counted items matched the system.')) + '</div></div>' +
        '<div class="card"><div class="card-h"><h3>Variance by category</h3></div><div class="card-b"><div class="chart-box">' + (cats.length ? '<canvas id="chVar"></canvas>' : '<div class="no-chart">No counts in the last 90 days</div>') + '</div></div></div></div>';
      el.innerHTML = head() + body;
      if (cats.length) chart('chVar', { type: 'bar', data: { labels: cats, datasets: [{ label: 'Variance', data: cats.map((k) => Math.round(C.byCategory[k])), backgroundColor: cats.map((k) => (C.byCategory[k] < 0 ? cssv('--danger') : cssv('--success'))), borderRadius: 5 }] }, options: (function () { const o = barOpts({ money: true, horizontal: true, legend: false }); o.scales.x.beginAtZero = false; return o; })() });
    } else {
      body = '<div class="kpis">' + kpi({ label: 'Net price variance', val: signed(P.net, (v) => money(v, 0)), sub: P.net > 0 ? 'Paid above standard' : 'Paid below standard', icon: 'scale', cls: P.net > 0 ? 'c-red' : 'c-green' }) +
        kpi({ label: 'Unfavorable', val: money(P.unfav, 0), sub: P.list.filter((p) => p.variance > 0).length + ' receipts above std', icon: 'trendUp', cls: 'c-red' }) +
        kpi({ label: 'Favorable', val: money(Math.abs(P.fav), 0), sub: P.list.filter((p) => p.variance < 0).length + ' receipts below std', icon: 'trendDown', cls: 'c-green' }) +
        kpi({ label: 'Receipts analysed', val: P.list.length, sub: 'Last 90 days', icon: 'in', cls: 'c-blue' }) + '</div>' +
        '<div class="card"><div class="card-h"><h3>Purchase price variance by item</h3><span class="sub">(actual − standard) × qty</span></div><div class="card-b"><div class="chart-box">' + (P.byItem.length ? '<canvas id="chPpv"></canvas>' : '<div class="no-chart">No receipts with a standard cost yet</div>') + '</div></div></div>' +
        '<div class="card mt"><div class="card-h"><h3>Receipts</h3></div><div class="card-b flush">' + (P.list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Date</th><th>Item</th><th>Supplier</th><th class="num">Qty</th><th class="num">Standard</th><th class="num">Actual</th><th class="num">Var %</th><th class="num">PPV</th></tr></thead><tbody>' +
          P.list.slice(0, 200).map((p) => '<tr><td data-l="Date" class="nowrap">' + fdate(p.ts) + '</td><td class="span2"><b>' + esc(p.name) + '</b> <span class="small muted mono">' + esc(p.sku) + '</span></td><td data-l="Supplier">' + esc(p.party || '—') + '</td><td class="num" data-l="Qty">' + qty(p.qty) + '</td><td class="num" data-l="Standard">' + money(p.std) + '</td><td class="num" data-l="Actual">' + money(p.actual) + '</td><td class="num" data-l="Var %"><span class="' + (p.pct > 0 ? 'neg' : 'pos') + '">' + signed(p.pct * 100, (v) => v.toFixed(1) + '%') + '</span></td><td class="num" data-l="PPV"><b class="' + (p.variance > 0 ? 'neg' : 'pos') + '">' + signed(p.variance, money) + '</b></td></tr>').join('') + '</tbody></table></div>' : empty('in', 'No receipts', '')) + '</div></div>';
      el.innerHTML = head() + body;
      const top = P.byItem.slice(0, 12);
      if (top.length) chart('chPpv', { type: 'bar', data: { labels: top.map((p) => p.name), datasets: [{ label: 'PPV', data: top.map((p) => Math.round(p.variance)), backgroundColor: top.map((p) => (p.variance > 0 ? cssv('--danger') : cssv('--success'))), borderRadius: 5 }] }, options: (function () { const o = barOpts({ money: true, horizontal: true, legend: false }); o.scales.x.beginAtZero = false; return o; })() });
    }
    function head() { return '<div class="page-head"><div><h2>Variance analysis</h2><p>Physical count vs system records, and purchase price vs standard cost.</p></div><div class="actions"><button class="btn" data-act="print">' + I('printer', 16) + ' Print</button></div></div>' + tabs([['count', 'Count variance'], ['cost', 'Cost variance (PPV)']], tab, 'var-tab'); }
  }

  /* =============================== SALVAGE =============================== */
  function vSalvage(el) {
    const A = S.A; const r = role();
    const by = (k) => A.salvage.filter((x) => x.salvage === k);
    const book = A.salvage.reduce((s, x) => s + x.value, 0); const rec = A.salvage.reduce((s, x) => s + x.salvageValue, 0);
    const hist = S.data.transactions.filter((t) => t.type === 'SALVAGE').slice(-50).reverse();
    const conds = ['Good', 'Damaged', 'Non-functional', 'Obsolete'];
    const st = A.settings;
    el.innerHTML = '<div class="page-head"><div><h2>Salvage &amp; condition</h2><p>Old, non-functional, damaged and obsolete stock with recommended action and recovery estimate.</p></div><div class="actions"><button class="btn" data-act="salv-export">' + I('download', 16) + ' Export</button></div></div>' +
      '<div class="kpis">' + kpi({ label: 'Recommend salvage', val: by('Recommend Salvage').length, num: by('Recommend Salvage').length, sub: 'Damaged / non-functional', icon: 'recycle', cls: 'c-red' }) +
      kpi({ label: 'Recommend disposal', val: by('Recommend Disposal').length, num: by('Recommend Disposal').length, sub: 'Obsolete models', icon: 'trash', cls: 'c-gray' }) +
      kpi({ label: 'Review for salvage', val: by('Review for Salvage').length, num: by('Review for Salvage').length, sub: 'Old and idle / dead stock', icon: 'clock', cls: 'c-amber' }) +
      kpi({ label: 'Book value at risk', val: money(book, 0), num: book, fmt: 'money', sub: 'Est. recovery ' + money(rec, 0), icon: 'wallet', cls: 'c-blue' }) + '</div>' +
      '<div class="grid g-side"><div class="card"><div class="card-h"><h3>Recommendations</h3></div><div class="card-b flush">' +
      (A.salvage.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Item</th><th>Condition</th><th class="num">Age</th><th class="num">Idle</th><th class="num">Qty</th><th class="num">Book value</th><th class="num">Est. recovery</th><th>Action</th><th></th></tr></thead><tbody>' +
        A.salvage.sort((a, b) => b.value - a.value).map((x) => '<tr><td class="span2">' + itemCell(x) + '</td><td data-l="Condition">' + chip(x.condition, COND_CHIP[x.condition]) + '</td><td class="num" data-l="Age">' + (x.ageDays / 365).toFixed(1) + ' y</td><td class="num" data-l="Idle">' + Math.round(x.idleDays) + ' d</td><td class="num" data-l="Qty">' + qty(x.qty) + '</td><td class="num" data-l="Book value"><b>' + money(x.value, 0) + '</b></td><td class="num" data-l="Est. recovery">' + money(x.salvageValue, 0) + '</td>' +
          '<td data-l="Action" class="span2">' + chip(x.salvage, SALV_CHIP[x.salvage]) + '<div class="small muted" style="margin-top:3px">' + esc(x.salvageReason) + '</div></td><td class="right span2"><div class="actions" style="justify-content:flex-end"><button class="btn btn-sm" data-act="item-cond" data-id="' + x.id + '">' + I('tool', 14) + '</button>' + (r === 'admin' && x.qty > 0 ? '<button class="btn btn-sm btn-danger" data-act="item-salvage" data-id="' + x.id + '">Salvage</button>' : '') + '</div></td></tr>').join('') + '</tbody></table></div>'
        : empty('check', 'No salvage candidates', 'All stock is in good, active condition.')) + '</div></div>' +
      '<div class="stack"><div class="card"><div class="card-h"><h3>Items by condition</h3></div><div class="card-b"><div class="chart-box sm"><canvas id="chCond"></canvas></div></div></div>' +
      '<div class="card"><div class="card-b small"><b>Recommendation rules</b><ul class="muted" style="margin:8px 0 0;padding-left:18px;display:grid;gap:4px"><li><b>Damaged / Non-functional</b> → Recommend salvage</li><li><b>Obsolete</b> → Recommend disposal</li><li>Older than <b>' + st.salvageAgeYears + ' years</b> and idle <b>' + st.nonMovingDays + '+ days</b> → Review</li><li>No movement for <b>' + st.nonMovingDays + '+ days</b> → Review (dead stock)</li><li>Recovery estimate = <b>' + pct(st.salvageRate) + '</b> of book value</li></ul></div></div></div></div>' +
      '<div class="card mt"><div class="card-h"><h3>' + I('recycle', 17) + ' Salvage &amp; disposal history</h3><span class="sub">YTD written off ' + money(hist.reduce((s, t) => s + t.totalCost, 0), 0) + ' · recovered ' + money(hist.reduce((s, t) => s + (+t.recovery || 0), 0), 0) + '</span></div><div class="card-b flush">' +
      (hist.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Date</th><th>Item</th><th>Method</th><th class="num">Qty</th><th class="num">Book value</th><th class="num">Recovery</th><th>By</th></tr></thead><tbody>' + hist.map((t) => '<tr><td data-l="Date">' + fdate(t.ts) + '</td><td class="span2"><b>' + esc(t.itemName) + '</b></td><td data-l="Method">' + esc(t.party) + '</td><td class="num" data-l="Qty">' + qty(t.qty) + '</td><td class="num" data-l="Book value">' + money(t.totalCost) + '</td><td class="num" data-l="Recovery">' + money(t.recovery) + '</td><td data-l="By">' + esc(t.userName) + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="card-b muted">No salvage transactions recorded yet.</div>') + '</div></div>';
    chart('chCond', { type: 'doughnut', data: { labels: conds, datasets: [{ data: conds.map((c) => A.rows.filter((x) => x.condition === c).length), backgroundColor: [cssv('--success'), cssv('--danger'), cssv('--out'), '#8a9bb5'], borderWidth: 2, borderColor: cssv('--surface') }] }, options: doughnutOpts() });
  }

  /* =============================== MOVEMENTS =============================== */
  function vMovements(el) {
    const f = S.filters.mov = S.filters.mov || { type: S.query.type || '', days: '30', q: '', limit: 200 };
    if (S.query.type !== undefined && !S.filters._movQ) { f.type = S.query.type; }
    S.filters._movQ = true;
    const list = movFiltered();
    const sum = (t) => list.filter((x) => x.type === t).reduce((s, x) => s + x.totalCost, 0);
    el.innerHTML = '<div class="page-head"><div><h2>Movements ledger</h2><p>Every stock-in, stock-out, adjustment, salvage and condition change with cost and running balance.</p></div><div class="actions"><button class="btn" data-act="mov-export">' + I('download', 16) + ' Export CSV</button></div></div>' +
      '<div class="toolbar"><div class="filter-chips">' + [['', 'All'], ['IN', 'Stock in'], ['OUT', 'Stock out'], ['ADJ', 'Adjustments'], ['SALVAGE', 'Salvage'], ['COND', 'Condition']].map(([v, l]) => '<button class="fchip ' + (f.type === v ? 'active' : '') + '" data-act="mov-type" data-v="' + v + '">' + l + '</button>').join('') + '</div>' +
      '<div class="grow"></div><select class="input" id="movDays" style="width:auto">' + [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']].map(([v, l]) => '<option value="' + v + '" ' + (f.days === v ? 'selected' : '') + '>' + l + '</option>').join('') + '</select>' +
      '<div class="search" style="min-width:220px">' + I('search', 17) + '<input class="input" id="movQ" placeholder="Item, ref, party, user…" value="' + esc(f.q) + '"></div></div>' +
      '<div class="card"><div class="stat-strip"><div><span>Movements</span><b>' + list.length + '</b></div><div><span>Inflow</span><b class="pos">' + money(sum('IN'), 0) + '</b></div><div><span>Outflow</span><b style="color:var(--out)">' + money(sum('OUT'), 0) + '</b></div><div><span>Adjustments</span><b>' + signed(sum('ADJ'), (v) => money(v, 0)) + '</b></div><div><span>Salvaged</span><b class="neg">' + money(sum('SALVAGE'), 0) + '</b></div></div>' +
      (list.length ? '<div class="table-wrap"><table class="t responsive"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Total</th><th class="num">Balance</th><th>Ref / party</th><th>By</th></tr></thead><tbody>' +
        list.slice(0, f.limit).map((t) => '<tr class="click ' + (S.freshTxn.has(t.id) ? 'new' : '') + '" data-act="open-item" data-id="' + t.itemId + '"><td data-l="Date" class="nowrap">' + fdt(t.ts) + '</td><td data-l="Type">' + chip(TXN[t.type] ? TXN[t.type].label : t.type, TXN[t.type] ? TXN[t.type].cls : '') + '</td><td class="span2"><b>' + esc(t.itemName) + '</b> <span class="small muted mono">' + esc(t.sku) + '</span>' + (t.type === 'COND' ? '<div class="small muted">' + esc(t.remarks) + '</div>' : '') + '</td>' +
          '<td class="num" data-l="Qty"><b class="' + (t.type === 'IN' || (t.type === 'ADJ' && t.qty > 0) ? 'pos' : t.type === 'COND' ? '' : 'neg') + '">' + (t.type === 'COND' ? '—' : (t.type === 'IN' || (t.type === 'ADJ' && t.qty > 0) ? '+' : '−') + qty(Math.abs(t.qty))) + '</b></td><td class="num" data-l="Unit cost">' + money(t.unitCost) + '</td><td class="num" data-l="Total"><b>' + money(Math.abs(t.totalCost)) + '</b></td><td class="num" data-l="Balance">' + qty(t.balanceAfter) + '</td><td data-l="Ref / party">' + esc(t.ref || '—') + '<div class="small muted">' + esc(t.party) + '</div></td><td data-l="By">' + esc(t.userName) + '</td></tr>').join('') +
        '</tbody></table></div>' + (list.length > f.limit ? '<div class="tfoot-note"><span>Showing ' + f.limit + ' of ' + list.length + '</span><button class="btn btn-sm" data-act="mov-more">Show more</button></div>' : '') : '<div class="card-b">' + empty('list', 'No movements', 'Nothing matches these filters.') + '</div>') + '</div>';
    $('#movDays').addEventListener('change', (e) => { f.days = e.target.value; renderView(true); });
    $('#movQ').addEventListener('input', debounce((e) => { f.q = e.target.value; const pos = e.target.selectionStart; renderView(true); const i = $('#movQ'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }, 300));
  }
  function movFiltered() {
    const f = S.filters.mov; const q = f.q.toLowerCase(); const since = f.days === 'all' ? 0 : Date.now() - (+f.days) * 86400000;
    return S.data.transactions.filter((t) => (!f.type || t.type === f.type) && Date.parse(t.ts) >= since && (!q || (t.itemName + ' ' + t.sku + ' ' + t.ref + ' ' + t.party + ' ' + t.userName + ' ' + t.remarks).toLowerCase().indexOf(q) >= 0)).reverse();
  }

  /* =============================== ALERTS =============================== */
  function computeAlerts() {
    if (!S.A) return [];
    const A = S.A; const r = role(); const out = [];
    if (r !== 'requisitioner') {
      A.out.forEach((x) => out.push({ id: 'out:' + x.id, level: 'danger', icon: 'alert', title: 'Out of stock · ' + x.name, body: 'Suggested order ' + qty(x.suggest) + ' ' + x.unit + ' (' + money(x.suggestCost, 0) + ')', href: '#/receive?item=' + x.id, cta: 'Receive', group: 'Stock' }));
      A.low.forEach((x) => out.push({ id: 'low:' + x.id, level: 'warn', icon: 'alert', title: 'Low stock · ' + x.name, body: qty(x.qty) + ' ' + x.unit + ' left (reorder at ' + qty(x.reorderLevel) + ') · ' + cover(x) + ' of cover', href: '#/receive?item=' + x.id, cta: 'Receive', group: 'Stock' }));
    }
    S.data.requisitions.forEach((q) => {
      const base = { id: 'req:' + q.id + ':' + q.status, icon: 'clipboard', href: '#/requests', group: 'Requisitions', reqId: q.id };
      if (r === 'custodian' && q.status === 'Pending') out.push(Object.assign(base, { level: 'info', title: q.reqNo + ' needs endorsement', body: q.requesterName + ' · ' + q.purpose, cta: 'Review' }));
      if (r === 'custodian' && (q.status === 'Approved' || q.status === 'Partially Issued')) out.push(Object.assign(base, { level: 'info', title: q.reqNo + ' ready to issue', body: q.department + ' · ' + q.lines.length + ' items', cta: 'Issue' }));
      if (r === 'admin' && (q.status === 'Endorsed' || q.status === 'Pending')) out.push(Object.assign(base, { level: q.priority === 'Urgent' ? 'danger' : 'info', title: q.reqNo + ' awaiting approval' + (q.priority === 'Urgent' ? ' · URGENT' : ''), body: q.requesterName + ' · ' + q.purpose, cta: 'Review' }));
      if (r === 'requisitioner' && q.status !== 'Pending' && (Date.now() - Date.parse(q.updatedAt)) < 14 * 86400000) out.push(Object.assign(base, { level: q.status === 'Rejected' ? 'danger' : q.status === 'Issued' ? 'success' : 'info', title: q.reqNo + ' · ' + q.status, body: q.purpose + (q.history.length ? ' — ' + (q.history[q.history.length - 1].note || 'by ' + q.history[q.history.length - 1].by) : ''), cta: 'View' }));
    });
    if (r === 'admin' && A.counts.pending.length) out.push({ id: 'cnt:' + A.counts.pending.map((c) => c.id).join('').slice(-24), level: 'warn', icon: 'scan', title: A.counts.pending.length + ' count variance(s) awaiting posting', body: 'Review and post adjustments from the physical count page.', href: '#/counts', cta: 'Review', group: 'Variance' });
    if (r !== 'requisitioner' && A.salvage.length) out.push({ id: 'salv:' + A.salvage.length, level: 'info', icon: 'recycle', title: A.salvage.length + ' item(s) recommended for salvage or disposal', body: money(A.salvage.reduce((s, x) => s + x.value, 0), 0) + ' book value · ' + money(A.salvage.reduce((s, x) => s + x.salvageValue, 0), 0) + ' est. recovery', href: '#/salvage', cta: 'View', group: 'Condition' });
    return out;
  }
  function markAlertsSeen() { computeAlerts().forEach((a) => { S.seen[a.id] = 1; }); LS.set('sp_seen_' + user().id, S.seen); updateBadges(); setTimeout(renderNav, 0); }
  function vAlerts(el) {
    const al = computeAlerts(); const groups = {};
    al.forEach((a) => { (groups[a.group] = groups[a.group] || []).push(a); });
    const unseen = (a) => !S.seen[a.id];
    const lvl = { danger: 'c-red', warn: 'c-amber', info: 'c-blue', success: 'c-green' };
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    el.innerHTML = '<div class="page-head"><div><h2>Alerts</h2><p>' + al.length + ' active alert' + (al.length === 1 ? '' : 's') + ' · updates live as stock moves.</p></div><div class="actions">' +
      (perm === 'default' ? '<button class="btn btn-accent" data-act="notif">' + I('bell', 16) + ' Enable push notifications</button>' : perm === 'granted' ? chip('Push notifications on', 'c-green') : '') + '</div></div>' +
      (al.length ? Object.keys(groups).map((g) => '<div class="card" style="margin-bottom:16px"><div class="card-h"><h3>' + esc(g) + '</h3><span class="sub">' + groups[g].length + '</span></div><div class="card-b flush" style="padding-top:10px">' +
        groups[g].map((a) => '<div class="list-row"><div class="f-ic ' + lvl[a.level] + '">' + I(a.icon, 16) + '</div><div class="grow"><b>' + esc(a.title) + '</b>' + (unseen(a) ? ' <span class="chip c-navy" style="height:18px;font-size:10px">NEW</span>' : '') + '<div class="small muted">' + esc(a.body) + '</div></div>' +
          (a.reqId ? '<button class="btn btn-sm" data-act="open-req" data-id="' + a.reqId + '">' + esc(a.cta) + '</button>' : '<a class="btn btn-sm" href="' + a.href + '">' + esc(a.cta) + '</a>') + '</div>').join('') + '</div></div>').join('')
        : '<div class="card">' + empty('check', 'All clear', 'No alerts right now. We will let you know when something needs attention.') + '</div>');
  }

  /* =============================== USERS =============================== */
  function vUsers(el) {
    const users = S.data.users.slice().sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
    const cnt = (r) => users.filter((u) => u.role === r && u.active).length;
    el.innerHTML = '<div class="page-head"><div><h2>Users &amp; access</h2><p>Each user signs in to exactly one portal based on their role.</p></div><div class="actions"><button class="btn btn-primary" data-act="user-new">' + I('plus', 16) + ' Add user</button></div></div>' +
      '<div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + ['requisitioner', 'custodian', 'admin'].map((r) => kpi({ label: ROLE_META[r].label, val: cnt(r), num: cnt(r), sub: 'active users', icon: ROLE_META[r].icon, cls: ROLE_META[r].cls })).join('') + '</div>' +
      '<div class="card"><div class="table-wrap"><table class="t responsive"><thead><tr><th>User</th><th>Username</th><th>Portal</th><th>Department</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>' +
      users.map((u) => '<tr><td class="span2"><div class="item-cell"><div class="avatar">' + esc(initials(u.name)) + '</div><div><b>' + esc(u.name) + '</b>' + (u.id === user().id ? '<small>(you)</small>' : '') + '</div></div></td><td class="mono" data-l="Username">' + esc(u.username) + '</td><td data-l="Portal">' + chip(ROLE_META[u.role].short, ROLE_META[u.role].cls) + '</td><td data-l="Department">' + esc(u.department || '—') + '</td><td data-l="Status">' + (u.active ? chip('Active', 'c-green') : chip('Disabled', 'c-gray')) + '</td><td data-l="Created">' + fdate(u.createdAt) + '</td><td class="right"><button class="btn btn-sm" data-act="user-edit" data-id="' + u.id + '">' + I('edit', 14) + ' Edit</button></td></tr>').join('') + '</tbody></table></div></div>';
  }
  function userForm(u) {
    const isNew = !u; u = u || { role: 'requisitioner', active: true };
    const m = modal({
      title: isNew ? 'Add user' : 'Edit user',
      body: '<form id="uF" class="grid-form"><label class="field full"><span>Full name *</span><input class="input" name="name" required value="' + esc(u.name || '') + '"></label>' +
        '<label class="field"><span>Username *</span><input class="input" name="username" required pattern="[a-zA-Z0-9._\\-]{3,30}" autocapitalize="none" value="' + esc(u.username || '') + '"></label>' +
        '<label class="field"><span>Department</span><input class="input" name="department" value="' + esc(u.department || '') + '"></label>' +
        '<label class="field"><span>Portal / role</span><select class="input" name="role">' + ['requisitioner', 'custodian', 'admin'].map((r) => '<option value="' + r + '" ' + (u.role === r ? 'selected' : '') + '>' + ROLE_META[r].label + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>' + (isNew ? 'PIN / password *' : 'Reset PIN (leave blank to keep)') + '</span><input class="input" name="pin" type="text" minlength="4" ' + (isNew ? 'required' : '') + ' autocomplete="new-password"></label>' +
        (isNew ? '' : '<label class="switch full"><input type="checkbox" name="active" ' + (u.active ? 'checked' : '') + '> Account active</label>') + '</form>',
      foot: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="uSave">Save user</button>'
    });
    m.$('#uSave').addEventListener('click', async (e) => {
      const fm = m.$('#uF'); if (!fm.reportValidity()) return;
      const p = { name: fm.name.value, username: fm.username.value, department: fm.department.value, role: fm.role.value, pin: fm.pin.value };
      if (!isNew) { p.id = u.id; p.active = fm.active.checked; }
      try { await write('saveUser', p, e.currentTarget, isNew ? 'User added' : 'User updated'); m.close(); } catch (err) { /* toasted */ }
    });
  }

  /* =============================== SETTINGS =============================== */
  function vSettings(el) {
    const s = Object.assign({}, S.data.settings);
    const n = (k, l, hint, attrs) => '<label class="field"><span>' + l + '</span><input class="input" type="number" name="' + k + '" value="' + esc(s[k]) + '" ' + (attrs || '') + '><span class="hint">' + hint + '</span></label>';
    el.innerHTML = '<div class="page-head"><div><h2>Settings</h2><p>Business rules used by analytics, alerts and salvage recommendations.</p></div></div>' +
      '<div class="grid g-side"><div class="card"><div class="card-h"><h3>' + I('settings', 17) + ' Organization &amp; thresholds</h3></div><div class="card-b"><form id="stF" class="grid-form">' +
      '<label class="field"><span>Company / warehouse name</span><input class="input" name="companyName" value="' + esc(s.companyName) + '"></label>' +
      '<label class="field"><span>Currency (ISO code)</span><input class="input" name="currency" maxlength="3" value="' + esc(s.currency) + '"><span class="hint">PHP, USD, EUR…</span></label>' +
      n('fastTurnover', 'Fast-moving turnover (×)', '90-day issues ÷ average stock', 'step="0.1" min="0.1"') + n('nonMovingDays', 'Dead stock after (days)', 'No movement for this long', 'min="30"') +
      n('salvageAgeYears', 'Salvage review age (years)', 'Old + idle items are reviewed', 'min="1"') + n('salvageRatePct', 'Salvage recovery rate (%)', 'Estimated % of book value', 'min="0" max="100"') +
      n('leadTimeDays', 'Supplier lead time (days)', 'Used by the reorder planner', 'min="1"') + n('pollSeconds', 'Live refresh interval (sec)', 'Lower = more real-time, more API calls', 'min="3" max="120"') +
      '<div class="full"><button class="btn btn-primary" id="stSave">' + I('check', 16) + ' Save settings</button></div></form></div></div>' +
      '<div class="stack"><div class="card"><div class="card-h"><h3>' + I('database', 17) + ' Data source</h3></div><div class="card-b stack"><div class="row">' + (API.isDemo ? chip('Demo data (this browser)', 'c-amber') : chip('Google Sheets · live', 'c-green')) + '</div>' +
      (API.isDemo ? '<p class="small muted" style="margin:0">Connect your Google Apps Script backend to share data across all devices and users.</p>' : '<p class="small muted mono" style="margin:0;word-break:break-all">' + esc(API.url) + '</p>') +
      '<button class="btn" data-act="server">' + I('database', 16) + ' Configure data source</button></div></div>' +
      (API.isDemo ? '<div class="card"><div class="card-h"><h3>' + I('zap', 17) + ' Demo tools</h3></div><div class="card-b stack"><label class="switch"><input type="checkbox" id="simT" ' + (LS.get('sp_sim', true) ? 'checked' : '') + '> Simulate live warehouse activity</label><button class="btn" data-act="demo-reset">' + I('refresh', 16) + ' Reset demo data</button></div></div>' : '') +
      '<div class="card"><div class="card-b small muted">' + esc(CFG.APP_NAME) + ' v' + APP_VERSION + ' · ' + S.data.items.length + ' items · ' + S.data.transactions.length + ' movements loaded</div></div></div></div>';
    const fm = $('#stF'); fm.salvageRatePct.value = Math.round((+s.salvageRate || 0) * 100);
    $('#stSave').addEventListener('click', async (e) => {
      e.preventDefault();
      const p = { companyName: fm.companyName.value.trim(), currency: fm.currency.value.trim().toUpperCase() || 'PHP', fastTurnover: +fm.fastTurnover.value, nonMovingDays: +fm.nonMovingDays.value, salvageAgeYears: +fm.salvageAgeYears.value, salvageRate: (+fm.salvageRatePct.value || 0) / 100, leadTimeDays: +fm.leadTimeDays.value, pollSeconds: +fm.pollSeconds.value };
      try { await write('saveSettings', p, e.currentTarget, 'Settings saved'); startTimers(); } catch (err) { /* toasted */ }
    });
    const sim = $('#simT'); if (sim) sim.addEventListener('change', () => { LS.set('sp_sim', sim.checked); toast(sim.checked ? 'Live simulation on' : 'Live simulation off'); });
  }

  /* =============================== PROFILE =============================== */
  function vProfile(el) {
    const u = user(); const rm = ROLE_META[u.role];
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    el.innerHTML = '<div class="page-head"><div><h2>My account</h2></div></div><div class="grid g-2"><div class="stack">' +
      '<div class="card"><div class="card-b row" style="gap:16px"><div class="avatar" style="width:60px;height:60px;font-size:20px">' + esc(initials(u.name)) + '</div><div class="grow"><h3 style="font-size:18px">' + esc(u.name) + '</h3><div class="muted">@' + esc(u.username) + ' · ' + esc(u.department || '') + '</div><div style="margin-top:6px">' + chip(rm.label, rm.cls) + '</div></div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('smartphone', 17) + ' App &amp; preferences</h3></div><div class="card-b flush">' +
      '<div class="list-row"><div class="grow"><b>Install app</b><div class="small muted">Add ' + esc(CFG.SHORT_NAME) + ' to your home screen or desktop</div></div><button class="btn btn-sm" data-act="install">' + I('download', 14) + ' Install</button></div>' +
      '<div class="list-row"><div class="grow"><b>Dark mode</b><div class="small muted">Easier on the eyes in the warehouse at night</div></div><label class="switch"><input type="checkbox" id="pfDark" ' + (document.documentElement.dataset.theme === 'dark' ? 'checked' : '') + '></label></div>' +
      '<div class="list-row"><div class="grow"><b>Push notifications</b><div class="small muted">' + (perm === 'granted' ? 'Enabled on this device' : perm === 'denied' ? 'Blocked in browser settings' : perm === 'unsupported' ? 'Not supported on this browser' : 'Get alerted when stock runs low or requests change') + '</div></div>' + (perm === 'default' ? '<button class="btn btn-sm" data-act="notif">Enable</button>' : '') + '</div>' +
      (API.isDemo ? '<div class="list-row"><div class="grow"><b>Simulated activity</b><div class="small muted">Demo: other users moving stock</div></div><label class="switch"><input type="checkbox" id="pfSim" ' + (LS.get('sp_sim', true) ? 'checked' : '') + '></label></div>' : '') +
      '<div class="list-row"><div class="grow"><b>Sign out</b><div class="small muted">End your session on this device</div></div><button class="btn btn-sm btn-danger" data-act="logout">' + I('logout', 14) + ' Sign out</button></div></div></div></div>' +
      '<div class="card"><div class="card-h"><h3>' + I('lock', 17) + ' Change PIN</h3></div><div class="card-b"><form id="pinF" class="stack"><label class="field"><span>Current PIN</span><input class="input" type="password" name="oldPin" required autocomplete="current-password"></label><label class="field"><span>New PIN (min 4)</span><input class="input" type="password" name="newPin" minlength="4" required autocomplete="new-password"></label><label class="field"><span>Confirm new PIN</span><input class="input" type="password" name="newPin2" required autocomplete="new-password"></label><button class="btn btn-primary" id="pinGo">Update PIN</button></form></div></div></div>';
    $('#pfDark').addEventListener('change', toggleTheme);
    const sim = $('#pfSim'); if (sim) sim.addEventListener('change', () => LS.set('sp_sim', sim.checked));
    $('#pinF').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      if (!f.reportValidity()) return;
      if (f.newPin.value !== f.newPin2.value) return toast('New PINs do not match', { type: 'warn' });
      try { await write('changePin', { oldPin: f.oldPin.value, newPin: f.newPin.value }, $('#pinGo'), 'PIN updated'); f.reset(); } catch (err) { /* toasted */ }
    });
  }

  /* =============================== ACTIONS (event delegation) =============================== */
  const ACT = {
    go: (a) => { location.hash = a.dataset.href; },
    logout: () => logout(false),
    theme: toggleTheme,
    server: serverModal,
    sync: () => sync(true).then(() => toast(S.online ? 'Up to date' : 'Offline', { type: S.online ? 'success' : 'warn', timeout: 1800 })),
    more: moreSheet,
    print: () => window.print(),
    install: () => promptInstall(),
    notif: async () => { if (!('Notification' in window)) return toast('Not supported on this browser', { type: 'warn' }); const p = await Notification.requestPermission(); toast(p === 'granted' ? 'Notifications enabled' : 'Notifications not enabled', { type: p === 'granted' ? 'success' : 'warn' }); renderView(true); },
    'open-item': (a) => openItem(a.dataset.id),
    'open-req': (a) => openReq(a.dataset.id),
    'item-new': () => itemForm(null),
    'item-cond': (a) => condModal(S.A.byId[a.dataset.id]),
    'item-salvage': (a) => salvageModal(S.A.byId[a.dataset.id]),
    'inv-sort': (a) => { const f = S.filters.inv; if (f.sort === a.dataset.k) f.dir *= -1; else { f.sort = a.dataset.k; f.dir = ['qty', 'value', 'unitCost'].indexOf(a.dataset.k) >= 0 ? -1 : 1; } renderInvTable(); },
    'inv-export': exportInventory,
    'cart-add': (a) => { const x = S.A.byId[a.dataset.id]; setCart(a.dataset.id, 1); toast('Added to cart', { type: 'success', body: x.name, timeout: 1600 }); if (S.view === 'home') renderView(true); },
    'cart-inc': (a) => { const c = S.cart.find((x) => x.itemId === a.dataset.id); setCart(a.dataset.id, (c ? c.qty : 0) + 1); },
    'cart-dec': (a) => { const c = S.cart.find((x) => x.itemId === a.dataset.id); setCart(a.dataset.id, (c ? c.qty : 1) - 1); },
    'cart-open': cartModal,
    'req-tab': (a) => { S.filters.req.tab = a.dataset.tab; renderView(true); },
    'an-tab': (a) => { location.hash = '#/analytics/' + a.dataset.tab; },
    'var-tab': (a) => { location.hash = '#/variance/' + a.dataset.tab; },
    'fsn-f': (a) => { S.filters.fsn = a.dataset.v; renderView(true); },
    'cnt-tab': (a) => { S.filters.cnt.htab = a.dataset.tab; renderCountHistory(); },
    'cnt-clear': () => { S.countDraft = {}; LS.set('sp_count_' + user().id, {}); renderCountSheet(); },
    'cnt-review': async (a) => {
      const ids = $$('[data-cs]').filter((c) => c.checked).map((c) => c.dataset.cs);
      if (!ids.length) return toast('Select at least one count', { type: 'warn' });
      const post = a.dataset.d === 'post';
      const val = S.data.counts.filter((c) => ids.indexOf(c.id) >= 0).reduce((s, c) => s + c.varianceValue, 0);
      const ok = await ask((post ? 'Post ' : 'Void ') + ids.length + ' variance(s)?', post ? 'Stock will be adjusted to the counted quantities. Net value impact: <b>' + signed(val, money) + '</b>.' : 'The counts will be kept for audit but not applied.', { ok: post ? 'Post adjustments' : 'Void', danger: !post });
      if (!ok) return;
      try { await write('reviewCount', { ids, decision: a.dataset.d }, a, post ? 'Adjustments posted' : 'Counts voided'); renderCountHistory(); } catch (e) { /* toasted */ }
    },
    'mv-prefill': (a) => { location.hash = '#/receive?item=' + a.dataset.id + '&t=' + Date.now(); },
    'reorder-export': () => downloadCSV('reorder-plan', ['SKU', 'Item', 'Supplier', 'On hand', 'Reorder level', 'Daily use', 'Days cover', 'Suggested qty', 'Unit', 'Std cost', 'Est. cost'], S.A.reorder.map((r) => [r.sku, r.name, r.supplier, r.qty, r.reorderLevel, r.daily.toFixed(2), r.cover === Infinity ? '' : Math.round(r.cover), r.suggest, r.unit, r.stdCost, r.suggestCost.toFixed(2)])),
    'salv-export': () => downloadCSV('salvage-recommendations', ['SKU', 'Item', 'Condition', 'Age (yrs)', 'Idle (days)', 'Qty', 'Book value', 'Est. recovery', 'Recommendation', 'Reason'], S.A.salvage.map((x) => [x.sku, x.name, x.condition, (x.ageDays / 365).toFixed(1), Math.round(x.idleDays), x.qty, x.value.toFixed(2), x.salvageValue.toFixed(2), x.salvage, x.salvageReason])),
    'mov-type': (a) => { S.filters.mov.type = a.dataset.v; renderView(true); },
    'mov-more': () => { S.filters.mov.limit += 300; renderView(true); },
    'mov-export': () => downloadCSV('movements', ['Date', 'Type', 'SKU', 'Item', 'Qty', 'Unit cost', 'Total cost', 'Balance after', 'Reference', 'Party', 'Remarks', 'Recovery', 'User'], movFiltered().map((t) => [t.ts, t.type, t.sku, t.itemName, t.qty, t.unitCost, t.totalCost, t.balanceAfter, t.ref, t.party, t.remarks, t.recovery, t.userName])),
    'user-new': () => userForm(null),
    'user-edit': (a) => userForm(S.data.users.find((u) => u.id === a.dataset.id)),
    'demo-reset': async () => { const ok = await ask('Reset demo data?', 'All demo changes in this browser will be replaced with fresh sample data.', { ok: 'Reset', danger: true }); if (!ok) return; window.DemoBackend.reset(); S.knownTxn = null; await sync(true); toast('Demo data reset', { type: 'success' }); }
  };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const fn = ACT[a.dataset.act];
    if (fn) { if (a.tagName === 'A' || a.tagName === 'BUTTON' || a.tagName === 'TR' || a.tagName === 'DIV') e.preventDefault(); fn(a, e); }
  });
  // Submit forms via JS so they also work inside sandboxed previews/webviews that block native form submission.
  const fireSubmit = (f) => f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('form button:not([type=button]), form input[type=submit]');
    if (!b || !b.form || b.disabled) return;
    e.preventDefault(); fireSubmit(b.form);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const t = e.target;
    if (!t.form || t.tagName !== 'INPUT' || /^(button|submit|checkbox|radio)$/.test(t.type)) return;
    if (!t.form.querySelector('button:not([type=button]), input[type=submit]')) return;
    e.preventDefault(); fireSubmit(t.form);
  });
  document.addEventListener('focusout', () => setTimeout(() => { if (S.pendingRender && !isTyping() && !modalOpen()) { S.pendingRender = false; renderView(true); } }, 400));

  /* =============================== PWA: INSTALL BANNER & SERVICE WORKER =============================== */
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = () => /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); S.deferredPrompt = e; maybeShowInstall(false); });
  window.addEventListener('appinstalled', () => { hideInstall(); LS.set('sp_install_seen', true); S.deferredPrompt = null; toast('App installed', { type: 'success', body: 'Launch ' + CFG.SHORT_NAME + ' from your home screen.' }); });

  function maybeShowInstall(force) {
    if (isStandalone()) return;
    if (!force && LS.get('sp_install_seen', false)) return;
    if ($('#install')) return;
    let actions, extra = '';
    if (S.deferredPrompt) actions = '<button class="btn btn-ghost btn-sm" data-ib="later">Not now</button><button class="btn btn-accent" data-ib="go">' + I('download', 16) + ' Install</button>';
    else if (isIOS()) { extra = '<div class="ios-steps">Tap <kbd>Share ⎋</kbd> then <kbd>Add to Home Screen ＋</kbd></div>'; actions = '<button class="btn btn-ghost btn-sm" data-ib="later">Got it</button>'; }
    else if (force || isMobile()) { extra = '<div class="ios-steps">Open your browser menu <kbd>⋮</kbd> and choose <kbd>Install app</kbd> or <kbd>Add to Home screen</kbd></div>'; actions = '<button class="btn btn-ghost btn-sm" data-ib="later">Got it</button>'; }
    else return;
    const el = document.createElement('div');
    el.className = 'install'; el.id = 'install';
    el.innerHTML = '<div class="i-logo"></div><div class="grow"><b>Install ' + esc(CFG.SHORT_NAME) + '</b><span class="small" style="display:block;color:#c9d2f5">' + esc(CFG.APP_NAME) + '</span><p>Full-screen, faster launch, offline view and live stock alerts on this device.</p>' + extra + '</div><div class="row">' + actions + '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-ib]'); if (!b) return;
      if (b.dataset.ib === 'go' && S.deferredPrompt) {
        S.deferredPrompt.prompt();
        const choice = await S.deferredPrompt.userChoice.catch(() => ({}));
        S.deferredPrompt = null;
        if (choice && choice.outcome === 'accepted') LS.set('sp_install_seen', true);
      } else LS.set('sp_install_seen', true);
      hideInstall();
    });
  }
  function hideInstall() { const el = $('#install'); if (el) el.remove(); }
  function promptInstall() {
    if (isStandalone()) return toast('Already installed', { type: 'success', body: 'You are using the installed app.' });
    hideInstall(); maybeShowInstall(true);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing; if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw); });
      });
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    }).catch((e) => console.warn('SW registration failed', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.updating) location.reload(); });
  }
  function showUpdate(worker) {
    if ($('.update-bar')) return;
    const el = document.createElement('div');
    el.className = 'update-bar';
    el.innerHTML = I('zap', 16) + ' A new version is available <button class="btn btn-sm btn-accent">Refresh</button>';
    el.querySelector('button').addEventListener('click', () => { S.updating = true; worker.postMessage({ type: 'SKIP_WAITING' }); });
    document.body.appendChild(el);
  }

  /* =============================== BOOT =============================== */
  function init() {
    applyTheme(LS.get('sp_theme', matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    S.portal = LS.get('sp_portal', 'custodian');
    registerSW();
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { S.online = true; sync(true); toast('Back online', { type: 'success', timeout: 2000 }); });
    window.addEventListener('offline', () => { S.online = false; updateLive(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) sync(); });
    window.addEventListener('storage', (e) => { if (API.isDemo && e.key === window.DemoBackend.storageKey && S.session) sync(); });
    window.addEventListener('resize', debounce(() => { if (S.session && S.charts.length) renderView(true); }, 400));
    const sess = LS.get('sp_session', null);
    if (sess && sess.token && sess.user) { S.session = sess; enterApp(); } else { renderLogin(); setTimeout(() => maybeShowInstall(false), 1500); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
