import { runDueReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request) {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const query = new URL(request.url).searchParams.get("secret") || "";
  return bearer === expected || query === expected;
}

export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runDueReminders());
  } catch (error) {
    console.error("Reminder cron failed", error);
    return Response.json({ error: "Reminder check failed" }, { status: 500 });
  }
}
