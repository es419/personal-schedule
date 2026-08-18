import { google } from "googleapis";
import { telegramRequest } from "@/lib/telegram";

const SCHEDULE_APP_KEY = "personalScheduleApp";
const SCHEDULE_APP_VALUE = "v1";
const SCHEDULE_FILE_NAME = "הלו״ז שלי";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const REMINDER_SHEET_TITLE = "_תזכורות";
const SETTINGS_SHEET_TITLE = "_הגדרות";
const CLEANUP_SETTING_KEY = "lastReminderCleanupDate";
const TIME_ZONE = "Asia/Jerusalem";
const CLEANUP_AFTER_MINUTE = 5;

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

function israelClock(nowMs = Date.now()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(nowMs)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isoDateInIsrael(isoString) {
  const time = Date.parse(String(isoString || ""));
  if (!Number.isFinite(time)) return "";
  return israelClock(time).date;
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

function parseMessageLog(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        id: Number(entry?.id),
        sentAt: String(entry?.sentAt || ""),
        chatId: String(entry?.chatId || ""),
      }))
      .filter((entry) => Number.isInteger(entry.id) && entry.id > 0 && Number.isFinite(Date.parse(entry.sentAt)));
  } catch {
    return [];
  }
}

function serializeMessageLog(entries) {
  return entries.length ? JSON.stringify(entries) : "";
}

function deletionCanBeForgotten(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("message to delete not found") ||
    message.includes("message can't be deleted") ||
    message.includes("message identifier is not specified")
  );
}

async function writeSetting(sheets, spreadsheetId, settingsRows, key, value) {
  const index = settingsRows.findIndex((row) => String(row?.[0] || "") === key);
  if (index >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SETTINGS_SHEET_TITLE}'!B${index + 2}`,
      valueInputOption: "RAW",
      requestBody: { values: [[value]] },
    });
    settingsRows[index][1] = value;
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${SETTINGS_SHEET_TITLE}'!A:B`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[key, value]] },
  });
  settingsRows.push([key, value]);
}

async function cleanupOldReminderMessages({ sheets, spreadsheetId, reminderRows, settingsRows, chatId, nowMs }) {
  const clock = israelClock(nowMs);
  const minutesSinceMidnight = clock.hour * 60 + clock.minute;
  const settings = settingsToMap(settingsRows);

  if (minutesSinceMidnight < CLEANUP_AFTER_MINUTE) {
    return { ran: false, deletedMessages: 0, removedRows: 0, failed: 0, reason: "waiting_after_midnight" };
  }
  if (settings.get(CLEANUP_SETTING_KEY) === clock.date) {
    return { ran: false, deletedMessages: 0, removedRows: 0, failed: 0, reason: "already_cleaned_today" };
  }

  const updates = [];
  const clearRanges = [];
  let deletedMessages = 0;
  let removedRows = 0;
  let failed = 0;

  for (let index = 0; index < reminderRows.length; index += 1) {
    const row = reminderRows[index] || [];
    const originalLog = parseMessageLog(row?.[7]);
    const remainingLog = [];

    for (const entry of originalLog) {
      if (isoDateInIsrael(entry.sentAt) >= clock.date) {
        remainingLog.push(entry);
        continue;
      }

      try {
        await telegramRequest("deleteMessage", { chat_id: entry.chatId || chatId, message_id: entry.id });
        deletedMessages += 1;
      } catch (error) {
        if (deletionCanBeForgotten(error)) {
          deletedMessages += 1;
        } else {
          console.warn("Telegram cleanup could not delete message", entry.id, error);
          remainingLog.push(entry);
          failed += 1;
        }
      }
    }

    const eventDate = String(row?.[1] || "");
    const rowNumber = index + 2;
    const shouldRemoveExpiredRow = Boolean(eventDate && eventDate < clock.date && remainingLog.length === 0);

    if (shouldRemoveExpiredRow) {
      clearRanges.push(`'${REMINDER_SHEET_TITLE}'!A${rowNumber}:H${rowNumber}`);
      reminderRows[index] = [];
      removedRows += 1;
      continue;
    }

    const nextLog = serializeMessageLog(remainingLog);
    if (nextLog !== String(row?.[7] || "")) {
      updates.push({ range: `'${REMINDER_SHEET_TITLE}'!H${rowNumber}`, values: [[nextLog]] });
      reminderRows[index][7] = nextLog;
    }
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  if (clearRanges.length) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: clearRanges },
    });
  }

  // Only mark the day complete when all retryable deletions succeeded.
  if (failed === 0) {
    await writeSetting(sheets, spreadsheetId, settingsRows, CLEANUP_SETTING_KEY, clock.date);
  }

  return { ran: true, deletedMessages, removedRows, failed };
}

async function sendReminder(chatId, row) {
  const [, , start, title, minutesBefore] = row;
  const text = `⏰ תזכורת: ${title} בעוד ${reminderLeadLabel(minutesBefore)} בשעה ${start}`;
  const message = await telegramRequest("sendMessage", { chat_id: chatId, text });
  const messageId = Number(message?.message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("Telegram did not return a message_id");
  return messageId;
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
    ranges: [`'${REMINDER_SHEET_TITLE}'!A2:H`, `'${SETTINGS_SHEET_TITLE}'!A2:B`],
  });
  const reminderRows = data.data.valueRanges?.[0]?.values || [];
  const settingsRows = data.data.valueRanges?.[1]?.values || [];
  const settings = settingsToMap(settingsRows);
  const chatId = settings.get("telegramChatId");
  if (!chatId) return { ok: true, scanned: reminderRows.length, sent: 0, skipped: 0, reason: "telegram_not_connected" };

  const cleanup = await cleanupOldReminderMessages({
    sheets,
    spreadsheetId: file.id,
    reminderRows,
    settingsRows,
    chatId,
    nowMs,
  });

  const updates = [];
  let sent = 0;
  let skipped = 0;

  for (let index = 0; index < reminderRows.length; index += 1) {
    const row = reminderRows[index];
    const [id, date, start, title, rawMinutes, sentAt] = row || [];
    const minutesBefore = Number(rawMinutes);
    if (!id || !date || !start || !title || !Number.isFinite(minutesBefore) || minutesBefore <= 0 || sentAt) continue;

    const eventStart = zonedLocalToUtc(date, start);
    const reminderAt = eventStart - minutesBefore * 60_000;
    if (nowMs < reminderAt) continue;

    const rowNumber = index + 2;
    if (nowMs >= eventStart) {
      updates.push({ range: `'${REMINDER_SHEET_TITLE}'!F${rowNumber}`, values: [[`MISSED|${new Date(nowMs).toISOString()}`]] });
      reminderRows[index][5] = `MISSED|${new Date(nowMs).toISOString()}`;
      skipped += 1;
      continue;
    }

    const sentIso = new Date(nowMs).toISOString();
    const messageId = await sendReminder(chatId, row);
    const messageLog = parseMessageLog(row?.[7]);
    messageLog.push({ id: messageId, sentAt: sentIso, chatId: String(chatId) });
    const serializedLog = serializeMessageLog(messageLog);

    updates.push(
      { range: `'${REMINDER_SHEET_TITLE}'!F${rowNumber}`, values: [[sentIso]] },
      { range: `'${REMINDER_SHEET_TITLE}'!H${rowNumber}`, values: [[serializedLog]] }
    );
    reminderRows[index][5] = sentIso;
    reminderRows[index][7] = serializedLog;
    sent += 1;
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: file.id,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  return { ok: true, scanned: reminderRows.length, sent, skipped, cleanup };
}
