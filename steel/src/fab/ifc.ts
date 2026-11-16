/**
 * ייצוא IFC4 (בקשת משתמש 16.11.2026): כל אלמנט כגוף משולשים מדויק (IfcTriangulatedFaceSet) — כולל חיתוכי קצה,
 * עם סוג IFC לפי תפקיד (עמוד/קורה/אלמנט/פלטה/מחבר), חומר, וסט מאפיינים (סימון, חתך, משקל, מכלול).
 * מיועד לפתיחה ב-Tekla / Revit / BIMcollab / צופי IFC. יחידות מ"מ.
 */
import { memberSolid } from '../geometry/solid';
import { massPerMeter, tryProfile } from '../profiles/library';
import { getMaterial } from '../profiles/materials';
import type { DerivedModel, Member, Project } from '../model/types';
import type { Fabrication } from './marks';

const B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  let n = 0n; for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = ''; for (let i = 0; i < 22; i++) { s = B64[Number(n & 63n)] + s; n >>= 6n; }
  return s;
}
/** מחרוזת IFC: תווים לא-ASCII בקידוד \X2\ (UTF-16 hex) */
function str(s: string): string {
  let out = '';
  for (const ch of s.replace(/'/g, "''")) {
    const c = ch.codePointAt(0)!;
    out += c < 128 ? ch : `\\X2\\${c.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
  }
  return `'${out}'`;
}
const f = (n: number) => { const s = n.toFixed(2); return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '.') : `${s}.`; };

const TYPE: Record<string, string> = { column: 'IFCCOLUMN', rafter: 'IFCBEAM', beam: 'IFCBEAM', purlin: 'IFCMEMBER', girt: 'IFCMEMBER', brace: 'IFCMEMBER', cleat: 'IFCPLATE', plate: 'IFCPLATE', anchor: 'IFCMECHANICALFASTENER', bolt: 'IFCMECHANICALFASTENER' };

export function projectToIfc(p: Project, d: DerivedModel, fab: Fabrication): string {
  const L: string[] = [];
  let id = 0;
  const e = (s: string) => { id++; L.push(`#${id}=${s};`); return `#${id}`; };
  const now = Math.floor(Date.now() / 1000);
  const person = e(`IFCPERSON($,${str(p.meta.designer || 'Designer')},$,$,$,$,$,$)`);
  const org = e(`IFCORGANIZATION($,${str('Kayan Engineering')},$,$,$)`);
  const po = e(`IFCPERSONANDORGANIZATION(${person},${org},$)`);
  const app = e(`IFCAPPLICATION(${org},'1.16','KAYAN STEEL PRO','KSP')`);
  const owner = e(`IFCOWNERHISTORY(${po},${app},$,.ADDED.,${now},${po},${app},${now})`);
  const origin = e('IFCCARTESIANPOINT((0.,0.,0.))');
  const zdir = e('IFCDIRECTION((0.,0.,1.))'), xdir = e('IFCDIRECTION((1.,0.,0.))');
  const ax = e(`IFCAXIS2PLACEMENT3D(${origin},${zdir},${xdir})`);
  const ctx = e(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${ax},$)`);
  const body = e(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${ctx},$,.MODEL_VIEW.,$)`);
  const uLen = e('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const uArea = e('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = e('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uMass = e('IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.)');
  const uAng = e('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = e(`IFCUNITASSIGNMENT((${uLen},${uArea},${uVol},${uMass},${uAng}))`);
  const proj = e(`IFCPROJECT('${guid()}',${owner},${str(p.meta.name)},${str(p.meta.number || '')},$,$,$,(${ctx}),${units})`);
  const lp0 = e(`IFCLOCALPLACEMENT($,${ax})`);
  const site = e(`IFCSITE('${guid()}',${owner},${str('Site')},$,$,${lp0},$,$,.ELEMENT.,$,$,$,$,$)`);
  const lpB = e(`IFCLOCALPLACEMENT(${lp0},${ax})`);
  const bld = e(`IFCBUILDING('${guid()}',${owner},${str(p.meta.name)},$,$,${lpB},$,$,.ELEMENT.,$,$,$)`);
  const lpS = e(`IFCLOCALPLACEMENT(${lpB},${ax})`);
  const st = e(`IFCBUILDINGSTOREY('${guid()}',${owner},${str('±0.00')},$,$,${lpS},$,$,.ELEMENT.,0.)`);
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${proj},(${site}))`);
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${site},(${bld}))`);
  e(`IFCRELAGGREGATES('${guid()}',${owner},$,$,${bld},(${st}))`);
  const lpEl = e(`IFCLOCALPLACEMENT(${lpS},${ax})`);
  const mats = new Map<string, string>();
  const matOf = (mid: string) => { let r = mats.get(mid); if (!r) { r = e(`IFCMATERIAL(${str(mid)},$,'Steel')`); mats.set(mid, r); } return r; };
  const byMat = new Map<string, string[]>();
  const els: string[] = [];
  const partOf = new Map(fab.parts.map((x) => [x.memberId, x]));
  const asmOf = new Map(fab.assemblies.map((a) => [a.id, a.mark]));
  const members: Member[] = d.members.filter((m) => m.kind !== 'bolt' || m.id.endsWith('.S'));
  for (const m of members) {
    let s; try { s = memberSolid(m); } catch { continue; }
    if (!s.tris.length) continue;
    // אינדוקס נקודות משותפות
    const key = new Map<string, number>(); const pts: string[] = []; const idx: string[] = [];
    const tri: number[] = [];
    for (let i = 0; i < s.tris.length; i += 3) {
      const k = `${s.tris[i].toFixed(1)},${s.tris[i + 1].toFixed(1)},${s.tris[i + 2].toFixed(1)}`;
      let n = key.get(k);
      if (n === undefined) { n = pts.length + 1; key.set(k, n); pts.push(`(${f(s.tris[i])},${f(s.tris[i + 1])},${f(s.tris[i + 2])})`); }
      tri.push(n);
    }
    for (let i = 0; i < tri.length; i += 3) if (tri[i] !== tri[i + 1] && tri[i + 1] !== tri[i + 2] && tri[i] !== tri[i + 2]) idx.push(`(${tri[i]},${tri[i + 1]},${tri[i + 2]})`);
    if (!idx.length) continue;
    const pl = e(`IFCCARTESIANPOINTLIST3D((${pts.join(',')}),$)`);
    const fs = e(`IFCTRIANGULATEDFACESET(${pl},$,.T.,(${idx.join(',')}),$)`);
    const rep = e(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${fs}))`);
    const pds = e(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
    const pt = partOf.get(m.id);
    const mark = pt?.mark ?? m.id;
    const T = TYPE[m.kind] ?? 'IFCMEMBER';
    const pred = T === 'IFCCOLUMN' ? '.COLUMN.' : T === 'IFCBEAM' ? '.BEAM.' : T === 'IFCPLATE' ? '.SHEET.' : T === 'IFCMECHANICALFASTENER' ? (m.kind === 'anchor' ? '.ANCHORBOLT.' : '.BOLT.') : m.kind === 'purlin' ? '.PURLIN.' : m.kind === 'brace' ? '.BRACE.' : m.kind === 'girt' ? '.MEMBER.' : '.NOTDEFINED.';
    const el = T === 'IFCMECHANICALFASTENER'
      ? e(`${T}('${guid()}',${owner},${str(mark)},${str(m.label)},${str(m.profile)},${lpEl},${pds},${str(m.id)},$,$,${pred})`)
      : e(`${T}('${guid()}',${owner},${str(mark)},${str(m.label)},${str(m.profile)},${lpEl},${pds},${str(m.id)},${pred})`);
    els.push(el);
    byMat.set(m.material, [...(byMat.get(m.material) ?? []), el]);
    // מאפיינים
    const pr = tryProfile(m.profile);
    const w = pt?.weight ?? (pr ? (massPerMeter(pr, getMaterial(m.material).density) * Math.hypot(m.end.x - m.start.x, m.end.y - m.start.y, m.end.z - m.start.z)) / 1000 : 0);
    const props = [
      e(`IFCPROPERTYSINGLEVALUE('Mark',$,IFCLABEL(${str(mark)}),$)`),
      e(`IFCPROPERTYSINGLEVALUE('Assembly',$,IFCLABEL(${str(pt ? asmOf.get(pt.assembly) ?? '' : '')}),$)`),
      e(`IFCPROPERTYSINGLEVALUE('Profile',$,IFCLABEL(${str(m.profile)}),$)`),
      e(`IFCPROPERTYSINGLEVALUE('Material',$,IFCLABEL(${str(m.material)}),$)`),
      e(`IFCPROPERTYSINGLEVALUE('Weight',$,IFCMASSMEASURE(${f(w)}),$)`),
      e(`IFCPROPERTYSINGLEVALUE('Finish',$,IFCLABEL('HDG ISO 1461'),$)`),
    ];
    const ps = e(`IFCPROPERTYSET('${guid()}',${owner},'KSP_Fabrication',$,(${props.join(',')}))`);
    e(`IFCRELDEFINESBYPROPERTIES('${guid()}',${owner},$,$,(${el}),${ps})`);
  }
  e(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid()}',${owner},$,$,(${els.join(',')}),${st})`);
  for (const [mid, list] of byMat) e(`IFCRELASSOCIATESMATERIAL('${guid()}',${owner},$,$,(${list.join(',')}),${matOf(mid)})`);
  const ts = new Date().toISOString().slice(0, 19);
  return [
    'ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${str(p.meta.name)},'${ts}',(${str(p.meta.designer || '')}),('Kayan'),'KAYAN STEEL PRO','KAYAN STEEL PRO','');`,
    "FILE_SCHEMA(('IFC4'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', '',
  ].join('\n');
}
