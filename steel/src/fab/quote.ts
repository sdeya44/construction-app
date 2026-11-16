/**
 * הצעת מחיר / אומדן עלות (בקשת משתמש 16.11.2026). המחירים נשמרים בקובץ הפרויקט בלבד (לא בקוד/ריפו).
 * פלדה לפי משקל רכש (מוטות מלאי מתוכנית החיתוך + פחת פלטות), גלוון לפי משקל נטו, ברגים לפי יחידה,
 * ייצור והרכבה לפי טון, הובלה סכום קבוע, תקורה ורווח באחוזים, מע"מ.
 */
import { getProfile, massPerMeter } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import type { Bom, CutPlan } from './bom';
import type { Fabrication } from './marks';
import type { DerivedModel } from '../model/types';
import type { CladdingTakeoff } from '../geometry/cladding';

export interface Pricing {
  steelPerKg: number; platePerKg: number; plateWastePct: number; galvPerKg: number;
  boltPerUnit: number; anchorPerUnit: number;
  fabHoursPerTon: number; hourRate: number; erectionPerTon: number; transport: number;
  overheadPct: number; marginPct: number; vatPct: number;
  /** חיפוי (₪): פנל גג/קיר למ"ר, פחים למטר, מזחלה למטר, מרזב ליח', ברגי חיפוי ליח', התקנת חיפוי למ"ר */
  roofPanelPerM2: number; wallPanelPerM2: number; flashingPerM: number; gutterPerM: number; downpipePerUnit: number; claddingScrewPerUnit: number; claddingInstallPerM2: number;
}
export const DEFAULT_PRICING: Pricing = {
  steelPerKg: 0, platePerKg: 0, plateWastePct: 15, galvPerKg: 0, boltPerUnit: 0, anchorPerUnit: 0,
  fabHoursPerTon: 0, hourRate: 0, erectionPerTon: 0, transport: 0, overheadPct: 0, marginPct: 0, vatPct: 18,
  roofPanelPerM2: 0, wallPanelPerM2: 0, flashingPerM: 0, gutterPerM: 0, downpipePerUnit: 0, claddingScrewPerUnit: 0, claddingInstallPerM2: 0,
};
export interface QuoteLine { key: string; label: string; qty: number; unit: string; price: number; total: number }
export interface Quote { lines: QuoteLine[]; subtotal: number; overhead: number; margin: number; beforeVat: number; vat: number; total: number; netKg: number; buyKg: number; perKg: number }

export function computeQuote(pr: Pricing, d: DerivedModel, fab: Fabrication, bom: Bom, plans: CutPlan[], clad?: CladdingTakeoff | null): Quote {
  // משקל פרופילים לרכש: אורך המוטות × משקל למטר; פלטות: נטו + פחת
  let buyProfiles = 0;
  for (const pl of plans) {
    const kgm = massPerMeter(getProfile(pl.profile), getMaterial(pl.material).density);
    buyProfiles += (pl.stockTotal / 1000) * kgm;
  }
  const plateKg = fab.parts.filter((x) => d.byId.get(x.memberId)?.kind === 'plate').reduce((a, x) => a + x.weight, 0);
  const anchors = d.members.filter((m) => m.kind === 'anchor').length;
  const anchorKg = fab.parts.filter((x) => d.byId.get(x.memberId)?.kind === 'anchor').reduce((a, x) => a + x.weight, 0);
  const plateBuy = plateKg * (1 + pr.plateWastePct / 100);
  const netKg = bom.totalWeight;
  const bolts = bom.bolts.reduce((a, b) => a + b.qty, 0);
  const tons = netKg / 1000;
  const L = (key: string, label: string, qty: number, unit: string, price: number): QuoteLine => ({ key, label, qty, unit, price, total: qty * price });
  const lines = [
    L('steel', 'פלדה — פרופילים (משקל רכש לפי תוכנית החיתוך)', Math.round(buyProfiles), 'ק"ג', pr.steelPerKg),
    L('plate', `פלדה — פלטות (נטו + ${pr.plateWastePct}% פחת)`, Math.round(plateBuy), 'ק"ג', pr.platePerKg || pr.steelPerKg),
    L('galv', 'גלוון חם (משקל נטו)', Math.round(netKg - anchorKg), 'ק"ג', pr.galvPerKg),
    L('bolts', 'ברגים מגולוונים (בורג+אום+דסקית)', bolts, 'יח\'', pr.boltPerUnit),
    L('anchors', 'מוטות עיגון', anchors, 'יח\'', pr.anchorPerUnit),
    L('fab', `ייצור במסגריה (${pr.fabHoursPerTon} ש"ע לטון)`, Math.round(tons * pr.fabHoursPerTon * 10) / 10, 'ש"ע', pr.hourRate),
    L('erect', 'הרכבה בשטח', Math.round(tons * 100) / 100, 'טון', pr.erectionPerTon),
    L('transport', 'הובלה', 1, 'קומפ\'', pr.transport),
  ];
  if (clad) {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const fl = clad.flashings.reduce((a, f) => a + f.length, 0) / 1000;
    const gu = clad.gutters.reduce((a, g) => a + g.length, 0) / 1000, dp = clad.gutters.reduce((a, g) => a + g.downpipes, 0);
    if (clad.roofArea) lines.push(L('roofPanel', 'חיפוי גג — פנלים', r1(clad.roofArea), 'מ"ר', pr.roofPanelPerM2));
    if (clad.wallArea) lines.push(L('wallPanel', 'חיפוי קירות — פנלים (נטו)', r1(clad.wallArea), 'מ"ר', pr.wallPanelPerM2));
    if (fl) lines.push(L('flashing', 'פחים: רכס, שוליים, פינות, בסיס ופתחים', r1(fl), 'מ\'', pr.flashingPerM));
    if (gu) lines.push(L('gutter', 'מזחלות', r1(gu), 'מ\'', pr.gutterPerM));
    if (dp) lines.push(L('downpipe', 'מרזבים', dp, 'יח\'', pr.downpipePerUnit));
    if (clad.screws) lines.push(L('cscrew', 'ברגי חיפוי', clad.screws, 'יח\'', pr.claddingScrewPerUnit));
    if (clad.roofArea + clad.wallArea) lines.push(L('cinstall', 'התקנת חיפוי', r1(clad.roofArea + clad.wallArea), 'מ"ר', pr.claddingInstallPerM2));
  }
  const subtotal = lines.reduce((a, l) => a + l.total, 0);
  const overhead = subtotal * pr.overheadPct / 100;
  const margin = (subtotal + overhead) * pr.marginPct / 100;
  const beforeVat = subtotal + overhead + margin;
  const vat = beforeVat * pr.vatPct / 100;
  return { lines, subtotal, overhead, margin, beforeVat, vat, total: beforeVat + vat, netKg, buyKg: buyProfiles + plateBuy, perKg: netKg ? beforeVat / netKg : 0 };
}
