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
  bills:      ["id","name","category","repeat","amountDue","nextDue","autopay","archived","url","notes","deleted","updatedAt","fundedBy"],
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
  if (!e.parameter || e.parameter.token !== TOKEN) return json({ error: "Invalid token" });
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
