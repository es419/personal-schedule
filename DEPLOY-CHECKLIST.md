# Deployment checklist — הלו״ז שלי + Telegram

## Google Cloud

ודא שפעילים:
- Google Sheets API
- Google Drive API

OAuth scope של המשתמש:
- `https://www.googleapis.com/auth/drive.file`

## Vercel — משתנים קיימים

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=https://YOUR-DOMAIN.vercel.app
NEXTAUTH_SECRET=...
ALLOWED_EMAIL=...
```

## Telegram — משתנים חדשים

צור Bot דרך BotFather והוסף:

```env
TELEGRAM_BOT_TOKEN=...
CRON_SECRET=...
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
```

`CRON_SECRET` אפשר ליצור ב-PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

את `GOOGLE_SERVICE_ACCOUNT_EMAIL` ואת `GOOGLE_PRIVATE_KEY` לוקחים מקובץ ה-JSON של ה-Service Account. אין להעלות את קובץ ה-JSON ל-GitHub.

לאחר שינוי Environment Variables: Redeploy.

## חיבור Telegram בתוך האפליקציה

1. פתח את הבוט בטלגרם ושלח `/start`.
2. פתח באפליקציה את תפריט הצד.
3. תחת "תזכורות Telegram" לחץ "חבר Telegram".
4. אמורה להגיע הודעת אישור מהבוט.

בשלב הזה האפליקציה גם משתפת אוטומטית את קובץ `הלו״ז שלי` עם ה-Service Account, כדי שהבודק ברקע יוכל לקרוא ולסמן תזכורות.

## Cron חיצוני

ב-Vercel Hobby לא משתמשים ב-Vercel Cron של פעם בדקה. הגדר שירות cron חיצוני לבצע GET פעם בדקה אל:

```text
https://YOUR-DOMAIN.vercel.app/api/cron/reminders
```

והוסף Header:

```text
Authorization: Bearer YOUR_CRON_SECRET
```

תגובה תקינה תיראה בערך כך:

```json
{"ok":true,"scanned":3,"sent":0,"skipped":0}
```

## בדיקת תזכורת

1. צור אירוע לעוד 5–10 דקות.
2. הפעל תזכורת של 5 דקות לפני.
3. ודא שבכרטיס האירוע מופיעה התזכורת.
4. כשהזמן מגיע, Telegram אמור לשלוח הודעה אחת בלבד.
5. ערוך את האירוע לזמן חדש — מצב התזכורת מתאפס אוטומטית וניתן לקבל התראה חדשה.
