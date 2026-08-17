const TELEGRAM_API = "https://api.telegram.org";

export function telegramConfigured() {
  return Boolean(String(process.env.TELEGRAM_BOT_TOKEN || "").trim());
}

export async function telegramRequest(method, payload = undefined) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!token) throw new Error("Telegram bot token is not configured");

  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: payload === undefined ? "GET" : "POST",
    headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    const description = data?.description || `Telegram ${method} failed`;
    throw new Error(description);
  }
  return data.result;
}

export function reminderServiceConfigured() {
  return Boolean(
    telegramConfigured() &&
    String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim() &&
    String(process.env.GOOGLE_PRIVATE_KEY || "").trim()
  );
}
