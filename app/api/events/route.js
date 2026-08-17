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

function parseReminderMinutes(value) {
  if (value === null || value === undefined || value === "" || Number(value) <= 0) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 43200) return NaN;
  return parsed;
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

    const reminderMinutes = parseReminderMinutes(body.reminderMinutes);
    if (Number.isNaN(reminderMinutes)) return Response.json({ error: "Invalid reminder" }, { status: 400 });
    if (reminderMinutes && !reminderServiceConfigured()) {
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
      reminderMinutes,
    };

    await createEvent(event, accessToken);
    return Response.json({ event }, { status: 201 });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to create event" }, { status: 500 });
  }
}
