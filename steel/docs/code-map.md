# מפת קוד — KAYAN STEEL PRO

> קרא את הקובץ הזה **לפני** חיפוש בקוד. לכל אזור: הקבצים, מודול הבדיקות (`npm run test:mod -- <מודול>`) ובדיקות הדפדפן.
> עדכן אותו כשמוסיפים קובץ או מעבירים אחריות. נתיבים יחסית ל-`steel/`.

## זרימת נתונים (תמצית)
`store.exec(Command)` → `commands/history.ts` (מצבים לא משתנים) → `geometry/generate.ts` (Project ⇒ DerivedModel: members, connections, issues) → תצוגה (`view/`), ייצור (`fab/`), שרטוטים (`drawing/`).
פקודה = פונקציה טהורה ב-`commands/commands.ts`. אשף = טרנזקציה (`History.txBegin/txCommit/txCancel`, `useWizardTx`).
טיפוסים וסכמה: `model/types.ts` (שינוי שובר ⇒ מיגרציה ב-`model/migrate.ts`).

## מנוע גיאומטריה (`src/geometry/`)
| אזור | קבצים | מודול |
|---|---|---|
| תזמור המודל, ולידציה | `generate.ts`, `model/validate.ts`, `model/defaults.ts` | frame |
| חתך מודולרי, צירים, גבהים | `model/section.ts`, `frame.ts` (מערכת צירים מקומית), `plan.ts` (תוכנית לא מלבנית) | frame |
| מוצק אלמנט (רשת), חלקי ייצור, התנגשויות, ביקורת אורכים | `solid.ts`, `parts.ts`, `clash.ts`, `audit.ts`, `lengthWhy.ts` | frame |
| פטות ותושבות, חיבורי המשך | `purlins.ts`, `autoSplice.ts` (גם `C.RS` המשך קורה) | purlins |
| קושרות, סבכה, אגד B | `bracing.ts`, `hbrace.ts`, `portal.ts` | bracing |
| אלכסוני עמוד-קורה, מכפל, פרט פח+לשונית | `knee.ts`, `kneeSolve.ts`, `haunch.ts`, `finJoint.ts` | knee |
| חיבורים: בסיס, ראש עמוד, רכס, ברגים (`makeBolt`) | `connections.ts`, `eavePlate.ts` | connections |
| פרטים מותאמים ("מתכון" ops), פרטים מוכנים (`detailPresets`, `presetFits`) | `detail.ts`, `core/expr.ts`, `model/connRegistry.ts` (רישום סוגי פרט) | connections |
| ספריית מחברים: 7 מחברים מוכנים, ייבוא/ייצוא | `data/connLibrary.json`, `detailLibrary.ts`, `ui/DetailLibrary.tsx` (`lib-*`) | connections (e2e v167) |
| סככת L וכיסאות `C.WS` | `wing.ts` | wing |
| דילול עמודים / קורה נושאת | `transfer.ts` | transfer |
| מסבכים, נעילה | `truss.ts`, `lockTruss.ts` | truss |
| תמוכות בין קורות | `rafterStruts.ts` | struts |
| חיפוי, מזחלות, תוספות גג | `cladding.ts`, `gutter.ts`, `roofExtras.ts` | cladding |

## ייצור ושרטוטים
| אזור | קבצים | מודול |
|---|---|---|
| מספור, חורים בחלק, מכלולים | `fab/marks.ts` | fab |
| כתב כמויות, ייצוא, הזמנה, האחדה | `fab/bom.ts`, `fab/export.ts`, `fab/unify.ts` | fab |
| DSTV/NC1, IFC | `fab/dstv.ts`, `fab/ifc.ts` | fab |
| הרכבה, מיקום, הצעת מחיר, גדלים | `fab/sequence.ts`, `fab/location.ts`, `fab/quote.ts`, `fab/clientQuote.ts`, `model/sizing.ts` | fab |
| קטלוג גיליונות ובניית גיליון | `drawing/views.ts` (**1241 שורות**) | drawing |
| שרטוט חלק (כולל חריצים ל-RHS), תא פלטה והפניית חורים (`holeCallouts`), מכלול | `drawing/part.ts`, `drawing/assembly.ts` | drawing |
| מודל גיליון ופלט | `drawing/sheet.ts`, `svg.ts`, `pdf.ts`, `dxf.ts`, `solidCache.ts` | drawing |
| מכלול אגד B / אלכסוני Y (מבט, פרטים מוגדלים, ריתוכים, פרטי פלטות, תלת־ממד) | `drawing/unit.ts` (`braceUnits`, `braceUnitSheet`) | drawing (`tests/unit.test.ts`) |
| ביקורת קריאות, הצבת תוויות בלי חפיפה, הסרת כפילויות | `drawing/layoutAudit.ts` (`auditSheet`, `boxIsFree`), `drawing/labels.ts` (`placeLabels`, `dedupeTexts`) | drawing (`tests/layout.test.ts`) |
| ביקורת CAD (OpenCascade, בבדיקות בלבד) | `cad/occAudit.ts` | cad |

## תצוגה (`src/view/`)
`viewport.ts` (**~960 שורות**, סצנה ראשית, בחירה, מידות תלויות-מבט — `DimSpec`, `Pane.drawLabels`), `zoom.ts` (מהירות זום, כיוון ב-`ui/LayersMenu.tsx`), `scene.ts` (צבעים), `realView.ts` (רינדור ריאליסטי, `familySet`/`connSet`/`endCloseup`) · מודול view.

## ממשק (`src/ui/`) — מודול ui (+ e2e)
| אזור | קבצים | בדיקות דפדפן |
|---|---|---|
| מסגרת האפליקציה, ניתוב חלון רכיב, גרסה (`desk-only`) | `App.tsx` | ux158 |
| סרגל שלבים ושלבים | `StepsRail.tsx`, `steps.ts` (`sr-*`) | ux158 ST-02 |
| עץ/ניווט, רשימות | `SideNav.tsx` (`ListsPanel`, `lists-*`), `navIndex.ts`, `navStatus.ts`, `TreePanel.tsx` | ux154 |
| חלון רכיב (מעטפת אשף) | `ComponentWindow.tsx`, `wizard/Wizard.tsx` (`wz-ok/cancel/undo`) | ux157, ux158 |
| אשף משפחות (purlins, ties, ridge, clad, tb, wing, truss, frame, roofx) | `FamilyStudio.tsx` (`FAMILIES`) | ux158 FW-* |
| אשף אלכסונים / קירות / אלמנט בודד | `KneeStudio.tsx`, `WallsStudio.tsx`, `ElementStudio.tsx` | ux156, ux158 EL-01 |
| בלוק מחבר אחד | `wizard/ConnectorBlock.tsx` (`cb-*`), `ConnTypePicker.tsx`, `DetailPicker.tsx` | ux158 CB-01 |
| מידות נעולות | `wizard/LockedDims.tsx` | — |
| כרטיס אלמנט (מחולק לחלקי אשף) | `PropertiesPanel.tsx` (**830 שורות**, `CardPartCtx`, `PSEC_PART`) | scope, ux |
| חתך מסגרת עם מידות | `FrameSection.tsx` (`fs-*`), `SectionEditor.tsx` (**679**, `TemplateBar`, `SecHeightsCtx`), `TriDims.tsx` | ux158 FS-02 |
| פאנלים של רכיבים | `StructurePanel.tsx` (**805**), `RoofPanel.tsx`, `TransferPanel.tsx`, `WingPanel.tsx`, `CladdingPanel.tsx` | transfer, truss |
| עורך חיבור, אשף חיבורים, סטודיו פרטים | `ConnectionEditor.tsx`, `ConnWizard.tsx`, `DetailStudio.tsx` (**691**), `PlateWizard.tsx`, `EaveCheckDialog.tsx` | connwizard, detail-studio, plate-wizard |
| פרויקט חדש, גיליון פרמטרים | `Dialogs.tsx`, `ParamSheet.tsx` | wizard-sheet |
| שרטוטים וייצור במסך | `DrawingsView.tsx`, `ProductionView.tsx`, `schematics.tsx`, `Schematic.tsx` | m4m5, schematics |
| שדות ויחידות | `fields.tsx` | — |

## בדיקות
- מפת מודולים: `tests/modules.mjs` · פקודה: `scripts/test-mod.mjs` · שלמות המפה: `tests/modules.test.ts`.
- עשן: `tests/smoke.test.ts` (כ-10 שניות). כבדות (רק בהרצה מלאה): `sim-all`, `catalog50`, `perf`, `audit`, `cad-oracle` המלא.
- בדיקות דפדפן: `e2e/` (דורש `npx vite build`; עזרים ב-`e2e/helpers.ts`: `boot`, `openNav`, `openGroup`).
