import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';
import { DEFAULT_CONFIG as cfg } from '../src/config.js';

// ---- synthetic fixtures (no real data) ----
const HEAD = 'Date,Arriving by date,Type,Confirmation Code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast Pay Fee,Cleaning fee,Pet fee,Gross earnings,Airbnb remitted tax,Earnings year';
const row = (o) => [o.date, '', o.type, o.code ?? '', '', '', '', '', o.guest ?? '', o.listing ?? '', o.details ?? '', o.ref ?? '', o.cur ?? 'USD', o.amt ?? '', o.paid ?? '', '', '', '', '', '', '', '2030'].map((v) => (String(v).includes(',') ? `"${v}"` : v)).join(',');
const csv = [HEAD,
  row({ date: '03/10/2030', type: 'Payout', details: 'Transfer to Stevie Garcia, Checking 1393 (USD)', ref: 'G-AAAAAAAA1', paid: 1450 }),
  row({ date: '03/10/2030', type: 'Reservation', guest: 'A', listing: 'Wisconsin Luxury Log Mansion | Sleeps 15', amt: 1000 }),
  row({ date: '03/10/2030', type: 'Reservation', guest: 'B', listing: 'Spacious Condo | Steps to French Quarter', amt: 500 }),
  row({ date: '03/10/2030', type: 'Co-Host payout', listing: 'Spacious Condo | Steps to French Quarter', amt: -50 }),
  row({ date: '03/12/2030', type: 'Payout', details: 'Transfer to Steven Garcia, Checking 2665 (USD)', ref: 'G-BBBBBBBB2', paid: 300 }),
  row({ date: '03/12/2030', type: 'Reservation', guest: 'C', listing: 'Glamping Cabin | Huge Window | Over a Creek', amt: 200 }),
  row({ date: '03/12/2030', type: 'Reservation', guest: 'D', listing: 'Brand New Listing | Sleeps 2', amt: 100 }),
  row({ date: '03/14/2030', type: 'Payout', details: 'Transfer to PayPal: x@y.com (USD)', ref: 'G-CCCCCCCC3', paid: 40 }),
  row({ date: '03/14/2030', type: 'Reservation', guest: 'E', listing: 'Spacious Condo | Steps to French Quarter', amt: 40 }),
  row({ date: '03/15/2030', type: 'Payout', details: 'Transfer to Empire Tours and Productions CO., Checking 6673 (USD)', ref: 'G-DDDDDDDD4', paid: 500 }),
  row({ date: '03/15/2030', type: 'Experience', guest: 'F', listing: 'Capitol Hill Guided Tour', amt: 300 }),
  row({ date: '03/15/2030', type: 'Reservation', guest: 'G', listing: 'Wisconsin Luxury Log Mansion | Sleeps 15', amt: 200 }),
].join('\n');
const qhead = [null, 'Transaction date', 'Transaction type', 'Num', 'Name', 'Location full name', 'Class full name', 'Description', 'Split', 'Amount', 'Balance', 'Adj'];
const q = (d, t, num, name, desc, cls, split, amt) => ['', d, t, num, name, '', cls, desc, split, amt, '', 'No'];
const qrows = [['Test Co'], ['Transaction Detail by Account'], ['March 2030'], [], qhead,
  ['Rental Income'],
  q('03/11/2030', 'Deposit', '', 'Airbnb', 'AIRBNB G-AAAAAAAA1', 'Ohio Homesteading', 'CPC Checking (1393)', 1450),
  q('03/11/2030', 'Deposit', '', 'Airbnb', 'AIRBNB G-AAAAAAAA1 dup', 'Ohio Homesteading', 'CPC Checking (1393)', 1450),
  q('03/13/2030', 'Deposit', '', 'Airbnb', 'AIRBNB G-BBBBBBBB2', 'Ohio Homesteading', 'Chase Complete Checking (2665) - Ohio', 300),
  q('03/31/2030', 'Journal Entry', 'WIRC-003', '', 'Reclass', 'Ohio Homesteading', '', -1450),
  q('03/31/2030', 'Journal Entry', 'WIRC-003', '', 'Reclass', 'Cassville WI', '', 1450),
  ['Total for Rental Income'],
];
const qbo = () => C.parseQbo(qrows, cfg);

test('csv parser handles quotes and CRLF', () => {
  assert.deepEqual(C.parseCSV('a,"b,c"\r\n1,"x""y"\r\n'), [['a', 'b,c'], ['1', 'x"y']]);
});

test('airbnb payouts group and tie, co-host included', () => {
  const a = C.parseAirbnb(csv, cfg);
  assert.equal(a.payouts.length, 4);
  assert.ok(a.payouts.every((p) => p.ties));
  assert.equal(a.payouts[0].sum, 1450);
  assert.equal(a.payouts[0].destKey, '1393');
  assert.equal(a.payouts[2].booked, false); // PayPal
});

test('listing match ignores spacing around pipes', () => {
  const c2 = structuredClone(cfg);
  const a = C.parseAirbnb(csv.replace('Glamping Cabin | Huge Window | Over a Creek', 'Glamping Cabin|Huge Window|Over a Creek'), c2);
  assert.equal(a.payouts[1].lines[0].cls, 'Ohio Homesteading');
});

test('end to end: NOLA split out of Cassville, next journal number, escalations', () => {
  const airbnb = C.parseAirbnb(csv, cfg);
  const r = C.analyze({ airbnb, qbo: qbo(), stripe: null }, cfg, ['2030-03']);
  assert.equal(r.journalStart.next, 4);
  assert.equal(r.journal.length, 1);
  const j = r.journal[0];
  assert.equal(j.no, 'WIRC-004');
  assert.equal(j.source, 'Cassville WI');
  assert.equal(j.lines[0].debit, 450);               // 500 NOLA less 50 co-host cut
  assert.equal(j.lines[1].credit, 450);
  assert.equal(j.lines[1].cls, 'NOLA');
  assert.equal(j.lines[0].date, '03/31/2030');
  const codes = r.exceptions.map((e) => e.code);
  assert.ok(codes.includes('new-listing'));
  assert.ok(codes.includes('duplicate'));
  assert.ok(codes.includes('empire-property'));
  assert.ok(r.checks.find((c) => c.label.startsWith('After the entries')).ok);
});

test('csv export: both lines share the journal number, debit and credit on the right sides', () => {
  const airbnb = C.parseAirbnb(csv, cfg);
  const r = C.analyze({ airbnb, qbo: qbo(), stripe: null }, cfg, ['2030-03']);
  const lines = C.journalCsv(r).trim().split(/\r?\n/);
  assert.equal(lines[0], '*JournalNo,*JournalDate,*AccountName,Debits,Credits,Description,Name,Class');
  assert.match(lines[1], /^WIRC-004,03\/31\/2030,Rental Income,450,,.*Cassville WI$/);
  assert.match(lines[2], /^WIRC-004,03\/31\/2030,Rental Income,,450,.*NOLA$/);
});

test('empty month selection and already-correct books produce no entries', () => {
  const airbnb = C.parseAirbnb(csv, cfg);
  const r0 = C.analyze({ airbnb, qbo: qbo(), stripe: null }, cfg, []);
  assert.equal(r0.journal.length, 0);
});

test('month completeness flags exports that stop early', () => {
  const airbnb = C.parseAirbnb(csv, cfg);
  const info = C.monthInfo({ airbnb, qbo: qbo() });
  assert.equal(info[0].complete, false);
});

test('missing income account section gives a clear error', () => {
  assert.throws(() => C.parseQbo([['x'], [null, 'Transaction date', 'Amount', 'Split', 'Class full name']], cfg), /Rental Income/);
});

test('missing Airbnb columns give a clear error', () => {
  assert.throws(() => C.parseAirbnb('a,b\n1,2', cfg), /missing column/);
});

// ---- SOP alignment tests ----
const run3 = () => C.analyze({ airbnb: C.parseAirbnb(csv, cfg), qbo: qbo(), stripe: null }, cfg, ['2030-03']);

test('only the three SOP escalation categories block posting', () => {
  const r = run3();
  const byCode = Object.fromEntries(r.exceptions.map((e) => [e.code, e]));
  assert.ok(C.BLOCKING.includes('new-listing') && C.BLOCKING.includes('empire-property'));
  assert.equal(byCode['duplicate'].sev, 'fix');
  assert.ok(!C.BLOCKING.includes('duplicate') && !C.BLOCKING.includes('no-payout'));
});

test('escalation email lists SOP items with date, listing, guest, amount; leaves out duplicates', () => {
  const mail = C.escalationEmail(run3());
  assert.match(mail, /New listing not in the class table/);
  assert.match(mail, /03\/12\/2030 \| Brand New Listing \| Sleeps 2 \| D \| 100\.00/);
  assert.match(mail, /Property booking paid to Empire/);
  assert.doesNotMatch(mail, /Duplicate deposits/);
});

test('step 5 summary: destination by class, excluded accounts shown but not booked', () => {
  const r = run3();
  const paypal = r.destSummary.find((d) => d.dest === 'PayPal' && d.cls === 'NOLA');
  assert.equal(paypal.status, 'Excluded'); assert.equal(paypal.amt, 40);
  const cpc = r.destSummary.filter((d) => d.dest === '1393');
  assert.deepEqual(cpc.map((d) => [d.cls, d.amt]).sort(), [['Cassville WI', 1000], ['NOLA', 450]]);
  assert.ok(r.destSummary.find((d) => d.dest === '6673' && d.cls === '(not a property booking)'));
});

test('deposit check fails when a payout is posted twice in QuickBooks', () => {
  const r = run3();
  assert.equal(r.checks.find((c) => c.label.startsWith('Total deposited')).ok, false);
});

test('period parser', () => {
  assert.equal(C.parsePeriod('January, 2025-August, 2026').length, 20);
  assert.deepEqual(C.parsePeriod('March 2030'), ['2030-03']);
  assert.equal(C.parsePeriod('January 1-September 25, 2026').length, 9);
  assert.equal(C.parsePeriod('nothing'), null);
});

test('step 10: P&L by class after posting is compared with the correct totals', () => {
  const r = run3();
  const mk = (c, n, o) => [['Test Co'], ['Profit and Loss'], ['March 2030'], [], ['', 'Cassville WI', 'NOLA', 'Ohio Homesteading', 'Total'], ['Income'], ['Rental Income', c, n, o, c + n + o]];
  const t = r.truth['2030-03'];
  const good = C.comparePnl(r, C.parsePnl(mk(t['Cassville WI'], t['NOLA'], t['Ohio Homesteading']), cfg));
  assert.ok(good.comparable && good.ok);
  const bad = C.comparePnl(r, C.parsePnl(mk(t['Cassville WI'] + 5, t['NOLA'], t['Ohio Homesteading']), cfg));
  assert.equal(bad.ok, false);
  const wrongPeriod = C.comparePnl(r, C.parsePnl([['x'], ['Profit and Loss'], ['January, 2025-August, 2026'], [], ['', 'A', 'B'], ['Rental Income', 1, 2]], cfg));
  assert.equal(wrongPeriod.comparable, false);
});

// ---- prior-month Airbnb file and timing adjustments ----
const mkCsv = (rows) => [HEAD, ...rows].join('\n');
const priorCsv = mkCsv([
  row({ date: '08/31/2030', type: 'Payout', details: 'Transfer to Stevie Garcia, Checking 1393 (USD)', ref: 'G-PRIOR0001', paid: 300 }),
  row({ date: '08/31/2030', type: 'Reservation', guest: 'P', listing: 'Spacious Condo | Steps to French Quarter', amt: 300 }),
]);
const sepCsv = mkCsv([
  row({ date: '09/05/2030', type: 'Payout', details: 'Transfer to Stevie Garcia, Checking 1393 (USD)', ref: 'G-SEPT00001', paid: 200 }),
  row({ date: '09/05/2030', type: 'Reservation', guest: 'S', listing: 'Wisconsin Luxury Log Mansion | Sleeps 15', amt: 200 }),
]);
const qh = [null, 'Transaction date', 'Transaction type', 'Num', 'Name', 'Location full name', 'Class full name', 'Description', 'Split', 'Amount', 'Balance', 'Adj'];
const sepQbo = (withAugJe) => C.parseQbo([['Test Co'], ['Transaction Detail by Account'], ['Sept 2030'], [], qh, ['Rental Income'],
  q('09/01/2030', 'Deposit', '', 'Airbnb', 'AIRBNB', 'Ohio Homesteading', 'CPC Checking (1393)', 300),
  q('09/06/2030', 'Deposit', '', 'Airbnb', 'AIRBNB', 'Ohio Homesteading', 'CPC Checking (1393)', 200),
  ...(withAugJe ? [
    q('08/31/2030', 'Journal Entry', 'WIRC-001', '', 'Reclass', 'Cassville WI', '', -300),
    q('08/31/2030', 'Journal Entry', 'WIRC-001', '', 'Reclass', 'NOLA', '', 300)] : []),
  ['Total for Rental Income']], cfg);
const air = (...t) => C.mergeAirbnb(t.map((x) => C.parseAirbnb(x, cfg)));
const lineOf = (res, cls) => res.journal.flatMap((j) => j.lines).filter((l) => l.cls === cls).map((l) => (l.credit ?? 0) - (l.debit ?? 0)).reduce((a, b) => a + b, 0);

test('prior file + earlier entry: timing line netted into the new month', () => {
  const r = C.analyze({ airbnb: air(sepCsv, priorCsv), qbo: sepQbo(true), stripe: null }, cfg, ['2030-09']);
  assert.equal(r.timing.length, 1);
  assert.equal(r.timing[0].amount, 300);
  assert.equal(r.timing[0].fromClass, 'NOLA');   // debit NOLA (reverses the earlier credit)
  assert.equal(r.timing[0].toClass, 'Cassville WI'); // credit the class the earlier entry debited
  assert.equal(lineOf(r, 'NOLA'), 0);
  assert.equal(lineOf(r, 'Cassville WI'), 500);
  assert.equal(lineOf(r, 'Ohio Homesteading'), -500);
  assert.ok(r.checks.every((c) => c.ok || /escalation/.test(c.label)));
});

test('prior file but no earlier entry: plain reclass, no timing line', () => {
  const r = C.analyze({ airbnb: air(sepCsv, priorCsv), qbo: sepQbo(false), stripe: null }, cfg, ['2030-09']);
  assert.equal(r.timing.length, 0);
  assert.equal(lineOf(r, 'NOLA'), 300);
  assert.equal(lineOf(r, 'Cassville WI'), 200);
});

test('prior file never creates reclass lines of its own', () => {
  const r = C.analyze({ airbnb: air(sepCsv, priorCsv), qbo: sepQbo(false), stripe: null }, cfg, ['2030-09']);
  assert.deepEqual(r.months, ['2030-09']);
  assert.equal(r.journal.every((j) => j.month === '2030-09'), true);
});

test('missing prior file: early deposit is an open item and the check fails', () => {
  const r = C.analyze({ airbnb: air(sepCsv), qbo: sepQbo(false), stripe: null }, cfg, ['2030-09']);
  assert.ok(r.exceptions.some((e) => e.code === 'prior-month-missing'));
  assert.equal(r.checks.find((c) => /Early-month/.test(c.label)).ok, false);
  assert.equal(r.summary.ready, false);
});

test('mergeAirbnb dedupes payouts by reference', () => {
  const m = air(priorCsv, priorCsv, sepCsv);
  assert.equal(m.payouts.length, 2);
});

// ---- plain-language problems ----
test('diagnose: files from different years give a clear error', () => {
  const a = C.parseAirbnb(csv.replaceAll('2030', '2025'), cfg);
  const d = C.diagnose({ airbnb: a, qbo: qbo(), stripe: null }, cfg);
  assert.equal(d[0].level, 'error');
  assert.match(d[0].msg, /different periods/);
});
test('diagnose: matching files raise no error', () => {
  const d = C.diagnose({ airbnb: C.parseAirbnb(csv, cfg), qbo: qbo(), stripe: null }, cfg);
  assert.equal(d.some((x) => x.level === 'error'), false);
});
test('diagnose: Airbnb file with no payouts', () => {
  const d = C.diagnose({ airbnb: C.parseAirbnb(HEAD, cfg), qbo: qbo(), stripe: null }, cfg);
  assert.match(d[0].msg, /no payouts/);
});
