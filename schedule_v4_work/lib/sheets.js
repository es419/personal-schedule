import { google } from "googleapis";

const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const DAY_FIELDS = ["התחלה", "סיום", "אירוע", "קטגוריה", "הערה", "מזהה"];
const COLS_PER_DAY = DAY_FIELDS.length;
const SCHEDULE_APP_KEY = "personalScheduleApp";
const SCHEDULE_APP_VALUE = "v1";
const SCHEDULE_FILE_NAME = "הלו״ז שלי";
const SPREADSHEET_MIME = "application/vnd.google-apps.spreadsheet";

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
        locale: "he_IL",
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
  const { sheets, spreadsheetId } = await ensureScheduleSpreadsheet(accessToken, dateString);
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

  return { sheets, spreadsheetId, week, sheetId: existing.properties.sheetId };
}

function rowToEvent(row, date) {
  return {
    start: row?.[0] || "",
    end: row?.[1] || "",
    title: row?.[2] || "",
    category: row?.[3] || "אישי",
    notes: row?.[4] || "",
    id: row?.[5] || "",
    date,
  };
}

export async function listWeekEvents(dateString, accessToken) {
  const { sheets, spreadsheetId, week } = await ensureWeekSheet(dateString, accessToken);
  const ranges = DAY_NAMES.map((_, dayIndex) => `'${week.title}'!${dayRange(dayIndex)}`);
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
  const events = [];

  (response.data.valueRanges || []).forEach((valueRange, dayIndex) => {
    for (const row of valueRange.values || []) {
      const event = rowToEvent(row, week.dates[dayIndex]);
      if (event.id && event.title) events.push(event);
    }
  });

  events.sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
  return { week, events, spreadsheetId };
}

async function findEventSlot(dateString, id, accessToken) {
  const { sheets, spreadsheetId, week } = await ensureWeekSheet(dateString, accessToken);
  const dayIndex = parseISODate(dateString).getUTCDay();
  const range = `'${week.title}'!${dayRange(dayIndex)}`;
  const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = response.data.values || [];
  const index = rows.findIndex((row) => row?.[5] === id);
  if (index === -1) return null;
  return { sheets, spreadsheetId, week, dayIndex, rowNumber: index + 3 };
}

export async function createEvent(event, accessToken) {
  const { sheets, spreadsheetId, week } = await ensureWeekSheet(event.date, accessToken);
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
  return event;
}

export async function deleteEvent(id, dateString, accessToken) {
  const found = await findEventSlot(dateString, id, accessToken);
  if (!found) return false;
  const startColumn = columnName(found.dayIndex * COLS_PER_DAY);
  const endColumn = columnName(found.dayIndex * COLS_PER_DAY + COLS_PER_DAY - 1);
  await found.sheets.spreadsheets.values.clear({
    spreadsheetId: found.spreadsheetId,
    range: `'${found.week.title}'!${startColumn}${found.rowNumber}:${endColumn}${found.rowNumber}`,
  });
  return true;
}
