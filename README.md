# הלו״ז שלי

אפליקציית לו״ז אישית ב-Next.js עם Google Sheets כ-backend.

## איך האחסון עובד

- האפליקציה משתמשת ב-Google OAuth של המשתמש עם scope מצומצם `drive.file`.
- בכניסה הראשונה היא מחפשת ב-Google Drive קובץ שהיא עצמה יצרה ומסומן כקובץ האפליקציה.
- אם הקובץ לא קיים, היא יוצרת פעם אחת קובץ Google Sheets בשם `הלו״ז שלי`.
- הקובץ מסומן ב-Drive באמצעות `appProperties`, ולכן האפליקציה תמצא אותו גם אם המשתמש ישנה לו את השם.
- בכל שבוע נוצר טאב חדש בתוך אותו קובץ, למשל `16.08-22.08.2026`.
- אם הטאב של השבוע כבר קיים, כל אירוע חדש נשמר בו ולא נוצר טאב כפול.
- בכל טאב יש שבעה אזורים: ראשון עד שבת.
- לכל יום נשמרים שעת התחלה, שעת סיום, שם אירוע, קטגוריה והערה.
- עמודת מזהה פנימית מוסתרת ומשמשת לעריכה ומחיקה.

## Google Cloud

1. הפעל בפרויקט את **Google Sheets API** ואת **Google Drive API**.
2. הגדר Google Auth Platform / OAuth consent screen.
3. ב-Data Access הוסף את scope:
   `https://www.googleapis.com/auth/drive.file`
4. צור OAuth Client מסוג **Web application**.
5. לפיתוח מקומי הוסף Redirect URI:
   `http://localhost:3000/api/auth/callback/google`
6. לפרודקשן הוסף את כתובת Vercel:
   `https://YOUR-DOMAIN.vercel.app/api/auth/callback/google`
7. אם האפליקציה במצב Testing, הוסף את חשבון Google שלך כ-Test user.

> אין צורך ב-Service Account ואין צורך ליצור Google Sheet ידנית או להגדיר Spreadsheet ID.

## משתני סביבה

העתק את `.env.example` ל-`.env.local` והשלם:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=
ALLOWED_EMAIL=
```

ליצירת secret:

```bash
openssl rand -base64 32
```

## הרצה

```bash
npm install
npm run dev
```

## Vercel

ב-Vercel הוסף את אותם משתני הסביבה, כאשר `NEXTAUTH_URL` הוא דומיין ה-Production המדויק.
לאחר שינוי Environment Variables יש לבצע Redeploy.
