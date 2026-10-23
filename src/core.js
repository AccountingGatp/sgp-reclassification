// Pure SOP logic. No DOM, no file I/O, no hardcoded data: everything comes from the uploaded
// exports and the config object. Runs in the browser and in Node (tests).

// ---------------------------------------------------------------- helpers
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clean = (s) => String(s ?? '').trim();
const lc = (s) => clean(s).toLowerCase();

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const DAY = 86400000;
export function mkDate(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const chk = new Date(t);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== m - 1 || chk.getUTCDate() !== d) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return { y, m, d, t: t / DAY, iso: `${y}-${pad(m)}-${pad(d)}`, month: `${y}-${pad(m)}`, mdy: `${pad(m)}/${pad(d)}/${y}` };
}
export function parseMDY(s) {
  // Accepts MM/DD/YYYY text, YYYY-MM-DD text, a real Date, or an Excel serial number
  // (so the same report works whether it arrives as CSV or Excel).
  if (typeof s === 'number') return s > 20000 && s < 80000 ? fromSerial(s) : null;
  if (s instanceof Date) return mkDate(s.getFullYear(), s.getMonth() + 1, s.getDate());
  const t = clean(s);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return mkDate(+m[3], +m[1], +m[2]);
  const i = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  return i ? mkDate(+i[1], +i[2], +i[3]) : null;
}
function parseDMY(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(clean(s));
  return m ? mkDate(+m[3], +m[2], +m[1]) : null;
}
function fromSerial(n) { // Excel serial -> date
  const ms = Math.round((n - 25569) * DAY);
  const dt = new Date(ms);
  return mkDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function monthEnd(month) {
  const [y, m] = month.split('-').map(Number);
  return mkDate(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
}
export function monthStart(month) { const [y, m] = month.split('-').map(Number); return mkDate(y, m, 1); }

export function normListing(s) {
  return lc(s).replace(/\s*\|\s*/g, '|').replace(/\s+/g, ' ');
}

export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

function listingClassifier(cfg) {
  const table = new Map(cfg.listings.map((l) => [normListing(l.name), l.cls]));
  return (listing) => (listing ? table.get(normListing(listing)) ?? null : null);
}

function destinationOf(details, cfg) {
  const t = lc(details);
  for (const k of Object.keys(cfg.destinations)) if (t.includes(k.toLowerCase())) return k;
  return null;
}

// ---------------------------------------------------------------- Airbnb CSV
export function isAirbnbRows(rows) {
  return rows.slice(0, 6).some((r) => { const h = r.map(clean); return h.includes('Paid out') && h.includes('Reference code'); });
}
// input: CSV text, or rows (array of arrays) read from an Excel sheet
export function parseAirbnb(input, cfg) {
  const all = typeof input === 'string' ? parseCSV(input) : input;
  if (!all.length) throw new Error('The Airbnb file is empty.');
  let hi = all.slice(0, 6).findIndex((r) => r.map(clean).includes('Reference code'));
  if (hi < 0) hi = 0;
  const rows = all.slice(hi);
  const header = rows[0].map(clean);
  const ix = (n) => header.indexOf(n);
  const need = ['Date', 'Type', 'Listing', 'Details', 'Reference code', 'Currency', 'Amount', 'Paid out'];
  const missing = need.filter((n) => ix(n) < 0);
  if (missing.length) throw new Error(`Airbnb file is missing column(s): ${missing.join(', ')}. Export "Transaction history" as CSV.`);
  const classify = listingClassifier(cfg);
  const warnings = [];
  const payouts = [];
  let curP = null;
  const data = rows.slice(1);
  data.forEach((r, i) => {
    const type = clean(r[ix('Type')]);
    const date = parseMDY(r[ix('Date')]);
    if (type === 'Payout') {
      const details = clean(r[ix('Details')]);
      const destKey = destinationOf(details, cfg);
      const dest = destKey ? cfg.destinations[destKey] : null;
      curP = {
        id: payouts.length, date, ref: clean(r[ix('Reference code')]), details,
        destKey: destKey ?? 'UNKNOWN', destLabel: dest?.label ?? details, booked: !!dest?.booked,
        dest, paid: toNumber(r[ix('Paid out')]) ?? 0, lines: [], row: i + 2 + hi,
        arriving: ix('Arriving by date') >= 0 ? parseMDY(r[ix('Arriving by date')]) : null,
      };
      payouts.push(curP);
    } else if (curP) {
      const listing = clean(r[ix('Listing')]);
      curP.lines.push({
        date, type, listing, guest: clean(r[ix('Guest')]), code: clean(r[ix('Confirmation Code')]),
        currency: clean(r[ix('Currency')]) || 'USD', amount: toNumber(r[ix('Amount')]) ?? 0,
        cls: classify(listing), row: i + 2 + hi,
      });
    } else {
      warnings.push(`Row ${i + 2 + hi} (${type}) appears before any Payout row and was ignored.`);
    }
  });
  const tol = cfg.tolerance;
  for (const p of payouts) {
    p.sum = round2(p.lines.reduce((a, l) => a + l.amount, 0));
    p.diff = round2(p.paid - p.sum);
    p.currencies = [...new Set(p.lines.map((l) => l.currency))];
    p.foreign = p.currencies.some((c) => c !== 'USD');
    p.ties = Math.abs(p.diff) <= tol + 1e-9;
  }
  const dates = payouts.map((p) => p.date).filter(Boolean).sort((a, b) => a.t - b.t);
  return {
    payouts, rowCount: data.length, warnings,
    minDate: dates[0] ?? null, maxDate: dates[dates.length - 1] ?? null,
    truncationRisk: data.length >= 999,
  };
}

// Combine the month's Airbnb export with an optional prior-month export. Payouts are deduped by
// reference code. The prior file is only used for matching and classifying deposits; the reclass
// still covers only deposits dated in the months being closed.
export function mergeAirbnb(list) {
  if (list.length === 1) return list[0];
  const seen = new Map(); const payouts = [];
  for (const a of list) for (const p of a.payouts) {
    const k = p.ref ? p.ref.toUpperCase() : null;
    if (k && seen.has(k)) { const o = seen.get(k); if (p.lines.length > o.lines.length) Object.assign(o, { ...p, id: o.id }); continue; }
    const q = { ...p, id: payouts.length }; payouts.push(q); if (k) seen.set(k, q);
  }
  const dates = payouts.map((p) => p.date).filter(Boolean).sort((a, b) => a.t - b.t);
  return {
    payouts, rowCount: list.reduce((a, x) => a + x.rowCount, 0), warnings: list.flatMap((x) => x.warnings),
    minDate: dates[0] ?? null, maxDate: dates[dates.length - 1] ?? null, truncationRisk: list.some((x) => x.truncationRisk),
  };
}

// ---------------------------------------------------------------- QBO Transaction Detail by Account
export function isQboRows(rows) {
  return rows.slice(0, 8).some((r) => /Transaction Detail by Account/i.test(clean(r[0])))
    || rows.slice(0, 10).some((r) => clean(r[1]) === 'Transaction date');
}

export function parseQbo(rows, cfg) {
  const hi = rows.findIndex((r) => clean(r[1]) === 'Transaction date');
  if (hi < 0) throw new Error('Could not find the "Transaction date" header. Use QuickBooks "Transaction Detail by Account".');
  const head = rows[hi].map(clean);
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const c = {
    date: col('Transaction date'), type: col('Transaction type'), num: col('Num'), name: col('Name'),
    desc: col('Description'), split: col('Split'), amt: col('Amount'),
    cls: col('Class full name', 'Class', 'Item class'),
  };
  if (c.amt < 0 || c.split < 0) throw new Error('QuickBooks report needs the Split and Amount columns.');
  if (c.cls < 0) throw new Error('QuickBooks report needs a Class column (show Class on the report).');
  const out = []; let section = null; const sections = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    const first = clean(r[0]);
    if (first && !clean(r[1])) {
      if (!/^total for /i.test(first)) { section = first; sections.push(first); }
      continue;
    }
    if (section !== cfg.incomeAccount || first || !clean(r[c.date])) continue;
    const date = parseMDY(r[c.date]) ?? (typeof r[c.date] === 'number' ? fromSerial(r[c.date]) : null);
    if (!date) continue;
    const split = clean(r[c.split]);
    const bm = /\((\d{4})\)/.exec(split);
    out.push({
      id: out.length, date, month: date.month, type: clean(r[c.type]), num: clean(r[c.num]),
      name: clean(r[c.name]), desc: clean(r[c.desc]), split, bank: bm ? bm[1] : 'other',
      cls: clean(r[c.cls]) || '(no class)', amount: toNumber(r[c.amt]) ?? 0, used: false,
    });
  }
  if (!sections.includes(cfg.incomeAccount)) throw new Error(`The "${cfg.incomeAccount}" section was not found in the QuickBooks report. Include it when you run the report.`);
  const dates = out.map((r) => r.date).sort((a, b) => a.t - b.t);
  const period = rows.slice(0, 5).map((r) => clean(r[0])).find((s) => /\d{4}/.test(s)) ?? '';
  return { rows: out, minDate: dates[0] ?? null, maxDate: dates[dates.length - 1] ?? null, sections, period };
}

// Existing journal numbers like WIRC-014 -> next free number (SOP: never reuse, never edit old ones).
export function nextJournalNumber(qboRows, cfg) {
  const p = cfg.journal.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${p}[-_ ]?(\\d+)$`, 'i');
  let max = 0, pad = cfg.journal.pad;
  for (const r of qboRows) {
    if (r.type !== 'Journal Entry') continue;
    const m = re.exec(r.num);
    if (m) { max = Math.max(max, +m[1]); pad = Math.max(pad, m[1].length); }
  }
  return { next: max + 1, max, pad: Math.max(pad, cfg.journal.pad) };
}

// ---------------------------------------------------------------- Stripe
export function isStripeRows(rows) {
  return rows.slice(0, 3).some((r) => r.map(clean).includes('automatic_payout_id'));
}

function stripeDateCandidates(cell) {
  // Excel turns ambiguous dd/mm/yyyy text into real dates with day and month swapped, and leaves
  // unambiguous ones (day > 12) as text. We try both readings and keep the one that matches QuickBooks.
  if (typeof cell === 'number') {
    const d = fromSerial(cell);
    if (!d) return null;
    return { plain: d, swapped: mkDate(d.y, d.d, d.m) ?? d, ambiguous: true };
  }
  if (cell instanceof Date) {
    const d = mkDate(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
    return { plain: d, swapped: mkDate(d.y, d.d, d.m) ?? d, ambiguous: true };
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(cell)); // Stripe CSV: 2026-09-09 01:36:24
  if (iso) { const di = mkDate(+iso[1], +iso[2], +iso[3]); if (di) return { plain: di, swapped: di, ambiguous: false }; }
  const d = parseDMY(cell);
  return d ? { plain: d, swapped: d, ambiguous: false } : null;
}

export function parseStripe(sheets, cfg) {
  const classify = listingClassifier(cfg);
  const lines = []; const seenBt = new Set();
  for (const { name, rows } of sheets) {
    const hi = rows.findIndex((r) => r.map(clean).includes('automatic_payout_id'));
    if (hi < 0) continue;
    const head = rows[hi].map(clean);
    const ix = (n) => head.indexOf(n);
    const netCol = head.indexOf('net (paid out)') >= 0 ? 'net (paid out)' : 'net'; // xlsx report vs CSV export
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const id = clean(r[ix('automatic_payout_id')]);
      if (!id) continue;
      const bt = clean(r[ix('balance_transaction_id')]);
      if (bt && seenBt.has(bt)) continue; // same line in two uploaded files
      if (bt) seenBt.add(bt);
      const cat = clean(r[ix('reporting_category')]);
      if (cat === 'payout') continue; // payout summary rows duplicate the lines
      const desc = clean(r[ix('description')]);
      lines.push({
        sheet: name, payoutId: id, dates: stripeDateCandidates(r[ix('automatic_payout_effective_at')]),
        btxn: clean(r[ix('balance_transaction_id')]), cat, gross: toNumber(r[ix('gross')]) ?? 0,
        net: toNumber(r[ix(netCol)]) ?? 0, desc, cls: null, listing: stripeListing(desc), guest: stripeGuest(desc),
      });
    }
  }
  const rules = cfg.stripeRules.map((x) => ({ contains: normListing(x.contains), cls: x.cls }));
  for (const l of lines) {
    const n = normListing(l.desc);
    const exact = classify(l.listing);
    const rule = exact ? null : rules.find((r) => n.includes(r.contains));
    l.cls = exact ?? rule?.cls ?? null;
    l.viaRule = !exact && !!rule;
  }
  // Disputes / chargebacks carry no listing: inherit the class of the charge they reverse.
  for (const l of lines) {
    if (l.cls) continue;
    const m = /\bch_(\w{16})/.exec(l.desc);
    if (m) {
      const src = lines.find((x) => x !== l && x.btxn.startsWith('txn_' + m[1]) && x.cls);
      if (src) { l.cls = src.cls; l.listing = src.listing; l.guest = src.guest; l.inherited = true; }
    }
  }
  const payouts = new Map();
  for (const l of lines) {
    if (!payouts.has(l.payoutId)) payouts.set(l.payoutId, { id: l.payoutId, lines: [], dates: l.dates });
    const p = payouts.get(l.payoutId);
    p.lines.push(l); if (!p.dates && l.dates) p.dates = l.dates;
  }
  for (const p of payouts.values()) p.net = round2(p.lines.reduce((a, l) => a + l.net, 0));
  return { lines, payouts: [...payouts.values()] };
}
function stripeListing(desc) {
  const m = /^(?:REFUND FOR CHARGE \()?Reservation #\d+:\s*[^,]+,\s*(.*?)(?:\s*\(\d+\))?\)?$/.exec(desc);
  return m ? m[1].trim() : '';
}
function stripeGuest(desc) {
  const m = /Reservation #\d+:\s*([^,]+),/.exec(desc);
  return m ? m[1].trim() : '';
}

// ---------------------------------------------------------------- months / completeness
export function monthInfo({ airbnb, qbo }) {
  const set = new Set(qbo.rows.map((r) => r.month));
  const out = [];
  for (const m of [...set].sort()) {
    const end = monthEnd(m), start = monthStart(m);
    const reasons = [];
    if (airbnb.minDate && airbnb.minDate.t > start.t + 3) reasons.push(`Airbnb export starts ${airbnb.minDate.mdy}`);
    if (airbnb.maxDate && airbnb.maxDate.t < end.t - 3) reasons.push(`Airbnb export ends ${airbnb.maxDate.mdy}`);
    if (qbo.maxDate && qbo.maxDate.t < end.t - 3) reasons.push(`QuickBooks report ends ${qbo.maxDate.mdy}`);
    out.push({ month: m, complete: reasons.length === 0, reasons });
  }
  return out;
}

// SOP "Escalate to Jonathan and Jennifer": only these stop posting.
export const BLOCKING = ['new-listing', 'empire-property', 'unknown-destination', 'no-tie', 'foreign'];

// ---------------------------------------------------------------- the SOP run
export function analyze({ airbnb, qbo, stripe }, cfg, months) {
  const tol = cfg.tolerance;
  const rows = qbo.rows.map((r) => ({ ...r, used: false }));
  const sel = new Set(months);
  const classify = listingClassifier(cfg);
  const items = []; // classified pieces of matched QBO rows
  const exceptions = [];
  const addEx = (e) => exceptions.push({ items: [], ...e });

  // ---- Airbnb payouts -> QBO deposits (SOP steps 4-7)
  const bookedPayouts = airbnb.payouts.filter((p) => p.booked && p.date).sort((a, b) => a.date.t - b.date.t || a.id - b.id);
  const payoutMatch = new Map();
  for (const p of bookedPayouts) {
    let best = null;
    for (const r of rows) {
      if (r.used || r.type !== 'Deposit' || r.bank !== p.destKey) continue;
      if (Math.abs(r.amount - p.paid) > 0.005) continue;
      const dt = r.date.t - p.date.t;
      if (dt < -cfg.matchWindow.before || dt > cfg.matchWindow.after) continue;
      if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { r, dt };
    }
    if (best) { best.r.used = true; payoutMatch.set(p.id, best.r); }
  }
  for (const p of bookedPayouts) {
    const r = payoutMatch.get(p.id);
    p.qbo = r ?? null;
    const byCls = new Map();
    for (const l of p.lines) {
      const cls = l.cls ?? '?';
      byCls.set(cls, round2((byCls.get(cls) ?? 0) + l.amount));
    }
    p.byClass = byCls;
    if (!r) continue;
    for (const [cls, amt] of byCls) {
      items.push({ rowId: r.id, cls: cls === '?' ? null : cls, amt, src: 'Airbnb', payoutId: p.id, unmapped: cls === '?' });
    }
  }

  // ---- Stripe payouts -> QBO (choose date reading that matches best)
  let stripeResult = null;
  if (stripe && stripe.payouts.length) {
    const tryRun = (swap) => {
      const used = new Set(); const matches = [];
      const pick = (amount, date, win) => {
        let best = null;
        for (const r of rows) {
          if (r.used || used.has(r.id) || Math.abs(r.amount - amount) > 0.005) continue;
          const dt = date ? Math.abs(r.date.t - date.t) : 0;
          if (date && dt > win) continue;
          if (!best || dt < best.dt) best = { r, dt };
        }
        return best?.r ?? null;
      };
      const unmatched = [];
      for (const p of stripe.payouts) {
        const d = p.dates ? (swap ? p.dates.swapped : p.dates.plain) : null;
        const r = pick(p.net, d, cfg.stripeWindowDays);
        if (r) { used.add(r.id); matches.push({ p, r, mode: 'payout' }); } else unmatched.push({ p, d });
      }
      for (const { p, d } of unmatched) { // fall back to line-by-line (e.g. refund and re-charge booked separately)
        let all = true; const ms = [];
        for (const l of p.lines) {
          const r = pick(l.net, d, cfg.stripeWindowDays + 7);
          if (r) { used.add(r.id); ms.push({ l, r }); } else all = false;
        }
        if (ms.length) matches.push({ p, lineMatches: ms, mode: 'lines', complete: all });
        if (!ms.length || !all) matches.push({ p, mode: 'none', missing: p.lines.filter((l) => !ms.find((m) => m.l === l)) });
      }
      return { matches, count: matches.filter((m) => m.mode !== 'none').length, swap };
    };
    const a = tryRun(true), b = tryRun(false);
    stripeResult = b.count > a.count ? b : a;
    for (const m of stripeResult.matches) {
      if (m.mode === 'payout') {
        m.r.used = true;
        const byCls = new Map();
        for (const l of m.p.lines) byCls.set(l.cls ?? '?', round2((byCls.get(l.cls ?? '?') ?? 0) + l.net));
        for (const [cls, amt] of byCls) items.push({ rowId: m.r.id, cls: cls === '?' ? null : cls, amt, src: 'Stripe', stripeId: m.p.id, unmapped: cls === '?' });
        m.p.qbo = m.r;
      } else if (m.mode === 'lines') {
        for (const { l, r } of m.lineMatches) {
          r.used = true;
          items.push({ rowId: r.id, cls: l.cls, amt: round2(l.net), src: 'Stripe', stripeId: m.p.id, unmapped: !l.cls });
        }
        m.p.qbo = m.lineMatches[0].r;
      }
    }
  }
  const stripeUnmatched = stripeResult ? stripeResult.matches.filter((m) => m.mode === 'none') : [];

  // ---- Everything else in the income account stays as booked
  for (const r of rows) {
    if (r.type === 'Journal Entry') continue;
    if (!items.some((i) => i.rowId === r.id)) items.push({ rowId: r.id, cls: r.cls, amt: r.amount, src: 'as booked', asBooked: true });
  }
  const rowById = new Map(rows.map((r) => [r.id, r]));
  // an unmapped line is also held as booked
  for (const it of items) if (it.unmapped) { it.cls = rowById.get(it.rowId).cls; it.asBooked = true; }

  // ---- Timing adjustments (only when an earlier posted entry already moved a deposit now in this month)
  const rowById0 = new Map(rows.map((r) => [r.id, r]));
  const timing = [];
  const jePat = new RegExp(`^${cfg.journal.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const prevMonth = (m) => { const [y, mm] = m.split('-').map(Number); return mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`; };
  const timingWarn = [];
  for (const M of [...sel].sort()) {
    const P = prevMonth(M);
    const jeRows = rows.filter((r) => r.type === 'Journal Entry' && r.month === P && jePat.test(r.num));
    if (!jeRows.length) continue;
    const strad = items.filter((it) => it.src === 'Airbnb' && !it.unmapped && it.cls
      && rowById0.get(it.rowId).month === M && bookedPayouts.find((p) => p.id === it.payoutId)?.date.month === P);
    if (!strad.length) continue;
    const je = {}, dep = {}, base = {};
    for (const r of jeRows) je[r.cls] = round2((je[r.cls] ?? 0) + r.amount);
    for (const r of rows) if (r.month === P && r.type !== 'Journal Entry') base[r.cls] = round2((base[r.cls] ?? 0) + r.amount);
    for (const it of items) { if (it.timing) continue; const r = rowById0.get(it.rowId); if (r.month === P) dep[it.cls] = round2((dep[it.cls] ?? 0) + it.amt); }
    const byCls = new Map();
    for (const it of strad) { if (!byCls.has(it.cls)) byCls.set(it.cls, []); byCls.get(it.cls).push(it); }
    for (const [c, list] of byCls) {
      // Amount of class c in the earlier entry that is not explained by deposits dated in that month
      const x = round2((je[c] ?? 0) - ((dep[c] ?? 0) - (base[c] ?? 0)));
      if (Math.abs(x) < 0.005) continue;
      let hit = null; const n = Math.min(list.length, 14);
      for (let mask = 1; mask < (1 << n) && !hit; mask++) {
        let t = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) t += list[i].amt;
        if (Math.abs(round2(t) - x) <= 0.005) hit = list.filter((_, i) => mask & (1 << i));
      }
      if (!hit) { timingWarn.push({ date: monthEnd(P).mdy, listing: c, amount: x, note: `${P} reclass moved ${x.toFixed(2)} more than the deposits dated in ${P} explain, and no payout from ${P} deposited in ${M} adds up to it` }); continue; }
      // class the earlier entry took the money out of
      const nums = [...new Set(jeRows.filter((r) => r.cls === c && r.amount > 0).map((r) => r.num))];
      const srcRow = jeRows.filter((r) => nums.includes(r.num) && r.amount < 0).sort((a, b) => a.amount - b.amount)[0];
      const from = srcRow?.cls;
      for (const it of hit) {
        const dr = rowById0.get(it.rowId); const p = bookedPayouts.find((q) => q.id === it.payoutId);
        if (!from || from === c) { timingWarn.push({ date: dr.date.mdy, listing: c, amount: it.amt, note: 'earlier entry found but its source class could not be identified' }); continue; }
        timing.push({ month: M, priorMonth: P, depositDate: dr.date.mdy, payoutDate: p.date.mdy, ref: p.ref, amount: it.amt, toClass: from, fromClass: c, priorNo: nums.join(', ') });
        items.push({ rowId: it.rowId, cls: c, amt: -it.amt, src: 'timing', timing: true });
        items.push({ rowId: it.rowId, cls: from, amt: it.amt, src: 'timing', timing: true });
      }
    }
  }

  // ---- Totals by month and class (SOP step 7)
  const classSet = new Set();
  const truth = {}, cur = {};
  const bump = (o, m, c, v) => { (o[m] ??= {}); o[m][c] = round2((o[m][c] ?? 0) + v); classSet.add(c); };
  for (const r of rows) if (sel.has(r.month)) bump(cur, r.month, r.cls, r.amount);
  for (const it of items) { const r = rowById.get(it.rowId); if (sel.has(r.month)) bump(truth, r.month, it.cls, it.amt); }
  const classes = [...classSet].sort((a, b) => {
    const ia = cfg.classes.indexOf(a), ib = cfg.classes.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const adj = {};
  const sortedMonths = [...sel].sort();
  for (const m of sortedMonths) {
    adj[m] = {};
    for (const c of classes) adj[m][c] = round2((truth[m]?.[c] ?? 0) - (cur[m]?.[c] ?? 0));
  }

  // ---- Journal entries: one per month and per source class (SOP "Journal entry and QBO import")
  const num = nextJournalNumber(qbo.rows, cfg);
  let n = num.next;
  const fmtNo = () => `${cfg.journal.prefix}${cfg.journal.separator}${String(n++).padStart(num.pad, '0')}`;
  const journal = [];
  for (const m of sortedMonths) {
    const srcs = classes.filter((c) => adj[m][c] < -0.004).map((c) => ({ c, left: -adj[m][c] }));
    const dsts = classes.filter((c) => adj[m][c] > 0.004).map((c) => ({ c, left: adj[m][c] }));
    const date = monthEnd(m);
    for (const s of srcs) {
      const no = fmtNo();
      const lines = [{ no, date: date.mdy, account: cfg.incomeAccount, debit: round2(s.left), credit: null, desc: `Reclass ${m} rental income out of ${s.c}`, name: '', cls: s.c }];
      let need = s.left;
      for (const d of dsts) {
        if (need < 0.004) break;
        const take = round2(Math.min(need, d.left));
        if (take < 0.004) continue;
        lines.push({ no, date: date.mdy, account: cfg.incomeAccount, debit: null, credit: take, desc: `Reclass ${m} rental income into ${d.c}`, name: '', cls: d.c });
        d.left = round2(d.left - take); need = round2(need - take);
      }
      journal.push({ no, month: m, source: s.c, total: round2(s.left), lines });
    }
  }

  // ---- Exceptions (SOP "Escalate to Jonathan and Jennifer")
  const inSel = (d) => d && sel.has(d.month);
  const sdate = (d) => (d ? (stripeResult?.swap ? d.swapped : d.plain)?.mdy : undefined);
  const unmappedListings = new Map();
  for (const p of airbnb.payouts) {
    if (!p.booked) continue;
    for (const l of p.lines) {
      if (l.cls || !l.listing) continue;
      const k = normListing(l.listing);
      if (!unmappedListings.has(k)) unmappedListings.set(k, { listing: l.listing, source: 'Airbnb', items: [] });
      unmappedListings.get(k).items.push({ date: p.date?.mdy, listing: l.listing, guest: l.guest, amount: l.amount, ref: p.ref });
    }
  }
  if (stripe) for (const l of stripe.lines) {
    if (l.cls) continue;
    const key = normListing(l.listing || l.desc);
    if (!unmappedListings.has(key)) unmappedListings.set(key, { listing: l.listing || l.desc, source: 'Stripe', items: [] });
    unmappedListings.get(key).items.push({ date: sdate(l.dates), listing: l.listing || l.desc, guest: l.guest, amount: l.net, ref: l.payoutId });
  }
  if (stripe) {
    const via = new Map();
    for (const l of stripe.lines) if (l.viaRule) via.set(normListing(l.listing), { date: undefined, listing: l.listing, amount: undefined, note: `classed ${l.cls} by keyword rule` });
    if (via.size) addEx({ sev: 'open', code: 'stripe-keyword', title: 'Stripe listings classed by keyword, not by the class table',
      detail: 'The SOP matches the listing name exactly. Confirm these classes and add the names to the class table.', items: [...via.values()] });
  }
  for (const u of unmappedListings.values()) {
    addEx({ sev: 'escalate', code: 'new-listing', title: `New listing not in the class table (${u.source})`, listing: u.listing,
      detail: `"${u.listing}". Held in its booked class until Jonathan confirms the class. Add it in Settings once known.`, items: u.items });
  }
  for (const p of airbnb.payouts) {
    if (p.booked || !p.dest?.flagPropertyBookings) continue;
    const props = p.lines.filter((l) => l.cls);
    if (props.length) addEx({ sev: 'escalate', code: 'empire-property', title: `Property booking paid to ${p.destLabel}`,
      detail: 'Steven\'s income in the wrong entity. Do not book; Jonathan decides how to bring it across (suggested: debit Due from Empire, credit Rental Income by property).',
      items: props.map((l) => ({ date: p.date?.mdy, listing: l.listing, guest: l.guest, amount: l.amount, ref: p.ref })) });
  }
  const unknownDest = airbnb.payouts.filter((p) => p.destKey === 'UNKNOWN');
  if (unknownDest.length) addEx({ sev: 'escalate', code: 'unknown-destination', title: 'Payout destination not recognised',
    detail: 'Add the account to Settings > Destinations so it can be booked or excluded.',
    items: unknownDest.map((p) => ({ date: p.date?.mdy, listing: p.details, amount: p.paid, ref: p.ref })) });
  const nonTie = airbnb.payouts.filter((p) => !p.ties && (p.booked || p.destKey === 'PayPal' || p.destKey === 'UNKNOWN'));
  if (nonTie.length) addEx({ sev: 'escalate', code: 'no-tie', title: 'Payout does not tie to its lines',
    detail: 'Sum of lines differs from Paid out by more than the tolerance.',
    items: nonTie.map((p) => ({ date: p.date?.mdy, listing: p.destLabel, amount: p.diff, ref: p.ref, note: `paid ${p.paid.toFixed(2)} vs lines ${p.sum.toFixed(2)}` })) });
  const foreignBooked = airbnb.payouts.filter((p) => p.foreign && (p.booked || p.destKey === 'PayPal'));
  if (foreignBooked.length) addEx({ sev: 'escalate', code: 'foreign', title: 'Foreign-currency payout',
    detail: 'Will not tie in USD.', items: foreignBooked.map((p) => ({ date: p.date?.mdy, listing: p.destLabel, amount: p.paid, ref: p.ref, note: p.currencies.join('/') })) });
  const foreignOther = airbnb.payouts.filter((p) => p.foreign && !p.booked && p.destKey !== 'PayPal');
  if (foreignOther.length) addEx({ sev: 'info', code: 'foreign-excluded', title: `Foreign-currency payouts to excluded accounts (${foreignOther.length})`,
    detail: 'Outside Steven\'s books, so they do not affect the reclass. Listed for completeness.',
    items: foreignOther.map((p) => ({ date: p.date?.mdy, listing: p.destLabel, amount: p.paid, ref: p.ref, note: `${p.currencies.join('/')} diff ${p.diff.toFixed(2)}` })) });

  const matchedRefs = new Set(bookedPayouts.filter((p) => p.qbo && p.ref).map((p) => p.ref.toUpperCase()));
  const knownRefs = new Set(airbnb.payouts.map((p) => p.ref.toUpperCase()).filter(Boolean));
  const dups = [], noPayout = [], priorMissing = [], others = new Map();
  const bookedKeys = new Set(Object.entries(cfg.destinations).filter(([, d]) => d.booked).map(([k]) => k));
  for (const r of rows) {
    if (r.used || r.type === 'Journal Entry' || !sel.has(r.month)) continue;
    if (stripeResult && /stripe/i.test(r.name + r.desc) && r.amount !== 0) { noPayout.push(r); continue; }
    const refs = (r.desc.match(/[GM]-[A-Z0-9]{8,}/gi) ?? []).map((x) => x.toUpperCase());
    // early-month deposit to a booked bank with no payout, while the Airbnb data starts inside the month:
    // it is most likely a payout from the end of the previous month (prior-month file missing)
    if (r.type === 'Deposit' && bookedKeys.has(r.bank) && r.date.d <= cfg.matchWindow.after && airbnb.minDate
      && airbnb.minDate.t >= monthStart(r.month).t && !/booking\.com|stripe/i.test(r.name + ' ' + r.desc) && !refs.some((x) => matchedRefs.has(x))) { priorMissing.push(r); continue; }
    if (refs.some((x) => matchedRefs.has(x))) dups.push(r);
    else if (/airbnb/i.test(r.name + ' ' + r.desc)) noPayout.push(r);
    else { const k = (r.name || '(no name)').replace(/\s*\(customer\)/i, '').toLowerCase(); if (!others.has(k)) others.set(k, []); others.get(k).push(r); }
  }
  if (dups.length) addEx({ sev: 'fix', code: 'duplicate', title: 'Duplicate deposits in QuickBooks',
    detail: 'The same Airbnb payout reference is posted more than once. Not reclassed. Check the bank statement, then delete the duplicate in QuickBooks.',
    items: dups.map((r) => ({ date: r.date.mdy, listing: r.split, amount: r.amount, ref: (r.desc.match(/[GM]-[A-Z0-9]{8,}/i) ?? [''])[0] })) });
  if (priorMissing.length) addEx({ sev: 'open', code: 'prior-month-missing', title: 'Early-month deposits need the prior month\'s Airbnb file',
    detail: 'These deposits to a booked bank have no payout in the files. They are probably payouts from the end of the previous month. Upload that month\'s Airbnb CSV (the last 7 to 10 days is enough). Until then they are left in the booked class and NOT checked.',
    items: priorMissing.map((r) => ({ date: r.date.mdy, listing: r.split, amount: r.amount, note: `${r.name} (booked as ${r.cls})` })) });
  if (timing.length) addEx({ sev: 'info', code: 'timing', title: `Timing adjustments (${timing.length})`,
    detail: 'An earlier posted entry already moved these amounts by payout date, but the deposit landed in the new month. The adjustment reverses the earlier move and is netted into this month\'s entries.',
    items: timing.map((t) => ({ date: t.depositDate, listing: `${t.fromClass} -> ${t.toClass}`, amount: t.amount, ref: t.ref, note: `moved by ${t.priorNo} (payout ${t.payoutDate})` })) });
  if (timingWarn.length) addEx({ sev: 'info', code: 'timing-unclear', title: 'Earlier reclass entry differs from its deposits (no timing line added)',
    detail: 'The earlier month\'s entry moved a different amount than its own deposits explain, and it does not match any payout that landed in the new month. No timing line was added. Glance at the earlier entry if you expected one.', items: timingWarn });
  if (noPayout.length) addEx({ sev: 'open', code: 'no-payout', title: 'QuickBooks deposit with no matching payout in the files',
    detail: 'Could be a prior-month payout, a payout outside the export range, or a missing report. Left in its booked class.',
    items: noPayout.map((r) => ({ date: r.date.mdy, listing: r.split, amount: r.amount, note: r.name })) });
  for (const [k, rs] of others) addEx({ sev: 'info', code: 'other-income', title: `Other income left as booked: ${k} (${rs.length})`,
    detail: 'No listing data supplied, so it is not reclassed.', items: rs.map((r) => ({ date: r.date.mdy, listing: r.split, amount: r.amount, note: r.cls })) });
  const unmatchedP = bookedPayouts.filter((p) => !p.qbo && inSel(p.date));
  if (unmatchedP.length) addEx({ sev: 'open', code: 'not-in-qbo', title: 'Airbnb payout not found in QuickBooks',
    detail: 'Check the bank statement; deposits near month-end may land in the next month. Not included in the reclass.',
    items: unmatchedP.map((p) => ({ date: p.date.mdy, listing: p.destLabel, amount: p.paid, ref: p.ref })) });
  if (stripeUnmatched.length) addEx({ sev: 'open', code: 'stripe-not-in-qbo', title: 'Stripe payout not found in QuickBooks',
    detail: 'No QuickBooks deposit with that amount near the payout date.',
    items: stripeUnmatched.flatMap((m) => (m.missing ?? m.p.lines).map((l) => ({ date: sdate(m.p.dates), listing: l.listing || l.desc, guest: l.guest, amount: l.net, ref: m.p.id }))) });
  const open = [];
  if (airbnb.truncationRisk) open.push(`The Airbnb file has ${airbnb.rowCount} rows. Airbnb exports can stop at 1,000 rows and cut off the end of the range. Last payout date is ${airbnb.maxDate?.mdy}; re-export a narrower range if the month looks short.`);
  const info = monthInfo({ airbnb, qbo }).filter((m) => sel.has(m.month) && !m.complete);
  for (const m of info) open.push(`${m.month} may be incomplete: ${m.reasons.join('; ')}.`);
  for (const w of airbnb.warnings) open.push(w);
  if (open.length) addEx({ sev: 'open', code: 'coverage', title: 'Coverage warnings', detail: open.join(' '), items: [] });

  // ---- Step 5: one summary of destination by class (excluded destinations shown but not booked)
  const ds = new Map();
  for (const p of airbnb.payouts) {
    if (!p.date || !sel.has(p.date.month)) continue;
    for (const l of p.lines) {
      if (l.currency !== 'USD') continue;
      const c = l.cls ?? (p.booked ? '(unmapped listing)' : '(not a property booking)');
      const k = [p.date.month, p.destKey, p.destLabel, p.booked ? 'Booked' : 'Excluded', c].join('\u0001');
      ds.set(k, round2((ds.get(k) ?? 0) + l.amount));
    }
  }
  const destSummary = [...ds.entries()].map(([k, amt]) => { const [month, dest, label, status, cls] = k.split('\u0001'); return { month, dest, label, status, cls, amt }; })
    .sort((a, b) => a.month.localeCompare(b.month) || a.dest.localeCompare(b.dest) || a.cls.localeCompare(b.cls));

  // ---- Tie-out checks (SOP "Tie-out checks before you post")
  const checks = [];
  const bookedTie = bookedPayouts.filter((p) => p.ties).length;
  checks.push({ ok: bookedTie === bookedPayouts.length, label: 'Every booked Airbnb payout ties to its lines (±$' + tol.toFixed(2) + ')', detail: `${bookedTie} of ${bookedPayouts.length}` });
  const payoutsNoDeposit = bookedPayouts.filter((p) => !p.qbo && inSel(p.date));
  const depositsNoPayout = [...dups, ...noPayout, ...priorMissing].filter((r) => /airbnb/i.test(r.name + ' ' + r.desc) || priorMissing.includes(r));
  checks.push({ ok: !payoutsNoDeposit.length && !depositsNoPayout.length,
    label: 'Total deposited to 2665 and 1393 equals the Airbnb payouts: every payout has a deposit and every Airbnb deposit has a payout',
    detail: `${payoutsNoDeposit.length} payout(s) without a deposit, ${depositsNoPayout.length} deposit(s) without a payout` });
  const coHost = bookedPayouts.filter((p) => p.lines.some((l) => /co-?host/i.test(l.type)));
  checks.push({ ok: coHost.every((p) => p.ties), label: 'Payouts with a co-host cut are counted net of the cut (negative lines included, total ties to the deposit)', detail: `${coHost.length} payout(s) with a co-host cut` });
  const unbal = journal.filter((j) => Math.abs(j.lines.reduce((a, l) => a + (l.debit ?? 0) - (l.credit ?? 0), 0)) > 0.004);
  checks.push({ ok: unbal.length === 0, label: 'Debits equal credits in every journal entry', detail: `${journal.length} entries` });
  const bad = journal.filter((j) => new Set(j.lines.map((l) => l.no)).size !== 1);
  checks.push({ ok: bad.length === 0, label: 'Both sides of each entry share one journal number', detail: '' });
  // post-JE class totals must equal correct totals
  const post = {};
  for (const m of sortedMonths) { post[m] = { ...(cur[m] ?? {}) }; for (const c of classes) post[m][c] ??= 0; }
  for (const j of journal) for (const l of j.lines) { const m = j.month; post[m][l.cls] = round2((post[m][l.cls] ?? 0) + (l.credit ?? 0) - (l.debit ?? 0)); }
  let maxDiff = 0;
  for (const m of sortedMonths) for (const c of classes) maxDiff = Math.max(maxDiff, Math.abs((post[m][c] ?? 0) - (truth[m]?.[c] ?? 0)));
  checks.push({ ok: maxDiff < 0.01, label: 'After the entries, each class equals the Airbnb/Stripe total for that class', detail: `max difference ${maxDiff.toFixed(2)}` });
  const blocking = exceptions.filter((e) => BLOCKING.includes(e.code));
  checks.push({ ok: !priorMissing.length, label: 'Early-month deposits all matched to a payout (prior-month Airbnb file loaded when needed)', detail: priorMissing.length ? `${priorMissing.length} deposit(s) have no payout. Upload last month's Airbnb file` : '' });
  checks.push({ ok: blocking.length === 0, label: 'No open escalation items', detail: blocking.length ? `${blocking.length} to resolve before posting` : '' });

  return {
    months: sortedMonths, classes, cur, truth, adj, post, journal, exceptions, checks, destSummary,
    payouts: airbnb.payouts, bookedPayouts, items, rows, stripe: stripeResult, stripeData: stripe,
    journalStart: num, timing, summary: {
      payoutsBooked: bookedPayouts.length, matched: bookedPayouts.filter((p) => p.qbo).length,
      entries: journal.length, ready: checks.every((c) => c.ok),
    },
  };
}

// ---------------------------------------------------------------- plain-language problems
// level 'error': results are not shown until fixed. level 'warn': shown above the results.
export function diagnose({ airbnb, qbo, stripe }, cfg) {
  const out = [];
  const range = (a, b) => (a && b ? `${a.mdy} to ${b.mdy}` : 'unknown dates');
  if (!airbnb.payouts.length) out.push({ level: 'error', msg: 'The Airbnb file has no payouts in it. In Airbnb go to Earnings > Transaction history, choose all transaction types and the full date range, then export CSV.' });
  if (!qbo.rows.length) out.push({ level: 'error', msg: `The QuickBooks report has no "${cfg.incomeAccount}" lines. Run Transaction Detail by Account for the period with the ${cfg.incomeAccount} account included.` });
  if (out.some((o) => o.level === 'error')) return out;
  const booked = airbnb.payouts.filter((p) => p.booked);
  if (!booked.length) out.push({ level: 'error', msg: `None of the Airbnb payouts go to a booked account (${Object.entries(cfg.destinations).filter(([, d]) => d.booked).map(([k]) => k).join(', ')}). Check you used the right Airbnb account, or add the account in Rules and settings.` });
  const slack = 20;
  if (airbnb.minDate && qbo.minDate && (airbnb.maxDate.t + slack < qbo.minDate.t || qbo.maxDate.t + slack < airbnb.minDate.t)) {
    out.push({ level: 'error', msg: `The files are from different periods. Airbnb covers ${range(airbnb.minDate, airbnb.maxDate)} but QuickBooks covers ${range(qbo.minDate, qbo.maxDate)}. Check you did not pick the wrong year or month, then upload matching files.` });
    return out;
  }
  if (airbnb.maxDate && qbo.maxDate && airbnb.maxDate.t < qbo.maxDate.t - 30) out.push({ level: 'warn', msg: `The Airbnb file ends ${airbnb.maxDate.mdy} but QuickBooks runs to ${qbo.maxDate.mdy}. Months after the Airbnb end date are marked incomplete and cannot be reclassed until you export Airbnb through month end.` });
  if (airbnb.maxDate && qbo.maxDate && qbo.maxDate.t < airbnb.maxDate.t - 30) out.push({ level: 'warn', msg: `QuickBooks ends ${qbo.maxDate.mdy} but Airbnb runs to ${airbnb.maxDate.mdy}. Re-run the QuickBooks report through month end.` });
  if (airbnb.truncationRisk) out.push({ level: 'warn', msg: `The Airbnb file has ${airbnb.rowCount} rows. Airbnb stops exports at about 1,000 rows, so the end may be cut off. Export a shorter date range if a month looks short.` });
  const bad = airbnb.payouts.filter((p) => !p.date);
  if (bad.length) out.push({ level: 'warn', msg: `${bad.length} payout row(s) have a date the tool could not read and are ignored (first one is row ${bad[0].row}). Dates must look like MM/DD/YYYY.` });
  if (stripe) {
    const sd = stripe.payouts.map((p) => p.dates?.plain).filter(Boolean).sort((a, b) => a.t - b.t);
    if (sd.length && qbo.minDate && (sd[sd.length - 1].t + 45 < qbo.minDate.t || sd[0].t - 45 > qbo.maxDate.t)) out.push({ level: 'warn', msg: `The Stripe report dates (${range(sd[0], sd[sd.length - 1])}) do not overlap QuickBooks (${range(qbo.minDate, qbo.maxDate)}). It may be the wrong year, so it is unlikely to match.` });
  }
  return out;
}

// Problems that only show once the run is done.
export function diagnoseResult(result) {
  const out = [];
  const inRange = result.bookedPayouts.filter((p) => result.months.includes(p.date.month));
  const matched = inRange.filter((p) => p.qbo).length;
  if (inRange.length >= 3 && matched / inRange.length < 0.5) out.push({ level: 'warn', msg: `Only ${matched} of ${inRange.length} Airbnb payouts in the selected months were found in QuickBooks. The files may be for different accounts or years, or the deposits are not booked to Rental Income. Check before posting.` });
  if (result.stripeData && result.stripe && !result.stripe.matches.some((m) => m.mode !== 'none')) out.push({ level: 'warn', msg: 'None of the Stripe payouts were found in QuickBooks, so Stripe income was not reclassed. Check the Stripe report is for the same period.' });
  if (!result.journal.length && result.summary.matched > 0) out.push({ level: 'info', msg: 'Nothing to reclass for the selected months: the booked classes already match Airbnb/Stripe.' });
  return out;
}

// ---------------------------------------------------------------- outputs
export function journalCsv(result) {
  const head = ['*JournalNo', '*JournalDate', '*AccountName', 'Debits', 'Credits', 'Description', 'Name', 'Class'];
  const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.join(',')];
  for (const j of result.journal) for (const l of j.lines) {
    lines.push([l.no, l.date, l.account, l.debit ?? '', l.credit ?? '', l.desc, l.name, l.cls].map(esc).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export function escalationEmail(result) {
  const ex = result.exceptions.filter((e) => BLOCKING.includes(e.code) || e.code === 'foreign-excluded');
  if (!ex.length) return 'Nothing to escalate for this run.';
  const mo = result.months.join(', ');
  const out = [`Subject: Airbnb reclass queries for ${mo}`, '', 'Hi Jonathan and Jennifer,', '',
    'While reclassifying Steven\'s Airbnb payouts we need your input on the items below before we post.', ''];
  ex.forEach((e, i) => {
    out.push(`${i + 1}. ${e.title}${e.code === 'foreign-excluded' ? ' (for your information)' : ''}`);
    out.push(`   ${e.detail}`);
    for (const it of e.items.slice(0, 60)) {
      out.push(`   - ${[it.date, it.listing, it.guest, it.amount !== undefined ? (+it.amount).toFixed(2) : '', it.note].filter((x) => x !== undefined && x !== '').join(' | ')}`);
    }
    if (e.items.length > 60) out.push(`   ... and ${e.items.length - 60} more (see workpaper)`);
    out.push('');
  });
  out.push('Thanks,');
  return out.join('\n');
}

// ---------------------------------------------------------------- SOP step 10: P&L by Class after posting
export function isPnlRows(rows) {
  return rows.slice(0, 5).some((r) => /^profit and loss/i.test(clean(r[0])));
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function parsePeriod(text) {
  const re = new RegExp(`(${MONTHS.join('|')})(?:\\s+\\d{1,2}(?!\\d))?(?:\\s*,?\\s*(\\d{4}))?`, 'gi');
  const hits = []; let m;
  while ((m = re.exec(text))) hits.push({ mo: MONTHS.indexOf(m[1].toLowerCase()) + 1, y: m[2] ? +m[2] : null });
  if (!hits.length) return null;
  const lastY = [...hits].reverse().find((h) => h.y)?.y;
  if (!lastY) return null;
  for (let i = hits.length - 1; i >= 0; i--) if (!hits[i].y) hits[i].y = i + 1 < hits.length && hits[i + 1].y ? hits[i + 1].y : lastY;
  const a = hits[0], z = hits[hits.length - 1];
  const out = []; let y = a.y, mo = a.mo;
  for (let guard = 0; guard < 120; guard++) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    if (y === z.y && mo === z.mo) break;
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}
export function parsePnl(rows, cfg) {
  const period = rows.slice(0, 6).map((r) => clean(r[0])).find((t) => /\d{4}/.test(t) && !/^profit/i.test(t)) ?? '';
  const hi = rows.findIndex((r, i) => i >= 2 && !clean(r[0]) && r.slice(1).filter((c) => clean(c)).length >= 2);
  if (hi < 0) throw new Error('Could not find the class columns. Run Profit and Loss with Class as the column.');
  const head = rows[hi].map(clean);
  const line = rows.find((r, i) => i > hi && clean(r[0]) === cfg.incomeAccount);
  if (!line) throw new Error(`No "${cfg.incomeAccount}" row in the Profit and Loss.`);
  const byClass = {};
  head.forEach((h, i) => { if (i > 0 && h && !/^total$/i.test(h)) byClass[h] = toNumber(line[i]) ?? 0; });
  return { period, months: parsePeriod(period), byClass };
}
// Compare a P&L run after posting with the correct totals from this run.
export function comparePnl(result, pnl) {
  const want = [...result.months].sort();
  if (!pnl.months || pnl.months.join() !== want.join()) {
    return { comparable: false, message: `The P&L covers "${pnl.period || 'an unknown period'}", but the selected months are ${want.join(', ')}. Run the P&L for exactly the selected months, after posting.` };
  }
  const rows = [];
  const classes = new Set([...result.classes, ...Object.keys(pnl.byClass)]);
  for (const c of classes) {
    const expected = round2(want.reduce((a, m) => a + (result.truth[m]?.[c] ?? 0), 0));
    const actual = round2(pnl.byClass[c] ?? 0);
    rows.push({ cls: c, expected, actual, diff: round2(actual - expected), ok: Math.abs(actual - expected) < 0.01 });
  }
  return { comparable: true, rows, ok: rows.every((r) => r.ok) };
}

export function workpaperSheets(result) {
  const sheets = {};
  const sum = [];
  for (const m of result.months) for (const c of result.classes) {
    const a = result.cur[m]?.[c] ?? 0, b = result.truth[m]?.[c] ?? 0, d = result.adj[m][c];
    if (a || b || d) sum.push({ Month: m, Class: c, 'Booked in QBO today (incl. earlier reclass entries)': a, 'Correct per Airbnb/Stripe': b, 'Reclass needed (+credit / -debit)': d });
  }
  sheets['Summary by month'] = sum;
  sheets['Destination x class'] = result.destSummary.map((d) => ({ Month: d.month, Destination: d.label, Status: d.status, Class: d.cls, Amount: d.amt }));
  sheets['Journal entries'] = result.journal.flatMap((j) => j.lines.map((l) => ({
    '*JournalNo': l.no, '*JournalDate': l.date, '*AccountName': l.account, Debits: l.debit ?? '', Credits: l.credit ?? '', Description: l.desc, Name: l.name, Class: l.cls })));
  if (result.timing?.length) sheets['Timing adjustments'] = result.timing.map((t) => ({ Month: t.month, 'Deposit date': t.depositDate, 'Payout date': t.payoutDate, Reference: t.ref, Amount: t.amount, 'Debit (reverses earlier move)': t.fromClass, Credit: t.toClass, 'Earlier entry': t.priorNo, Note: 'Netted into this month\'s journal entries' }));
  sheets['Exceptions'] = result.exceptions.flatMap((e) => (e.items.length ? e.items : [{}]).map((it) => ({
    Type: e.sev, Issue: e.title, Date: it.date ?? '', 'Listing / account': it.listing ?? '', Guest: it.guest ?? '', Amount: it.amount ?? '', Reference: it.ref ?? '', Note: it.note ?? (it.date ? '' : e.detail) })));
  sheets['Checks'] = result.checks.map((c) => ({ Check: c.label, Result: c.ok ? 'Pass' : 'REVIEW', Detail: c.detail }));
  sheets['Airbnb payouts'] = result.bookedPayouts.map((p) => {
    const row = { 'Payout date': p.date?.mdy ?? '', Reference: p.ref, Destination: p.destLabel, 'Paid out': p.paid, 'Sum of lines': p.sum, Diff: p.diff, Ties: p.ties ? 'Yes' : 'NO' };
    for (const c of result.classes) row[c] = p.byClass.get(c) ?? 0;
    row['Unmapped'] = p.byClass.get('?') ?? 0;
    row['QBO deposit date'] = p.qbo?.date.mdy ?? 'NOT FOUND';
    row['QBO class (as booked)'] = p.qbo?.cls ?? '';
    return row;
  });
  sheets['Airbnb lines'] = result.payouts.flatMap((p) => p.lines.map((l) => ({
    'Payout date': p.date?.mdy ?? '', Reference: p.ref, Destination: p.destLabel, Booked: p.booked ? 'Yes' : 'No',
    'Line date': l.date?.mdy ?? '', Type: l.type, Confirmation: l.code, Guest: l.guest, Listing: l.listing, Class: l.cls ?? '', Currency: l.currency, Amount: l.amount })));
  if (result.stripeData?.lines.length) {
    sheets['Stripe lines'] = result.stripeData.lines.map((l) => ({
      Payout: l.payoutId, Sheet: l.sheet, Category: l.cat, Guest: l.guest, Listing: l.listing, Class: l.cls ?? '', Gross: l.gross, Net: l.net, Description: l.desc }));
  }
  return sheets;
}
