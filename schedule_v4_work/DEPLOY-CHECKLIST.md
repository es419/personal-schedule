# Deployment checklist — הלו״ז שלי

## איפה עצרנו

הפרויקט המקומי כבר יכול להיות Git repository. השלב הבא הוא ליצור repository ריק ב-GitHub, לדחוף אליו את הקוד, ואז לייבא אותו ל-Vercel.

## 1. Google Cloud

ודא שבאותו Project פעילים:
- Google Sheets API
- Google Drive API

ב-Google Auth Platform / Data Access צריך scope:
- https://www.googleapis.com/auth/drive.file

אין צורך ב-Service Account ואין צורך ליצור Google Sheet ידנית.

## 2. GitHub

צור repository חדש בשם `personal-schedule`.
אל תוסיף README, .gitignore או License דרך GitHub.

בתיקיית הפרויקט ב-PowerShell:

```powershell
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/personal-schedule.git
git push -u origin main
```

אם `origin` כבר קיים:

```powershell
git remote set-url origin https://github.com/YOUR_USERNAME/personal-schedule.git
git push -u origin main
```

## 3. Vercel

- Add New -> Project
- Import את `personal-schedule`
- Framework אמור להיות מזוהה כ-Next.js
- Deploy פעם ראשונה כדי לקבל Production URL

## 4. Google OAuth — כתובת Production

אחרי שקיבלת כתובת Vercel, למשל:
`https://personal-schedule.vercel.app`

ב-OAuth Client מסוג Web application הוסף:

Authorized JavaScript origins:
- `https://personal-schedule.vercel.app`

Authorized redirect URIs:
- `https://personal-schedule.vercel.app/api/auth/callback/google`

אפשר להשאיר גם את localhost לפיתוח:
- `http://localhost:3000`
- `http://localhost:3000/api/auth/callback/google`

## 5. Environment Variables ב-Vercel

הוסף ל-Production:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=https://personal-schedule.vercel.app
NEXTAUTH_SECRET=...
ALLOWED_EMAIL=your-google-email@example.com
```

ליצירת NEXTAUTH_SECRET ב-PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

אחרי הוספת/שינוי Environment Variables בצע Redeploy.

## 6. בדיקה ראשונה

1. פתח את כתובת ה-Vercel.
2. התחבר עם Google.
3. אשר את ההרשאה שהאפליקציה מבקשת.
4. בכניסה הראשונה האפליקציה אמורה ליצור קובץ Google Sheets אחד בשם `הלו״ז שלי`.
5. הוסף אירוע עם שעת התחלה וסיום.
6. ודא שהאירוע מופיע בטאב של השבוע הנוכחי.
7. הוסף אירוע נוסף באותו שבוע — אסור שייווצר קובץ או טאב נוסף.
8. עבור לשבוע אחר והוסף אירוע — צריך להיווצר רק טאב חדש בתוך אותו קובץ.

## 7. iPhone

לאחר שהכול עובד ב-Safari:
Share -> Add to Home Screen.
האייקון כבר כלול בפרויקט והאפליקציה מוגדרת ל-standalone.
