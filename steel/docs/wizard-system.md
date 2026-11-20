# KAYAN Unified Engineering Wizard System — שלב 1: מיפוי, ארכיטקטורה ותוכנית

> מסמך עבודה (גרסה 1.56 → 1.57). מצב קיים נבדק בקוד ב-`steel/src`. אין כאן שינוי חישובים או מנוע.
> הכרעות המשתמש: **שינוי מוצג חי במודל, נשמר באישור; ביטול מחזיר למצב שלפני פתיחת האשף** · **לחיצה אחת על אלמנט פותחת את האשף**.

## 1. מפת האשפים והעורכים הקיימים

| משפחה | כניסה היום (מפתח ניווט) | עורך / רכיב קיים | פרמטרים במנוע | תחולה שהמנוע מממש | מחברים |
|---|---|---|---|---|---|
| הגדרות פרויקט | `s:project` | `StructurePanel` (section project) | `meta`, `settings` | גלובלי | — |
| צירים, מסגרות, גבהים | `s:geometry` | `StructurePanel` + `SectionEditor` (חתך מודולרי) + `TriDims` | `width, eaveL/R, ridgeX, frames[], section` | גלובלי; מסגרת בודדת (`setFrameY`, `addFrame`) | — |
| עמודים / קורות גג (חתך) | `s:profiles`, לחיצה על עמוד/קורה | `StructurePanel`, `PropertiesPanel` (one/line/frame/similar) | `columnProfile, rafterProfile`, `memberOverrides` | אלמנט · ציר · מסגרת · כל הדומים | ראש עמוד, בסיס, רכס (`ConnectionEditor`, `EaveCheckDialog`) |
| פטות שיפוע + תושבות | `r:left`/`r:right`, לחיצה על פטה | `RoofPanel/SideEditor`, `CleatTypePicker`, `schematics` | `purlins.left/right`, `cleatOverrides` | שיפוע · תושבת בודדת | תושבת פטה (`purlin-cleat`) |
| חיבורי המשך פטות | `r:splices` | `SpliceEditor` | `splices`, `autoSplice` | אלמנט · אוטומטי | `purlin-splice`, `beam-splice` |
| אלכסוני עמוד-קורה | `b:knee`, לחיצה על אלכסון | **`KneeStudio` (1.56)** + `KneeSides` | `kneeBraces` + `sides[key]` + `offCells` + `memberOverrides` | כל המודל · מיקום (ציר+צד, כל המסגרות) · חתך/פרט לאלכסון בודד · הדלקה לתא | `knee` (C/R) |
| מכפל | בתוך `b:knee` | `HaunchEditor` | `haunch` | גלובלי | `C.HN` |
| קשיחות קירות X / אגד B / מסבך נעילה | `b:walls`, לחיצה על מכלול | **`WallsStudio` (1.56)**, `PortalFields`, `LockTrussFields`, `WallXShape`, `WallLines` | `bracing.walls` + `lineType/linePortal/lineTruss` | כל המודל · ציר | `brace-end`, `brace-cross`, `C.BB.*`, `C.LT.*` |
| סיב רציף | בתוך קשיחות קירות | `LineTiesEditor` | `bracing.lineTies` | צירים נבחרים | `C.LTIE` |
| קושרות גג | `b:roof`, לחיצה על קושרת | `RoofBracingPanel`, `RoofXGrid/Split`, `RafterStrutsEditor` | `bracing.roof`, `rafterStruts` | כל המודל · מפתח (תוכנית) | `brace`, `RS` |
| קשירת פטות / מוטות תלייה / תמיכה צידית | `b:ties` | `BracingEditor part=ties`, `PurlinExtras` | `purlinTies, sagRods, flyBraces` | כל המודל | — |
| חיזוק רכס | `b:ridge` | `RidgeReinfEditor` | `ridgeReinf` | כל המודל | `ridge` |
| חיפוי גג / קירות / פטות קיר | `w:roof`, `w:walls` | `CladdingPanel` | `cladding.*` | קיר / שיפוע | — |
| מזחלות | `w:roof`, לחיצה על מזחלה | `GutterWizard` (מודאלי) | `cladding.gutters` | מזחלה בודדת | `gutter` |
| פתחים | `w:openings` | `CladdingPanel` | `cladding.openings` | פתח בודד | — |
| דילול עמודים | `b:tb` | `TransferPanel`, `OmitDialog` | `transfers[]` | פריט בודד | `tb-support`, `tb-seat` |
| כנף L | `b:wing` | `WingPanel` | `wing` | גלובלי | — |
| מסבכי גג | `b:truss` | `RoofTrussPanel`, `TrussWizard` (מודאלי) | `roofTruss` | מסגרות נבחרות | `truss*` |
| מחברים (כללי) | `conns`, `c:*`, כרטיס חיבור במודל | `ConnectionEditor`, `ConnWizard`, `PlateWizard`, `DetailStudio`, `DetailLibrary` | `connectionOverrides`, `customDetails` | חיבור · כל החיבורים מהסוג | — |

**נקודות כניסה היום:** ריבון (`Ribbon` ב-`SideNav`), סרגל שלבים (`StepsRail`), גיליון פרמטרים (`ParamSheet` → אירוע `ksp-nav`), לחיצה במודל (`viewport.handleClick` → `selection` → `App`), כרטיס חיבור (`ConnCard` → `activeConn`), חיפוש Ctrl+K (`CommandPalette`), תפריט עגול בלחיצה ימנית (`MarkingMenu`), טבלאות מופעים (`ComponentTable`), עץ (בטלפון).

**מנגנון שינוי:** כל עריכה = `store.exec(Command)` → `History` (מצבים לא משתנים, 200 צעדים) → `generate()` מחדש. אין היום טרנזקציה/קיבוץ פעולות.

**תלויות:** המודל הנגזר (`DerivedModel`) נבנה מחדש מכל שינוי; שרטוטים (`DrawingsView`), ייצור/מספור (`ProductionView`, `numberParts`), רשימות וכמויות נגזרים ממנו בכל פתיחה. נעילת מהדורה (`revision.locked`) חוסמת שינויים; השוואה למהדורה — בגיליון הפרמטרים.

## 2. ארכיטקטורה

```
openWizard(target)  ← כל נקודות הכניסה (ריבון, שלבים, גיליון, לחיצה, כרטיס חיבור, Ctrl+K, תפריט עגול, טבלת מופעים)
      │   target = { family } | { memberId } | { connId }      (resolveFamily: מזהה → משפחה, כמו compOfMember היום)
      ▼
WizardShell (חלון צף: כותרת, זיהוי, מונה, מזעור/הגדלה/סגירה, גרירה)
  ├─ WizardTypeSelector     ← def.types[]       (כרטיסים עם תמונה מרונדרת מהמודל — RealPic)
  ├─ WizardScopeSelector    ← def.scopes(ctx)   (רק תחולות שהמנוע מממש; האחרות אפורות עם הסבר; מונה + הדגשה כתומה)
  ├─ WizardNavigation       ← 1 מיקום · 2 גיאומטריה · 3 חתך ומחברים (+ קבוצות משנה לפי def)
  │    ├─ WizardLocationEditor   ← def.location(ctx)
  │    ├─ WizardGeometryEditor   ← Wizard3DPreview + WizardDimensionEditor(def.dims)
  │    └─ WizardProfileEditor + WizardConnectionEditor ← def.profiles, def.connectors
  ├─ WizardValidation       ← issues של המשפחה (PanelAlerts) + אילוצים לא פתירים
  └─ WizardActions          ← אישור · ביטול · שחזור (Undo בתוך הטרנזקציה) · העתקת הגדרות · החלה על נבחרים
```

- **WizardDef (רישום משפחה):** `{ id, title, icon, tint, match(id), types?, scopes(ctx), location, geometry: { preview(ctx): RealSet, dims?: DimSystem, fields }, profiles, connectors(ctx), counts(ctx) }`. כל אשף = הגדרה, לא קוד UI חדש.
- **טרנזקציה (`store.tx`):** פתיחת אשף רושמת נקודת מצב; כל `exec` בתוך האשף נכנס להיסטוריה כרגיל (תצוגה חיה); **אישור** מאחד את כל הצעדים לפעולת Undo אחת; **ביטול** מחזיר לנקודת המצב ומוחק את הצעדים; סגירה בלי הכרעה = אישור (שומר את העבודה). מומש ב-`History` (שינוי קטן, בלי לגעת במנוע).
- **מערכת מידות (`DimSystem`):** משתנים עצמאיים של המנוע (למשל ירידה+זווית), מידות נגזרות (פונקציית מדידה על המודל), בחירת קבועות. **בדיקת דרגות חופש:** מספר הקבועות = מספר המשתנים, ובנוסף דרגת היעקוביאן מלאה בנקודה הנוכחית (זוג תלוי — מסומן "לא תקין" ולא נשלח לפתרון). סוגי מידה: קלט נעול · מחושבת · ייחוס · לא תקינה.
- **עיצוב:** טוקנים מרכזיים (`--wz-*`) — צבעים (כחול = בחירה, כתום = שינוי/נעילה, ירוק = תקין, אדום = שגיאה), ריווחים 4/8/12/16, רדיוסים 8/12/16, צל, טיפוגרפיה, מצבי פקד. כל רכיב משתמש רק בהם.

## 3. רכיבים משותפים — ממה הם נבנים

| רכיב חדש | בסיס קיים |
|---|---|
| WizardShell | `ComponentWindow` (1.55–1.56) |
| WizardTypeSelector | `ks-types` + `RealPic`/`WallPic`/`KneePic` |
| WizardScopeSelector | `ks-scope` (KneeStudio/WallsStudio) + `ScopeIsolator` (הדגשה כתומה) |
| WizardNavigation | `ks-secs` |
| Wizard3DPreview | `LiveView3D` + `realView` (wallSet/kneeSet) |
| WizardDimensionEditor | `DimInput` + `kneeSolve` (יורחב ל-DimSystem כללי) + השרטוטים הקיימים עם מידות לעריכה (`schematics`) |
| WizardProfileEditor | `ProfilePicker` |
| WizardConnectionEditor | `ks-ends` + `EndCards`/`DetailEnds` + `ConnWizard` + `DetailStudio` (שליטה מלאה נשארת בסטודיו) |
| WizardValidation | `PanelAlerts`, `issues` |
| WizardActions | חדש (על בסיס `History`) |

## 4. טבלת התאמה ישן → חדש (סדר יישום)

| שלב | משפחה | אשף חדש | הערות |
|---|---|---|---|
| אב-טיפוס | קשיחות קירות | `walls` | מעבר מ-WallsStudio לרכיבים המשותפים + טרנזקציה + פעולות |
| 2 | אלכסוני עמוד-קורה + מכפל | `knee` | KneeStudio → DimSystem כללי; מכפל בשלוש לשוניות |
| 3 | קושרות גג, קשירת פטות, רכס | `roofBrace`, `ties`, `ridge` | |
| 4 | פטות שיפוע, תושבות, המשכים | `purlins`, `splices` | |
| 5 | חיפוי, מזחלות, פתחים | `cladding`, `gutter`, `openings` | GutterWizard נבלע באשף |
| 6 | דילול עמודים, כנף L, מסבכי גג | `transfer`, `wing`, `truss` | TrussWizard נבלע באשף |
| 7 | צירים/מסגרות, עמודים, קורות, חתכים | `frame`, `members` | מעטפת "הגדרות" בלי סוג/תחולה במקום שאין להם משמעות |
| 8 | פרויקט והגדרות | `project` | מעטפת הגדרות בלבד |

## 5. סיכונים ותלויות

1. **תחולות שהמנוע לא מממש** (למשל גיאומטריה לאלכסון בודד, קשיחות למכלול בודד) — לא יוצגו כפעילות. הרחבת המנוע = משימה נפרדת עם בדיקות.
2. **טרנזקציה ושמירה אוטומטית** — השמירה האוטומטית רצה בזמן האשף; ביטול חייב להחזיר גם אותה (שמירה אחרי ביטול). ייבדק.
3. **זוגות מידות תלויים** — פותר לא יתכנס או יתן פתרון לא יציב; בדיקת דרגה לפני פתרון.
4. **בדיקות קיימות (128 E2E)** נשענות על מזהי `data-testid` — הרכיבים המשותפים שומרים אותם.
5. **ביצועים** — תמונות מרונדרות (generate לכל אפשרות) ופותר המידות (generate לכל צעד) — תור ומטמון קיימים; לפותר נדרש מגבלת זמן.
6. **מהדורה נעולה** — האשף נפתח לקריאה בלבד עם הסבר.
7. **מובייל** — האשף כגיליון תחתון; ייבדק בכל שלב.

## 6. תוכנית בשלבים (כל שלב: גיבוי = commit+push, בדיקות רלוונטיות + בדיקה חדשה)

1. מיפוי (מסמך זה).
2. Design tokens (`--wz-*`) והחלתם על החלונות הקיימים.
3. תשתית: `WizardShell`, `openWizard`, רישום משפחות, טרנזקציה ב-`History`, `WizardActions`, `WizardScopeSelector`, `WizardNavigation`.
4. **אב-טיפוס: קשיחות קירות** על הרכיבים המשותפים — **עצירה לאישור**.
5. אלכסונים + מכפל (DimSystem כללי עם בדיקת דרגות חופש).
6. בדיקות רגרסיה מלאות.
7. הרחבה לפי הטבלה בסעיף 4.
8. בדיקות אינטגרציה (פתיחה מכל כניסה, טעינה, ביטול/אישור, Undo/Redo, שמירה וטעינה, שרטוטים ורשימות, RTL, גדלי חלון).
9. ניקוי כפילויות (העורכים הישנים שנבלעו).
10. בדיקות סופיות + שחרור.
