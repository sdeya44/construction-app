/**
 * מפת מודולים לבדיקות — אילו קבצי מקור שייכים לכל מודול ואילו בדיקות מכסות אותו.
 * משמשת את `npm run test:mod` (scripts/test-mod.mjs).
 *
 * src   — תחיליות נתיב (יחסית ל-steel/) של קבצי המודול
 * tests — קבצי vitest; מחרוזת = כל הקובץ, { file, t } = רק בדיקות ששמן מכיל t
 * e2e   — בדיקות דפדפן שרלוונטיות (רצות רק עם --e2e)
 *
 * כלל: כל קובץ בדיקה חייב להופיע לפחות במודול אחד או ב-HEAVY (בדיקת MOD-01 אוכפת זאת).
 */

/** בדיקות כבדות — רק בהרצה מלאה (npm run test:full) */
export const HEAVY = ['tests/sim-all.test.ts', 'tests/catalog50.test.ts', 'tests/perf.test.ts', 'tests/audit.test.ts', 'tests/cad-oracle.test.ts'];

/** בדיקת עשן — בסוף כל סבב */
export const SMOKE = ['tests/smoke.test.ts', 'tests/modules.test.ts'];

const cad = (t) => ({ file: 'tests/cad-oracle.test.ts', t });

export const MODULES = {
  frame: {
    title: 'מסגרות, צירים, חתך, גבהים, תוכנית',
    src: ['src/geometry/generate.ts', 'src/geometry/frame.ts', 'src/geometry/plan.ts', 'src/geometry/solid.ts', 'src/geometry/parts.ts', 'src/geometry/audit.ts', 'src/geometry/clash.ts', 'src/geometry/lengthWhy.ts', 'src/model/section.ts', 'src/model/defaults.ts', 'src/model/validate.ts', 'src/model/types.ts'],
    tests: ['tests/generate.test.ts', 'tests/section.test.ts', 'tests/framesection.test.ts', 'tests/plan.test.ts', 'tests/steep.test.ts', 'tests/v137.test.ts', 'tests/newshapes.test.ts'],
    e2e: ['e2e/m1.spec.ts', 'e2e/wizard-sheet.spec.ts'],
  },
  purlins: {
    title: 'פטות, תושבות, חיבורי המשך',
    src: ['src/geometry/purlins.ts', 'src/geometry/autoSplice.ts'],
    tests: ['tests/purlins.test.ts', 'tests/splice.test.ts', 'tests/autosplice.test.ts', 'tests/steep.test.ts', cad('· beam-splice'), cad('· purlin-')],
    e2e: ['e2e/m2.spec.ts', 'e2e/m3.spec.ts', 'e2e/cleat-types.spec.ts'],
  },
  bracing: {
    title: 'קושרות גג וקיר, אגד B, סבכה, חיזוק רכס',
    src: ['src/geometry/bracing.ts', 'src/geometry/hbrace.ts', 'src/geometry/portal.ts'],
    tests: ['tests/bracing.test.ts', 'tests/rodx.test.ts', 'tests/roofx136.test.ts', 'tests/reinf.test.ts', 'tests/portal.test.ts', cad('· brace')],
    e2e: ['e2e/v129.spec.ts', 'e2e/sim-gable.spec.ts'],
  },
  knee: {
    title: 'אלכסוני עמוד-קורה ומכפלים',
    src: ['src/geometry/knee.ts', 'src/geometry/kneeSolve.ts', 'src/geometry/haunch.ts', 'src/geometry/finJoint.ts'],
    tests: ['tests/kneegrid.test.ts', 'tests/kneesolve.test.ts', { file: 'tests/newshapes.test.ts', t: 'מכפל' }, cad('· knee')],
    e2e: ['e2e/knee-sides.spec.ts', 'e2e/ux156.spec.ts'],
  },
  connections: {
    title: 'חיבורים: בסיס, ראש עמוד, רכס, פרטים מותאמים, אשף חיבורים',
    src: ['src/geometry/connections.ts', 'src/geometry/detail.ts', 'src/geometry/eavePlate.ts', 'src/model/connRegistry.ts'],
    tests: ['tests/connections.test.ts', 'tests/connwizard.test.ts', 'tests/detail.test.ts', 'tests/extras141.test.ts', cad('· base'), cad('· eave'), cad('· ridge'), { file: 'tests/cad-oracle.test.ts', t: 'CAD-02' }],
    e2e: ['e2e/connwizard.spec.ts', 'e2e/detail-studio.spec.ts', 'e2e/plate-wizard.spec.ts', 'e2e/v134.spec.ts'],
  },
  wing: {
    title: 'סככת L (כנף) וכיסאות',
    src: ['src/geometry/wing.ts'],
    tests: [{ file: 'tests/detail.test.ts', t: 'כנף' }, cad('· rafter-side'), { file: 'tests/cad-oracle.test.ts', t: 'כיסא כנף' }],
    e2e: [],
  },
  transfer: {
    title: 'דילול עמודים — קורה נושאת',
    src: ['src/geometry/transfer.ts'],
    tests: ['tests/transfer.test.ts', cad('· tb-')],
    e2e: ['e2e/transfer.spec.ts'],
  },
  truss: {
    title: 'מסבכים ונעילה',
    src: ['src/geometry/truss.ts', 'src/geometry/lockTruss.ts'],
    tests: ['tests/truss.test.ts', 'tests/locktruss.test.ts', cad('· truss')],
    e2e: ['e2e/truss.spec.ts'],
  },
  struts: {
    title: 'תמוכות בין הקורות',
    src: ['src/geometry/rafterStruts.ts'],
    tests: ['tests/rafterstruts.test.ts'],
    e2e: ['e2e/rafter-struts.spec.ts'],
  },
  cladding: {
    title: 'חיפוי, מרזבים, תוספות גג',
    src: ['src/geometry/cladding.ts', 'src/geometry/gutter.ts', 'src/geometry/roofExtras.ts'],
    tests: ['tests/cladding.test.ts'],
    e2e: [],
  },
  fab: {
    title: 'ייצור: מספור, כמויות, DSTV, IFC, הזמנה, האחדה, הרכבה, הצעת מחיר',
    src: ['src/fab/', 'src/model/sizing.ts'],
    tests: ['tests/fab.test.ts', 'tests/dstv.test.ts', 'tests/export.test.ts', 'tests/order.test.ts', 'tests/unify.test.ts', 'tests/erection.test.ts', 'tests/sizing.test.ts'],
    e2e: ['e2e/m4m5.spec.ts', 'e2e/v136.spec.ts', 'e2e/sizing.spec.ts'],
  },
  drawing: {
    title: 'שרטוטים: גיליונות, חלק, מכלול, PDF/DXF/SVG',
    src: ['src/drawing/'],
    tests: ['tests/drawings.test.ts'],
    e2e: ['e2e/m4m5.spec.ts', 'e2e/schematics.spec.ts', 'e2e/v135.spec.ts'],
  },
  profiles: {
    title: 'ספריית חתכים וקטלוג',
    src: ['src/profiles/'],
    tests: ['tests/profiles.test.ts', 'tests/builtin.test.ts', 'tests/catalog.test.ts'],
    e2e: ['e2e/catalog.spec.ts'],
  },
  core: {
    title: 'ליבה: פקודות, היסטוריה, שמירה, יחידות, הודעות',
    src: ['src/core/', 'src/commands/', 'src/store.ts', 'src/persist/', 'src/model/migrate.ts', 'src/model/issues.ts'],
    tests: ['tests/units.test.ts', 'tests/history-tx.test.ts', 'tests/issues.test.ts', 'tests/orphan.test.ts'],
    e2e: ['e2e/restore.spec.ts'],
  },
  view: {
    title: 'תלת-ממד ותמונות',
    src: ['src/view/', 'src/ui/LiveView3D.tsx', 'src/ui/RealPic.tsx'],
    tests: ['tests/realview.test.ts'],
    e2e: ['e2e/ux158.spec.ts'],
  },
  ui: {
    title: 'ממשק: אשפים, שלבים, פאנלים',
    src: ['src/ui/'],
    tests: ['tests/steps.test.ts', 'tests/lockeddims.test.ts', 'tests/framesection.test.ts'],
    e2e: ['e2e/ux158.spec.ts', 'e2e/ux157.spec.ts'],
  },
  cad: {
    title: 'ביקורת CAD (OpenCascade)',
    src: ['src/cad/'],
    tests: [{ file: 'tests/cad-oracle.test.ts', t: 'CAD-02' }, cad('^CAD-01 דו-שיפועי ·')],
    e2e: [],
  },
};
