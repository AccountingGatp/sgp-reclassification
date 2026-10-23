import * as core from './core.js';
import { DEFAULT_CONFIG, mergeConfig } from './config.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cls$ = (n) => (Math.abs(n) < 0.005 ? 'zero' : n > 0 ? 'pos' : 'neg');

// ------------------------------------------------------------ state
const LS_KEY = 'property-reclass-config-v1';
const state = {
  cfg: loadConfig(),
  inputs: { airbnb: [], qbo: null, stripe: [], pnl: null },
  ack: false, ackKey: '',
  parsed: null, months: new Set(), monthList: [], result: null, tab: 'summary', picked: false,
};

function loadConfig() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return mergeConfig(JSON.parse(s)); } catch { /* storage blocked */ }
  return mergeConfig(null);
}
function saveConfig() { try { localStorage.setItem(LS_KEY, JSON.stringify(state.cfg)); } catch { /* ignore */ } }

// ------------------------------------------------------------ file intake
const drop = $('#drop'), fileInput = $('#file');
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => ingestAll([...e.dataTransfer.files]));
fileInput.addEventListener('change', () => { ingestAll([...fileInput.files]); fileInput.value = ''; });

async function readSheets(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const wb = window.XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((name) => ({ name, rows: window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) }));
}

// Every report can arrive as CSV or Excel, so each file is first turned into sheets of rows
// and then recognised by its content, not by its extension.
async function toSheets(f, ext) {
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const text = await f.text();
    return [{ name: f.name, rows: core.parseCSV(text) }];
  }
  return readSheets(f);
}

async function ingestAll(files) {
  setErr('');
  for (const f of files) {
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!f.size) { addSkipped(f.name, 'The file is empty (0 bytes). Re-export it and try again.'); continue; }
      if (!['csv', 'tsv', 'txt', 'xlsx', 'xls'].includes(ext)) { addSkipped(f.name, `Cannot use a .${ext} file. Upload CSV or Excel (.xlsx) exports.`); continue; }
      const sheets = await toSheets(f, ext);
      const first = sheets[0]?.rows ?? [];
      const kind = sheets.some((s) => core.isAirbnbRows(s.rows)) ? 'airbnb'
        : sheets.some((s) => core.isQboRows(s.rows)) ? 'qbo'
        : sheets.some((s) => core.isStripeRows(s.rows)) ? 'stripe'
        : core.isPnlRows(first) ? 'pnl' : null;
      if (kind === 'airbnb') {
        const rows = sheets.find((s) => core.isAirbnbRows(s.rows)).rows;
        const p = core.parseAirbnb(rows, state.cfg);
        state.inputs.airbnb = state.inputs.airbnb.filter((x) => x.name !== f.name);
        state.inputs.airbnb.push({ name: f.name, rows, max: p.maxDate?.t ?? 0, min: p.minDate?.t ?? 0, info: `${p.payouts.length} payouts, ${p.minDate?.mdy ?? '?'} to ${p.maxDate?.mdy ?? '?'}` });
        state.inputs.airbnb.sort((a, b) => b.max - a.max);
        const mine = state.inputs.airbnb.find((x) => x.name === f.name);
        const others = state.inputs.airbnb.filter((x) => x !== mine);
        if (others.length && p.minDate && p.maxDate && others.some((x) => x.min <= p.minDate.t && x.max >= p.maxDate.t)) addSkipped(f.name, 'Loaded, but its dates are already inside another Airbnb file, so it adds nothing. Use it only for the days before the other file starts.');
      } else if (kind === 'qbo') {
        const rows = sheets.find((s) => core.isQboRows(s.rows)).rows;
        const p = core.parseQbo(rows, state.cfg);
        const mine = { name: f.name, rows, info: `${p.rows.length} ${state.cfg.incomeAccount} lines, ${p.minDate?.mdy ?? '?'} to ${p.maxDate?.mdy ?? '?'}`, max: p.maxDate?.t ?? 0, n: p.rows.length };
        const cur = state.inputs.qbo;
        if (!cur || mine.max > cur.max || (mine.max === cur.max && mine.n >= cur.n)) state.inputs.qbo = mine;
        else addSkipped(f.name, 'Older QuickBooks export; the one with later dates is used');
      } else if (kind === 'stripe') {
        state.inputs.stripe = state.inputs.stripe.filter((x) => x.name !== f.name);
        const p = core.parseStripe(sheets, state.cfg);
        if (!p.lines.length) addSkipped(f.name, 'Stripe file has no charge lines. Export the payout reconciliation / itemized payouts report with its transactions.');
        else state.inputs.stripe.push({ name: f.name, sheets, info: `${p.payouts.length} payouts, ${p.lines.length} lines` });
      } else if (kind === 'pnl') {
        const p = core.parsePnl(first, state.cfg);
        state.inputs.pnl = { name: f.name, rows: first, info: `period: ${p.period || 'unknown'}` };
        state.tab = 'after';
      } else {
        const title = first.slice(0, 4).map((r) => r[0]).find((x) => x) ?? 'unknown report';
        addSkipped(f.name, `Not used: this looks like "${title}". The tool needs the Airbnb transaction history, QuickBooks Transaction Detail by Account, a Stripe payouts report, or (after posting) Profit and Loss by Class. Each can be CSV or Excel.`);
      }
    } catch (e) { setErr(`${f.name}: ${friendlyErr(e)}`); }
  }
  state.picked = false;
  compute();
}

function friendlyErr(e) {
  const m = String(e.message || e);
  if (/password|encrypt/i.test(m)) return 'The file is password protected. Remove the password and export it again.';
  if (/zip|corrupt|central directory|unsupported file|bad compressed|invalid|End of data/i.test(m)) return 'The file could not be opened. It may be damaged or not a real Excel file. Re-download it from QuickBooks/Stripe and try again.';
  return m;
}
const skipped = [];
function addSkipped(name, note) { skipped.push({ name, note }); }
function setErr(m) { const el = $('#loaderr'); el.textContent = m; el.hidden = !m; }

function renderFiles() {
  const li = [];
  const { airbnb, qbo, stripe } = state.inputs;
  airbnb.forEach((a, i) => li.push(fileRow('airbnb', i === 0 ? 'Airbnb' : 'Airbnb (prior month)', a.name, a.info, () => { state.inputs.airbnb = state.inputs.airbnb.filter((x) => x !== a); })));
  if (qbo) li.push(fileRow('qbo', 'QuickBooks', qbo.name, qbo.info, () => { state.inputs.qbo = null; }));
  if (state.inputs.pnl) li.push(fileRow('airbnb', 'P&L (after)', state.inputs.pnl.name, state.inputs.pnl.info, () => { state.inputs.pnl = null; }));
  for (const s of stripe) li.push(fileRow('stripe', 'Stripe', s.name, s.info, () => { state.inputs.stripe = state.inputs.stripe.filter((x) => x !== s); }));
  for (const s of skipped.splice(0)) li.push(fileRow('skip', 'Skipped', s.name, s.note));
  const ul = $('#files'); ul.innerHTML = '';
  const missing = [];
  if (!airbnb.length) missing.push('Airbnb CSV'); if (!qbo) missing.push('QuickBooks Transaction Detail by Account');
  for (const l of li) ul.append(l);
  if (missing.length && li.length) { const m = document.createElement('li'); m.innerHTML = `<span class="meta">Still needed: ${esc(missing.join(', '))}</span>`; ul.append(m); }
}
function fileRow(kind, label, name, info, onRemove) {
  const li = document.createElement('li');
  li.innerHTML = `<span><span class="tag ${kind}">${label}</span>${esc(name)} <span class="meta">${esc(info ?? '')}</span></span>`;
  if (onRemove) { const b = document.createElement('button'); b.className = 'btn sm'; b.textContent = 'Remove'; b.addEventListener('click', () => { onRemove(); state.picked = false; compute(); }); li.append(b); }
  return li;
}

// ------------------------------------------------------------ compute
function compute() {
  setErr('');
  renderFiles();
  state.result = null; state.problems = [];
  renderProblems();
  const { airbnb, qbo, stripe } = state.inputs;
  if (!airbnb.length || !qbo) { $('#monthsCard').hidden = true; $('#results').hidden = true; return; }
  try {
    const a = core.mergeAirbnb(airbnb.map((x) => core.parseAirbnb(x.rows, state.cfg)));
    const q = core.parseQbo(qbo.rows, state.cfg);
    const s = stripe.length ? core.parseStripe(stripe.flatMap((x) => x.sheets), state.cfg) : null;
    state.parsed = { airbnb: a, qbo: q, stripe: s };
    state.problems = core.diagnose(state.parsed, state.cfg);
    renderProblems();
    if (state.problems.some((x) => x.level === 'error')) { $('#monthsCard').hidden = true; $('#results').hidden = true; return; }
    state.monthList = core.monthInfo(state.parsed);
    if (!state.picked) { state.months = new Set(state.monthList.filter((m) => m.complete).map((m) => m.month)); state.picked = true; }
    state.months = new Set([...state.months].filter((m) => state.monthList.some((x) => x.month === m)));
    renderMonths();
    run();
  } catch (e) { setErr(e.message); $('#results').hidden = true; }
}

function run() {
  if (!state.parsed) return;
  if (!state.months.size) { state.result = null; $('#results').hidden = true; renderProblems([{ level: 'warn', msg: 'No month is ticked. Tick at least one month above. Months marked incomplete need a fuller export first.' }]); return; }
  state.result = core.analyze(state.parsed, state.cfg, [...state.months]);
  renderProblems(core.diagnoseResult(state.result));
  renderResults();
}

function renderProblems(extra = []) {
  let el = document.querySelector('#problems');
  if (!el) { el = document.createElement('div'); el.id = 'problems'; el.setAttribute('role', 'alert'); $('#files').after(el); }
  const all = [...(state.problems ?? []), ...extra];
  el.innerHTML = all.map((p) => `<p class="${p.level === 'error' ? 'err' : 'hint'}" style="margin:8px 0">${p.level === 'error' ? 'Problem: ' : p.level === 'warn' ? 'Check: ' : 'Note: '}${esc(p.msg)}</p>`).join('');
}

function renderMonths() {
  $('#monthsCard').hidden = false;
  const box = $('#months'); box.innerHTML = '';
  for (const m of state.monthList) {
    const l = document.createElement('label'); l.className = 'chip' + (m.complete ? '' : ' inc');
    l.title = m.complete ? 'Export covers the whole month' : m.reasons.join('; ');
    l.innerHTML = `<input type="checkbox" ${state.months.has(m.month) ? 'checked' : ''}> ${esc(m.month)}${m.complete ? '' : ' <em>incomplete</em>'}`;
    l.querySelector('input').addEventListener('change', (e) => { e.target.checked ? state.months.add(m.month) : state.months.delete(m.month); run(); });
    box.append(l);
  }
}

// ------------------------------------------------------------ results
const TABS = [['summary', 'Summary'], ['entries', 'Journal entries'], ['exceptions', 'Exceptions'], ['checks', 'Checks'], ['payouts', 'Payouts'], ['email', 'Email draft'], ['after', 'After posting']];

function renderResults() {
  const r = state.result;
  $('#results').hidden = false;
  const blocking = r.exceptions.filter((e) => core.BLOCKING.includes(e.code));
  const esc2 = blocking.length;
  const key = blocking.map((e) => e.code + e.title).join('|');
  if (key !== state.ackKey) { state.ackKey = key; state.ack = false; }
  const failed = r.checks.filter((c) => !c.ok && c.label !== 'No open escalation items').length;
  const b = $('#banner');
  if (esc2) { b.className = 'banner warn'; b.innerHTML = `<div>Stop: ${esc2} item${esc2 === 1 ? '' : 's'} to escalate before posting<small>The SOP says to ask Jonathan and Jennifer first. The import file stays locked until you confirm they have answered. ${failed ? 'A tie-out check also needs review (Checks tab).' : ''}</small></div>`; }
  else if (failed) { b.className = 'banner warn'; b.innerHTML = `<div>${r.journal.length} journal ${r.journal.length === 1 ? 'entry' : 'entries'} built, a tie-out check needs review<small>See the Checks and Exceptions tabs (for example duplicate deposits) before posting.</small></div>`; }
  else { b.className = 'banner ok'; b.innerHTML = `<div>${r.journal.length} journal ${r.journal.length === 1 ? 'entry' : 'entries'} ready to post<small>All tie-out checks pass. Have a second person review before posting.</small></div>`; }
  const ack = $('#ack'); ack.checked = state.ack; $('#ackWrap').hidden = !esc2;
  $('#dlCsv').disabled = !r.journal.length || (esc2 > 0 && !state.ack);
  $('#dlCsv').title = $('#dlCsv').disabled && esc2 ? 'Locked until the escalation items are answered' : '';

  const tabs = $('#tabs'); tabs.innerHTML = '';
  for (const [id, label] of TABS) {
    const t = document.createElement('button'); t.className = 'tab'; t.role = 'tab'; t.setAttribute('aria-selected', String(state.tab === id));
    const n = id === 'exceptions' ? esc2 : id === 'checks' ? failed : 0;
    t.innerHTML = esc(label) + (n ? `<span class="n">${n}</span>` : '');
    t.addEventListener('click', () => { state.tab = id; renderResults(); });
    tabs.append(t);
  }
  const p = $('#panel');
  p.innerHTML = { summary, entries, exceptions, checks, payouts, email, after }[state.tab](r);
  if (state.tab === 'exceptions') bindAssign();
  if (state.tab === 'after') bindAfter();
}

function summary(r) {
  let h = '<table><thead><tr><th>Month</th><th>Class</th><th class="num">Booked in QBO today</th><th class="num">Correct</th><th class="num">Reclass (+credit / -debit)</th></tr></thead><tbody>';
  for (const m of r.months) {
    let any = false;
    for (const c of r.classes) {
      const a = r.cur[m]?.[c] ?? 0, b = r.truth[m]?.[c] ?? 0, d = r.adj[m][c];
      if (!a && !b && !d) continue; any = true;
      h += `<tr><td>${esc(m)}</td><td>${esc(c)}</td><td class="num">${money(a)}</td><td class="num">${money(b)}</td><td class="num ${cls$(d)}">${Math.abs(d) < 0.005 ? '-' : money(d)}</td></tr>`;
    }
    if (!any) h += `<tr><td>${esc(m)}</td><td colspan="4" class="zero">No rental income lines</td></tr>`;
  }
  h += '</tbody></table>';
  h += '<h3 style="margin:20px 0 6px;font-size:15px">Airbnb payouts by destination and class (SOP step 5)</h3><table><thead><tr><th>Payout month</th><th>Destination</th><th>Status</th><th>Class</th><th class="num">Amount</th></tr></thead><tbody>';
  for (const d of r.destSummary) h += `<tr><td>${esc(d.month)}</td><td>${esc(d.label)}</td><td>${d.status === 'Booked' ? 'Booked' : '<span class="zero">Excluded, not booked</span>'}</td><td>${esc(d.cls)}</td><td class="num">${money(d.amt)}</td></tr>`;
  h += '</tbody></table><p class="hint" style="margin-top:12px">Payout month here is the Airbnb payout date; the table above uses the QuickBooks deposit date. "Booked today" includes reclass entries already posted (earlier journal numbers are never edited). "Correct" is the Airbnb and Stripe total by listing class.</p>';
  return h;
}

function timingBlock(r) {
  if (!r.timing?.length) return '';
  return `<h3 style="margin:14px 0 6px;font-size:15px">Timing adjustments <span class="meta" style="color:var(--muted);font-weight:400">· already netted into the entries below</span></h3>
    <table><thead><tr><th>Month</th><th>Deposit date</th><th>Payout</th><th class="num">Amount</th><th>Debit (reverses earlier move)</th><th>Credit</th><th>Earlier entry</th></tr></thead><tbody>
    ${r.timing.map((t) => `<tr><td>${esc(t.month)}</td><td>${esc(t.depositDate)}</td><td>${esc(t.ref)} · ${esc(t.payoutDate)}</td><td class="num">${money(t.amount)}</td><td>${esc(t.fromClass)}</td><td>${esc(t.toClass)}</td><td>${esc(t.priorNo)}</td></tr>`).join('')}
    </tbody></table>`;
}

function entries(r) {
  if (!r.journal.length) return timingBlock(r) + '<p class="empty">Nothing to reclass for the selected months. Booked classes already match.</p>';
  return timingBlock(r) + r.journal.map((j) => `
    <h3 style="margin:14px 0 6px;font-size:15px">${esc(j.no)} <span class="meta" style="color:var(--muted);font-weight:400">· ${esc(j.month)} · out of ${esc(j.source)} · ${money(j.total)}</span></h3>
    <table><thead><tr><th>Journal no</th><th>Date</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th>Class</th><th>Description</th></tr></thead><tbody>
    ${j.lines.map((l) => `<tr><td>${esc(l.no)}</td><td>${esc(l.date)}</td><td>${esc(l.account)}</td><td class="num">${money(l.debit)}</td><td class="num">${money(l.credit)}</td><td>${esc(l.cls)}</td><td>${esc(l.desc)}</td></tr>`).join('')}
    </tbody></table>`).join('') +
    `<p class="hint" style="margin-top:12px">Numbering continues after the highest ${esc(state.cfg.journal.prefix)} entry found in QuickBooks (${r.journalStart.max ? esc(state.cfg.journal.prefix + state.cfg.journal.separator + String(r.journalStart.max).padStart(r.journalStart.pad, '0')) : 'none found'}). Debit lowers a class, credit raises it.</p>`;
}

function itemsTable(items) {
  return `<table><thead><tr><th>Date</th><th>Listing / account</th><th>Guest</th><th class="num">Amount</th><th>Reference</th><th>Note</th></tr></thead><tbody>${items.slice(0, 200).map((i) => `<tr><td>${esc(i.date)}</td><td>${esc(i.listing)}</td><td>${esc(i.guest)}</td><td class="num">${money(i.amount)}</td><td>${esc(i.ref)}</td><td>${esc(i.note)}</td></tr>`).join('')}</tbody></table>${items.length > 200 ? `<p class="hint">Showing 200 of ${items.length}. The workpaper has them all.</p>` : ''}`;
}

function exceptions(r) {
  const order = { escalate: 0, fix: 1, open: 2, info: 3 };
  const list = [...r.exceptions].sort((a, b) => order[a.sev] - order[b.sev]);
  if (!list.length) return '<p class="empty">No exceptions.</p>';
  return list.map((e, ix) => {
    const label = { escalate: 'Escalate', fix: 'Fix in QuickBooks', open: 'Check', info: 'FYI' }[e.sev];
    const total = e.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
    const assign = e.code === 'new-listing' && e.listing && !/^chargeback/i.test(e.listing)
      ? `<div class="assign"><label>Class for this listing <select data-assign="${ix}">${state.cfg.classes.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label><button class="btn sm" data-add="${ix}" data-listing="${esc(e.listing)}">Add to class table</button></div>` : '';
    return `<div class="ex"><h3><span class="pill ${e.sev}">${label}</span>${esc(e.title)}</h3><p>${esc(e.detail)}${e.items.length ? ` <strong>${e.items.length} line${e.items.length === 1 ? '' : 's'}, net ${money(total)}</strong>` : ''}</p>${assign}${e.items.length ? `<details ${e.items.length <= 5 ? 'open' : ''}><summary>Show lines</summary>${itemsTable(e.items)}</details>` : ''}</div>`;
  }).join('');
}
function bindAssign() {
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    const sel = document.querySelector(`[data-assign="${b.dataset.add}"]`);
    state.cfg.listings.push({ name: b.dataset.listing, cls: sel.value });
    saveConfig(); compute();
  }));
}

function checks(r) {
  return `<table><thead><tr><th style="width:90px">Result</th><th>SOP tie-out check</th><th>Detail</th></tr></thead><tbody>${r.checks.map((c) => `<tr><td><span class="pill ${c.ok ? 'pass' : 'fail'}">${c.ok ? 'Pass' : 'Review'}</span></td><td>${esc(c.label)}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table>`;
}

function payouts(r) {
  const cs = r.classes;
  return `<table><thead><tr><th>Payout date</th><th>Destination</th><th class="num">Paid out</th>${cs.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th>Ties</th><th>QBO deposit</th></tr></thead><tbody>${r.bookedPayouts.slice().sort((a, b) => b.date.t - a.date.t).slice(0, 400).map((p) => `<tr><td>${esc(p.date?.mdy)}</td><td>${esc(p.destLabel)}</td><td class="num">${money(p.paid)}</td>${cs.map((c) => `<td class="num">${money(p.byClass.get(c) ?? 0) || ''}</td>`).join('')}<td>${p.ties ? 'Yes' : '<strong class="neg">No</strong>'}</td><td>${p.qbo ? esc(p.qbo.date.mdy) + ' · ' + esc(p.qbo.cls) : '<strong class="neg">Not found</strong>'}</td></tr>`).join('')}</tbody></table><p class="hint" style="margin-top:12px">Only payouts to booked accounts are listed. PayPal and Empire payouts are excluded per the SOP. "QBO deposit" shows the class as originally booked.</p>`;
}

function email(r) {
  return `<textarea readonly style="width:100%;min-height:340px;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)">${esc(core.escalationEmail(r))}</textarea>`;
}

function after(r) {
  const pnl = state.inputs.pnl;
  let h = `<p class="hint">SOP step 10. After you post the entries, run <strong>Profit and Loss by Class</strong> in QuickBooks for exactly the selected months (${esc(r.months.join(', '))}), with classes as columns, and drop the file anywhere on this page. Rental Income for each class must equal the correct total.</p>`;
  if (!pnl) return h + '<p class="empty">No Profit and Loss added yet.</p>';
  try {
    const cmp = core.comparePnl(r, core.parsePnl(pnl.rows, state.cfg));
    if (!cmp.comparable) return h + `<div class="err">${esc(cmp.message)}</div>`;
    h += `<div class="banner ${cmp.ok ? 'ok' : 'warn'}">${cmp.ok ? 'Every class matches the Airbnb and Stripe totals' : 'Some classes do not match'}</div>`;
    h += '<table><thead><tr><th>Class</th><th class="num">Expected (correct)</th><th class="num">P&amp;L Rental Income</th><th class="num">Difference</th><th></th></tr></thead><tbody>' + cmp.rows.map((x) => `<tr><td>${esc(x.cls)}</td><td class="num">${money(x.expected)}</td><td class="num">${money(x.actual)}</td><td class="num ${cls$(x.diff)}">${money(x.diff)}</td><td><span class="pill ${x.ok ? 'pass' : 'fail'}">${x.ok ? 'Match' : 'Review'}</span></td></tr>`).join('') + '</tbody></table>';
  } catch (e) { h += `<div class="err">${esc(e.message)}</div>`; }
  return h + `<p><button class="btn sm" id="rmPnl">Remove P&amp;L</button></p>`;
}
function bindAfter() { const b = $('#rmPnl'); if (b) b.addEventListener('click', () => { state.inputs.pnl = null; renderFiles(); renderResults(); }); }

// ------------------------------------------------------------ downloads
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const span = () => { const m = state.result.months; return m.length > 1 ? `${m[0]}_to_${m[m.length - 1]}` : m[0]; };
$('#dlCsv').addEventListener('click', () => download(`qbo-journal-import_${span()}.csv`, new Blob([core.journalCsv(state.result)], { type: 'text/csv' })));
$('#dlXlsx').addEventListener('click', () => {
  const X = window.XLSX, wb = X.utils.book_new();
  for (const [name, rows] of Object.entries(core.workpaperSheets(state.result))) {
    const ws = X.utils.json_to_sheet(rows.length ? rows : [{ Note: 'Nothing to show' }]);
    const keys = Object.keys(rows[0] ?? { Note: '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(60, Math.max(k.length + 2, ...rows.slice(0, 200).map((r) => String(r[k] ?? '').length + 2))) }));
    for (const addr of Object.keys(ws)) if (addr[0] !== '!' && typeof ws[addr].v === 'number') ws[addr].z = '#,##0.00';
    X.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  download(`reclass-workpaper_${span()}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
});
$('#ack').addEventListener('change', (e) => { state.ack = e.target.checked; renderResults(); });
$('#copyMail').addEventListener('click', async (e) => {
  const text = core.escalationEmail(state.result); const b = e.currentTarget;
  try { await navigator.clipboard.writeText(text); } catch {
    const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  const old = b.textContent; b.textContent = 'Copied'; setTimeout(() => { b.textContent = old; }, 1500);
});

// ------------------------------------------------------------ settings
$('#openSettings').addEventListener('click', () => { const c = $('#settingsCard'); c.hidden = !c.hidden; if (!c.hidden) { renderSettings(); c.scrollIntoView({ behavior: 'smooth' }); } });

function renderSettings() {
  const c = state.cfg;
  $('#settings').innerHTML = `<div class="set-grid">
    <div><h3>Class table (listing to QBO class)</h3>
      <p class="hint">Matching ignores case and spacing around "|". A listing that is not here stops the process and is escalated.</p>
      <div id="listRows">${c.listings.map((l, i) => `<div class="row"><input type="text" data-l="${i}" data-f="name" value="${esc(l.name)}"><input type="text" data-l="${i}" data-f="cls" value="${esc(l.cls)}" list="clsList" style="min-width:170px;flex:0"><button class="btn sm" data-del-l="${i}">Remove</button></div>`).join('')}</div>
      <button class="btn sm" id="addL">Add listing</button></div>
    <div><h3>Payout destinations</h3>
      <p class="hint">Matched against the Details text of each Airbnb payout. Only "booked" accounts are reclassed.</p>
      ${Object.entries(c.destinations).map(([k, d]) => `<div class="row"><code>${esc(k)}</code> ${esc(d.label)} <label><input type="checkbox" data-dest="${esc(k)}" ${d.booked ? 'checked' : ''}> booked in Steven's books</label></div>`).join('')}
      <div class="row"><input type="text" id="newDest" placeholder="Add key, e.g. 4455 or Venmo" style="min-width:200px;flex:0"><button class="btn sm" id="addDest">Add (not booked)</button></div></div>
    <div><h3>Stripe keyword rules</h3>
      <p class="hint">Used after the class table. First match wins.</p>
      <div>${c.stripeRules.map((s, i) => `<div class="row"><input type="text" data-s="${i}" data-f="contains" value="${esc(s.contains)}" style="min-width:200px;flex:1"><input type="text" data-s="${i}" data-f="cls" value="${esc(s.cls)}" list="clsList" style="min-width:170px;flex:0"><button class="btn sm" data-del-s="${i}">Remove</button></div>`).join('')}</div>
      <button class="btn sm" id="addS">Add rule</button></div>
    <div><h3>Journal and matching</h3>
      <div class="row"><label>Entry prefix <input type="text" id="jPrefix" value="${esc(c.journal.prefix)}" style="min-width:80px;width:90px;flex:0"></label>
      <label>Digits <input type="number" id="jPad" min="1" max="6" value="${c.journal.pad}" style="width:70px"></label>
      <label>Tie tolerance $ <input type="number" id="tol" step="0.01" min="0" value="${c.tolerance}" style="width:80px"></label>
      <label>Deposit lag, days before / after <input type="number" id="mwb" min="0" value="${c.matchWindow.before}" style="width:60px"> <input type="number" id="mwa" min="0" value="${c.matchWindow.after}" style="width:60px"></label></div>
      <div class="row"><label>QuickBooks income account <input type="text" id="inc" value="${esc(c.incomeAccount)}" style="min-width:180px;flex:0"></label>
      <label>Classes <input type="text" id="classes" value="${esc(c.classes.join(', '))}" style="min-width:320px"></label></div></div>
    <div class="row"><button class="btn" id="expCfg">Export settings (.json)</button><label class="btn">Import settings<input type="file" id="impCfg" accept=".json" hidden></label><button class="btn" id="resetCfg">Reset to SOP defaults</button></div>
    <datalist id="clsList">${c.classes.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>`;
  bindSettings();
}

function bindSettings() {
  const c = state.cfg; const apply = () => { saveConfig(); reparseInputs(); };
  const root = $('#settings');
  root.querySelectorAll('[data-l]').forEach((el) => el.addEventListener('change', () => { c.listings[+el.dataset.l][el.dataset.f] = el.value.trim(); apply(); }));
  root.querySelectorAll('[data-s]').forEach((el) => el.addEventListener('change', () => { c.stripeRules[+el.dataset.s][el.dataset.f] = el.value.trim(); apply(); }));
  root.querySelectorAll('[data-del-l]').forEach((el) => el.addEventListener('click', () => { c.listings.splice(+el.dataset.delL, 1); apply(); renderSettings(); }));
  root.querySelectorAll('[data-del-s]').forEach((el) => el.addEventListener('click', () => { c.stripeRules.splice(+el.dataset.delS, 1); apply(); renderSettings(); }));
  $('#addL').addEventListener('click', () => { c.listings.push({ name: '', cls: c.classes[0] ?? '' }); renderSettings(); });
  $('#addS').addEventListener('click', () => { c.stripeRules.push({ contains: '', cls: c.classes[0] ?? '' }); renderSettings(); });
  root.querySelectorAll('[data-dest]').forEach((el) => el.addEventListener('change', () => { c.destinations[el.dataset.dest].booked = el.checked; apply(); }));
  $('#addDest').addEventListener('click', () => { const k = $('#newDest').value.trim(); if (k && !c.destinations[k]) { c.destinations[k] = { label: k, booked: false }; apply(); renderSettings(); } });
  const num = (id, fn) => $(id).addEventListener('change', (e) => { fn(e.target.value); apply(); });
  num('#jPrefix', (v) => { c.journal.prefix = v.trim() || 'WIRC'; });
  num('#jPad', (v) => { c.journal.pad = Math.max(1, +v || 3); });
  num('#tol', (v) => { c.tolerance = Math.max(0, +v || 0); });
  num('#mwb', (v) => { c.matchWindow.before = Math.max(0, +v || 0); });
  num('#mwa', (v) => { c.matchWindow.after = Math.max(0, +v || 0); });
  num('#inc', (v) => { c.incomeAccount = v.trim() || 'Rental Income'; });
  num('#classes', (v) => { c.classes = v.split(',').map((x) => x.trim()).filter(Boolean); });
  $('#expCfg').addEventListener('click', () => download('reclass-settings.json', new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' })));
  $('#impCfg').addEventListener('change', async (e) => { try { state.cfg = mergeConfig(JSON.parse(await e.target.files[0].text())); saveConfig(); reparseInputs(); renderSettings(); } catch { setErr('That settings file could not be read.'); } });
  $('#resetCfg').addEventListener('click', () => { state.cfg = mergeConfig(null); saveConfig(); reparseInputs(); renderSettings(); });
}

function reparseInputs() { compute(); }

renderFiles();
