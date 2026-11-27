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
| אלכסוני עמוד-קורה, מכפל, פרט פח+לשונית (חריץ RHS: `finJoint` ⇒ `Connection.slots` דרך `slotsOf`; מתכון: פעולת `slot` ב-`detail.ts`; ייצור: `fab/marks.ts:memberSlots`; `tests/slot.test.ts` SLOT-01..05) | `knee.ts`, `kneeSolve.ts`, `haunch.ts`, `finJoint.ts` | knee |
| חיבורים: בסיס, ראש עמוד, רכס, ברגים (`makeBolt`) | `connections.ts`, `eavePlate.ts` | connections |
| פרטים מותאמים ("מתכון" ops), פרטים מוכנים (`detailPresets`, `presetFits`; `preset-plate-plate` + דגל `bolts.noHost` — `tests/plateplate.test.ts`; הצמדות, תיקון בלחיצה והפוך-לפרמטר בסטודיו: `geometry/mates.ts` (`stackPlate`, `flushElementTo`, `growPlate`, `promoteToParam`) — `tests/mates.test.ts`; **עורך אילוצים** (רשימה, שחרור, קישור מידות): `geometry/constraints.ts` (`constraintsOf`, `linkDim`, `unlinkDim`), `ConstraintsCard` ב-`DetailStudio.tsx` — `tests/constraints.test.ts` CONSTR-01..05, `e2e/studio-mates.spec.ts` CONSTR-E1; **"הפוך לתבנית"** (גישה ב': פלטות במודל ← `CustomDetail`, הסקה הפוכה + אימות הלוך-חזור, בלי שינוי מנוע): `geometry/templateFromParts.ts` (`templateFromParts` — פלטות+חורים+ברגים+ריתוכים+חיתוך קצה; `opts.bolts/cut/welds`; `plateOutline`, `groupHoles`), כפתור `make-template` ב-`PropertiesPanel.tsx`, `store.studioDraft` ← `DetailStudio.tsx` — `tests/templatefromparts.test.ts` TFP-01..05, `e2e/make-template.spec.ts` MT-E1/E2; תכנון: `docs/make-template-plan.md`, `tests/studiofix.test.ts`, `e2e/studio-mates.spec.ts`; כרטיסי חתך עם משתנים: `ui/SectionCards.tsx` (SEC-E1); תוכנית הסטודיו: `docs/studio-plan.md`); מתכון v2: `params` + ערכי מופע `detailParams` (`paramOverrides`, `shownParams`, `detailParamValues`; פקודות `setDetailParam` / `resetDetailParams` / `setDetailTemplateVar`) | `detail.ts`, `core/expr.ts`, `model/connRegistry.ts` (רישום סוגי פרט, `customParamDefs`) | connections (`tests/detailparams.test.ts`) |
| אתרי אמצע/עוגן (G9, שלב D): `midSite.ts` (`midSite` — `פריט\|s:k`, `anchorSite` — `פריט\|p:שם`), `Site.mid`, `SiteCtx` (`findSite(.., ctx)`), פנים `u±`/`a±`/`w±`, `weld.ax`, `Connection.recipe.anchors`; מתכונים: `spliceRecipes.ts` (`purlinSpliceRecipe` — דגל `purlins.splice.engine`; `beamSplice{Bolted,Flange,WeldedI,WeldedBox}Recipe` — דגל `settings.spliceEngine`, פרמטרים מ-`autoSplice.ts`), `crossRecipes.ts` (`braceCrossGusset/RodRecipe` — `bracing.conn.engine` / `roof.rod.engine`, עוגן מ-`bracing.ts:crossRecipe`) | `geometry/midSite.ts`, `geometry/detail.ts`, `geometry/spliceRecipes.ts`, `geometry/crossRecipes.ts`, `geometry/autoSplice.ts` | purlins (`tests/splice-compare.test.ts` SPLICE-01/02, `tests/beamsplice-compare.test.ts` BSPLICE-01/02), bracing (`tests/cross-compare.test.ts` CROSS-01/02), CAD-14 |
| מתכוני הסבה (שלב C/D): `BUILTIN_RECIPES`, `kneeFinRecipe`, `strutFinRecipe`/`strutEndRecipe`/`strutWeldRecipe` (דגל `rafterStruts.engine`, תיבת סימון `rs-recipe`), `cleatRunRecipe`/`cleatPlateRecipe`/`cleatSeamRecipe` (תפר, `sj`/`xs`)/`cleatStandRecipe` (`angle` עם `vert`), `kneeFinRecipe(desc,id)` לאגד B ולמסבך נעילה (גם עמוד I, U (UPN/UPE) ו-C דרך `Site.Pt`/`th` — `trueHit` ב-`detail.ts`; שער `colI` ב-`portal.ts`/`lockTruss.ts`; `tests/uhost-compare.test.ts` UHOST-01/02) (`PortalBraceParams.engine`, `LockTrussParams.engine`; `tests/portal-compare.test.ts` PORTAL-01/02, CAD-10, `tests/lock-compare.test.ts` LOCK-01/02, CAD-11), `sideRecipe` (`building.sideEngine`, `bolts.noMain/headUp`, משתנה `ev`; `tests/side-compare.test.ts` SIDE-01/02, CAD-09), `baseEmbeddedRecipe`/`baseBoltedRecipe` (`building.baseEngine`, `holes.ring`, `rod.holes`, `bolts.anchor`, `cut.keep`, `Connection.recipe.own`; בדיקות `tests/base-compare.test.ts` BASE-01/02, CAD-08) (דגל `purlins.engine`, `cleat-recipe`; פעולת `angle`, צורת `rtri`, `plate.suffix`; `RECIPE_CONN_TYPE`); אתר זוגי: `recipe.pairs`/`siteParams`, `buildDetail({extra})`; פנים `axisA`, משתנים `ha`/`pb`, `plate.clipOff`); חשיפה: `kneeBraces.finEngine`, `Connection.recipe` (שיוך משתמע ב-`applyCustomDetails`), `findDetail`; ביצועי אתרים: `rayGeom` ב-`detail.ts`; אשף מחיבור custom: `familyOf`/`underlyingConn` ב-`connRegistry.ts` | `geometry/convRecipes.ts`, `geometry/detail.ts`, `model/connRegistry.ts` | knee (`tests/kneefin-compare.test.ts` CONV-01..04), struts (`tests/strutfin-compare.test.ts` STRUT-01..04, CAD-05/06), purlins (`tests/cleat-compare.test.ts` CLEAT-01..03, CAD-07), connections (`tests/connperf.test.ts`) |
| מחבר "פלטה אל פלטה + קיטומי פינות" (`preset-plate-plate-cham` ב-`detail.ts`; יכולת כללית `plate.cornerOn` — פינות נקטמות לפי פרמטר; UI: `DetailStudio.tsx`) — `tests/chamfer.test.ts`, `e2e/chamfer.spec.ts`; QA מנוע: `tests/qa-resize.test.ts`; דוח: `docs/qa-report-195.md`, שחזורים: `docs/qa/` | `geometry/detail.ts`, `ui/DetailStudio.tsx`, `commands/commands.ts` (`removeFrame`) | connections, frame |
| אשף חיבורים: חיפוש, מועדפים (העדפת משתמש ב-localStorage, לא בפרויקט) ותצוגה מקדימה (איור) במעבר עכבר — `ui/connFavs.ts` (`filterCands`, `loadFavs`) — `tests/connfavs.test.ts` FAV-01, `e2e/conn-favs.spec.ts` FAV-E1; דוח התאמה לכל חיבור (לשונית בייצור, CSV/XLSX; גיאומטריה בלבד, "אינו תכן מאושר") — `fab/connReport.ts` (`connReportTable`, `issuesOfConn`) — `tests/connreport.test.ts` CRPT-01, `e2e/conn-report.spec.ts` CRPT-E1; מחקר: `docs/research-upgrades.md` | `ui/ConnWizard.tsx`, `ui/ProductionView.tsx` | connections |
| ביקורת Codex 1.93 — סטטוס ותיקונים: `docs/review-193.md`; `detailInfo` (פותר מובנה/סטודיו), `candidates`/`applyDetail` ב-`model/connRegistry.ts`, `tests/conn-review.test.ts`, `e2e/conn-review.spec.ts` | `model/connRegistry.ts`, `ui/ConnWizard.tsx` | connections |
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
| ניסטינג ללייזר לפלטות (קונטור אמיתי, אריזה על רסטר, סיבוב 90°, DXF לכל לוח, דוח כמויות; אלגוריתם עצמאי; אינו מאומת מול מכונה) — `fab/nesting.ts` (`nestParts`, `nestPlates`, `nestSheetDxf`, `nestZip`, `nestTables`), `ui/NestingDialog.tsx` (כפתור `export-nest` בייצור) | `fab/nesting.ts`, `ui/NestingDialog.tsx` | fab (`tests/nesting.test.ts` NEST-01..04, `e2e/nesting.spec.ts`) |
| DSTV/NC1 (ZIP: פלטות בלבד — פרופילים נחתכים במסגריה; חריץ RHS כשורות `** SLOT` ב-`partToNc1`), IFC | `fab/dstv.ts`, `fab/ifc.ts` | fab |
| הרכבה, מיקום, הצעת מחיר, גדלים | `fab/sequence.ts`, `fab/location.ts`, `fab/quote.ts`, `fab/clientQuote.ts`, `model/sizing.ts` | fab |
| קטלוג גיליונות ובניית גיליון (החלק המייצג של סימון: `representativePart`) | `drawing/views.ts` (**~1260 שורות**) | drawing |
| שרטוט חלק (כולל חריצים ל-RHS — מ-`part.slots` של המודל), תא פלטה והפניית חורים (`holeCallouts`), מכלול | `drawing/part.ts`, `drawing/assembly.ts` | drawing |
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
| טופס פרמטרים דינמי לפרט מהספרייה (מתכון v2) | `wizard/DetailParams.tsx` (`dpf-*`), שדות `wiz-cf-*` ב-`ConnWizard.tsx`, כרטיס "פרמטרים באשף" ב-`DetailStudio.tsx` (`ParamsCard`) | detail-params |
| מידות נעולות | `wizard/LockedDims.tsx` | — |
| כרטיס אלמנט (מחולק לחלקי אשף) | `PropertiesPanel.tsx` (**830 שורות**, `CardPartCtx`, `PSEC_PART`) | scope, ux |
| חתך מסגרת עם מידות | `FrameSection.tsx` (`fs-*`), `SectionEditor.tsx` (**679**, `TemplateBar`, `SecHeightsCtx`), `TriDims.tsx` | ux158 FS-02 |
| פאנלים של רכיבים | `StructurePanel.tsx` (**805**), `RoofPanel.tsx`, `TransferPanel.tsx`, `WingPanel.tsx`, `CladdingPanel.tsx` | transfer, truss |
| עורך חיבור, אשף חיבורים, סטודיו פרטים (תגיות מידה תלויות-מבט — `Viewer` loop, `.dim-svg`) | `ConnectionEditor.tsx`, `ConnWizard.tsx`, `DetailStudio.tsx` (**~720**), `PlateWizard.tsx`, `EaveCheckDialog.tsx` | connwizard, detail-studio, plate-wizard |
| פרויקט חדש, גיליון פרמטרים | `Dialogs.tsx`, `ParamSheet.tsx` | wizard-sheet |
| שרטוטים וייצור במסך | `DrawingsView.tsx`, `ProductionView.tsx`, `schematics.tsx`, `Schematic.tsx` | m4m5, schematics |
| שדות ויחידות | `fields.tsx` | — |

## בדיקות
- מפת מודולים: `tests/modules.mjs` · פקודה: `scripts/test-mod.mjs` · שלמות המפה: `tests/modules.test.ts`.
- עשן: `tests/smoke.test.ts` (כ-10 שניות). כבדות (רק בהרצה מלאה): `sim-all`, `catalog50`, `perf`, `audit`, `cad-oracle` המלא.
- בדיקות דפדפן: `e2e/` (דורש `npx vite build`; עזרים ב-`e2e/helpers.ts`: `boot`, `openNav`, `openGroup`).
