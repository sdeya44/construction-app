import { expect, it } from 'vitest';
import { defaultBuilding, defaultRidgeReinf, newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { defaultKneeBraces } from '../src/geometry/knee';
import { defaultCladding } from '../src/geometry/cladding';
import { defaultHaunch } from '../src/geometry/haunch';
import { defaultPortal } from '../src/geometry/portal';
import { defaultLockTruss } from '../src/geometry/lockTruss';
import { defaultWing } from '../src/geometry/wing';
import { defaultTrussSpec } from '../src/geometry/truss';
import { defaultRhsTruss } from '../src/geometry/hbrace';
import { SECTION_TEMPLATES } from '../src/model/section';
import { auditContacts } from '../src/geometry/audit';
it('AUD-01: בקרת אורכים ומגעים — כל ריתוך נוגע, כל בורג עובר בחלקים, במגוון מבנים וחיבורים', () => {
  const tally = new Map<string, { n: number; ex: string }>();
  const models: [string, any, ((p: any) => void)?][] = [];
  const B = () => defaultBuilding() as any;
  for (const t of SECTION_TEMPLATES) { const b = B(); b.section = t.make(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.bracing.roof.enabled = true; models.push([t.id, b]); }
  { const b = B(); b.kneeBraces = { ...defaultKneeBraces(), enabled: true }; b.cladding = defaultCladding(); b.bracing.roof.enabled = true; models.push(['full', b]); }
  { const b = B(); b.roofType = 'mono'; b.eaveRight = 7200; b.cladding = defaultCladding(); models.push(['mono', b]); }
  { const b = B(); b.haunch = defaultHaunch(); b.ridgeReinf = { ...defaultRidgeReinf(), type: 'plate' }; models.push(['haunch+ridge', b]); }
  { const b = B(); b.ridgeReinf = { ...defaultRidgeReinf(), type: 'tie' }; models.push(['ridgetie', b]); }
  { const b = B(); b.bracing.walls.type = 'portal'; b.bracing.walls.portal = defaultPortal(); models.push(['portal', b]); }
  { const b = B(); b.bracing.walls.type = 'portal'; b.bracing.walls.portal = { ...defaultPortal(), finOrient: 'vertical' }; models.push(['portalV', b]); }
  { const b = B(); b.bracing.walls.type = 'truss'; b.bracing.walls.truss = defaultLockTruss(); models.push(['lock', b]); }
  { const b = B(); b.bracing.roof.enabled = true; b.bracing.roof.type = 'rhs'; b.bracing.roof.rhs = defaultRhsTruss(); models.push(['roofRHS', b]); }
  { const b = B(); b.bracing.roof.enabled = true; b.bracing.roof.endDetail = 'rod'; b.bracing.roof.profile = 'L50x50x5'; models.push(['roofRod', b]); }
  { const b = B(); b.wing = defaultWing(b, 'gable'); models.push(['wing', b]); }
  { const b = B(); b.roofTruss = { enabled: true, frames: 'all', shape: 'flat', spec: defaultTrussSpec(8, 1500, { top: 'IPE300' }) }; models.push(['rooftruss', b]); }
  { const b = B(); b.width = 30000; b.ridgeX = 15000; b.eaveLeft = 13000; b.eaveRight = 13000; models.push(['welded', b, (p) => { p.settings.spliceJoint = { beams: 'welded', columns: 'welded' }; }]); }
  { const b = B(); b.width = 30000; b.ridgeX = 15000; b.eaveLeft = 13000; b.eaveRight = 13000; models.push(['bolted-splice', b]); }
  for (const prof of ['IPE600', 'HEB300']) for (const mono of [false, true]) for (const sup of ['A1', 'A2', 'A3', 'A4', 'A5']) for (const seat of ['B1', 'B2', 'B3']) { const b = B(); if (mono) { b.roofType = 'mono'; b.eaveRight = 7200; } const f = b.frames; b.transfers = [{ id: 'T1', lineId: mono ? 'R' : 'L', from: f[1].id, to: f[3].id, removed: [f[2].id], profile: prof, support: sup, seat }]; models.push([`tb-${prof}-${mono}-${sup}-${seat}`, b]); }
  for (const conn of ['fin', 'plate'] as const) for (const o of ['horizontal', 'vertical'] as const) for (const ch of ['RHS120x80x5', 'HEA160']) {
    const b = B(); const f = b.frames; const spec = { ...defaultTrussSpec(6, 1000), profiles: { ...defaultTrussSpec(6, 1000).profiles, top: ch, bottom: ch } };
    b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[3].id, removed: [f[1].id, f[2].id], profile: 'HEA160', support: 'A1', seat: 'B1', kind: 'truss', truss: spec, trussFit: 'between', trussConn: conn, finOrient: o }]; models.push([`tr-${conn}-${o}-${ch}`, b]);
  }
  { const b = B(); const f = b.frames; b.transfers = [{ id: 'T1', lineId: 'L', from: f[0].id, to: f[3].id, removed: [f[1].id, f[2].id], profile: 'HEA160', support: 'A1', seat: 'B1', kind: 'truss', truss: defaultTrussSpec(6, 1000) }]; models.push(['tr-top', b]); }
  { const b = B(); b.cladding = defaultCladding(); b.cladding.gutter.enabled = true; models.push(['gutter', b]); }
  { const b = B(); b.columnProfile = 'SHS200x200x8'; b.bracing.roof.enabled = true; models.push(['shs-col', b]); }
  for (const [name, b, mut] of models) {
    const p = newProject(name, b); mut?.(p);
    let d; try { d = generate(p); } catch (e) { console.log('ERR', name, String(e).slice(0, 100)); continue; }
    if (d.issues.some((i) => i.severity === 'error')) { if (!name.startsWith('tr-fin')) console.log('ERRMODEL', name); continue; }
    for (const f of auditContacts(d)) {
      const key = `${f.kind}|${f.conn.replace(/F\d+|\d+/g, '#')}|${f.a.replace(/F\d+|\d+/g, '#')}`;
      const r = tally.get(key) ?? { n: 0, ex: `${name}: ${f.message}` }; r.n++; tally.set(key, r);
    }
  }
  console.log('MODELS', models.length, 'TOTAL', [...tally.values()].reduce((s, r) => s + r.n, 0));
  for (const [k, r] of [...tally].sort((a, b) => b[1].n - a[1].n).slice(0, 60)) console.log('A', r.n, k, '::', r.ex.slice(0, 220));
  expect([...tally.values()].map((r) => r.ex)).toEqual([]);
}, 600000);
