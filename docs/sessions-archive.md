# מיפוי שיחות פיתוח — construction-app

עודכן: 27.11.2026. מקור: מטא-דאטה של סשנים ומצב ענפים ב-git (לא תמלילים מלאים).

## מצב הענפים מול main

| ענף | commits מעל main | מה יש בו | מוזג? |
|---|---|---|---|
| `claude/gantt-chart-app-kPR38` | 65 | `gantt.html` — אפליקציית גאנט, תיקון תקיעה (מגבלות ו-guards) | לא |
| `claude/quantity-calculator-app-ad34b` | 7 | `quantity-calculator/` — מחשבון כמויות (35 קבצים) | לא |
| `claude/kayan-execution-accounts-gyx9hw` | 14 | מערכת חשבונות ביצוע (קובץ יחיד). גיליונות החישוב שולבו ב-boq (`09b2931`) | חלקית |
| `claude/great-allen-ebjp5f` | 2 | כלל עברית ב-CLAUDE.md וסקיל | לא (ה-PRs 24–34 כן) |
| `claude/mazil-quotes-app` | 0 | אפליקציית הצעות מחיר | כן |
| `claude/brave-wozniak-4wyvus`, `busy-brown-hc7u02`, `trusting-rubin-y4cxjv` | 156 / 135 / 201 | KAYAN STEEL PRO (`steel/`) | לא |

## החלטה

- אין למחוק ענפים של גאנט, מחשבון כמויות וסטיל לפני מיזוג או גיבוי — הקוד קיים רק שם.
- סשן הצעות המחיר ו-"SKN file format" — אין בהם קוד ייחודי.
- סשן boq (`great-allen`) הוא הגרסה העדכנית לכתבי כמויות וחשבונות.

## עדכון 27.11.2026

- מחשבון הכמויות (חתכי חפירה/מילוי) מוזג ל-main דרך PR מהענף `claude/quantity-calculator-app-ad34b`.
- הגאנט: ההיסטוריה של הענף `claude/gantt-chart-app-kPR38` לא קשורה ל-main (אין merge base), ומיזוג ישיר היה דורס את `index.html` ו-`sw.js` של האפליקציה החיה. לכן הקובץ העצמאי `gantt.html` הועתק ל-`gantt/index.html`. ההיסטוריה המלאה (65 commits) נשארת בענף המקורי — לא למחוק אותו.
