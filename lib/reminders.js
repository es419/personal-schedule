import { google } from "googleapis";
import { telegramRequest } from "@/lib/telegram";

const SCHEDULE_APP_KEY = "personalScheduleApp";
const SCHEDULE_APP_VALUE = "v1";
const SCHEDULE_FILE_NAME = "הלו״ז שלי";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const REMINDER_SHEET_TITLE = "_תזכורות";
const SETTINGS_SHEET_TITLE = "_הגדרות";
const TIME_ZONE = "Asia/Jerusalem";

function serviceAccountClients() {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  const rawKey = String(process.env.GOOGLE_PRIVATE_KEY || "").trim();
  if (!email || !rawKey) throw new Error("Google service account is not configured");

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: rawKey.replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

async function findScheduleSpreadsheet(drive) {
  const tagged = await drive.files.list({
    q: `appProperties has { key='${SCHEDULE_APP_KEY}' and value='${SCHEDULE_APP_VALUE}' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,appProperties)",
    orderBy: "createdTime",
  });
  if (tagged.data.files?.length) return tagged.data.files[0];

  const byName = await drive.files.list({
    q: `name='${SCHEDULE_FILE_NAME}' and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,appProperties)",
    orderBy: "createdTime",
  });
  return byName.data.files?.[0] || null;
}

function settingsToMap(rows = []) {
  return new Map(rows.filter((row) => row?.[0]).map((row) => [String(row[0]), String(row?.[1] || "")]));
}

function zonedLocalToUtc(dateString, timeString, timeZone = TIME_ZONE) {
  const [year, month, day] = dateString.split("-").map(Number);
  const [hour, minute] = timeString.split(":").map(Number);
  const targetWallClock = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetWallClock;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second || 0)
    );
    const correction = targetWallClock - represented;
    guess += correction;
    if (correction === 0) break;
  }
  return guess;
}

function reminderLeadLabel(minutes) {
  const value = Number(minutes);
  if (value === 1440) return "יום";
  if (value === 2880) return "יומיים";
  if (value % 1440 === 0) return `${value / 1440} ימים`;
  if (value === 60) return "שעה";
  if (value === 120) return "שעתיים";
  if (value % 60 === 0) return `${value / 60} שעות`;
  if (value === 1) return "דקה";
  return `${value} דקות`;
}

async function sendReminder(chatId, row) {
  const [, , , title, minutesBefore] = row;
  const text = [
    `תזכורת: ${title}`,
    `בעוד ${reminderLeadLabel(minutesBefore)}`,
  ].join("\n");
  await telegramRequest("sendMessage", { chat_id: chatId, text });
}

export async function runDueReminders(nowMs = Date.now()) {
  const { sheets, drive } = serviceAccountClients();
  const file = await findScheduleSpreadsheet(drive);
  if (!file?.id) return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: "schedule_not_found" };

  const meta = await sheets.spreadsheets.get({ spreadsheetId: file.id, fields: "sheets(properties(title))" });
  const titles = new Set((meta.data.sheets || []).map((sheet) => sheet.properties?.title));
  if (!titles.has(REMINDER_SHEET_TITLE)) {
    return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: "no_reminders" };
  }
  if (!titles.has(SETTINGS_SHEET_TITLE)) {
    return { ok: true, scanned: 0, sent: 0, skipped: 0, reason: "telegram_not_connected" };
  }

  const data = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: file.id,
    ranges: [`'${REMINDER_SHEET_TITLE}'!A2:F`, `'${SETTINGS_SHEET_TITLE}'!A2:B`],
  });
  const reminderRows = data.data.valueRanges?.[0]?.values || [];
  const settings = settingsToMap(data.data.valueRanges?.[1]?.values || []);
  const chatId = settings.get("telegramChatId");
  if (!chatId) return { ok: true, scanned: reminderRows.length, sent: 0, skipped: 0, reason: "telegram_not_connected" };

  const updates = [];
  let sent = 0;
  let skipped = 0;

  for (let index = 0; index < reminderRows.length; index += 1) {
    const row = reminderRows[index];
    const [id, date, start, title, rawMinutes, sentAt] = row;
    const minutesBefore = Number(rawMinutes);
    if (!id || !date || !start || !title || !Number.isFinite(minutesBefore) || minutesBefore <= 0 || sentAt) continue;

    const eventStart = zonedLocalToUtc(date, start);
    const reminderAt = eventStart - minutesBefore * 60_000;
    if (nowMs < reminderAt) continue;

    const rowNumber = index + 2;
    if (nowMs >= eventStart) {
      updates.push({ range: `'${REMINDER_SHEET_TITLE}'!F${rowNumber}`, values: [[`MISSED|${new Date(nowMs).toISOString()}`]] });
      skipped += 1;
      continue;
    }

    await sendReminder(chatId, row);
    updates.push({ range: `'${REMINDER_SHEET_TITLE}'!F${rowNumber}`, values: [[new Date(nowMs).toISOString()]] });
    sent += 1;
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: file.id,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  return { ok: true, scanned: reminderRows.length, sent, skipped };
}
