# הלו״ז שלי

אפליקציית לו״ז אישית ב-Next.js עם Google Sheets כ-backend ותזכורות Telegram.

## אחסון

- קובץ Google Sheets יחיד בשם `הלו״ז שלי` נוצר אוטומטית.
- כל שבוע נשמר בטאב נפרד, ראשון עד שבת.
- אירועים כוללים התחלה, סיום, קטגוריה והערה.
- תזכורות נשמרות בגיליון מוסתר `_תזכורות`, כך שמבנה השבוע הקיים לא משתנה.
- מזהה ה-Telegram נשמר בגיליון מוסתר `_הגדרות`.
- אירועים שעברו נשארים בהיסטוריה ומסומנים כ"הסתיים".

## תזכורות Telegram

בכל אירוע אפשר להפעיל תזכורת ולבחור 5/15/30 דקות, שעה, יום או זמן מותאם אישית.

כדי שהתזכורות יעבדו גם כשהאפליקציה סגורה:

1. צור Bot ב-Telegram דרך BotFather וקבל Bot Token.
2. הגדר ב-Vercel את `TELEGRAM_BOT_TOKEN`.
3. השתמש ב-Service Account של פרויקט Google והגדר ב-Vercel את `GOOGLE_SERVICE_ACCOUNT_EMAIL` ואת `GOOGLE_PRIVATE_KEY`.
4. צור `CRON_SECRET` אקראי ושמור גם אותו ב-Vercel.
5. אחרי ה-Deploy, שלח `/start` לבוט.
6. באפליקציה: תפריט -> תזכורות Telegram -> חבר Telegram. האפליקציה מזהה את הצ'אט ושומרת אותו בעצמה.
7. הגדר שירות cron חיצוני שיקרא פעם בדקה ל-`/api/cron/reminders` עם ה-secret.

האפליקציה משתפת אוטומטית רק את קובץ הלו״ז שלה עם ה-Service Account, כ-Writer, כדי שהבדיקה ברקע תוכל לקרוא תזכורות ולסמן אילו כבר נשלחו.

## Google Cloud

- הפעל Google Sheets API ו-Google Drive API.
- OAuth scope של המשתמש נשאר `https://www.googleapis.com/auth/drive.file`.
- אין צורך להגדיר Spreadsheet ID ידנית.

## Environment Variables

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
ALLOWED_EMAIL=
TELEGRAM_BOT_TOKEN=
CRON_SECRET=
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
```

אם ה-private key מודבק בשורה אחת, אפשר להשאיר בו `\n`; הקוד ממיר אותם לירידות שורה בזמן ריצה.
