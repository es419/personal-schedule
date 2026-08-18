import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createEvent, listWeekEvents } from "@/lib/sheets";
import { reminderServiceConfigured } from "@/lib/telegram";

export const dynamic = "force-dynamic";

function unauthorized(message = "Unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}

function validTimeRange(start, end) {
  return /^\d{2}:\d{2}$/.test(start || "") && /^\d{2}:\d{2}$/.test(end || "") && end > start;
}

function getGoogleAccess(session) {
  if (!session?.accessToken || session.authError) return null;
  return session.accessToken;
}

function parseReminderMinutesList(value) {
  const source = Array.isArray(value) ? value : (value === null || value === undefined || value === "" ? [] : [value]);
  const parsed = source.map(Number);
  if (parsed.some((item) => !Number.isInteger(item) || item < 1 || item > 43200)) return null;
  return [...new Set(parsed)].sort((a, b) => b - a);
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  const accessToken = getGoogleAccess(session);
  if (!accessToken) return unauthorized("Google authorization expired. Sign in again.");

  const { searchParams } = new URL(request.url);
  const week = searchParams.get("week");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week || "")) {
    return Response.json({ error: "Invalid week date" }, { status: 400 });
  }

  try {
    return Response.json(await listWeekEvents(week, accessToken));
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to load schedule" }, { status: 500 });
  }
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  const accessToken = getGoogleAccess(session);
  if (!accessToken) return unauthorized("Google authorization expired. Sign in again.");

  try {
    const body = await request.json();
    if (!body.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || !validTimeRange(body.start, body.end)) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const reminderMinutesList = parseReminderMinutesList(body.reminderMinutesList ?? body.reminderMinutes);
    if (!reminderMinutesList) return Response.json({ error: "Invalid reminder" }, { status: 400 });
    if (reminderMinutesList.length && !reminderServiceConfigured()) {
      return Response.json({ error: "Reminder service is not configured" }, { status: 503 });
    }

    const event = {
      id: crypto.randomUUID(),
      title: body.title.trim(),
      date: body.date,
      start: body.start,
      end: body.end,
      category: body.category || "אישי",
      notes: body.notes?.trim() || "",
      reminderMinutesList,
      reminderMinutes: reminderMinutesList[0] || null,
    };

    await createEvent(event, accessToken);
    return Response.json({ event }, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to create event" }, { status: 500 });
  }
}
