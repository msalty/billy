# Billy Setup Guide

A single-file web app (PWA) that runs on iOS, Android, Mac, Windows, and Linux, works fully offline, and syncs to a Google Sheet you own.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app (UI + logic + local storage) |
| `manifest.json` | Lets the app install to your home screen / dock |
| `sw.js` | Service worker — makes it work offline |
| `Code.gs` | Google Apps Script backend — syncs to a Google Sheet |

## Step 1: Set up the Google Sheet backend (~5 min, one time)

1. Go to [sheets.new](https://sheets.new) and create a blank sheet named e.g. **Bill Tracker DB**.
2. In the sheet: **Extensions → Apps Script**. Delete the boilerplate and paste in all of `Code.gs`.
3. Change the `TOKEN` line near the top to your own secret (any random string).
4. Click **Deploy → New deployment → ⚙ type: Web app**:
   - Description: anything
   - Execute as: **Me**
   - Who has access: **Anyone** (the token is what protects your data)
5. Click **Deploy**, authorize when prompted, and **copy the Web app URL** (ends in `/exec`).

> To update the script later, use **Deploy → Manage deployments → ✏ Edit → New version**, so the URL stays the same.

## Step 2: Host the app on GitHub Pages (~5 min, one time)

1. Create a free account at [github.com](https://github.com) if needed.
2. Create a new repository, e.g. `bill-tracker` (public or private both work; Pages on private repos requires a paid plan, so use **public** — the app contains no personal data, your data lives only on your devices and in your Sheet).
3. Upload `index.html`, `manifest.json`, and `sw.js` (repo page → **Add file → Upload files**).
4. Repo **Settings → Pages → Source: Deploy from a branch → Branch: main / root → Save**.
5. After a minute your app is live at `https://<username>.github.io/bill-tracker/`.

## Step 3: Connect and install on each device

1. Open the URL in a browser and tap **⚙︎** (bottom right).
2. Paste the Apps Script **Web app URL** and your **token**, leave auto-sync on, Save.
3. Install it like an app:
   - **iPhone/iPad (Safari):** Share → **Add to Home Screen**
   - **Android (Chrome):** menu ⋮ → **Add to Home screen / Install app**
   - **Mac/Windows/Linux (Chrome/Edge):** install icon in the address bar
   - **Mac (Safari):** File → **Add to Dock**

That's it. Each device keeps a full local copy (works offline); changes sync to the Sheet automatically a few seconds after you make them, on launch, and when you come back online. The ↻ Sync button forces it.

## How sync works

- Every bill, payment, and income entry carries an `updatedAt` timestamp.
- Sync sends your local data to the script, which merges it with the Sheet (newest record wins) and returns the merged result.
- Deletions are tombstones (a `deleted` flag), so a delete on one device propagates instead of resurrecting.
- The Sheet has readable tabs (**Bills / Payments / Incomes / Categories**) — you can browse, chart, or even hand-edit it. If you hand-edit, set the row's `updatedAt` to a bigger number (e.g. current ms timestamp from `=ROUND((NOW()-DATE(1970,1,1))*86400000)`) so devices accept the change.

## Using the app

- **＋ New** — add a bill: name, category, amount (leave blank for variable bills like utilities), repeat interval, next due date, autopay flag, payment website URL, notes.
- **Archive** — retired a card or closed an account? Archive the bill from its detail view instead of deleting: its full payment history stays browsable under the **Archived** filter, but it disappears from the list, calendar, balance, and badge. Unarchive any time.
- **Custom categories** — pick "＋ New category…" in the bill form's category dropdown: name it, choose an SVG icon and a color. Custom categories sync to the Sheet (Categories tab) like everything else.
- **Pay Online** — if a bill has a URL, its detail view shows a **Pay Online** button that opens the biller's site in a new tab.
- Tap a bill for its detail view: log payments, **Mark Paid** (one tap, uses amount due or the running average), **Skip** a cycle, see highest/lowest/average payment, this year vs last year, a 13-month history chart, and the full payment log.
- **Log Payment** advances the next due date automatically (uncheck the box to log a back payment).
- Sidebar: calendar with due-date dots, bills due soon / this month / paid this month, and Monthly Balance (add income via **+ New Income**).
- **Calendar selection** — click a dotted date to highlight the bills due that day; the bottom bar shows "N bills selected. Estimated amount due: $X". Click again to clear. Works for projected future occurrences too.
- **On phones / narrow windows** the layout restacks: calendar card on top, then the bill list grouped into Overdue / Due Soon / Due Later with due date and amount on the right, then the stats and Monthly Balance card. Forms open as bottom sheets sized for touch.
- Filter dropdown: all bills, due this week, autopay only, or by category. Search box filters by name.
- **⚙︎** also has JSON backup/restore and CSV export.
- **Per-bill payment logs** — in a bill's detail view, **Import Log** accepts pasted text or a file with one payment per line (`MM/DD/YYYY,amount,note`); duplicates (same date + amount) are skipped automatically, `$` and thousands separators are tolerated, and notes may contain commas. **Export Log** downloads the bill's history in the same format, newest first.

## Extra features included beyond the mock-up

- Overdue highlighting (red) and due-soon (amber) status bars
- Autopay badge and autopay-only filter
- Variable-amount bills use the running average for estimates
- Month-end aware recurrence (Jan 31 → Feb 28 → Mar 31)
- Offline queue with auto-sync on reconnect and a sync status line
- One-tap **Mark Paid**, back-dated payments, skip cycle
- CSV export and JSON backup/restore (restore merges rather than overwrites)
- Search, category filters, installable PWA on all platforms

## Email reminders (optional, no push server needed)

The sync script can email you when bills come due — it runs on Google's servers daily, so your devices can be off. Anti-spam by design: an email is sent only when at least one bill is inside your reminder window, and each bill is emailed **once per due date** (paying a bill advances its date, arming the next cycle's single reminder).

1. In the app: **⚙︎ Settings → Email reminders**, set days ahead (e.g. 3; 0 = off), Save, then Sync once to push the setting.
2. One time, in the Sheet's **Extensions → Apps Script** editor (with the latest Code.gs): select **setupReminders** in the function dropdown, click **Run**, and authorize. This creates a daily ~8am trigger.

Emails go to your own Google account address. To stop them, set days to 0 in the app (or delete the trigger under the clock icon in the Apps Script editor).

## Spending summary

The bar-chart button in the bottom bar opens a year-by-year summary: total paid, payment count, and a per-category breakdown with proportion bars. It's read-only and computed from your existing payment history — nothing else in the app changes.

## App icon badge

The installed app can show a badge with the number of bills that are overdue or due within 7 days (one combined count). Enable it in **⚙︎ Settings → Enable Badge** — on iPhone (iOS 16.4+) this prompts for notification permission once, which iOS requires for badging. The badge refreshes whenever you open or switch away from the app; on Android it also refreshes in the background every ~12 hours. Note the badge can't update in the background on iPhone without a push server, so on iOS it reflects the count as of the last time the app was opened.

## Troubleshooting

- **"Sync failed: Invalid token"** — the token in ⚙︎ must exactly match `TOKEN` in Code.gs.
- **Sync failed with no clear error** — re-deploy the Apps Script as a *new version*, confirm "Who has access: Anyone", and that you copied the `/exec` URL (not `/dev`).
- **App doesn't update after you change index.html** — the service worker serves network-first, so a normal reload gets the new version; force-quit and reopen the installed app if needed.
