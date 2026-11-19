import { describe, expect, it } from 'vitest';
import { defaultBuilding, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultFlyBraces, defaultLineTies, defaultSagRods } from '../src/geometry/roofExtras';
import { clash } from '../src/geometry/clash';
import type { BuildingParams } from '../src/model/types';

const gen = (f: (b: BuildingParams) => void) => { const b = defaultBuilding(); f(b); return generate(newProject('t', b)); };
const noClash = (d: ReturnType<typeof generate>) => expect(d.issues.filter((i) => i.code === 'CLASH' || i.severity === 'error')).toEqual([]);

describe('רכיבים 1.41 — מוטות תלייה, תמיכה צידית, סיב רציף, בסיס בכלונס', () => {
  it('SR: מוט תלייה בין כל שתי פטות סמוכות, בכל מפתח; חורים בווב הפטות', () => {
    const d = gen((b) => { b.bracing.sagRods = { ...defaultSagRods(), perBay: 2 }; });
    const rods = d.members.filter((m) => m.id.startsWith('SR.'));
    const nb = defaultBuilding().frames.length - 1;
    const perPlane = (pl: string) => d.members.filter((m) => m.purlin?.side === pl).length - 1;
    expect(rods.length).toBe(nb * 2 * (perPlane('L') + perPlane('R')));
    expect(rods.every((m) => m.profile === 'RD8')).toBe(true);
    const c = d.connections.find((x) => x.id.startsWith('C.SR.'))!;
    expect((c.holes ?? []).length).toBe(perPlane('L') + 1);
    noClash(d);
  });
  it('FB: תמיכה צידית — 2 זוויתנים בכל פטה שנייה בכל קורה, ללא התנגשות מול הקורה, הפטה והתומך', () => {
    const d = gen((b) => { b.bracing.flyBraces = defaultFlyBraces(); });
    const fb = d.members.filter((m) => m.id.startsWith('FB.'));
    expect(fb.length).toBeGreaterThan(0);
    expect(fb.length % 2).toBe(0);
    noClash(d);
    // הזוויתן מול הקורה, הפטה והתומכים
    const near = d.members.filter((m) => ['rafter', 'purlin', 'cleat', 'plate', 'column'].includes(m.kind) && !m.connId?.startsWith('C.FB.'));
    const hits = fb.slice(0, 40).flatMap((a) => near.filter((o) => Math.abs(o.start.x - a.start.x) < 1500 && Math.abs((o.start.y + o.end.y) / 2 - a.start.y) < 3000 || o.kind === 'purlin').map((o) => [a.id, o.id, clash(a, o)?.depth ?? 0] as const)).filter((h) => h[2] > 0.5);
    expect(hits).toEqual([]);
  });
  it('LT: סיב רציף בשני צירי הקיר בכל המפתחים, פח + לשונית לעמוד', () => {
    const d = gen((b) => { b.bracing.walls.enabled = false; b.bracing.lineTies = defaultLineTies(['L', 'R']); });
    const nb = defaultBuilding().frames.length - 1;
    expect(d.members.filter((m) => m.id.startsWith('LTIE.')).length).toBe(2 * nb);
    expect(d.connections.filter((c) => c.id.startsWith('C.LTIE.')).every((c) => c.parts.some((p) => p.endsWith('.T')))).toBe(true);
    noClash(d);
  });
  it('PILE: בסיס בכלונס — ללא פלטה ועיגון, העמוד מוארך בעומק ההטמנה', () => {
    const d0 = gen(() => {});
    const d = gen((b) => { void b; });
    const p = newProject('t', defaultBuilding());
    p.connectionDefaults.base = { ...p.connectionDefaults.base, mode: 'pile', pileEmbed: 800 };
    const dp = generate(p);
    const col0 = d0.byId.get('F1.COL.L')!, col = dp.byId.get('F1.COL.L')!;
    expect(col0.start.z - col.start.z).toBeCloseTo(800, 0);
    expect(dp.members.some((m) => m.kind === 'anchor')).toBe(false);
    expect(dp.connections.filter((c) => c.type === 'base').every((c) => c.parts.length === 0 && /כלונס/.test(c.label))).toBe(true);
    void d;
    noClash(dp);
  });
});
