import { google } from "googleapis";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_FIELDS = ["התחלה", "סיום", "אירוע", "קטגוריה", "הערה", "מזהה"];
const COLS_PER_DAY = DAY_FIELDS.length;
const SCHEDULE_APP_KEY = "personalScheduleApp";
const SCHEDULE_APP_VALUE = "v1";
const SCHEDULE_FILE_NAME = "הלו״ז שלי";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";
const REMINDER_SHEET_TITLE = "_תזכורות";
const SETTINGS_SHEET_TITLE = "_הגדרות";
const REMINDER_HEADERS = ["מזהה אירוע", "תאריך", "התחלה", "אירוע", "דקות לפני", "נשלח ב", "סיום", "הודעות Telegram"];
const SETTINGS_HEADERS = ["מפתח", "ערך"];

export function reminderInfrastructureConfigured() {
  return Boolean(
    String(process.env.TELEGRAM_BOT_TOKEN || "").trim() &&
    String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim() &&
    String(process.env.GOOGLE_PRIVATE_KEY || "").trim()
  );
}

function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toISODate(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + amount);
  return copy;
}

export function getWeekInfo(dateString) {
  const date = parseISODate(dateString);
  const start = addDays(date, -date.getUTCDay());
  const end = addDays(start, 6);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const startLabel = `${String(start.getUTCDate()).padStart(2, "0")}.${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  const endLabel = `${String(end.getUTCDate()).padStart(2, "0")}.${String(end.getUTCMonth() + 1).padStart(2, "0")}`;
  const title = sameYear
    ? `${startLabel}-${endLabel}.${end.getUTCFullYear()}`
    : `${startLabel}.${start.getUTCFullYear()}-${endLabel}.${end.getUTCFullYear()}`;

  return {
    title,
    start: toISODate(start),
    end: toISODate(end),
    dates: Array.from({ length: 7 }, (_, index) => toISODate(addDays(start, index))),
  };
}

function getGoogleClients(accessToken) {
  if (!accessToken) throw new Error("Missing Google user access token");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth }),
  };
}

async function ensureServiceAccountAccess(drive, spreadsheetId) {
  const email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
  if (!email) throw new Error("Google service account email is not configured");

  const permissions = await drive.permissions.list({
    fileId: spreadsheetId,
    fields: "permissions(id,emailAddress,type,role)",
  });
  const existing = (permissions.data.permissions || []).find(
    (permission) => permission.type === "user" && permission.emailAddress?.toLowerCase() === email.toLowerCase()
  );

  if (!existing) {
    await drive.permissions.create({
      fileId: spreadsheetId,
      sendNotificationEmail: false,
      requestBody: { type: "user", role: "writer", emailAddress: email },
      fields: "id",
    });
    return;
  }

  if (existing.role !== "writer" && existing.role !== "owner") {
    await drive.permissions.update({
      fileId: spreadsheetId,
      permissionId: existing.id,
      requestBody: { role: "writer" },
      fields: "id,role",
    });
  }
}

async function sheetProperties(sheets, spreadsheetId) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title,hidden))" });
  return meta.data.sheets?.map((sheet) => sheet.properties).filter(Boolean) || [];
}

async function ensureHiddenSheet(sheets, spreadsheetId, title, headers) {
  let properties = (await sheetProperties(sheets, spreadsheetId)).find((sheet) => sheet.title === title);
  if (!properties) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title, hidden: true, rightToLeft: true } } }] },
    });
    properties = created.data.replies?.[0]?.addSheet?.properties;
    if (!properties?.sheetId && properties?.sheetId !== 0) throw new Error(`Failed to create ${title}`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1:${columnName(headers.length - 1)}1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
  return properties;
}

async function readReminderRows(sheets, spreadsheetId) {
  const properties = await sheetProperties(sheets, spreadsheetId);
  if (!properties.some((sheet) => sheet.title === REMINDER_SHEET_TITLE)) return [];
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${REMINDER_SHEET_TITLE}'!A2:H`,
  });
  return response.data.values || [];
}

function normalizeEventReminderMinutes(event) {
  const source = Array.isArray(event.reminderMinutesList)
    ? event.reminderMinutesList
    : (event.reminderMinutes ? [event.reminderMinutes] : []);
  return [...new Set(source.map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= 43200))]
    .sort((a, b) => b - a);
}

async function upsertReminders(event, sheets, drive, spreadsheetId) {
  const desired = normalizeEventReminderMinutes(event);
  const rows = await readReminderRows(sheets, spreadsheetId);
  const existingIndices = rows.map((row, index) => row?.[0] === event.id ? index : -1).filter((index) => index !== -1);

  if (!desired.length) {
    if (existingIndices.length) {
      await sheets.spreadsheets.values.batchClear({
        spreadsheetId,
        requestBody: { ranges: existingIndices.map((index) => `'${REMINDER_SHEET_TITLE}'!A${index + 2}:G${index + 2}`) },
      });
    }
    return;
  }

  await ensureServiceAccountAccess(drive, spreadsheetId);
  await ensureHiddenSheet(sheets, spreadsheetId, REMINDER_SHEET_TITLE, REMINDER_HEADERS);

  const used = new Set();
  let appendIndex = rows.length;
  const updates = [];

  for (const minutesBefore of desired) {
    let targetIndex = existingIndices.find((index) => !used.has(index) && Number(rows[index]?.[4]) === minutesBefore);
    if (targetIndex === undefined) targetIndex = existingIndices.find((index) => !used.has(index));
    if (targetIndex === undefined) {
      targetIndex = rows.findIndex((row, index) => !used.has(index) && (!row || row.length === 0 || row.every((cell) => !cell)));
    }
    if (targetIndex === -1 || targetIndex === undefined) targetIndex = appendIndex++;
    used.add(targetIndex);

    const existing = rows[targetIndex];
    const unchangedSchedule = existing && existing?.[0] === event.id && existing?.[1] === event.date && existing?.[2] === event.start && Number(existing?.[4]) === minutesBefore;
    const sentAt = unchangedSchedule ? existing?.[5] || "" : "";
    const rowNumber = targetIndex + 2;
    updates.push({
      range: `'${REMINDER_SHEET_TITLE}'!A${rowNumber}:G${rowNumber}`,
      values: [[event.id, event.date, event.start, event.title, minutesBefore, sentAt, event.end || ""]],
    });
  }

  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }

  const unusedExisting = existingIndices.filter((index) => !used.has(index));
  if (unusedExisting.length) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: unusedExisting.map((index) => `'${REMINDER_SHEET_TITLE}'!A${index + 2}:G${index + 2}`) },
    });
  }
}

async function removeReminders(id, sheets, spreadsheetId) {
  const rows = await readReminderRows(sheets, spreadsheetId);
  const indices = rows.map((row, index) => row?.[0] === id ? index : -1).filter((index) => index !== -1);
  if (!indices.length) return;
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId,
    requestBody: { ranges: indices.map((index) => `'${REMINDER_SHEET_TITLE}'!A${index + 2}:G${index + 2}`) },
  });
}

function reminderMapFromRows(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = row?.[0];
    const minutesBefore = Number(row?.[4]);
    if (!id || !Number.isFinite(minutesBefore) || minutesBefore <= 0) continue;
    if (!map.has(id)) map.set(id, { reminderMinutesList: [], reminderSentAt: [] });
    const reminder = map.get(id);
    if (!reminder.reminderMinutesList.includes(minutesBefore)) reminder.reminderMinutesList.push(minutesBefore);
    reminder.reminderSentAt.push(row?.[5] || "");
  }
  for (const reminder of map.values()) reminder.reminderMinutesList.sort((a, b) => b - a);
  return map;
}

function columnName(index) {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function dayRange(dayIndex, startRow = 3, endRow = "") {
  const startColumn = dayIndex * COLS_PER_DAY;
  const endColumn = startColumn + COLS_PER_DAY - 1;
  return `${columnName(startColumn)}${startRow}:${columnName(endColumn)}${endRow}`;
}

async function initializeWeekSheet(sheets, spreadsheetId, sheetId, title) {
  const headerRow1 = [];
  const headerRow2 = [];
  DAY_NAMES.forEach((day) => {
    headerRow1.push(day, ...Array(COLS_PER_DAY - 1).fill(""));
    headerRow2.push(...DAY_FIELDS);
  });

  const totalColumns = DAY_NAMES.length * COLS_PER_DAY;
  const lastColumn = columnName(totalColumns - 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1:${lastColumn}2`,
    valueInputOption: "RAW",
    requestBody: { values: [headerRow1, headerRow2] },
  });

  const requests = [];
  DAY_NAMES.forEach((_, dayIndex) => {
    const startColumnIndex = dayIndex * COLS_PER_DAY;
    requests.push({
      mergeCells: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex,
          endColumnIndex: startColumnIndex + COLS_PER_DAY,
        },
        mergeType: "MERGE_ALL",
      },
    });
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: startColumnIndex + 5,
          endIndex: startColumnIndex + 6,
        },
        properties: { hiddenByUser: true },
        fields: "hiddenByUser",
      },
    });
  });

  requests.push(
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 2 } },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: totalColumns },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.12, green: 0.16, blue: 0.24 },
            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 12 },
            horizontalAlignment: "CENTER",
            verticalAlignment: "MIDDLE",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: totalColumns },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.9, green: 0.92, blue: 0.96 },
            textFormat: { bold: true },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 2, startColumnIndex: 0, endColumnIndex: totalColumns },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(wrapStrategy,verticalAlignment)",
      },
    }
  );

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function findScheduleSpreadsheet(drive) {
  const tagged = await drive.files.list({
    q: `appProperties has { key='${SCHEDULE_APP_KEY}' and value='${SCHEDULE_APP_VALUE}' } and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,createdTime,modifiedTime,appProperties)",
    orderBy: "createdTime",
  });

  if (tagged.data.files?.length) return tagged.data.files[0];

  // Recovery path: if spreadsheet creation succeeded but tagging was interrupted,
  // drive.file can still see files this app created. Re-tag the canonical named file.
  const byName = await drive.files.list({
    q: `name='${SCHEDULE_FILE_NAME}' and mimeType='${SPREADSHEET_MIME}' and trashed=false`,
    spaces: "drive",
    pageSize: 10,
    fields: "files(id,name,createdTime,modifiedTime,appProperties)",
    orderBy: "createdTime",
  });

  if (byName.data.files?.length === 1) {
    const file = byName.data.files[0];
    await drive.files.update({
      fileId: file.id,
      requestBody: { appProperties: { [SCHEDULE_APP_KEY]: SCHEDULE_APP_VALUE } },
    });
    return file;
  }

  return null;
}

async function ensureScheduleSpreadsheet(accessToken, dateString) {
  const { sheets, drive } = getGoogleClients(accessToken);
  const existing = await findScheduleSpreadsheet(drive);
  if (existing?.id) return { sheets, drive, spreadsheetId: existing.id };

  const week = getWeekInfo(dateString);
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: SCHEDULE_FILE_NAME,
        timeZone: "Asia/Jerusalem",
      },
      sheets: [
        {
          properties: {
            title: week.title,
            rightToLeft: true,
          },
        },
      ],
    },
    fields: "spreadsheetId,sheets(properties(sheetId,title))",
  });

  const spreadsheetId = created.data.spreadsheetId;
  const sheetProperties = created.data.sheets?.[0]?.properties;
  if (!spreadsheetId || (!sheetProperties?.sheetId && sheetProperties?.sheetId !== 0)) {
    throw new Error("Failed to create schedule spreadsheet");
  }

  await drive.files.update({
    fileId: spreadsheetId,
    requestBody: {
      appProperties: { [SCHEDULE_APP_KEY]: SCHEDULE_APP_VALUE },
    },
  });

  await initializeWeekSheet(sheets, spreadsheetId, sheetProperties.sheetId, week.title);
  return { sheets, drive, spreadsheetId };
}

export async function ensureWeekSheet(dateString, accessToken) {
  const { sheets, drive, spreadsheetId } = await ensureScheduleSpreadsheet(accessToken, dateString);
  const week = getWeekInfo(dateString);
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets(properties(sheetId,title))" });
  let existing = meta.data.sheets?.find((sheet) => sheet.properties?.title === week.title);

  if (!existing) {
    const created = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: week.title, rightToLeft: true } } }] },
    });
    const sheetProperties = created.data.replies?.[0]?.addSheet?.properties;
    if (!sheetProperties?.sheetId && sheetProperties?.sheetId !== 0) {
      throw new Error("Failed to create weekly sheet");
    }
    existing = { properties: sheetProperties };
    await initializeWeekSheet(sheets, spreadsheetId, sheetProperties.sheetId, week.title);
  }

  const properties = meta.data.sheets?.map((sheet) => sheet.properties).filter(Boolean) || [];
  if (!properties.some((sheet) => sheet.title === existing.properties.title)) properties.push(existing.properties);
  return { sheets, drive, spreadsheetId, week, sheetId: existing.properties.sheetId, sheetProperties: properties };
}

function rowToEvent(row, date, reminderMap) {
  const reminder = reminderMap.get(row?.[5] || "");
  return {
    start: row?.[0] || "",
    end: row?.[1] || "",
    title: row?.[2] || "",
    category: row?.[3] || "אישי",
    notes: row?.[4] || "",
    id: row?.[5] || "",
    date,
    reminderMinutesList: reminder?.reminderMinutesList || [],
    reminderMinutes: reminder?.reminderMinutesList?.[0] || null,
    reminderSentAt: reminder?.reminderSentAt || [],
  };
}

export async function listWeekEvents(dateString, accessToken) {
  const { sheets, spreadsheetId, week, sheetProperties: properties } = await ensureWeekSheet(dateString, accessToken);
  const ranges = DAY_NAMES.map((_, dayIndex) => `'${week.title}'!${dayRange(dayIndex)}`);
  const hasReminderSheet = properties.some((sheet) => sheet.title === REMINDER_SHEET_TITLE);
  if (hasReminderSheet) ranges.push(`'${REMINDER_SHEET_TITLE}'!A2:F`);
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const valueRanges = response.data.valueRanges || [];
  const reminderRows = hasReminderSheet ? valueRanges[DAY_NAMES.length]?.values || [] : [];
  const reminderMap = reminderMapFromRows(reminderRows);
  const events = [];

  valueRanges.slice(0, DAY_NAMES.length).forEach((valueRange, dayIndex) => {
    for (const row of valueRange.values || []) {
      const event = rowToEvent(row, week.dates[dayIndex], reminderMap);
      if (event.id && event.title) events.push(event);
    }
  });

  events.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  return { week, events, spreadsheetId };
}

async function findEventSlot(dateString, id, accessToken) {
  const { sheets, drive, spreadsheetId, week } = await ensureWeekSheet(dateString, accessToken);
  const dayIndex = parseISODate(dateString).getUTCDay();
  const range = `'${week.title}'!${dayRange(dayIndex)}`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = response.data.values || [];
  const index = rows.findIndex((row) => row?.[5] === id);
  if (index === -1) return null;
  return { sheets, drive, spreadsheetId, week, dayIndex, rowNumber: index + 3 };
}

export async function createEvent(event, accessToken) {
  const { sheets, drive, spreadsheetId, week } = await ensureWeekSheet(event.date, accessToken);
  if (normalizeEventReminderMinutes(event).length) {
    await ensureServiceAccountAccess(drive, spreadsheetId);
    await ensureHiddenSheet(sheets, spreadsheetId, REMINDER_SHEET_TITLE, REMINDER_HEADERS);
  }

  const dayIndex = parseISODate(event.date).getUTCDay();
  const range = `'${week.title}'!${dayRange(dayIndex)}`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = response.data.values || [];
  let rowIndex = rows.findIndex((row) => !row?.[5] && !row?.[2]);
  if (rowIndex === -1) rowIndex = rows.length;
  const rowNumber = rowIndex + 3;
  const startColumn = columnName(dayIndex * COLS_PER_DAY);
  const endColumn = columnName(dayIndex * COLS_PER_DAY + COLS_PER_DAY - 1);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${week.title}'!${startColumn}${rowNumber}:${endColumn}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[event.start, event.end, event.title, event.category, event.notes || "", event.id]],
    },
  });
  await upsertReminders(event, sheets, drive, spreadsheetId);
  return event;
}

export async function updateEvent(id, previousDate, event, accessToken) {
  if (previousDate !== event.date) {
    const removed = await deleteEvent(id, previousDate, accessToken);
    if (!removed) return null;
    return createEvent(event, accessToken);
  }

  const found = await findEventSlot(previousDate, id, accessToken);
  if (!found) return null;
  const drive = found.drive;
  if (normalizeEventReminderMinutes(event).length) {
    await ensureServiceAccountAccess(drive, found.spreadsheetId);
    await ensureHiddenSheet(found.sheets, found.spreadsheetId, REMINDER_SHEET_TITLE, REMINDER_HEADERS);
  }
  const startColumn = columnName(found.dayIndex * COLS_PER_DAY);
  const endColumn = columnName(found.dayIndex * COLS_PER_DAY + COLS_PER_DAY - 1);

  await found.sheets.spreadsheets.values.update({
    spreadsheetId: found.spreadsheetId,
    range: `'${found.week.title}'!${startColumn}${found.rowNumber}:${endColumn}${found.rowNumber}`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[event.start, event.end, event.title, event.category, event.notes || "", id]],
    },
  });
  await upsertReminders(event, found.sheets, drive, found.spreadsheetId);
  return event;
}

export async function deleteEvent(id, dateString, accessToken) {
  const found = await findEventSlot(dateString, id, accessToken);
  if (!found) return false;
  await removeReminders(id, found.sheets, found.spreadsheetId);
  const startColumn = columnName(found.dayIndex * COLS_PER_DAY);
  const endColumn = columnName(found.dayIndex * COLS_PER_DAY + COLS_PER_DAY - 1);
  await found.sheets.spreadsheets.values.clear({
    spreadsheetId: found.spreadsheetId,
    range: `'${found.week.title}'!${startColumn}${found.rowNumber}:${endColumn}${found.rowNumber}`,
  });
  return true;
}

export async function getTelegramChatId(accessToken, dateString) {
  const { sheets, spreadsheetId } = await ensureScheduleSpreadsheet(accessToken, dateString);
  const properties = await sheetProperties(sheets, spreadsheetId);
  if (!properties.some((sheet) => sheet.title === SETTINGS_SHEET_TITLE)) return "";
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SETTINGS_SHEET_TITLE}'!A2:B`,
  });
  const row = (response.data.values || []).find((item) => item?.[0] === "telegramChatId");
  return String(row?.[1] || "");
}

export async function saveTelegramChatId(accessToken, chatId, dateString) {
  const { sheets, drive, spreadsheetId } = await ensureScheduleSpreadsheet(accessToken, dateString);
  await ensureServiceAccountAccess(drive, spreadsheetId);
  await ensureHiddenSheet(sheets, spreadsheetId, SETTINGS_SHEET_TITLE, SETTINGS_HEADERS);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SETTINGS_SHEET_TITLE}'!A2:B`,
  });
  const rows = response.data.values || [];
  const index = rows.findIndex((row) => row?.[0] === "telegramChatId");
  const rowNumber = index === -1 ? rows.length + 2 : index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SETTINGS_SHEET_TITLE}'!A${rowNumber}:B${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [["telegramChatId", String(chatId)]] },
  });
  return String(chatId);
}
