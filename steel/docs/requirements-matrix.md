# מטריצת דרישות

סטטוס: ✅ מומש ונבדק · 🟡 חלקי · ⬜ לא מומש · 🔒 תלוי החלטה

| Req | דרישה (סעיף אפיון) | מודול | בדיקה | סטטוס |
|---|---|---|---|---|
| R3.1 | מקור אמת אחד | `model/`, `geometry/generate.ts` | unit: דטרמיניזם | ✅ |
| R3.3 | זהויות יציבות | `generate.ts` (F#.COL.L) | unit: מזהה מסגרת יציב | ✅ Element ID · ⬜ Part/Assembly Mark (M5) |
| R3.4 | יחידות בשכבה אחת | `core/units.ts` | unit | ✅ |
| R3.5 | X/Y/Z, Z למעלה | `core/vec.ts`, viewport | GEO-02 | ✅ |
| R3.6 | פרמטריות + דיווח התאמות לא תקפות | `generate.ts`, `commands.ts` | unit + e2e STALE_OVERRIDE | ✅ |
| R3.7 | Undo/Redo, ולידציות, אין כפתור מת | `history.ts`, `validate.ts` | e2e עריכה | ✅ |
| R3.8 | 10,000 אלמנטים | גיאומטריה ממוזגת | ⬜ בדיקת עומס (M6) | 🟡 |
| R3.9 | Offline, JSON + סכמה + מיגרציות | `persist/`, `migrate.ts`, `sw.js` | SAVE-01 | ✅ (מיגרציה ראשונה תיבדק כשתהיה v2) |
| R4 | פרויקט, רשת צירים, מבנה | `StructurePanel`, `generate.ts` | GEO-01 | ✅ גג דו/חד־שיפועי, רכס לא מרכזי, גבהים שונים, מרווחים לא אחידים, קונזולות |
| R5.1 | מבטים, ortho/persp, Fit, 4 מבטים, חתך, בידוד | `viewport.ts` | GEO-01, VIEW | ✅ |
| R5.2 | בחירה, קדימות, בחירה מאחור, גרירה≠בחירה | `viewport.ts` | GEO-03, MOB-01 | ✅ |
| R5.3 | Move/Copy/Rotate/Mirror/Delete/Measure/Snap/Hide/Isolate | `commands.ts`, `Dialogs.tsx` | e2e | ✅ (Rotate/Mirror/Copy — בדיקת e2e חסרה, unit חסר) |
| R6 | ספריית חתכים | `profiles/` | unit | 🟡 IPE/HEA/HEB/HEM/INP/UPN/UPE/SHS/RHS/CHS/L/C/Z/PL — לא מאומת |
| R7 | מכלולים, חלקי ייצור, חיבורי המשך | `geometry/parts.ts`, `SpliceEditor` | BEAM-01 | ✅ חלוקה ומיקום · ⬜ סימון חלקים (M5) |
| R8 | מערכת פטות | `geometry/purlins.ts`, `RoofPanel` | ROOF-01…05, PURL-01…03, SPL-01/02 | ✅ |
| R8.1 | נקודות תמיכה מזוהות | `buildPurlins` | יחידה | ✅ (התומכים עצמם — M3) |
| R8.6 | תומכי L | `geometry/connections.ts` | CLEAT-01…04 | ✅ |
| R9 | חיבורים: קורה-עמוד, רכס, בסיס, פטה-קורה; עורך, תבניות, סטטוס, התנגשויות | `connections.ts`, `clash.ts`, `ConnectionEditor` | CONN-01 | ✅ · ⬜ קושרות, קורה-קורה, חיבור המשך עם גיאומטריה |
| R10 | שרטוטים | — | DRAW-01 | ⬜ M4 |
| R11 | BOM, חיתוך, מספור | סיכום משקלים בלבד | BOM-01 | 🟡 סיכום לפי חתך · ⬜ M5 |
| R12 | פרויקטים, גרסאות, שכפול, גיבוי | `persist/idb.ts` | SAVE-01 | ✅ · ⬜ נעילת מהדורה (M5) |
| R14 | הפרדה מתכנון מבני | אין מנוע חישוב; תכונות חתך מסומנות "לא מאומת" | — | ✅ |
