import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteEvent, updateEvent } from "@/lib/sheets";
import { reminderServiceConfigured } from "@/lib/telegram";

function unauthorized(message = "Unauthorized") {
  return Response.json({ error: message }, { status: 401 });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
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

export async function PATCH(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  const accessToken = getGoogleAccess(session);
  if (!accessToken) return unauthorized("Google authorization expired. Sign in again.");

  try {
    const { id } = await params;
    const body = await request.json();
    if (!id || !validDate(body.previousDate) || !validDate(body.date) || !body.title?.trim() || !validTimeRange(body.start, body.end)) {
      return Response.json({ error: "Invalid event" }, { status: 400 });
    }

    const reminderMinutes = parseReminderMinutes(body.reminderMinutes);
    if (Number.isNaN(reminderMinutes)) return Response.json({ error: "Invalid reminder" }, { status: 400 });
    if (reminderMinutes && !reminderServiceConfigured()) {
      return Response.json({ error: "Reminder service is not configured" }, { status: 503 });
    }

    const event = {
      id,
      title: body.title.trim(),
      date: body.date,
      start: body.start,
      end: body.end,
      category: body.category || "אישי",
      notes: body.notes?.trim() || "",
      reminderMinutes,
    };

    const updated = await updateEvent(id, body.previousDate, event, accessToken);
    if (!updated) return Response.json({ error: "Event not found" }, { status: 404 });
    return Response.json({ event: updated });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session) return unauthorized();
  const accessToken = getGoogleAccess(session);
  if (!accessToken) return unauthorized("Google authorization expired. Sign in again.");

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    if (!id || !validDate(date)) return Response.json({ error: "Invalid event" }, { status: 400 });
    const removed = await deleteEvent(id, date, accessToken);
    if (!removed) return Response.json({ error: "Event not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Failed to delete event" }, { status: 500 });
  }
}
