# Billy — Setup Guide

A single-file web app (PWA) that runs on iOS, Android, Mac, Windows, and Linux, works fully offline, and syncs to a Google Sheet you own.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire app (UI + logic + local storage) |
| `manifest.json` | Lets the app install to your home screen / dock |
| `sw.js` | Service worker — makes it work offline |
| `Code.gs` | Google Apps Script backend — syncs to a Google Sheet, emails reminders, publishes the calendar feed |

## Step 1 — Set up the Google Sheet backend (~5 min, one time)

1. Go to [sheets.new](https://sheets.new) and create a blank sheet named e.g. **Bill Tracker DB**.
2. In the sheet: **Extensions → Apps Script**. Delete the boilerplate and paste in all of `Code.gs`.
3. Change the `TOKEN` line near the top to your own secret (any random string).
4. Click **Deploy → New deployment → ⚙ type: Web app**:
   - Description: anything
   - Execute as: **Me**
   - Who has access: **Anyone** (the token is what protects your data)
5. Click **Deploy**, authorize when prompted, and **copy the Web app URL** (ends in `/exec`).

> To update the script later, use **Deploy → Manage deployments → ✏ Edit → New version**, so the URL stays the same.

## Step 2 — Host the app on GitHub Pages (~5 min, one time)

1. Create a free account at [github.com](https://github.com) if needed.
2. Create a new repository, e.g. `bill-tracker` (public or private both work; Pages on private repos requires a paid plan, so use **public** — the app contains no personal data, your data lives only on your devices and in your Sheet).
3. Upload `index.html`, `manifest.json`, and `sw.js` (repo page → **Add file → Upload files**).
4. Repo **Settings → Pages → Source: Deploy from a branch → Branch: main / root → Save**.
5. After a minute your app is live at `https://<username>.github.io/bill-tracker/`.

## Step 3 — Connect and install on each device

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
- New columns are appended to the right of each tab, never inserted, so existing sheets keep working after an update — don't reorder the header row.
- The Sheet has readable tabs (**Bills / Payments / Incomes / Categories**) — you can browse, chart, or even hand-edit it. If you hand-edit, set the row's `updatedAt` to a bigger number (e.g. current ms timestamp from `=ROUND((NOW()-DATE(1970,1,1))*86400000)`) so devices accept the change.

## Using the app

- **＋ New** — add a bill: name, category, amount (leave blank for variable bills like utilities), repeat interval, next due date, autopay flag, funding source, payment website URL, notes.
- **Archive** — retired a card or closed an account? Archive the bill from its detail view instead of deleting: its full payment history stays browsable under the **Archived** filter, but it disappears from the list, calendar, balance, and badge. Unarchive any time.
- **Funded by** — if a bill gets charged to another bill you track (Netflix on your Discover card), pick that card in the bill form's **Funded by** dropdown. See [Funding sources](#funding-sources) below.
- **Custom categories** — pick "＋ New category…" in the bill form's category dropdown: name it, choose an SVG icon and a color. Custom categories sync to the Sheet (Categories tab) like everything else.
- **Pay Online** — if a bill has a URL, its detail view shows a **Pay Online** button that opens the biller's site in a new tab.
- Tap a bill for its detail view: log payments, **Mark Paid** (one tap, uses amount due or the running average), **Skip** a cycle, see highest/lowest/average payment, this year vs last year, a 13-month history chart, and the full payment log.
- **Log Payment** advances the next due date automatically (uncheck the box to log a back payment).
- Sidebar: calendar with due-date dots, bills due soon / this month / paid this month, and Monthly Balance (add income via **+ New Income**).
- **Look ahead by month** — the arrows above the calendar move the whole summary, not just the grid. Step forward and the stats and Monthly Balance re-scope to that month: what's due, what it totals, and how it sits against your expected income. Labels name the month you're looking at (`BILLS DUE IN OCTOBER`, `October 2027 Balance`) so a projected month is never mistaken for the current one, and the clock icon returns you to today. See [Looking ahead](#looking-ahead).
- **Calendar selection** — click a dotted date to highlight the bills due that day; the bottom bar shows "N bills selected. Estimated amount due: $X". Click again to clear. Works for projected future occurrences too.
- **On phones / narrow windows** the layout restacks: calendar card on top, then the bill list grouped into Overdue / Due Soon / Due Later with due date and amount on the right, then the stats and Monthly Balance card. Forms open as bottom sheets sized for touch.
- Filter dropdown: all bills, due this week, autopay only, or by category. Search box filters by name.
- **⚙︎** also has an Appearance setting (dark mode), JSON backup/restore, and CSV export.
- **Per-bill payment logs** — in a bill's detail view, **Import Log** accepts pasted text or a file with one payment per line (`MM/DD/YYYY,amount,note`); duplicates (same date + amount) are skipped automatically, `$` and thousands separators are tolerated, and notes may contain commas. **Export Log** downloads the bill's history in the same format, newest first.

## Extra features included beyond the mock-up

- Overdue highlighting (red) and due-soon (amber) status bars
- Autopay badge and autopay-only filter
- Variable-amount bills use the running average for estimates
- Month-end aware recurrence (Jan 31 → Feb 28 → Mar 31) — see [Month-end due dates](#month-end-due-dates)
- Offline queue with auto-sync on reconnect and a sync status line
- One-tap **Mark Paid**, back-dated payments, skip cycle
- CSV export and JSON backup/restore (restore merges rather than overwrites)
- Search, category filters, installable PWA on all platforms

## Email reminders (optional, no push server needed)

The sync script can email you when bills come due — it runs on Google's servers daily, so your devices can be off. Anti-spam by design: an email is sent only when at least one bill is inside your reminder window, and each bill is emailed **once per due date** (paying a bill advances its date, arming the next cycle's single reminder).

1. In the app: **⚙︎ Settings → Email reminders**, set days ahead (e.g. 3; 0 = off), Save, then Sync once to push the setting.
2. One time, in the Sheet's **Extensions → Apps Script** editor (with the latest Code.gs): select **setupReminders** in the function dropdown, click **Run**, and authorize. This creates a daily ~8am trigger.

Emails go to your own Google account address. To stop them, set days to 0 in the app (or delete the trigger under the clock icon in the Apps Script editor).

## Calendar feed (optional)

The sync script can also publish your due dates as an iCalendar feed, so bills show up in Google Calendar, Apple Calendar, or Outlook — including on devices that never open Billy. It's read-only; subscribing can't change your data.

1. Make sure the Apps Script has the latest `Code.gs` and is **re-deployed as a new version** (Deploy → Manage deployments → ✏ Edit → New version). The feed lives on the same `/exec` URL, so an older deployment simply won't answer it.
2. In the app: **⚙︎ Settings → Calendar feed**. The link builds itself from your sync URL and token as soon as both are filled in.
3. Subscribe:
   - **Apple Calendar / Outlook** — tap **Subscribe (Apple / Outlook)**, or paste the link with `https://` swapped for `webcal://`.
   - **Google Calendar** — **Copy Link**, then on the web: *Other calendars → + → From URL → paste → Add calendar*.
   - **Outlook web** — *Add calendar → Subscribe from web → paste*.

Each bill becomes an all-day event named like `Netflix — $15.49 (autopay)`, marked free rather than busy so it doesn't make you look booked. Variable bills show their running average with a `~`. The event description carries the repeat interval, funding source, notes, and a link to the biller's site, and the event's URL field opens that site straight from the calendar.

Optional parameters you can append to the link:

| Parameter | Does |
|---|---|
| `&months=24` | How far ahead to project (1–60, default 18) |
| `&alarm=2` | Adds a reminder 2 days before each due date (default: none) |
| `&cashonly=1` | Skips bills [charged to another bill you track](#funding-sources) |

Notes:

- Calendar apps re-fetch on their own schedule — Google typically every several hours to a day, Apple on the interval you pick when subscribing. Changes in Billy reach your calendar on that cadence, not instantly, and only after they've synced to the Sheet.
- The feed lists every occurrence explicitly rather than using a recurrence rule, so the dates match Billy exactly (a repeating rule can't reproduce its month-end behavior).
- Archived and deleted bills are left out.
- **The link contains your token.** Anyone who has it can read your bill names and amounts, and it may be stored on your calendar provider's servers. Treat it like a password; to revoke it, change `TOKEN` in `Code.gs` (which also means re-entering the token on each device).

## Looking ahead

The calendar's ‹ › arrows re-scope the summary beneath it. Step to a future month and you get what's due then, what it comes to, and how it compares with your expected income — useful for spotting the month a yearly premium lands on top of everything else.

- **The current month is unchanged.** "Bills due soon" (the next 7 days) only makes sense from today, so it appears on the current month and nowhere else.
- **Every label names its month** — `BILLS DUE IN OCTOBER`, `STILL DUE IN OCTOBER`, `October 2027 Balance` — so projected figures are never mistaken for today's. The clock icon jumps back to the current month.
- **Future months are projections** built from each bill's repeat interval, so they include bills whose next due date hasn't reached that month yet.
- **Past months show what you paid, not what was due.** A bill only remembers its next due date; history lives in your payment log. So looking back gives real "paid" figures and nothing under "due" — this is a forward-looking view.
- **Income is treated as the same monthly figure in every month.** Billy tracks income as a monthly amount, so a month with an unusual paycheck won't be reflected.
- The bill list itself doesn't change — only the summary follows the calendar.

> **A figure that changed:** bills now count once per time they actually bill in a month. Previously a weekly bill was counted a single time no matter what, so a $50/week bill contributed $50 to "still due this month" instead of up to $250. If you track weekly or fortnightly bills, your Monthly Balance will read lower — and more accurately — than before.

## Month-end due dates

A bill due on the 29th, 30th, or 31st keeps that day even when a month is too short for it. Each bill stores an **anchor day** — the day of the month it's meant to land on — and every advance is measured from that anchor, not from wherever the last occurrence fell:

```
Jan 31 → Feb 28 → Mar 31 → Apr 30 → May 31
```

February clamps to its last day, then March returns to the 31st. The same applies to quarterly, semi-annual, and yearly bills, including a yearly bill on Feb 29, which clamps to the 28th in ordinary years and takes the 29th again each leap year.

The anchor is set from the due date you pick in the bill form, and it's only re-set when you deliberately change that date — renaming a bill or editing its amount won't disturb it. A bill's detail view spells the behavior out whenever its anchor is past the 28th.

> **Upgrading:** earlier versions re-derived the day from the previous occurrence, so once February pulled a bill back to the 28th it stayed there — a bill due the 31st quietly walked backwards for good. Existing bills are given an anchor matching the day their next due date currently sits on. That stops the drift immediately, but it can't recover a day already lost: if one of your bills has crept backwards, set its next due date to the right day once and it will hold from then on.

## Funding sources

Bills that get charged to a credit card you also track were being counted twice in **Monthly Balance** — once as the charge, once inside the card's statement payment. Setting **Funded by** on a bill fixes that.

Pick the bill it gets charged to (e.g. Netflix → Discover Card) and one rule applies everywhere money is totalled:

> A bill is left out of the cash-flow math **if and only if** its funding source is itself a bill you track.

- **Netflix → Discover Card** — the Discover statement is already in your balance, so Netflix isn't counted again.
- **Mortgage → Bank account / direct** (the default) — money leaves your account, so it counts.
- **Something charged to a card you *don't* track** — leave it direct. It still counts, because it's then the only record of that money in the app.

Nothing is hidden. The sidebar counts still include every bill so they match the list, and the dollar figures show cash out of your account with a muted **“+ $X charged to cards”** line beside them. Monthly Balance gets a matching **CHARGED TO CARDS** footnote.

Two things come free with it:

- A card's detail view lists **Charged to this bill** — every recurring charge that posts to it. Each row shows the amount as it actually bills (`$324.95/yr`), so you can match it against a statement, and the total is a **monthly equivalent**: anything that doesn't bill monthly is spread across the year, with its monthly share shown under the row. Adding a yearly charge to monthly ones directly would produce a number that's neither. (The total covers what Billy knows about; your real statement may also include one-off spending.)
- The filter dropdown gains a **Charged to** group. When a card is reissued, pick it and you have the exact list of billers to go update.

Notes: every existing bill defaults to direct, so the feature is invisible until you use it. The picker won't offer a bill that already draws on the one you're editing, so funding can't loop. Archiving or deleting a funder puts its charges back into your balance — they have to come from somewhere once the card's statement is gone — and the app tells you how many bills that affects before you confirm.

## Dark mode

**⚙︎ Settings → Appearance**: *Match device*, *Light*, or *Dark*. The default is **Match device**, so on iOS, Android, macOS, and Windows the app follows your system setting — including switching live if your device changes at sunset, with no need to reopen Billy. Pick Light or Dark to override that.

The choice previews as soon as you change the dropdown, so you can see it before committing; **Cancel** puts back whatever was saved.

Notes:

- The setting is stored per device and is **not** synced to your Sheet, so you can run dark on your phone and light on your desktop.
- The theme is resolved before the first pixel is drawn, so opening the app in dark mode never flashes white.
- The status-bar colour follows the theme on installed iOS/Android apps.
- Category colours are yours to choose and stay recognisable in dark mode — the swatch is dimmed and the icon lightened, rather than the colour being replaced.
- One thing that can't follow the theme: the **splash colour of the installed app** comes from `manifest.json`, which is a static file with no dark variant. It stays light for the moment the app launches.

## Spending summary

The bar-chart button in the bottom bar opens a year-by-year summary: total paid, payment count, and a per-category breakdown with proportion bars. It's read-only and computed from your existing payment history — nothing else in the app changes.

## App icon badge

The installed app can show a badge with the number of bills that are overdue or due within 7 days (one combined count). Enable it in **⚙︎ Settings → Enable Badge** — on iPhone (iOS 16.4+) this prompts for notification permission once, which iOS requires for badging. The badge refreshes whenever you open or switch away from the app; on Android it also refreshes in the background every ~12 hours. Note the badge can't update in the background on iPhone without a push server, so on iOS it reflects the count as of the last time the app was opened.

## Troubleshooting

- **"Sync failed: Invalid token"** — the token in ⚙︎ must exactly match `TOKEN` in Code.gs.
- **Sync failed with no clear error** — re-deploy the Apps Script as a *new version*, confirm "Who has access: Anyone", and that you copied the `/exec` URL (not `/dev`).
- **App doesn't update after you change index.html** — the service worker serves network-first, so a normal reload gets the new version; force-quit and reopen the installed app if needed.
