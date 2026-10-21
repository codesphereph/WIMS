/* CPU WIMS — analytics engine.
 * Turns raw items + transactions + counts into stock status, FSN (fast/slow/non-moving), ABC,
 * reorder suggestions, salvage recommendations, count variance, purchase-price variance and a health score.
 */
window.Analytics = (function () {
  'use strict';
  const DAY = 86400000;
  const DEF = { fastTurnover: 1, nonMovingDays: 180, salvageAgeYears: 5, salvageRate: 0.15, leadTimeDays: 14 };
  const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const clamp = (n) => Math.max(0, Math.min(1, n));

  function compute(data, settings) {
    const s = Object.assign({}, DEF, settings || {});
    const now = Date.now();
    const items = (data.items || []).filter((i) => i.active !== false);
    const txns = data.transactions || [];
    const stats = {};
    items.forEach((i) => { stats[i.id] = { out30: 0, out90: 0, outVal30: 0, outVal90: 0, in30: 0, inVal30: 0, in90: 0, lastMove: 0, lastOut: 0 }; });

    // Daily in/out series for the last 30 days
    const series = {}; const labels = [];
    for (let d = 29; d >= 0; d--) { const k = dayKey(now - d * DAY); series[k] = { inV: 0, outV: 0, inQ: 0, outQ: 0 }; labels.push(k); }
    let in30Value = 0, out30Value = 0, in30Count = 0, out30Count = 0, salvage90Value = 0, recovery90 = 0, adj90Value = 0;
    const ppv = [];
    const itemMap = {}; (data.items || []).forEach((i) => { itemMap[i.id] = i; });

    txns.forEach((t) => {
      const ts = Date.parse(t.ts); if (!ts) return;
      const age = (now - ts) / DAY;
      const st = stats[t.itemId];
      const k = dayKey(ts);
      if (t.type === 'IN' && age <= 30) { in30Value += t.totalCost; in30Count++; if (series[k]) { series[k].inV += t.totalCost; series[k].inQ += t.qty; } }
      if (t.type === 'OUT' && age <= 30) { out30Value += t.totalCost; out30Count++; if (series[k]) { series[k].outV += t.totalCost; series[k].outQ += t.qty; } }
      if (t.type === 'SALVAGE' && age <= 90) { salvage90Value += t.totalCost; recovery90 += +t.recovery || 0; }
      if (t.type === 'ADJ' && age <= 90) adj90Value += t.totalCost;
      if (t.type === 'IN' && age <= 90 && t.ref !== 'OPENING') {
        const it = itemMap[t.itemId];
        const std = it ? +it.stdCost || 0 : 0;
        if (std > 0) ppv.push({ ts: t.ts, itemId: t.itemId, sku: t.sku, name: t.itemName, category: it.category, qty: t.qty, std, actual: t.unitCost, party: t.party, ref: t.ref,
          variance: (t.unitCost - std) * t.qty, pct: (t.unitCost - std) / std });
      }
      if (!st) return;
      if (t.type !== 'COND' && ts > st.lastMove) st.lastMove = ts;
      if (t.type === 'OUT') {
        if (ts > st.lastOut) st.lastOut = ts;
        if (age <= 30) { st.out30 += t.qty; st.outVal30 += t.totalCost; }
        if (age <= 90) { st.out90 += t.qty; st.outVal90 += t.totalCost; }
      } else if (t.type === 'IN') {
        if (age <= 30) { st.in30 += t.qty; st.inVal30 += t.totalCost; }
        if (age <= 90) st.in90 += t.qty;
      }
    });

    const rows = items.map((i) => {
      const x = stats[i.id];
      const qty = +i.qty || 0; const cost = +i.unitCost || 0; const value = qty * cost;
      const acq = Date.parse(i.dateAcquired) || now;
      const ageDays = Math.max(0, (now - acq) / DAY);
      const idleDays = x.lastMove ? (now - x.lastMove) / DAY : ageDays;
      const daily = x.out90 / 90;
      const cover = daily > 0 ? qty / daily : (qty > 0 ? Infinity : 0);
      const turnover = x.out90 / Math.max(1, qty + x.out90 / 2);
      const rl = +i.reorderLevel || 0;
      let status = 'In Stock';
      if (qty <= 0) status = 'Out of Stock';
      else if (rl > 0 && qty <= rl) status = 'Low Stock';
      else if (+i.maxLevel > 0 && qty > +i.maxLevel) status = 'Overstock';
      const movement = x.out90 === 0 ? 'Non-moving' : (turnover >= s.fastTurnover ? 'Fast' : 'Slow');
      const dead = qty > 0 && idleDays >= s.nonMovingDays;
      const cond = i.condition || 'Good';
      let salvage = null, reason = '';
      if (cond === 'Damaged' || cond === 'Non-functional') { salvage = 'Recommend Salvage'; reason = cond + ' — recover parts/scrap value'; }
      else if (cond === 'Obsolete') { salvage = 'Recommend Disposal'; reason = 'Obsolete model — dispose or auction'; }
      else if (qty > 0 && ageDays / 365 >= s.salvageAgeYears && idleDays >= s.nonMovingDays) { salvage = 'Review for Salvage'; reason = Math.floor(ageDays / 365) + ' yrs old, idle ' + Math.round(idleDays) + ' days'; }
      else if (dead) { salvage = 'Review for Salvage'; reason = 'Dead stock — no movement in ' + Math.round(idleDays) + ' days'; }
      const needs = rl > 0 && (status === 'Low Stock' || status === 'Out of Stock' || (daily > 0 && cover < s.leadTimeDays));
      const target = Math.max(rl * 2, Math.ceil(daily * (s.leadTimeDays + 30)));
      const suggest = needs && cond === 'Good' ? Math.max(0, Math.ceil(target - qty)) : 0;
      return Object.assign({}, i, x, {
        qty, unitCost: cost, value, daily, cover, turnover, status, movement, dead, idleDays, ageDays, salvage, salvageReason: reason,
        salvageValue: value * s.salvageRate, suggest, suggestCost: suggest * (+i.stdCost || cost)
      });
    });

    // ABC classification on 90-day consumption value (Pareto 80/15/5)
    const totalCons = rows.reduce((a, r) => a + r.outVal90, 0);
    let cum = 0;
    rows.slice().sort((a, b) => b.outVal90 - a.outVal90).forEach((r) => {
      const before = totalCons ? cum / totalCons : 1;
      cum += r.outVal90;
      r.cumPct = totalCons ? cum / totalCons : 1;
      r.abc = r.outVal90 <= 0 ? 'C' : before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    });

    const byId = {}; rows.forEach((r) => { byId[r.id] = r; });
    const sumV = (arr) => arr.reduce((a, r) => a + r.value, 0);
    const low = rows.filter((r) => r.status === 'Low Stock');
    const out = rows.filter((r) => r.status === 'Out of Stock' && r.reorderLevel > 0);
    const over = rows.filter((r) => r.status === 'Overstock');
    const fast = rows.filter((r) => r.movement === 'Fast');
    const slow = rows.filter((r) => r.movement === 'Slow');
    const nonMoving = rows.filter((r) => r.movement === 'Non-moving');
    const deadStock = rows.filter((r) => r.dead);
    const salvage = rows.filter((r) => r.salvage);
    const reorder = rows.filter((r) => r.suggest > 0).sort((a, b) => (a.cover - b.cover) || (a.qty - b.qty));

    // Categories
    const catMap = {};
    rows.forEach((r) => {
      const c = r.category || 'General';
      catMap[c] = catMap[c] || { name: c, value: 0, items: 0, out90: 0, low: 0 };
      catMap[c].value += r.value; catMap[c].items++; catMap[c].out90 += r.outVal90;
      if (r.status === 'Low Stock' || r.status === 'Out of Stock') catMap[c].low++;
    });
    const categories = Object.values(catMap).sort((a, b) => b.value - a.value);

    // Physical count variance (last 90 days, excluding voided)
    const counts = (data.counts || []).filter((c) => c.status !== 'Voided' && (now - Date.parse(c.ts)) / DAY <= 90);
    const matched = counts.filter((c) => c.variance === 0).length;
    const accuracy = counts.length ? matched / counts.length : null;
    const shrink = counts.filter((c) => c.variance < 0).reduce((a, c) => a + c.varianceValue, 0);
    const overage = counts.filter((c) => c.variance > 0).reduce((a, c) => a + c.varianceValue, 0);
    const varCat = {};
    counts.forEach((c) => { const k = c.category || (itemMap[c.itemId] || {}).category || 'General'; varCat[k] = (varCat[k] || 0) + c.varianceValue; });
    const pendingCounts = (data.counts || []).filter((c) => c.status === 'Pending');

    // Purchase price variance
    const ppvUnfav = ppv.filter((p) => p.variance > 0).reduce((a, p) => a + p.variance, 0);
    const ppvFav = ppv.filter((p) => p.variance < 0).reduce((a, p) => a + p.variance, 0);
    const ppvByItem = {};
    ppv.forEach((p) => { ppvByItem[p.itemId] = ppvByItem[p.itemId] || { itemId: p.itemId, sku: p.sku, name: p.name, variance: 0, qty: 0, receipts: 0 }; ppvByItem[p.itemId].variance += p.variance; ppvByItem[p.itemId].qty += p.qty; ppvByItem[p.itemId].receipts++; });

    // Aging by days since last movement
    const bucketDefs = [['0–30 days', 0, 30], ['31–90 days', 30, 90], ['91–180 days', 90, 180], ['181–365 days', 180, 365], ['Over 1 year', 365, Infinity]];
    const aging = bucketDefs.map(([label, a, b]) => { const rs = rows.filter((r) => r.qty > 0 && r.idleDays >= a && r.idleDays < b); return { label, items: rs.length, value: sumV(rs) }; });

    // Requisitions
    const reqs = data.requisitions || [];
    const reqBy = (st) => reqs.filter((r) => r.status === st).length;

    // Health score (0–100)
    const n = rows.filter((r) => r.reorderLevel > 0).length || 1;
    const stockScore = clamp(1 - (low.length + out.length * 1.5) / n);
    const salvageScore = clamp(1 - (salvage.length / Math.max(1, rows.length)) * 2);
    const movingScore = clamp(1 - nonMoving.length / Math.max(1, rows.length));
    const accScore = accuracy === null ? 1 : accuracy;
    const health = Math.round(100 * (0.35 * stockScore + 0.25 * accScore + 0.2 * movingScore + 0.2 * salvageScore));

    return {
      settings: s, rows, byId, categories,
      totals: { value: sumV(rows), skus: rows.length, units: rows.reduce((a, r) => a + r.qty, 0) },
      flow: { labels, series: labels.map((k) => series[k]), in30Value, out30Value, in30Count, out30Count, salvage90Value, recovery90, adj90Value },
      low, out, over, fast, slow, nonMoving, deadStock, salvage, reorder,
      counts: { list: counts, accuracy, matched, total: counts.length, shrink, overage, net: shrink + overage, byCategory: varCat, pending: pendingCounts },
      ppv: { list: ppv.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)), unfav: ppvUnfav, fav: ppvFav, net: ppvUnfav + ppvFav, byItem: Object.values(ppvByItem).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)) },
      aging,
      reqs: { pending: reqBy('Pending'), endorsed: reqBy('Endorsed'), approved: reqBy('Approved'), partial: reqBy('Partially Issued'), issued: reqBy('Issued'), rejected: reqBy('Rejected') },
      health: { score: health, parts: { stock: stockScore, accuracy: accScore, moving: movingScore, salvage: salvageScore } }
    };
  }

  return { compute, dayKey };
})();
