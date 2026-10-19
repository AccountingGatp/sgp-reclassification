# SOP coverage

Line-by-line map of the SOP ("Steven Garcia Property Reclassification", Dhwani, GATP Solutions, Oct 17 2026) to this tool.
Status: **Done** (automated as written), **Adapted** (automated, with a stated difference), **Manual** (left to the person, on purpose).

## Purpose
| SOP | Status | Where |
|---|---|---|
| Book payouts to the right class; one payout can bundle properties | Done | Lines classified individually; payout split by class |
| Bank deposit alone does not tell you the class | Done | Class comes from the listing only, never the account |
| Error 1: NOLA income left in Cassville because both settle into 1393 | Done | CPC payouts are split by listing; "Booked today" includes earlier WIRC entries |
| Error 2: income summed before the manager's cut | Done | Co-host lines are included in the total; check "counted net of the cut" |
| Error 3: debit and credit on separate journal numbers | Done | One journal number per entry; check "both sides share one journal number" |

## Reports to request
| # | Report | Status |
|---|---|---|
| 1 | Airbnb payout and transaction CSV | Done. Required columns are validated. Warns at ~1,000 rows and when the range stops before month-end |
| 2 | Stripe report | Adapted. The SOP names it but gives no steps. Matched to QuickBooks by amount and date; class by listing table, then keyword rules (flagged for confirmation) |
| 3 | QBO Transaction Detail by Account | Done. Rental Income section, Class column |
| 4 | QBO Profit and Loss by Class | Done for the "after" check (After posting tab). The "before" figure is taken from report 3 |
| 5 | Bank statements | Manual (see step 8) |
| 6 | Listing-to-class table | Done. Editable in Settings; a new listing can be assigned from the Exceptions tab |
| Requesting reports by the 3rd | Manual |

## Classification rules
| SOP | Status |
|---|---|
| Match listing text exactly | Adapted: case and spacing around "\|" are ignored, because the SOP's own table is inconsistent (`Glamping Cabin\| Huge Window\|Valley...`) |
| Unknown listing stops the process | Done: import file is locked until the item is answered (tick the confirmation) or the listing is added |
| Book only 2665 and 1393 | Done |
| 1393 receives Wisconsin and NOLA: split every payout | Done |
| PayPal: not booked | Done: shown as excluded |
| Empire 6673: not booked; list property bookings | Done: blocks posting and goes in the email with the suggested entry |
| Co-host lines: included in the total | Done |
| Resolution/Adjustment/Cancellation/Misc: class by listing line | Done |
| Class read from the Rental Income section | Done |

## Monthly procedure
| Step | Status |
|---|---|
| 1 Check export complete | Adapted: month marked incomplete if either export stops more than 3 days short of month-end (the 3 days is a tolerance chosen here) |
| 2 Group lines under payout | Done |
| 3 Tie each payout (±$0.02); note foreign currency | Done; foreign-currency payouts to booked accounts block, those to Empire are listed as FYI |
| 4 Classify each line | Done |
| 5 Summary of destination by class | Done (Summary tab and workpaper "Destination x class") |
| 6 Match to QuickBooks (ACH lag) | Done: amount to the cent, -3/+14 days (editable) |
| 7 Find differences; split mixed deposits | Done |
| 8 Check bank statement for deposits not in QuickBooks | Manual. Unmatched payouts are listed as "check" items |
| 9 Build journal entry; second person reviews | Entry Done; review Manual |
| 10 P&L by Class after posting | Done (After posting tab) |

## Tie-out checks
| SOP | Status |
|---|---|
| Every payout ties | Done |
| Booked by class equals total deposited | Done as two checks: every payout has a deposit and every Airbnb deposit has a payout; after the entries each class equals the correct total |
| Debits equal credits | Done |
| No gross reservation figure where a co-host cut applies | Done indirectly: payouts with a co-host line must tie net |

## Journal entry and import
| SOP | Status |
|---|---|
| One entry per month and per source class; debit the class it is wrongly in, credit the class it belongs to | Done |
| Two lines | Adapted: one debit line plus one credit line per destination class (needed when one source feeds two classes) |
| Columns in the SOP order | Done |
| Same JournalNo on both lines | Done |
| Date at month-end | Done |
| Next free number in the series, old numbers unchanged | Adapted: continues the pattern found in QuickBooks (WIRC-014 gives WIRC-015). The SOP's own example (WIRC3-001) does not match QuickBooks |
| Net of the co-host cut | Done |
| Excel workpaper beside the import | Done |
| Never edit a posted entry; post a true-up | Done: posted entries are part of "Booked today", so only the difference is posted |

## Escalation
| SOP | Status |
|---|---|
| Empire property bookings, new listing, payout that will not tie or is foreign currency | Done; these are the only items that block posting |
| One email with payout date, listing, guest, amount | Done (draft, copy button) |

## Deliberately not in the tool
- **Posting to QuickBooks.** There is no safe automatic posting; a person imports the file after a second review.
- **Reading bank statements.** They are scanned PDFs, vary by bank, and step 8 needs judgement.
- **Guessing the class of an unknown listing.** The SOP says to ask Jonathan. The tool only lets a person add it after he answers. Stripe keyword rules are the exception and are always listed for confirmation.
- **Editing or deleting QuickBooks data**, including duplicate deposits. They are reported, never changed.
- **Reclassifying income the files cannot explain** (Booking.com, deposits with no payout). These stay as booked and are listed.

## Added beyond the SOP
Stripe matching, duplicate-deposit detection, months chosen by QuickBooks deposit date, and editable settings.
