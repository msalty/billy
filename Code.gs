/**
 * Bill Tracker sync backend — Google Apps Script.
 *
 * Setup:
 * 1. Create a new Google Sheet (this becomes your central database).
 * 2. Extensions → Apps Script, paste this whole file, change TOKEN below.
 * 3. Deploy → New deployment → type "Web app":
 *      Execute as: Me
 *      Who has access: Anyone
 * 4. Copy the Web app URL into the app's Settings (⚙︎) along with the token.
 *
 * The sheet stays human-readable: one tab per table (Bills, Payments, Incomes, Categories).
 * You can even edit cells by hand — bump the updatedAt column (or clear it and
 * it will be treated as older) and the change will flow to your devices.
 * Merge strategy: last-write-wins per record, by updatedAt (ms since epoch).
 */

const TOKEN = "change-me-to-something-secret";

const TABLES = {
  // New columns must be appended, never inserted: readTable maps this list
  // positionally onto existing sheet rows, so inserting would shift old data.
  bills:      ["id","name","category","repeat","amountDue","nextDue","autopay","archived","url","notes","deleted","updatedAt","fundedBy","anchorDay"],
  payments:   ["id","billId","date","amount","note","deleted","updatedAt"],
  incomes:    ["id","name","amount","deleted","updatedAt"],
  categories: ["id","label","icon","color","deleted","updatedAt"]
};

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); }
  catch (err) { return json({ error: "Bad request" }); }

  if (body.token !== TOKEN) return json({ error: "Invalid token" });

  // Reminder setting syncs like data: newest explicit change wins across devices
  const props = PropertiesService.getScriptProperties();
  if (body.reminder && Number(body.reminder.updatedAt || 0) > Number(props.getProperty("reminderDaysTs") || 0)) {
    props.setProperty("reminderDays", String(Number(body.reminder.days) || 0));
    props.setProperty("reminderDaysTs", String(Number(body.reminder.updatedAt) || 0));
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const merged = {};
    for (const table in TABLES) {
      const existing = readTable(ss, table);
      const incoming = (body.data && body.data[table]) || {};
      for (const id in incoming) {
        const inc = incoming[id], cur = existing[id];
        if (!cur || Number(inc.updatedAt || 0) > Number(cur.updatedAt || 0)) existing[id] = inc;
      }
      writeTable(ss, table, existing);
      merged[table] = existing;
    }
    return json({ ok: true, data: merged,
      reminder: { days: Number(props.getProperty("reminderDays") || 0),
                  updatedAt: Number(props.getProperty("reminderDaysTs") || 0) } });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.token !== TOKEN) return json({ error: "Invalid token" });
  if (p.ics) return ical(buildIcs(p));
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = {};
  for (const table in TABLES) data[table] = readTable(ss, table);
  return json({ ok: true, data: data });
}

function readTable(ss, table) {
  const cols = TABLES[table];
  let sh = ss.getSheetByName(cap(table));
  if (!sh) { sh = ss.insertSheet(cap(table)); sh.appendRow(cols); return {}; }
  const values = sh.getDataRange().getValues();
  const out = {};
  for (let r = 1; r < values.length; r++) {
    const rec = {};
    cols.forEach(function (c, i) { rec[c] = values[r][i]; });
    if (!rec.id) continue;
    rec.id = String(rec.id);
    // A funding source is another bill's id — keep it a string even if the
    // sheet (or a hand edit) hands it back as a number.
    if (rec.fundedBy !== undefined) rec.fundedBy = rec.fundedBy ? String(rec.fundedBy) : "";
    if (rec.anchorDay !== undefined) rec.anchorDay = Number(rec.anchorDay) || 0;
    if (rec.amountDue !== undefined) rec.amountDue = Number(rec.amountDue) || 0;
    if (rec.amount !== undefined) rec.amount = Number(rec.amount) || 0;
    rec.updatedAt = Number(rec.updatedAt) || 0;
    rec.deleted = rec.deleted === true || rec.deleted === "TRUE" || rec.deleted === "true";
    if (rec.autopay !== undefined) rec.autopay = rec.autopay === true || rec.autopay === "TRUE" || rec.autopay === "true";
    if (rec.archived !== undefined) rec.archived = rec.archived === true || rec.archived === "TRUE" || rec.archived === "true";
    // Dates typed by hand in the sheet come back as Date objects — normalize.
    ["nextDue", "date"].forEach(function (k) {
      if (rec[k] instanceof Date) {
        const d = rec[k];
        rec[k] = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      } else if (rec[k] !== undefined) {
        rec[k] = rec[k] ? String(rec[k]) : null;
      }
    });
    out[rec.id] = rec;
  }
  return out;
}

function writeTable(ss, table, records) {
  const cols = TABLES[table];
  let sh = ss.getSheetByName(cap(table));
  if (!sh) sh = ss.insertSheet(cap(table));
  sh.clearContents();
  const rows = [cols];
  Object.keys(records).forEach(function (id) {
    const rec = records[id];
    rows.push(cols.map(function (c) { return rec[c] === undefined || rec[c] === null ? "" : rec[c]; }));
  });
  sh.getRange(1, 1, rows.length, cols.length).setValues(rows);
  // Keep date-ish columns as plain text so they round-trip unchanged.
  sh.getRange(1, 1, rows.length, cols.length).setNumberFormat("@");
}

/* ===================== Calendar feed =====================
 * GET .../exec?token=YOUR_TOKEN&ics=1 returns an iCalendar feed of upcoming
 * due dates. Subscribe to it from Google Calendar, Apple Calendar, or Outlook
 * and your bills show up next to everything else in your life, on devices that
 * never open Billy. Read-only — subscribing changes nothing in the Sheet.
 *
 * Optional parameters:
 *   &months=18    how far ahead to project (1-60, default 18)
 *   &alarm=2      add a reminder N days before each due date (0 = none)
 *   &cashonly=1   skip bills charged to another bill you track
 *
 * The feed lists each occurrence explicitly rather than using an RRULE. That
 * is deliberate: Billy's month-end rule walks Jan 31 -> Feb 28 -> Mar 31, and
 * RFC 5545 recurrence cannot express it (BYMONTHDAY=31 silently skips every
 * month without a 31st). Explicit dates keep the calendar identical to the app.
 */
const ICS_MONTHS = 18;
// Mirrors REPEAT_LABEL in index.html so the calendar reads like the app.
const ICS_REPEAT = {
  monthly: "Every month", weekly: "Every week", biweekly: "Every 2 weeks",
  quarterly: "Every quarter", semiannual: "Every 6 months",
  yearly: "Every year", once: "One time"
};

function buildIcs(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bills = readTable(ss, "bills");
  const payments = readTable(ss, "payments");
  const months = clampInt(params.months, 1, 60, ICS_MONTHS);
  const alarm = clampInt(params.alarm, 0, 60, 0);
  const cashOnly = params.cashonly === "1" || params.cashonly === "true";

  // Running average per bill, for the ones whose amount varies.
  const sums = {}, counts = {};
  for (const pid in payments) {
    const pay = payments[pid];
    if (pay.deleted || !pay.billId) continue;
    sums[pay.billId] = (sums[pay.billId] || 0) + Number(pay.amount || 0);
    counts[pay.billId] = (counts[pay.billId] || 0) + 1;
  }

  const horizon = new Date();
  horizon.setMonth(horizon.getMonth() + months);
  const stamp = icsStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Billy//Bill Tracker//EN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Billy — Bills", "NAME:Billy — Bills",
    "X-WR-CALDESC:Upcoming bill due dates from Billy",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"
  ];

  for (const id in bills) {
    const b = bills[id];
    if (b.deleted || b.archived || !b.nextDue) continue;
    // Same rule as the app: a bill funded by another tracked bill is a charge
    // on that bill, not a separate withdrawal.
    const funder = b.fundedBy && bills[b.fundedBy];
    const passThrough = !!(funder && !funder.deleted && !funder.archived);
    if (cashOnly && passThrough) continue;

    const exact = Number(b.amountDue || 0);
    const avg = counts[id] ? sums[id] / counts[id] : 0;
    const amount = exact || avg;
    const label = !amount ? "" : (exact ? " — " + icsMoney(amount) : " — ~" + icsMoney(amount));
    const summary = b.name + label + (b.autopay ? " (autopay)" : "");

    const desc = [];
    if (b.repeat) desc.push("Repeats: " + (ICS_REPEAT[b.repeat] || b.repeat));
    if (!exact && avg) desc.push("Amount varies — ~" + icsMoney(avg) + " average of " + counts[id] + " payments");
    if (passThrough) desc.push("Charged to: " + funder.name + " (not a separate withdrawal)");
    if (b.autopay) desc.push("Autopay is on — no action needed.");
    if (b.url) desc.push("Pay: " + b.url);
    if (b.notes) desc.push(String(b.notes));

    // Bills that predate anchorDay, or whose anchor has not synced up from a
    // device yet, fall back to the day nextDue sits on — the same value the
    // app's migration backfills, so both sides project identical dates.
    const first = parseIcsDate(b.nextDue);
    const anchor = clampDayIcs(b.anchorDay) || (first ? first.getDate() : 0);
    let d = String(b.nextDue);
    for (let i = 0; i < 500 && d; i++) {
      const dt = parseIcsDate(d);
      if (!dt) break;
      if (dt > horizon) break;
      lines.push("BEGIN:VEVENT");
      // Stable per bill+date, so refetching updates events instead of duplicating them.
      lines.push("UID:" + id + "-" + d.replace(/-/g, "") + "@billy");
      lines.push("DTSTAMP:" + stamp);
      // All-day: a bill is due on a date, not at a time. DTEND is exclusive.
      lines.push("DTSTART;VALUE=DATE:" + d.replace(/-/g, ""));
      lines.push("DTEND;VALUE=DATE:" + nextDayCompact(d));
      lines.push(fold("SUMMARY:" + icsEsc(summary)));
      if (desc.length) lines.push(fold("DESCRIPTION:" + icsEsc(desc.join("\n"))));
      if (b.url) lines.push(fold("URL:" + icsEsc(b.url)));
      lines.push("TRANSP:TRANSPARENT"); // due dates shouldn't mark you busy
      if (alarm) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY",
          fold("DESCRIPTION:" + icsEsc(summary)),
          "TRIGGER:-P" + alarm + "D", "END:VALARM");
      }
      lines.push("END:VEVENT");
      if (b.repeat === "once") break;
      d = addIntervalIcs(d, b.repeat, anchor);
    }
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// Ported from the app so the calendar and the app agree on every date,
// including the Jan 31 -> Feb 28 -> Mar 31 month-end walk. The anchor is
// computed once per bill and held fixed across the whole projection; deriving
// it from each occurrence would let February drag the date back permanently.
function addIntervalIcs(dateStr, repeat, anchorDay) {
  const d = parseIcsDate(dateStr);
  if (!d) return null;
  // Not clampInt: an absent anchor arrives as 0 or "", and clamping would
  // silently pin every such bill to the 1st instead of falling back.
  const want = clampDayIcs(anchorDay) || d.getDate();
  switch (repeat) {
    case "weekly": d.setDate(d.getDate() + 7); return icsDstr(d);
    case "biweekly": d.setDate(d.getDate() + 14); return icsDstr(d);
    case "monthly": return monthStepIcs(d, 1, want);
    case "quarterly": return monthStepIcs(d, 3, want);
    case "semiannual": return monthStepIcs(d, 6, want);
    case "yearly": return monthStepIcs(d, 12, want);
    default: return null; // once
  }
}
function monthStepIcs(d, months, wantDay) {
  const m = d.getMonth() + months;
  const y = d.getFullYear() + Math.floor(m / 12), mo = ((m % 12) + 12) % 12;
  const dim = new Date(y, mo + 1, 0).getDate();
  return icsDstr(new Date(y, mo, Math.min(wantDay, dim)));
}
function icsDstr(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
function parseIcsDate(s) {
  const p = String(s).split("-").map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}
function nextDayCompact(dateStr) {
  const d = parseIcsDate(dateStr);
  d.setDate(d.getDate() + 1);
  return "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
}
function icsStamp(d) {
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T"
    + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
}
function icsMoney(n) {
  const s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-$" : "$") + s;
}
function icsEsc(s) {
  return String(s == null ? "" : s)
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}
// RFC 5545 caps a content line at 75 octets; continuations start with a space.
// Counting octets (not characters) keeps multi-byte names from being split
// mid-character, which some clients reject.
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const c = ch.codePointAt(0);
    const n = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (bytes + n > 73) { out.push(cur); cur = " "; bytes = 1; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n");
}
function clampDayIcs(n) {
  n = Math.floor(Number(n));
  return (n >= 1 && n <= 31) ? n : 0;
}
function clampInt(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  if (!isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}
function ical(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.ICAL);
}

/* ===================== Email reminders =====================
 * One-time setup: run setupReminders() from the Apps Script editor
 * (Run > setupReminders) and authorize when prompted. That creates a
 * daily ~8am trigger. Set "days ahead" in the app's Settings (0 = off).
 *
 * Anti-spam design: an email goes out only when at least one bill is due
 * within the window, and each bill+dueDate combination is emailed exactly
 * once (tracked in Script Properties). When you pay a bill, its due date
 * advances, which naturally arms the next cycle's single reminder.
 */
function setupReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendReminders") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendReminders").timeBased().everyDays(1).atHour(8).create();
}

function sendReminders() {
  const props = PropertiesService.getScriptProperties();
  const days = Number(props.getProperty("reminderDays") || 0);
  if (!days) return; // 0 or unset = reminders off
  const bills = readTable(SpreadsheetApp.getActiveSpreadsheet(), "bills");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = [];
  for (const id in bills) {
    const b = bills[id];
    if (b.deleted || b.archived || !b.nextDue) continue;
    const p = String(b.nextDue).split("-").map(Number);
    const diff = Math.round((new Date(p[0], p[1] - 1, p[2]) - today) / 86400000);
    if (diff > days) continue; // not yet inside the window (overdue included)
    const key = "notified:" + id + ":" + b.nextDue;
    if (props.getProperty(key)) continue; // already emailed for this due date
    due.push({ b: b, diff: diff, key: key });
  }
  if (!due.length) return; // nothing new — no email
  due.sort(function (a, b) { return a.diff - b.diff; });
  const lines = due.map(function (d) {
    const when = d.diff < 0 ? "OVERDUE by " + (-d.diff) + " day" + (d.diff === -1 ? "" : "s")
      : d.diff === 0 ? "due TODAY" : "due in " + d.diff + " day" + (d.diff === 1 ? "" : "s");
    const amt = d.b.amountDue ? " — $" + Number(d.b.amountDue).toFixed(2) : "";
    return "• " + d.b.name + amt + " — " + when + " (" + d.b.nextDue + ")";
  });
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    "Billy: " + due.length + " bill" + (due.length > 1 ? "s" : "") + " due soon",
    lines.join("\n") + "\n\nOpen Billy to log or skip these payments."
  );
  due.forEach(function (d) { props.setProperty(d.key, "1"); });
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pad(n) { return (n < 10 ? "0" : "") + n; }
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
