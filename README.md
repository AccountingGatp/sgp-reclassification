# Property reclass tool

Browser-only tool that applies the monthly Airbnb property reclassification SOP. Upload the month's exports and it gives you:

- the QuickBooks journal import file (`*JournalNo,*JournalDate,*AccountName,Debits,Credits,Description,Name,Class`)
- an Excel workpaper (summary, entries, exceptions, checks, every payout and line)
- a draft of the single escalation email for Jonathan and Jennifer

Files are read and processed in the browser tab. Nothing is uploaded, and there is no server or build step.

## Use it each month

1. Open the site and drop in: the Airbnb transaction CSV, the QuickBooks **Transaction Detail by Account** export (with the *Rental Income* section and **Class** shown), and the Stripe report if there is one. Other reports (P&L, GL) are ignored.
2. Tick the months to reclass. Months are taken from the QuickBooks deposit date; a month is flagged *incomplete* if either export stops before month-end.
3. Read the **Exceptions** tab, ask about escalation items, then download the import and workpaper. Have a second person review before posting.

Nothing is month-specific: months, payouts, deposits and the next journal number (the highest `WIRC-nnn` already in QuickBooks plus one) all come from the uploaded files.

## What it does (SOP steps)

- Groups each Airbnb payout with its lines and checks it ties (±$0.02). Foreign-currency payouts are flagged.
- Classifies every line by **listing name**, never by bank account. Only 2665 and 1393 are booked; PayPal and Empire 6673 are excluded. Property bookings paid to Empire are listed for Jonathan.
- Matches each payout and Stripe payout to a QuickBooks deposit by amount and date (ACH lag allowed).
- Compares the correct class totals to what QuickBooks holds now, including reclass entries already posted, and builds one entry per month and per source class. Debit lowers a class, credit raises it. Old entries are never edited.
- Runs the SOP tie-out checks and lists duplicates, new listings, unmatched deposits and coverage problems.

## Settings

The class table, payout destinations, Stripe keyword rules, journal prefix, tolerance and deposit window are editable under *Rules and settings*. They are saved in your browser and can be exported/imported as JSON. A new listing found in a run can be assigned to a class straight from the Exceptions tab.

## Develop

```
npm install
npm test        # unit tests on synthetic data
npm run dev     # serve on http://localhost:5173
```

Layout: `src/core.js` (all SOP logic, no DOM), `src/config.js` (default rules), `src/app.js` (UI), `vendor/xlsx.full.min.js` (SheetJS 0.18.5, run `npm run vendor` to refresh).

## Deploy

**Vercel:** import the repo, framework preset *Other*, no build command, output directory `.` (root). `vercel.json` adds security headers, including a CSP that blocks all network requests from the page.

**GitHub Pages:** push to `main`, set Settings > Pages > Source to *GitHub Actions*; `.github/workflows/pages.yml` publishes the site.

## Notes

- Stripe exports saved through Excel can have day and month swapped on ambiguous dates. The tool tries both readings and keeps the one that matches QuickBooks.
- Bank statements are not read; step 8 of the SOP (checking deposits missing from QuickBooks against the statement) remains manual.
- Never commit real exports: `.gitignore` excludes csv/xlsx files.
