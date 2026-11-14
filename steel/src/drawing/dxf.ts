import { visualOrder, type Layer, type Sheet } from './sheet';

/** צבעי ACI לשכבות */
const ACI: Record<Layer, number> = { FRAME: 7, TITLE: 7, OUTLINE: 7, THIN: 8, HIDDEN: 8, AXIS: 1, DIM: 5, TEXT: 7, HOLE: 1, MARK: 30, CUT: 7 };
const LT: Record<Layer, string> = { FRAME: 'CONTINUOUS', TITLE: 'CONTINUOUS', OUTLINE: 'CONTINUOUS', THIN: 'CONTINUOUS', HIDDEN: 'DASHED', AXIS: 'CENTER', DIM: 'CONTINUOUS', TEXT: 'CONTINUOUS', HOLE: 'CONTINUOUS', MARK: 'CONTINUOUS', CUT: 'CONTINUOUS' };

/** קידוד טקסט ל-DXF R12: תווים שאינם ASCII כ-\U+XXXX (נתמך ב-AutoCAD ובקוראי DXF נפוצים). */
function dxfText(s: string): string {
  return [...visualOrder(s)].map((c) => { const n = c.codePointAt(0)!; return n < 128 ? c : `\\U+${n.toString(16).toUpperCase().padStart(4, '0')}`; }).join('');
}

/**
 * DXF (AutoCAD R12, ASCII) של גיליון. קואורדינטות בקנה מידה אמיתי של המודל (מ"מ נייר × קנה המידה),
 * כך שמדידה ב-CAD נותנת מ"מ אמיתיים. מסגרת וגוש הכותרת מוגדלים בהתאם.
 */
export function sheetToDxf(sh: Sheet): string {
  const k = sh.scale || 1;
  const o: string[] = [];
  const g = (code: number, v: string | number) => { o.push(String(code), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : v); };
  const layers = Object.keys(ACI) as Layer[];
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4);
  g(9, '$EXTMIN'); g(10, 0); g(20, 0);
  g(9, '$EXTMAX'); g(10, sh.w * k); g(20, sh.h * k);
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 3);
  for (const [name, desc, pat] of [['CONTINUOUS', 'Solid', []], ['DASHED', '__ __', [2 * k, -1.2 * k]], ['CENTER', '__ . __', [6 * k, -1.5 * k, 1 * k, -1.5 * k]]] as [string, string, number[]][]) {
    g(0, 'LTYPE'); g(2, name); g(70, 0); g(3, desc); g(72, 65); g(73, pat.length); g(40, pat.reduce((s, x) => s + Math.abs(x), 0));
    for (const x of pat) g(49, x);
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const l of layers) { g(0, 'LAYER'); g(2, l); g(70, 0); g(62, ACI[l]); g(6, LT[l]); }
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'STYLE'); g(70, 1);
  g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'arial.ttf'); g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  const X = (x: number) => x * k, Y = (y: number) => y * k;
  for (const e of sh.ents) {
    if (e.k === 'line') { g(0, 'LINE'); g(8, e.layer); g(10, X(e.a.x)); g(20, Y(e.a.y)); g(30, 0); g(11, X(e.b.x)); g(21, Y(e.b.y)); g(31, 0); }
    else if (e.k === 'circle') { g(0, 'CIRCLE'); g(8, e.layer); g(10, X(e.c.x)); g(20, Y(e.c.y)); g(30, 0); g(40, e.r * k); }
    else if (e.k === 'poly') {
      g(0, 'POLYLINE'); g(8, e.layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, e.closed ? 1 : 0);
      for (const q of e.pts) { g(0, 'VERTEX'); g(8, e.layer); g(10, X(q.x)); g(20, Y(q.y)); g(30, 0); }
      g(0, 'SEQEND'); g(8, e.layer);
    } else {
      const h = e.h * k;
      const just = e.align === 'left' ? 0 : e.align === 'right' ? 2 : 1;
      g(0, 'TEXT'); g(8, e.layer); g(10, X(e.p.x)); g(20, Y(e.p.y)); g(30, 0); g(40, h); g(1, dxfText(e.s));
      if (e.rot) g(50, e.rot);
      if (just) { g(72, just); g(11, X(e.p.x)); g(21, Y(e.p.y)); g(31, 0); }
    }
  }
  g(0, 'ENDSEC'); g(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
