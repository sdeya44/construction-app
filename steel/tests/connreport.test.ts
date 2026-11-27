/** CRPT-01: דוח התאמה לכל חיבור — נתונים מהמודל, שיוך הודעות, הערת "אינו תכן מאושר", יציבות וחוסן */
import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { CONN_REPORT_NOTE, connReportTable, issuesOfConn } from '../src/fab/connReport';
import { toCsv } from '../src/fab/export';
import type { Project } from '../src/model/types';

const LABELS: Record<string, string> = { eave: 'עמוד-קורה', knee: 'אלכסון עמוד-קורה', base: 'פלטת בסיס' };
const proj = (mut?: (b: ReturnType<typeof defaultBuilding>) => void): Project => {
  const p = newProject(); const b = defaultBuilding();
  b.kneeBraces = { ...defaultKneeBraces(), enabled: true, profile: 'RHS80x80x4' };
  mut?.(b);
  return { ...p, building: b };
};

describe('CRPT-01 דוח התאמה לכל חיבור', () => {
  it('שורה לכל חיבור + שתי שורות סיכום; עמודות תואמות; ברגים/ריתוכים מקובצים מהמודל', () => {
    const p = proj(); const d = generate(p);
    const t = connReportTable(p, d, LABELS);
    expect(t.rows.length).toBe(d.connections.length + 2);
    for (const r of t.rows) expect(r.length).toBe(t.headers.length);
    const body = t.rows.slice(0, d.connections.length);
    const eave = d.connections.find((c) => c.type === 'eave')!;
    const row = body.find((r) => r[0] === (eave.label || eave.id))!;
    expect(row).toBeTruthy();
    const nBolts = String(row[4]).split(', ').reduce((s, x) => s + Number(x.split('×')[0]), 0);
    expect(nBolts).toBe(eave.bolts.length);
    expect(row[1]).toBe('עמוד-קורה');
  });
  it('שיוך הודעות על מודל עם הודעות אמיתיות (HEB240): כולן משויכות, והסכום בטבלה = ההודעות במודל', () => {
    const p = proj((b) => { b.columnProfile = 'HEB240'; });
    const d = generate(p);
    const live = d.issues.filter((i) => i.severity !== 'info');
    expect(live.length).toBeGreaterThan(0); // אחרת הבדיקה ריקה
    const t = connReportTable(p, d, LABELS);
    const body = t.rows.slice(0, d.connections.length);
    const linked = body.reduce((s, r) => s + Number(r[7]) + Number(r[8]), 0);
    expect(linked).toBe(d.connections.reduce((s, c) => s + issuesOfConn(c, live).length, 0));
    expect(linked).toBeGreaterThan(0);
    const rest = Number(String(t.rows[t.rows.length - 2][9]).split(': ')[1]);
    expect(rest + new Set(d.connections.flatMap((c) => issuesOfConn(c, live))).size).toBe(live.length);
    expect(body.some((r) => String(r[9]).includes('אזהרה:') || String(r[9]).includes('שגיאה:'))).toBe(true);
  });
  it('הערת "אינו תכן מאושר" תמיד בסוף; אין טענת חוזק/אישור בתוצאה; CSV תקין ויציב', () => {
    const p = proj(); const d = generate(p);
    const t = connReportTable(p, d, LABELS);
    expect(t.rows[t.rows.length - 1][0]).toBe(CONN_REPORT_NOTE);
    expect(CONN_REPORT_NOTE).toContain('אינו תכן מאושר');
    const results = new Set(t.rows.slice(0, d.connections.length).map((r) => String(r[10])));
    for (const x of results) expect(['אין ממצאים בבדיקות הגיאומטריה', 'יש אזהרות — לבדיקה', 'יש שגיאות — לתקן לפני ייצור']).toContain(x);
    const a = toCsv(t), b = toCsv(connReportTable(p, generate(p), LABELS));
    expect(a).toBe(b);
    expect(a.startsWith('﻿')).toBe(true);
  });
  it('חוסן: פרויקט בלי חיבורים, וסוג חיבור שאינו במפה', () => {
    const p = proj(); const d = generate(p);
    const empty = connReportTable(p, { ...d, connections: [], issues: [] }, LABELS);
    expect(empty.rows.length).toBe(2);
    const t = connReportTable(p, d, {});
    expect(t.rows.some((r) => r[1] === 'eave')).toBe(true);
  });
  it('מוטציה: חיבור עם שגיאה מסומן "יש שגיאות" ולא "אין ממצאים"', () => {
    const p = proj(); const d = generate(p);
    const c = d.connections[0];
    const fake = { ...d, issues: [...d.issues, { code: 'BOLT_OUTSIDE', severity: 'error' as const, elementId: c.id, message: `${c.label}: בדיקה` }] };
    const t = connReportTable(p, fake, LABELS);
    const r = t.rows.find((x) => x[0] === (c.label || c.id))!;
    expect(Number(r[7])).toBeGreaterThanOrEqual(1);
    expect(r[10]).toBe('יש שגיאות — לתקן לפני ייצור');
  });
});
