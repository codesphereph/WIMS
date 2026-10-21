/* CPU WIMS — Demo backend.
 * Mirrors the Apps Script API (backend/Code.gs) but stores data in localStorage,
 * so the app is fully usable before the Google Sheets backend is connected.
 * Data is shared between tabs: open two portals side by side to watch updates live.
 */
(function () {
  'use strict';
  const KEY = 'cpu_wims_demo_db_v2';
  const DAY = 86400000;

  class WmsError extends Error { constructor(m, c) { super(m); this.code = c || 'ERROR'; } }
  window.WmsError = WmsError;

  const DEFAULT_SETTINGS = {
    companyName: 'CPU Central Warehouse', currency: 'PHP', fastTurnover: 1, nonMovingDays: 180,
    salvageAgeYears: 5, salvageRate: 0.15, leadTimeDays: 14, pollSeconds: 5
  };
  const CONDITIONS = ['Good', 'Damaged', 'Non-functional', 'Obsolete'];
  const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];

  const iso = (t) => new Date(t === undefined ? Date.now() : t).toISOString();
  const uid = (p) => p + '-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
  const round = (n, d = 2) => { const f = Math.pow(10, d); return Math.round(num(n) * f) / f; };
  const err = (m, c) => new WmsError(m, c);

  /* ---------------- persistence ---------------- */
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
    const db = seed();
    save(db);
    return db;
  }
  function save(db) {
    db.version = String(Date.now()) + Math.random().toString(36).slice(2, 5);
    if (db.transactions.length > 6000) db.transactions = db.transactions.slice(-6000);
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { throw err('Browser storage is full. Reset the demo data in Settings.'); }
  }
  function reset() { localStorage.removeItem(KEY); return load(); }

  /* ---------------- seed data ---------------- */
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function seed() {
    const R = rng(20261021);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const now = Date.now();
    const users = [
      { id: 'US-ADMIN', username: 'admin', name: 'Maria Santos', role: 'admin', department: 'Management', pin: 'admin123', active: true },
      { id: 'US-CUST', username: 'custodian', name: 'Jose Reyes', role: 'custodian', department: 'Warehouse', pin: 'custodian123', active: true },
      { id: 'US-REQ', username: 'requester', name: 'Ana Cruz', role: 'requisitioner', department: 'Project Site A – Talamban', pin: 'request123', active: true },
      { id: 'US-REQ2', username: 'mark', name: 'Mark Lim', role: 'requisitioner', department: 'Carpentry Team', pin: 'mark1234', active: true }
    ].map((u) => Object.assign(u, { createdAt: iso(now - 200 * DAY) }));

    // sku, name, category, unit, cost (PHP), reorder level, velocity (prob/day), max qty per issue, bin, extra
    const cat = [
      // Aggregates — sold/issued by cubic meter
      ['AGG-001', 'Washed Sand (S1)', 'Aggregates', 'cu.m', 1450, 12, 0.75, 4, 'YARD-A1'],
      ['AGG-002', 'Filling Sand / Escombro', 'Aggregates', 'cu.m', 850, 10, 0.45, 5, 'YARD-A2'],
      ['AGG-003', 'Gravel 3/4" (G1)', 'Aggregates', 'cu.m', 1650, 12, 0.7, 4, 'YARD-A3'],
      ['AGG-004', 'Gravel 3/8" Pea Gravel', 'Aggregates', 'cu.m', 1750, 6, 0.3, 2, 'YARD-A4'],
      ['AGG-005', 'Crushed Rock / Base Course', 'Aggregates', 'cu.m', 1250, 8, 0.25, 3, 'YARD-A5', { noRestockLate: true }],
      // Masonry
      ['MAS-001', 'Hollow Block CHB 4"', 'Masonry & Cement', 'pc', 14, 800, 0.8, 250, 'YARD-B1'],
      ['MAS-002', 'Hollow Block CHB 5"', 'Masonry & Cement', 'pc', 17, 500, 0.55, 150, 'YARD-B2'],
      ['MAS-003', 'Hollow Block CHB 6"', 'Masonry & Cement', 'pc', 22, 400, 0.35, 120, 'YARD-B3'],
      ['MAS-004', 'Portland Cement 40kg', 'Masonry & Cement', 'bag', 265, 100, 0.85, 30, 'WH-C1'],
      ['MAS-005', 'Masonry Cement 40kg', 'Masonry & Cement', 'bag', 240, 40, 0.3, 10, 'WH-C1'],
      ['MAS-006', 'Tile Adhesive 25kg', 'Masonry & Cement', 'bag', 380, 20, 0.15, 5, 'WH-C2', { overstock: true }],
      // Lumber & plywood
      ['LUM-001', 'Plywood Ordinary 1/4" (4x8)', 'Lumber & Plywood', 'sheet', 420, 30, 0.5, 8, 'WH-D1'],
      ['LUM-002', 'Plywood Ordinary 1/2" (4x8)', 'Lumber & Plywood', 'sheet', 780, 25, 0.4, 6, 'WH-D1'],
      ['LUM-003', 'Marine Plywood 3/4" (4x8)', 'Lumber & Plywood', 'sheet', 1350, 15, 0.25, 4, 'WH-D2'],
      ['LUM-004', 'Phenolic Board 3/4" (Formwork)', 'Lumber & Plywood', 'sheet', 1150, 20, 0.3, 6, 'WH-D2'],
      ['LUM-005', 'Coco Lumber 2"x2"x10\'', 'Lumber & Plywood', 'pc', 85, 100, 0.55, 30, 'WH-D3'],
      ['LUM-006', 'Good Lumber 2"x4"x10\'', 'Lumber & Plywood', 'pc', 320, 40, 0.3, 10, 'WH-D3'],
      // Nails & fasteners — by kilo
      ['NAL-001', 'Common Wire Nail 1"', 'Nails & Fasteners', 'kg', 98, 15, 0.35, 3, 'WH-E1'],
      ['NAL-002', 'Common Wire Nail 1-1/2"', 'Nails & Fasteners', 'kg', 92, 20, 0.5, 4, 'WH-E1'],
      ['NAL-003', 'Common Wire Nail 2"', 'Nails & Fasteners', 'kg', 88, 30, 0.7, 6, 'WH-E1'],
      ['NAL-004', 'Common Wire Nail 2-1/2"', 'Nails & Fasteners', 'kg', 88, 25, 0.55, 5, 'WH-E2'],
      ['NAL-005', 'Common Wire Nail 3"', 'Nails & Fasteners', 'kg', 86, 30, 0.6, 6, 'WH-E2'],
      ['NAL-006', 'Common Wire Nail 4"', 'Nails & Fasteners', 'kg', 86, 20, 0.35, 4, 'WH-E2', { noRestockLate: true }],
      ['NAL-007', 'Concrete Nail 2"', 'Nails & Fasteners', 'kg', 135, 10, 0.25, 2, 'WH-E3'],
      ['NAL-008', 'Umbrella Roofing Nail 2-1/2"', 'Nails & Fasteners', 'kg', 125, 10, 0.2, 2, 'WH-E3'],
      ['NAL-009', 'Finishing Nail 1-1/2"', 'Nails & Fasteners', 'kg', 115, 8, 0.15, 2, 'WH-E3'],
      ['NAL-010', 'Tekscrew 2-1/2" (100s)', 'Nails & Fasteners', 'box', 290, 15, 0.2, 3, 'WH-E4'],
      // Steel
      ['STL-001', 'Deformed Bar 10mm x 6m', 'Steel & Rebar', 'pc', 215, 80, 0.5, 25, 'YARD-F1'],
      ['STL-002', 'Deformed Bar 12mm x 6m', 'Steel & Rebar', 'pc', 310, 60, 0.4, 20, 'YARD-F1'],
      ['STL-003', 'Deformed Bar 16mm x 6m', 'Steel & Rebar', 'pc', 540, 30, 0.15, 8, 'YARD-F2'],
      ['STL-004', 'G.I. Tie Wire #16', 'Steel & Rebar', 'kg', 85, 25, 0.5, 5, 'WH-F3'],
      // Roofing, paint, tools, PPE
      ['ROF-001', 'G.I. Corrugated Sheet Ga.26 x 8ft', 'Roofing', 'sheet', 465, 30, 0.15, 10, 'WH-G1'],
      ['PNT-001', 'Latex Paint White 4L', 'Paint & Finishing', 'gal', 780, 10, 0.12, 2, 'WH-H1'],
      ['PNT-002', 'Paint Thinner 1L', 'Paint & Finishing', 'bottle', 125, 12, 0.2, 3, 'WH-H1'],
      ['TLS-001', 'Shovel Pointed (Steel Handle)', 'Tools & Equipment', 'pc', 420, 6, 0.06, 1, 'WH-T1'],
      ['TLS-002', 'Wheelbarrow Heavy Duty', 'Tools & Equipment', 'unit', 2850, 3, 0.03, 1, 'WH-T2'],
      ['PPE-001', 'Safety Helmet (Yellow)', 'PPE & Safety', 'pc', 320, 20, 0.25, 4, 'WH-P1'],
      ['PPE-002', 'Cotton Work Gloves (dozen)', 'PPE & Safety', 'dozen', 180, 15, 0.45, 3, 'WH-P1'],
      // Salvage / disposal candidates
      ['TLS-090', 'Concrete Mixer 1-Bagger (Seized Engine)', 'Tools & Equipment', 'unit', 68000, 0, 0, 0, 'YARD-Z1', { condition: 'Non-functional', acquired: '2018-05-10', qty: 1 }],
      ['TLS-091', 'Wheelbarrow (Broken Tray)', 'Tools & Equipment', 'unit', 2600, 0, 0, 0, 'YARD-Z1', { condition: 'Damaged', acquired: '2020-07-03', qty: 5 }],
      ['ROF-090', 'G.I. Sheet Ga.26 (Rusted, Water-damaged)', 'Roofing', 'sheet', 440, 0, 0, 0, 'YARD-Z2', { condition: 'Damaged', acquired: '2021-01-18', qty: 34 }],
      ['LUM-090', 'Plywood 1/4" (Delaminated, Wet)', 'Lumber & Plywood', 'sheet', 400, 0, 0, 0, 'YARD-Z2', { condition: 'Damaged', acquired: '2023-06-12', qty: 18 }],
      ['MAS-090', 'Cement 40kg (Hardened, Expired)', 'Masonry & Cement', 'bag', 255, 0, 0, 0, 'WH-Z3', { condition: 'Obsolete', acquired: '2024-02-20', qty: 22 }],
      ['HDW-090', 'Door Knob Set (Discontinued Model)', 'Hardware', 'set', 650, 0, 0, 0, 'WH-Z3', { condition: 'Obsolete', acquired: '2017-09-01', qty: 14 }],
      ['HDW-001', 'Steel Door Hinge 4" (pair)', 'Hardware', 'pair', 95, 0, 0, 0, 'WH-Z4', { acquired: '2019-04-15', qty: 60 }]
    ];
    const suppliers = ['Mandaue Builders Depot', 'Cebu Hardware Supply', 'Talisay Aggregates Corp.', 'Visayas Steel Trading', 'Island Lumber & Plywood', 'Consolacion Hollow Blocks', 'Citi Hardware Supply'];
    const SUP = { 'Aggregates': 'Talisay Aggregates Corp.', 'Masonry & Cement': 'Consolacion Hollow Blocks', 'Lumber & Plywood': 'Island Lumber & Plywood',
      'Nails & Fasteners': 'Cebu Hardware Supply', 'Steel & Rebar': 'Visayas Steel Trading', 'Roofing': 'Mandaue Builders Depot', 'Paint & Finishing': 'Citi Hardware Supply',
      'Tools & Equipment': 'Citi Hardware Supply', 'PPE & Safety': 'Cebu Hardware Supply', 'Hardware': 'Cebu Hardware Supply' };
    const depts = ['Project Site A – Talamban', 'Project Site B – Mandaue', 'Masonry Team', 'Carpentry Team', 'Steel Works', 'Roofing Crew', 'Maintenance'];
    const START = 150;
    const items = []; const transactions = []; const counts = [];
    const state = {};

    function dayTs(dayOffset) {
      const d = new Date(now - dayOffset * DAY);
      d.setHours(8 + Math.floor(R() * 9), Math.floor(R() * 60), Math.floor(R() * 60), 0);
      return Math.min(d.getTime(), now - 60000 * (1 + Math.floor(R() * 50)));
    }
    function addTxn(it, type, qty, unitCost, ts, extra) {
      const t = Object.assign({
        id: 'TX-' + (transactions.length + 1).toString(36).toUpperCase() + Math.floor(R() * 1e6).toString(36).toUpperCase(),
        ts: iso(ts), type, itemId: it.id, sku: it.sku, itemName: it.name, qty: round(qty, 4), unitCost: round(unitCost, 4),
        totalCost: round(qty * unitCost, 2), balanceAfter: it.qty, ref: '', party: '', remarks: '', recovery: 0, userName: 'Jose Reyes'
      }, extra || {});
      transactions.push(t);
    }

    cat.forEach((c, idx) => {
      const ex = c[9] || {};
      const it = {
        id: 'IT-' + String(idx + 1).padStart(4, '0'), sku: c[0], name: c[1], category: c[2], unit: c[3], location: c[8],
        qty: 0, unitCost: c[4], stdCost: c[4], reorderLevel: c[5], maxLevel: c[5] ? c[5] * 5 : 0, condition: ex.condition || 'Good',
        dateAcquired: ex.acquired || iso(now - (START + 20 + Math.floor(R() * 400)) * DAY).slice(0, 10),
        supplier: SUP[c[2]] || pick(suppliers), remarks: '', active: true, updatedAt: iso(now)
      };
      items.push(it);
      state[it.id] = { vel: c[6], maxOut: c[7], pendingIn: null, ex };
      const openQty = ex.qty || Math.max(c[5] * 3, 3) + Math.floor(R() * c[5]);
      const cost = round(c[4] * (0.95 + R() * 0.08), 2);
      it.qty = openQty; it.unitCost = cost;
      addTxn(it, 'IN', openQty, cost, dayTs(ex.acquired ? 240 + Math.floor(R() * 120) : START), { ref: 'OPENING', party: it.supplier, remarks: 'Opening balance' });
    });

    for (let d = START - 1; d >= 0; d--) {
      items.forEach((it) => {
        const st = state[it.id];
        // receive scheduled restocks
        if (st.pendingIn && st.pendingIn.day >= d) {
          const q = st.pendingIn.qty; const cost = st.pendingIn.cost;
          const nq = it.qty + q; it.unitCost = round((it.qty * it.unitCost + q * cost) / nq, 4); it.qty = nq;
          addTxn(it, 'IN', q, cost, dayTs(d), { ref: 'DR-' + (4000 + transactions.length), party: it.supplier, remarks: 'PO delivery' });
          st.pendingIn = null;
        }
        if (st.vel > 0 && R() < st.vel && it.qty > 0) {
          const q = Math.min(it.qty, 1 + Math.floor(R() * st.maxOut));
          it.qty = round(it.qty - q, 4);
          addTxn(it, 'OUT', q, it.unitCost, dayTs(d), { ref: 'RIS-' + (7000 + transactions.length), party: pick(depts), remarks: 'Issued to site' });
        }
        const lateFreeze = st.ex.noRestockLate && d < 25;
        if (!st.pendingIn && it.reorderLevel > 0 && it.qty <= it.reorderLevel && !lateFreeze && d > 2) {
          const lead = 3 + Math.floor(R() * 5);
          const target = it.reorderLevel * (st.ex.overstock ? 7 : 3);
          const cost = round(it.stdCost * (0.92 + R() * 0.2), 2);
          st.pendingIn = { day: d - lead, qty: Math.max(1, target - it.qty), cost };
        }
      });
      // physical count 40 days ago (posted) and 3 days ago (pending)
      if (d === 40 || d === 3) {
        const posted = d === 40;
        items.filter((x, i) => i % 3 === (posted ? 0 : 1)).forEach((it) => {
          const roll = R();
          let v = 0;
          if (roll < 0.14) v = -Math.max(1, Math.round(it.qty * 0.04 * R() + 1));
          else if (roll < 0.19) v = Math.max(1, Math.round(R() * 2));
          if (it.qty + v < 0) v = -it.qty;
          const ts = dayTs(d);
          const c = {
            id: 'CT-' + (counts.length + 1).toString().padStart(4, '0'), ts: iso(ts), itemId: it.id, sku: it.sku, itemName: it.name, category: it.category,
            systemQty: it.qty, countedQty: it.qty + v, variance: v, unitCost: it.unitCost, varianceValue: round(v * it.unitCost, 2),
            countedBy: 'Jose Reyes', remarks: v < 0 ? pick(['Possible pilferage', 'Unrecorded issuance', 'Spillage / washout in yard', 'Short delivery not reported', 'Broken during handling']) : (v > 0 ? 'Unrecorded return' : ''),
            status: v === 0 ? 'Matched' : (posted ? 'Posted' : 'Pending'), postedBy: posted && v !== 0 ? 'Maria Santos' : '', postedAt: posted && v !== 0 ? iso(ts + 3600000) : ''
          };
          counts.push(c);
          if (posted && v !== 0) {
            it.qty = it.qty + v;
            addTxn(it, 'ADJ', v, it.unitCost, ts + 3600000, { ref: 'COUNT ' + c.id, party: 'Physical count', remarks: c.remarks, userName: 'Maria Santos' });
          }
        });
      }
    }
    // condition change audit trail
    items.filter((i) => i.condition !== 'Good').forEach((it) => {
      addTxn(it, 'COND', 0, it.unitCost, dayTs(20 + Math.floor(R() * 60)), { remarks: 'Good → ' + it.condition + ' · Inspection finding' });
    });
    // a past disposal so the salvage history is not empty
    const oldMon = items.find((i) => i.sku === 'HDW-090');
    if (oldMon && oldMon.qty > 3) { oldMon.qty -= 3; addTxn(oldMon, 'SALVAGE', 3, oldMon.unitCost, dayTs(34), { ref: 'IIRUP-2026-014', party: 'Scrap sale', remarks: 'Sold to scrap buyer as mixed metal', recovery: 450, userName: 'Maria Santos' }); }
    transactions.sort((a, b) => a.ts < b.ts ? -1 : 1);

    // Requisitions in various stages
    const byS = (s) => items.find((i) => i.sku === s);
    const mkReq = (no, user, daysAgo, status, lines, purpose, priority, extraHist) => {
      const created = now - daysAgo * DAY - Math.floor(R() * 5 * 3600000);
      const hist = [{ at: iso(created), by: user.name, role: user.role, action: 'Submitted', note: '' }];
      (extraHist || []).forEach((h, i) => hist.push({ at: iso(created + (i + 1) * 3 * 3600000), by: h[0], role: h[1], action: h[2], note: h[3] || '' }));
      return {
        id: 'RQ-' + no, reqNo: 'RQ-2610-' + String(no).padStart(4, '0'), createdAt: iso(created), requesterId: user.id, requesterName: user.name,
        department: user.department, purpose, priority, neededBy: iso(created + 5 * DAY).slice(0, 10), status,
        lines: lines.map(([s, q, iq]) => { const it = byS(s); return { itemId: it.id, sku: it.sku, name: it.name, unit: it.unit, qty: q, issuedQty: iq || 0, unitCost: it.unitCost }; }),
        history: hist, updatedAt: hist[hist.length - 1].at
      };
    };
    const [, , ana, mark] = users;
    const J = ['Jose Reyes', 'custodian']; const M = ['Maria Santos', 'admin'];
    const requisitions = [
      mkReq(1, ana, 12, 'Issued', [['MAS-004', 40, 40], ['AGG-001', 4, 4], ['AGG-003', 4, 4]], 'Slab on grade – Unit 3 ground floor', 'High', [[...J, 'Endorsed'], [...M, 'Approved'], [...J, 'Issued']]),
      mkReq(2, mark, 9, 'Issued', [['LUM-004', 12, 12], ['LUM-005', 40, 40], ['NAL-003', 5, 5], ['NAL-005', 5, 5]], 'Column & beam formworks – 2nd floor', 'Normal', [[...J, 'Endorsed'], [...M, 'Approved'], [...J, 'Issued']]),
      mkReq(3, ana, 6, 'Rejected', [['TLS-002', 3]], 'Additional wheelbarrows for site', 'Normal', [[...J, 'Endorsed'], [...M, 'Rejected', 'Borrow from Site B pool; 2 units idle there']]),
      mkReq(4, ana, 3, 'Partially Issued', [['MAS-001', 600, 400], ['MAS-004', 25, 25], ['AGG-001', 3, 3]], 'Perimeter wall CHB laying – Lot 7', 'Urgent', [[...J, 'Endorsed'], [...M, 'Approved'], [...J, 'Partially Issued', 'CHB 4" short — balance on next delivery']]),
      mkReq(5, mark, 2, 'Approved', [['LUM-002', 10], ['NAL-002', 3], ['NAL-009', 2]], 'Ceiling framing & ceiling board – Unit 5', 'Normal', [[...J, 'Endorsed'], [...M, 'Approved']]),
      mkReq(6, ana, 1, 'Endorsed', [['STL-002', 40], ['STL-001', 60], ['STL-004', 10]], 'Footing & column rebars – Building B', 'High', [[...J, 'Endorsed', 'Stock available']]),
      mkReq(7, ana, 0.2, 'Pending', [['AGG-002', 8], ['AGG-005', 6], ['MAS-004', 30]], 'Driveway sub-base and pouring', 'Normal'),
      mkReq(8, mark, 0.1, 'Pending', [['ROF-001', 24], ['NAL-008', 4], ['PNT-001', 3]], 'Roof repair – site office & bunkhouse', 'Low')
    ];


    return { users, items, transactions, requisitions, counts, settings: Object.assign({}, DEFAULT_SETTINGS), reqSeq: 8, version: '1' };
  }

  /* ---------------- helpers mirroring the backend ---------------- */
  function session(db, token, roles) {
    const id = String(token || '').replace(/^demo\./, '');
    const u = db.users.find((x) => x.id === id && x.active);
    if (!u) throw err('Session expired. Please sign in again.', 'AUTH');
    if (roles && roles.indexOf(u.role) < 0) throw err('You do not have permission for this action.', 'FORBIDDEN');
    return u;
  }
  const pub = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, department: u.department, active: u.active, createdAt: u.createdAt });
  const item = (db, id) => { const it = db.items.find((i) => i.id === id); if (!it) throw err('Item not found.'); return it; };
  function txn(db, type, it, qty, unitCost, p, s) {
    const t = {
      id: uid('TX'), ts: iso(), type, itemId: it.id, sku: it.sku, itemName: it.name, qty: round(qty, 4), unitCost: round(unitCost, 4),
      totalCost: round(qty * unitCost, 2), balanceAfter: it.qty, ref: String(p.ref || ''), party: String(p.party || ''),
      remarks: String(p.remarks || ''), recovery: num(p.recovery), userName: s.name
    };
    db.transactions.push(t);
    return t;
  }
  function doIn(db, p, s) {
    const qty = num(p.qty); const cost = num(p.unitCost);
    if (!(qty > 0)) throw err('Quantity must be greater than zero.');
    if (cost < 0) throw err('Unit cost cannot be negative.');
    const it = item(db, p.itemId);
    const nq = it.qty + qty;
    it.unitCost = nq > 0 ? round((it.qty * it.unitCost + qty * cost) / nq, 4) : cost;
    it.qty = nq; it.updatedAt = iso();
    return { item: it, txn: txn(db, 'IN', it, qty, cost, p, s) };
  }
  function doOut(db, it, qty, p, s) {
    if (!(qty > 0)) throw err('Quantity must be greater than zero.');
    if (qty > it.qty) throw err('Insufficient stock for ' + it.name + ': only ' + it.qty + ' ' + it.unit + ' available.');
    it.qty = round(it.qty - qty, 4); it.updatedAt = iso();
    return { item: it, txn: txn(db, 'OUT', it, qty, it.unitCost, p, s) };
  }
  const REQ_RULES = {
    endorse: { roles: ['custodian', 'admin'], from: ['Pending'], label: 'Endorsed' },
    approve: { roles: ['admin'], from: ['Pending', 'Endorsed'], label: 'Approved' },
    reject: { roles: ['custodian', 'admin'], from: ['Pending', 'Endorsed', 'Approved'], label: 'Rejected' },
    issue: { roles: ['custodian', 'admin'], from: ['Approved', 'Partially Issued'], label: 'Issued' },
    cancel: { roles: ['requisitioner', 'custodian', 'admin'], from: ['Pending', 'Endorsed'], label: 'Cancelled' }
  };

  const ACTIONS = {
    ping: (db) => ({ pong: true, version: db.version }),
    login(db, p) {
      const u = db.users.find((x) => x.username.toLowerCase() === String(p.username || '').trim().toLowerCase());
      if (!u || !u.active || u.pin !== String(p.pin || '')) throw err('Invalid username or PIN', 'AUTH_FAILED');
      return { token: 'demo.' + u.id, user: pub(u) };
    },
    logout: () => true,
    sync(db, p, t) {
      const s = session(db, t);
      if (p.since && p.since === db.version) return { changed: false, version: db.version };
      const isReq = s.role === 'requisitioner';
      return {
        changed: true, version: db.version, items: db.items,
        transactions: isReq ? [] : db.transactions.slice(-3000),
        requisitions: isReq ? db.requisitions.filter((r) => r.requesterId === s.id) : db.requisitions,
        counts: isReq ? [] : db.counts, users: s.role === 'admin' ? db.users.map(pub) : [],
        settings: Object.assign({}, DEFAULT_SETTINGS, db.settings), serverTime: iso()
      };
    },
    saveItem: { roles: ['admin'], fn(db, p, s) {
      const sku = String(p.sku || '').trim(); const name = String(p.name || '').trim();
      if (!sku) throw err('SKU is required.'); if (!name) throw err('Item name is required.');
      if (p.condition && CONDITIONS.indexOf(p.condition) < 0) throw err('Invalid condition.');
      if (db.items.some((i) => i.sku.toLowerCase() === sku.toLowerCase() && i.id !== p.id)) throw err('SKU already exists: ' + sku);
      if (p.id) {
        const o = item(db, p.id);
        ['sku', 'name', 'category', 'unit', 'location', 'condition', 'dateAcquired', 'supplier', 'remarks'].forEach((k) => { if (p[k] !== undefined) o[k] = String(p[k]).trim(); });
        ['stdCost', 'reorderLevel', 'maxLevel'].forEach((k) => { if (p[k] !== undefined) o[k] = num(p[k]); });
        if (p.active !== undefined) o.active = !!p.active;
        o.updatedAt = iso();
        return { item: o };
      }
      const cost = num(p.unitCost || p.stdCost);
      const o = {
        id: uid('IT'), sku, name, category: String(p.category || 'General'), unit: String(p.unit || 'pc'), location: String(p.location || ''),
        qty: 0, unitCost: cost, stdCost: num(p.stdCost || cost), reorderLevel: num(p.reorderLevel), maxLevel: num(p.maxLevel),
        condition: p.condition || 'Good', dateAcquired: p.dateAcquired || iso().slice(0, 10), supplier: String(p.supplier || ''),
        remarks: String(p.remarks || ''), active: true, updatedAt: iso()
      };
      db.items.push(o);
      if (num(p.openingQty) > 0) return doIn(db, { itemId: o.id, qty: p.openingQty, unitCost: cost, ref: 'OPENING', party: o.supplier, remarks: 'Opening balance' }, s);
      return { item: o };
    } },
    setCondition: { roles: ['custodian', 'admin'], fn(db, p, s) {
      if (CONDITIONS.indexOf(p.condition) < 0) throw err('Invalid condition.');
      const it = item(db, p.itemId); const before = it.condition;
      if (before === p.condition) return { item: it };
      it.condition = p.condition; it.updatedAt = iso();
      return { item: it, txn: txn(db, 'COND', it, 0, it.unitCost, { remarks: before + ' → ' + p.condition + (p.remarks ? ' · ' + p.remarks : '') }, s) };
    } },
    stockIn: { roles: ['custodian', 'admin'], fn: (db, p, s) => doIn(db, p, s) },
    stockOut: { roles: ['custodian', 'admin'], fn: (db, p, s) => doOut(db, item(db, p.itemId), num(p.qty), p, s) },
    salvage: { roles: ['admin'], fn(db, p, s) {
      const it = item(db, p.itemId); const qty = num(p.qty);
      if (!(qty > 0)) throw err('Quantity must be greater than zero.');
      if (qty > it.qty) throw err('Only ' + it.qty + ' ' + it.unit + ' on hand.');
      it.qty = round(it.qty - qty, 4); it.updatedAt = iso();
      return { item: it, txn: txn(db, 'SALVAGE', it, qty, it.unitCost, { ref: p.ref, party: p.method || 'Salvage', remarks: p.remarks, recovery: p.recovery }, s) };
    } },
    createRequisition: { fn(db, p, s) {
      const lines = (p.lines || []).map((l) => {
        const it = item(db, l.itemId); const q = num(l.qty);
        if (!(q > 0)) throw err('Requested quantity must be greater than zero.');
        return { itemId: it.id, sku: it.sku, name: it.name, unit: it.unit, qty: q, issuedQty: 0, unitCost: it.unitCost };
      });
      if (!lines.length) throw err('Add at least one item to the requisition.');
      if (!String(p.purpose || '').trim()) throw err('Purpose is required.');
      db.reqSeq = (db.reqSeq || 0) + 1;
      const d = new Date(); const now = iso();
      const r = {
        id: uid('RQ'), reqNo: 'RQ-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(db.reqSeq).padStart(4, '0'),
        createdAt: now, requesterId: s.id, requesterName: s.name, department: String(p.department || s.department || ''),
        purpose: String(p.purpose).trim(), priority: PRIORITIES.indexOf(p.priority) >= 0 ? p.priority : 'Normal', neededBy: String(p.neededBy || ''),
        status: 'Pending', lines, history: [{ at: now, by: s.name, role: s.role, action: 'Submitted', note: String(p.note || '') }], updatedAt: now
      };
      db.requisitions.push(r);
      return { requisition: r };
    } },
    requisitionAction: { fn(db, p, s) {
      const rule = REQ_RULES[p.action];
      if (!rule) throw err('Unknown requisition action.');
      if (rule.roles.indexOf(s.role) < 0) throw err('You do not have permission to ' + p.action + ' requisitions.', 'FORBIDDEN');
      const r = db.requisitions.find((x) => x.id === p.id);
      if (!r) throw err('Requisition not found.');
      if (rule.from.indexOf(r.status) < 0) throw err('Cannot ' + p.action + ' a requisition that is ' + r.status + '.');
      if (p.action === 'reject' && s.role === 'custodian' && r.status !== 'Pending') throw err('Only admins can reject after endorsement.');
      if (p.action === 'cancel' && s.role === 'requisitioner' && r.requesterId !== s.id) throw err('You can only cancel your own requests.');
      if ((p.action === 'reject' || p.action === 'cancel') && !String(p.note || '').trim() && s.role !== 'requisitioner') throw err('Please give a reason.');
      let status = rule.label;
      if (p.action === 'issue') {
        const plan = p.issue || {}; let any = false;
        r.lines.forEach((l) => {
          const remaining = round(l.qty - (l.issuedQty || 0), 4);
          if (remaining <= 0) return;
          const it = db.items.find((i) => i.id === l.itemId); if (!it) return;
          const wanted = plan[l.itemId] !== undefined ? num(plan[l.itemId]) : remaining;
          const give = Math.min(wanted, remaining, it.qty);
          if (give > 0) { doOut(db, it, give, { ref: r.reqNo, party: r.department || r.requesterName, remarks: 'Requisition ' + r.reqNo }, s); l.issuedQty = round((l.issuedQty || 0) + give, 4); any = true; }
        });
        if (!any) throw err('Nothing was issued — check available stock.');
        status = r.lines.every((l) => (l.issuedQty || 0) >= l.qty) ? 'Issued' : 'Partially Issued';
      }
      r.status = status; r.updatedAt = iso();
      r.history.push({ at: r.updatedAt, by: s.name, role: s.role, action: status, note: String(p.note || '') });
      return { requisition: r };
    } },
    submitCount: { roles: ['custodian', 'admin'], fn(db, p, s) {
      const entries = p.entries || [];
      if (!entries.length) throw err('Enter at least one counted quantity.');
      const now = iso();
      return { counts: entries.map((e) => {
        const it = item(db, e.itemId); const counted = num(e.countedQty);
        if (counted < 0) throw err('Counted quantity cannot be negative.');
        const v = round(counted - it.qty, 4);
        const c = { id: uid('CT'), ts: now, itemId: it.id, sku: it.sku, itemName: it.name, category: it.category, systemQty: it.qty, countedQty: counted,
          variance: v, unitCost: it.unitCost, varianceValue: round(v * it.unitCost, 2), countedBy: s.name, remarks: String(e.remarks || ''),
          status: v === 0 ? 'Matched' : 'Pending', postedBy: '', postedAt: '' };
        db.counts.push(c);
        return c;
      }) };
    } },
    reviewCount: { roles: ['admin'], fn(db, p, s) {
      if (['post', 'void'].indexOf(p.decision) < 0) throw err('Invalid decision.');
      const done = [];
      (p.ids || []).forEach((id) => {
        const c = db.counts.find((x) => x.id === id);
        if (!c || c.status !== 'Pending') return;
        if (p.decision === 'post') {
          const it = db.items.find((i) => i.id === c.itemId);
          if (it) {
            const nq = Math.max(0, round(it.qty + c.variance, 4)); const applied = round(nq - it.qty, 4);
            it.qty = nq; it.updatedAt = iso();
            txn(db, 'ADJ', it, applied, it.unitCost, { ref: 'COUNT ' + c.id, party: 'Physical count', remarks: c.remarks || 'Count variance posted' }, s);
          }
          c.status = 'Posted';
        } else c.status = 'Voided';
        c.postedBy = s.name; c.postedAt = iso();
        done.push(c);
      });
      return { counts: done };
    } },
    saveUser: { roles: ['admin'], fn(db, p, s) {
      const username = String(p.username || '').trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw err('Username must be 3–30 characters (letters, numbers, . _ -).');
      if (['requisitioner', 'custodian', 'admin'].indexOf(p.role) < 0) throw err('Invalid role.');
      if (!String(p.name || '').trim()) throw err('Name is required.');
      if (db.users.some((u) => u.username.toLowerCase() === username && u.id !== p.id)) throw err('Username already taken.');
      if (p.pin && String(p.pin).length < 4) throw err('PIN must be at least 4 characters.');
      if (p.id) {
        const u = db.users.find((x) => x.id === p.id); if (!u) throw err('User not found.');
        if (u.id === s.id && (p.active === false || p.role !== 'admin')) throw err('You cannot demote or deactivate your own account.');
        Object.assign(u, { username, name: String(p.name).trim(), role: p.role, department: String(p.department || '') });
        if (p.active !== undefined) u.active = !!p.active;
        if (p.pin) u.pin = String(p.pin);
        return { user: pub(u) };
      }
      if (!p.pin) throw err('PIN is required for new users.');
      const u = { id: uid('US'), username, name: String(p.name).trim(), role: p.role, department: String(p.department || ''), pin: String(p.pin), active: true, createdAt: iso() };
      db.users.push(u);
      return { user: pub(u) };
    } },
    saveSettings: { roles: ['admin'], fn(db, p) {
      Object.keys(p).forEach((k) => { if (k in DEFAULT_SETTINGS) db.settings[k] = p[k]; });
      return { settings: Object.assign({}, DEFAULT_SETTINGS, db.settings) };
    } },
    changePin: { fn(db, p, s) {
      if (s.pin !== String(p.oldPin || '')) throw err('Current PIN is incorrect.');
      if (String(p.newPin || '').length < 4) throw err('New PIN must be at least 4 characters.');
      s.pin = String(p.newPin);
      return true;
    } }
  };

  function call(action, payload, token) {
    const db = load();
    const a = ACTIONS[action];
    if (!a) throw err('Unknown action: ' + action, 'BAD_ACTION');
    if (typeof a === 'function') return JSON.parse(JSON.stringify(a(db, payload || {}, token)));
    const s = session(db, token, a.roles);
    const result = a.fn(db, payload || {}, s);
    save(db);
    return JSON.parse(JSON.stringify(result));
  }

  /* Simulated warehouse activity from "other users" so the live monitor has something to show. */
  function simulateActivity() {
    const db = load();
    const live = db.items.filter((i) => i.active && i.condition === 'Good' && i.reorderLevel > 0);
    if (!live.length) return null;
    const it = live[Math.floor(Math.random() * live.length)];
    const bot = { name: 'Ramon Dela Cruz' };
    const depts = ['Project Site A – Talamban', 'Project Site B – Mandaue', 'Masonry Team', 'Carpentry Team', 'Steel Works'];
    let t;
    if (it.qty <= it.reorderLevel && Math.random() < 0.5) {
      const q = Math.max(1, it.reorderLevel * 3 - it.qty);
      t = doIn(db, { itemId: it.id, qty: q, unitCost: round(it.stdCost * (0.94 + Math.random() * 0.14), 2), ref: 'DR-' + Math.floor(5000 + Math.random() * 4000), party: it.supplier, remarks: 'Supplier delivery' }, bot).txn;
    } else if (it.qty > 0) {
      const q = Math.min(it.qty, 1 + Math.floor(Math.random() * Math.max(1, Math.ceil(it.reorderLevel / 6))));
      t = doOut(db, it, q, { ref: 'RIS-' + Math.floor(8000 + Math.random() * 1000), party: depts[Math.floor(Math.random() * depts.length)], remarks: 'Site issuance' }, bot).txn;
    }
    if (t) save(db);
    return t || null;
  }

  window.DemoBackend = { call, reset, simulateActivity, storageKey: KEY, accounts: [
    { role: 'requisitioner', username: 'requester', pin: 'request123' },
    { role: 'custodian', username: 'custodian', pin: 'custodian123' },
    { role: 'admin', username: 'admin', pin: 'admin123' }
  ] };
})();
