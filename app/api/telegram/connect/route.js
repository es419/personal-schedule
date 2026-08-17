import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getTelegramChatId, saveTelegramChatId } from "@/lib/sheets";
import { reminderServiceConfigured, telegramConfigured, telegramRequest } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function israelToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function accessToken(session) {
  if (!session?.accessToken || session.authError) return null;
  return session.accessToken;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const token = accessToken(session);
  if (!token) return Response.json({ error: "Google authorization expired" }, { status: 401 });

  try {
    const chatId = await getTelegramChatId(token, israelToday());
    return Response.json({
      connected: Boolean(chatId),
      botConfigured: telegramConfigured(),
      reminderServiceConfigured: reminderServiceConfigured(),
    });
  } catch (error) {
    console.error(error);
    return Response.json({ connected: false, botConfigured: telegramConfigured(), reminderServiceConfigured: reminderServiceConfigured() });
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const token = accessToken(session);
  if (!token) return Response.json({ error: "Google authorization expired" }, { status: 401 });
  if (!reminderServiceConfigured()) {
    return Response.json({ error: "שירות התזכורות עדיין לא הוגדר ב-Vercel" }, { status: 503 });
  }

  try {
    const updates = await telegramRequest("getUpdates");
    const recentCutoff = Math.floor(Date.now() / 1000) - 15 * 60;
    const privateChats = (updates || [])
      .map((update) => {
        const message = update?.message || update?.edited_message || update?.callback_query?.message;
        return { chat: message?.chat, date: Number(message?.date || 0) };
      })
      .filter((item) => item.chat?.id && item.chat?.type === "private" && item.date >= recentCutoff);
    const chat = privateChats.at(-1)?.chat;
    if (!chat) {
      return Response.json({ error: "שלח קודם /start לבוט בטלגרם ואז לחץ שוב על חיבור" }, { status: 409 });
    }

    await saveTelegramChatId(token, String(chat.id), israelToday());
    await telegramRequest("sendMessage", {
      chat_id: chat.id,
      text: "✅ הלו״ז מחובר לטלגרם. מעכשיו אשלח כאן תזכורות לאירועים שבחרת.",
    });
    return Response.json({ connected: true });
  } catch (error) {
    console.error("Telegram connect failed", error);
    return Response.json({ error: "החיבור לטלגרם נכשל" }, { status: 500 });
  }
}
