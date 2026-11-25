# מקור ייחוס מחבילת KAYAN 1.70 (לא חלק מהבנייה)

קבצים שנלקחו מ-`KAYAN-ESSENTIAL-CODE.zip` (SHA-256 `ce82a0e3ea77db8e726858d5dd3c5a5f38be90c15b104b8ac3f8826b2ba6c93e`, תיקיית `src/`),
כדי שיהיו זמינים לשלבים הבאים בלי להעלות את החבילה מחדש. **לא נבנים, לא נבדקים ולא מיובאים** מקוד התוכנה (`src/`) —
מעבירים מהם ל-TypeScript בתוך `src/` עם בדיקות, כפי שנעשה ב-1.65–1.69. הם בנויים מעל מתאם (`adapter.mjs`) לקובץ הבנוי של 1.65 — לא מעל המודל שלנו.

| שלב עתידי | קבצים |
|---|---|
| קינון פלטות לפי קו מתאר | `polygon-nesting.mjs`, `nesting.mjs`, `nesting-rect.mjs`, `dxf.mjs`, `drawings/plate-engine.mjs` |
| תכנון מוטות: עובי מסור, קיטום, מלאי | `bar-planning.mjs`, `drawings/machining-model.mjs`, `drawings/notch-engine.mjs`, `drawings/project-notches.mjs` |
| STEP למכלול/בחירה, בדיקת גופים | `worker.mjs` (replicad / OpenCascade), `adapter.mjs`, `drawings/plate-end-trim.mjs`, `drawings/structural-groups.mjs` |
| "שרטוט מדויק" — קווים נסתרים וחתכים | `drawings/occ-projection.mjs` (+ `worker.mjs`) |
| מגע ריתוכים בגופי CAD | `drawings/kernel-contact.mjs` (הגרסה שלנו: `src/cad/occAudit.ts`) |
| השוואת מהדורות | `drawings/revision-diff.mjs` |
| תצוגת גוף | `preview.mjs` |

תלויות בחבילה המקורית: `replicad@1.2.1`, `replicad-opencascadejs@1.2.1` (כבר ב-devDependencies שלנו), `three`.
רישיונות: replicad — MIT; replicad-opencascadejs (OpenCascade) — LGPL-2.1.
