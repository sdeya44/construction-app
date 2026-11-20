import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { DerivedModel, Member, Project } from '../model/types';
import type { Vec3 } from '../core/vec';
import { buildModel, groupColor } from './scene';

/**
 * 1.55: תצוגה ריאליסטית של רכיב — פלדה עם השתקפויות (סביבת חדר), שמש עם צללים רכים, קרקע ושמיים.
 * משמשת את התצוגה החיה בחלון הרכיב ואת התמונות באריחי הסוג. מקבלת את אלמנטי המודל עצמו (DerivedModel) —
 * מה שרואים כאן הוא בדיוק מה שהמנוע מייצר.
 */
export interface RealTag { a: Vec3; b: Vec3; text: string; hot?: boolean; /** מיקום התגית (ברירת מחדל: אמצע הקטע) */ at?: Vec3;
  /** 1.56: תגית מידה עם נעילה — לחיצה על המנעול קובעת שהמידה הזו נקבעת (והשאר נגזרות) */ lock?: boolean; onLock?: () => void; id?: string }
export interface RealSet {
  /** הרכיב עצמו (צבע הקבוצה) + חלקי החיבור שלו */
  focus: Member[];
  /** המבנה סביב (עמודים, קורות, חגורות) — אפור פלדה */
  context: Member[];
  /** אלמנטים משניים שקופים למחצה (חגורות קיר, פטות) */
  ghost?: Member[];
  tags?: RealTag[];
  /** כיוון מבט התחלתי: זווית אופקית (רדיאנים, 0 = ממינוס Y) והגבהה */
  dir?: { th: number; ph: number };
  key: string;
}

const PLATE = 0xb9c3cc, BOLT = 0x2b3036, STEEL = 0x76838f;
const brighten = (hex: number, k: number) => { const c = new THREE.Color(hex); c.offsetHSL(0, 0.08, k); return c.getHex(); };

export interface BuiltScene { scene: THREE.Scene; box: THREE.Box3; focusBox: THREE.Box3; dispose(): void }

let skyTex: THREE.Texture | null = null;
function sky(): THREE.Texture {
  if (skyTex) return skyTex;
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
  const g = cv.getContext('2d')!; const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#c9d8e6'); gr.addColorStop(0.55, '#e8edf2'); gr.addColorStop(1, '#f4f1ea');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  skyTex = new THREE.CanvasTexture(cv); skyTex.colorSpace = THREE.SRGBColorSpace;
  return skyTex;
}
let groundTex: THREE.Texture | null = null;
function groundMap(): THREE.Texture {
  if (groundTex) return groundTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d')!; const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, '#e4e0d6'); gr.addColorStop(0.7, '#ebe8e1'); gr.addColorStop(1, '#f4f1ea');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  groundTex = new THREE.CanvasTexture(cv); groundTex.colorSpace = THREE.SRGBColorSpace;
  return groundTex;
}

export function buildRealScene(set: RealSet, envTex: THREE.Texture | null, shadowSize = 2048): BuiltScene {
  const scene = new THREE.Scene();
  const disp: { dispose(): void }[] = [];
  scene.background = sky();
  if (envTex) { scene.environment = envTex; scene.environmentIntensity = 0.75; }
  const focusIds = new Set(set.focus.map((m) => m.id));
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide }); disp.push(solidMat);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x1c242c, transparent: true, opacity: 0.22 }); disp.push(edgeMat);
  const colorOf = (m: Member) => {
    if (m.kind === 'bolt' || m.kind === 'anchor') return BOLT;
    if (m.kind === 'plate' || m.kind === 'cleat') return PLATE;
    if (focusIds.has(m.id)) return brighten(groupColor(m) ?? 0x3e9bb3, 0.04);
    return STEEL;
  };
  const solid = [...set.context, ...set.focus];
  const box = new THREE.Box3(), focusBox = new THREE.Box3();
  if (solid.length) {
    const b = buildModel(solid, solidMat, edgeMat, colorOf);
    b.mesh.castShadow = true; b.mesh.receiveShadow = true;
    scene.add(b.mesh, b.edges); disp.push(b.mesh.geometry, b.edges.geometry);
    box.copy(b.box);
  }
  if (set.focus.length) { const fb = buildModel(set.focus, solidMat, edgeMat); focusBox.copy(fb.box); fb.mesh.geometry.dispose(); fb.edges.geometry.dispose(); } else focusBox.copy(box);
  if (set.ghost?.length) {
    const gm = new THREE.MeshStandardMaterial({ color: 0x9aa6b2, metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }); disp.push(gm);
    const ge = new THREE.LineBasicMaterial({ color: 0x5a6672, transparent: true, opacity: 0.12 }); disp.push(ge);
    const g = buildModel(set.ghost, gm, ge, () => 0x9aa6b2);
    (g.mesh.material as THREE.MeshStandardMaterial).vertexColors = false;
    scene.add(g.mesh, g.edges); disp.push(g.mesh.geometry, g.edges.geometry);
    box.union(g.box);
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-1000, -1000, 0), new THREE.Vector3(1000, 1000, 2000));
  const ctr = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  const R = Math.max(800, size.length() / 2);
  // קרקע: משטח בהיר עם צל רך; גובה — תחתית המבנה (או מעט מתחת לרכיב, אם הוא גבוה)
  const zG = Math.min(box.min.z, focusBox.isEmpty() ? box.min.z : focusBox.min.z) - 5;
  const gG = new THREE.CircleGeometry(R * 3.2, 64); disp.push(gG);
  const gMat = new THREE.MeshStandardMaterial({ map: groundMap(), roughness: 1, metalness: 0 }); disp.push(gMat);
  const ground = new THREE.Mesh(gG, gMat); ground.position.set(ctr.x, ctr.y, zG); ground.receiveShadow = true;
  // קרקע רק כשמוצג המבנה עד הבסיס (בצומת גבוה — בלי רצפה שמרחפת באוויר)
  if (box.min.z < 400) scene.add(ground);
  // אור: שמיים + שמש עם צללים
  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0xb9b3a4, 0.9));
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.1);
  sun.position.set(ctr.x - R * 1.2, ctr.y - R * 1.6, ctr.z + R * 2.6); sun.target.position.copy(ctr);
  sun.castShadow = true; sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera; sc.left = -R * 1.5; sc.right = R * 1.5; sc.top = R * 1.5; sc.bottom = -R * 1.5; sc.near = 10; sc.far = R * 8; sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = R * 0.0008; sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.45); fill.position.set(ctr.x + R * 2, ctr.y + R, ctr.z + R); scene.add(fill);
  return { scene, box, focusBox, dispose: () => { for (const x of disp) x.dispose(); sun.shadow.map?.dispose(); } };
}

/** מצלמה שמציגה את התיבה מכיוון (th, ph) בזווית ראייה 30° */
export function fitCamera(cam: THREE.PerspectiveCamera, box: THREE.Box3, th: number, ph: number, zoom = 1) {
  const ctr = box.getCenter(new THREE.Vector3());
  const R = Math.max(600, box.getSize(new THREE.Vector3()).length() / 2);
  const dist = (R / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * (cam.aspect < 1 ? 1.15 / Math.max(0.55, cam.aspect) : 0.92) / zoom;
  cam.position.set(ctr.x + dist * Math.cos(ph) * Math.sin(th), ctr.y - dist * Math.cos(ph) * Math.cos(th), ctr.z + dist * Math.sin(ph));
  cam.near = Math.max(5, dist / 200); cam.far = dist * 20; cam.updateProjectionMatrix();
  cam.lookAt(ctr);
}

/** מרנדר ריאליסטי: WebGLRenderer עם צללים רכים, ACES וסביבת חדר להשתקפויות */
export class RealRenderer {
  R: THREE.WebGLRenderer;
  env: THREE.Texture | null = null;
  constructor(canvas?: HTMLCanvasElement) {
    this.R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: !canvas });
    this.R.shadowMap.enabled = true; this.R.shadowMap.type = THREE.PCFSoftShadowMap;
    this.R.toneMapping = THREE.ACESFilmicToneMapping; this.R.toneMappingExposure = 1.05;
    this.R.outputColorSpace = THREE.SRGBColorSpace;
    try { const pm = new THREE.PMREMGenerator(this.R); const room = new RoomEnvironment(); this.env = pm.fromScene(room, 0.04).texture; room.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); pm.dispose(); } catch { this.env = null; }
  }
  dispose() { this.env?.dispose(); this.R.dispose(); }
}

// ---------------- תמונות ממוזערות (אריחי סוג) ----------------
let thumbR: RealRenderer | null = null;
const thumbCache = new Map<string, string>();
/** תמונה ריאליסטית של קבוצת אלמנטים (data-URL). מטמון לפי מפתח. */
export function renderThumb(set: RealSet, w = 360, h = 240): string {
  const hit = thumbCache.get(set.key); if (hit) return hit;
  try {
    thumbR ??= new RealRenderer();
    const r = thumbR.R;
    r.setPixelRatio(1); r.setSize(w, h, false);
    const built = buildRealScene(set, thumbR.env, 1024);
    const cam = new THREE.PerspectiveCamera(30, w / h, 10, 1e6); cam.up.set(0, 0, 1);
    const fb = built.box;
    fitCamera(cam, fb, set.dir?.th ?? -0.55, set.dir?.ph ?? 0.32, 1.05);
    r.render(built.scene, cam);
    const url = r.domElement.toDataURL('image/jpeg', 0.86);
    built.dispose();
    if (thumbCache.size > 80) thumbCache.clear();
    thumbCache.set(set.key, url);
    return url;
  } catch { return ''; }
}

// ---------------- בחירת האלמנטים להצגה ----------------
const mid = (m: Member) => ({ x: (m.start.x + m.end.x) / 2, y: (m.start.y + m.end.y) / 2, z: (m.start.z + m.end.z) / 2 });
const sub = (a: Vec3, b: Vec3) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
/** קיצוץ אלמנט ארוך לקטע שבתוך תיבה (לפי פרמטר לאורכו) */
function cropTo(m: Member, keep: (p: Vec3) => boolean): Member | null {
  const d = sub(m.end, m.start), L = len(d); if (L < 1) return null;
  let a = -1, b = -1; const N = 40;
  for (let i = 0; i <= N; i++) { const t = i / N; const p = { x: m.start.x + d.x * t, y: m.start.y + d.y * t, z: m.start.z + d.z * t }; if (keep(p)) { if (a < 0) a = t; b = t; } }
  if (a < 0) return null;
  if (a <= 0 && b >= 1) return m;
  const at = (t: number) => ({ x: m.start.x + d.x * t, y: m.start.y + d.y * t, z: m.start.z + d.z * t });
  return { ...m, start: at(a), end: at(b), startCut: a > 0 ? undefined : m.startCut, endCut: b < 1 ? undefined : m.endCut };
}
/** חלקי החיבור (פלטות, ברגים) של קבוצת אלמנטים */
export function connParts(d: DerivedModel, ids: string[]): Member[] {
  const S = new Set(ids), out: Member[] = [], seen = new Set<string>();
  for (const c of d.connections) {
    if (!c.members.some((x) => S.has(x))) continue;
    for (const pid of [...c.parts, ...c.bolts.flatMap((b) => [`${b.id}.H`, `${b.id}.S`, `${b.id}.N`])]) {
      const m = d.byId.get(pid); if (m && !seen.has(pid)) { seen.add(pid); out.push(m); }
    }
  }
  return out;
}

export const WALL_RE = /^(BR\.W|BB\.|LT\.)/;
export const wallLineOf = (id: string) => /^(?:BR\.W\d+|BB\.\d+|LT\.\d+)\.([^.]+)/.exec(id)?.[1];

/** קשיחות קירות: מפתח אחד (או כל הקיר) בציר, עם העמודים, קצות הקורות וחגורות הקיר */
export function wallSet(p: Project, d: DerivedModel, opt: { memberId?: string; whole?: boolean } = {}): RealSet | null {
  const comp = d.members.filter((m) => WALL_RE.test(m.id) && m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat');
  if (!comp.length) return null;
  const lines = d.section?.lines ?? [];
  const sel = opt.memberId ? d.byId.get(opt.memberId) : undefined;
  const lineId = (sel && wallLineOf(sel.id)) ?? wallLineOf(comp[0].id);
  const line = lines.find((l) => l.id === lineId);
  const onLine = comp.filter((m) => wallLineOf(m.id) === lineId);
  const lx = line?.x ?? mid(onLine[0] ?? comp[0]).x;
  const fys = p.building.frames.map((f) => f.y).sort((a, b) => a - b);
  const ref = mid(sel && WALL_RE.test(sel.id) ? sel : onLine[0] ?? comp[0]);
  let bi = fys.findIndex((y, i) => i < fys.length - 1 && ref.y >= y - 1 && ref.y <= fys[i + 1] + 1); if (bi < 0) bi = 0;
  const y0 = opt.whole ? fys[0] : fys[bi], y1 = opt.whole ? fys[fys.length - 1] : fys[Math.min(fys.length - 1, bi + 1)];
  const inBay = (q: Vec3, pad = 1) => q.y >= y0 - pad && q.y <= y1 + pad;
  const focusMain = onLine.filter((m) => inBay(mid(m)) || (opt.whole));
  const focus = [...focusMain, ...connParts(d, focusMain.map((m) => m.id))];
  const near = (q: Vec3) => Math.abs(q.x - lx) < 400;
  const context: Member[] = [], ghost: Member[] = [];
  for (const m of d.members) {
    if (WALL_RE.test(m.id) || m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor') continue;
    if (m.kind === 'column') { if (near(m.start) && inBay(m.start)) context.push(m); continue; }
    if (m.kind === 'rafter') { if (inBay(m.start)) { const c = cropTo(m, (q) => Math.abs(q.x - lx) < 2600 && inBay(q, 1)); if (c) context.push(c); } continue; }
    if (m.kind === 'girt' || m.kind === 'beam' || m.kind === 'purlin') {
      if (near(m.start) && near(m.end)) { const c = cropTo(m, (q) => inBay(q, 700)); if (c) (m.kind === 'beam' ? context : ghost).push(c); }
    }
  }
  const tags: RealTag[] = [];
  const zb = Math.min(...context.filter((m) => m.kind === 'column').map((m) => Math.min(m.start.z, m.end.z)), 0);
  if (!opt.whole) tags.push({ a: { x: lx, y: y0, z: zb }, b: { x: lx, y: y1, z: zb }, text: ((y1 - y0) / 1000).toFixed(2) });
  const main = [...focusMain].sort((a, b) => len(sub(b.end, b.start)) - len(sub(a.end, a.start)))[0];
  if (main) tags.push({ a: main.start, b: main.end, text: main.profile, hot: true });
  const side = (line && lines.length && line.x <= Math.min(...lines.map((l) => l.x)) + 1) ? -1 : 1;
  return { focus, context, ghost, tags, dir: { th: side < 0 ? -1.0 : 1.0, ph: 0.22 }, key: `w|${lineId}|${bi}|${opt.whole ? 1 : 0}` };
}

export const KNEE_RE = /^KB\./;
/** אלכסוני עמוד-קורה: הצומת (עמוד + קצה הקורה + האלכסונים שבו) או המסגרת כולה */
export function kneeSet(p: Project, d: DerivedModel, opt: { memberId?: string; frame?: boolean } = {}): RealSet | null {
  const kbs = d.members.filter((m) => KNEE_RE.test(m.id) && m.kind !== 'plate' && m.kind !== 'bolt' && m.kind !== 'cleat');
  if (!kbs.length) return null;
  const sel = opt.memberId ? d.byId.get(opt.memberId) : undefined;
  const ref = sel && KNEE_RE.test(sel.id) ? sel : kbs[0];
  const frameOf = (m: Member) => m.frameId ?? /^KB\.([^.]+)/.exec(m.id)?.[1];
  const fid = frameOf(ref);
  // נקודת העמוד: הקצה הנמוך של האלכסון
  const P = ref.start.z < ref.end.z ? ref.start : ref.end;
  let focusMain: Member[], context: Member[] = [];
  if (opt.frame) {
    focusMain = kbs.filter((m) => frameOf(m) === fid);
    context = d.members.filter((m) => m.frameId === fid && (m.kind === 'column' || m.kind === 'rafter' || m.kind === 'beam') && !KNEE_RE.test(m.id));
  } else {
    focusMain = kbs.filter((m) => frameOf(m) === fid && Math.hypot(...['x', 'y', 'z'].map((k) => (mid(m) as never)[k] - (mid(ref) as never)[k]) as [number, number, number]) < 2500);
    const box = (q: Vec3) => Math.abs(q.y - P.y) < 700 && Math.abs(q.x - P.x) < 2000 && q.z > P.z - 1000 && q.z < P.z + 2000;
    for (const m of d.members) {
      if (KNEE_RE.test(m.id) || m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor') continue;
      if (m.kind !== 'column' && m.kind !== 'rafter' && m.kind !== 'beam') continue;
      if (m.frameId && m.frameId !== fid) continue;
      const c = cropTo(m, box); if (c) context.push(c);
    }
  }
  const focus = [...focusMain, ...connParts(d, focusMain.map((m) => m.id))];
  const tags: RealTag[] = [];
  const kb = p.building.kneeBraces;
  const top = ref.start.z < ref.end.z ? ref.end : ref.start;
  if (!opt.frame && kb) {
    const dz = top.z - P.z, dh = Math.hypot(top.x - P.x, top.y - P.y);
    const ang = Math.round((Math.atan2(dz, dh) * 180) / Math.PI);
    const inw = Math.sign(top.x - P.x) || 1, off = { x: P.x - inw * 450, y: P.y, z: P.z };
    tags.push({ a: off, b: { ...off, z: P.z + (kb.drop ?? 0) }, text: `ירידה ${Math.round(kb.drop)}`, hot: true, at: { ...off, x: off.x - inw * 250, z: P.z + (kb.drop ?? 0) * 0.35 } });
    tags.push({ a: P, b: top, text: `${ang}° · ${ref.profile}`, hot: true, at: { x: P.x + (top.x - P.x) * 0.8 + inw * 300, y: P.y, z: P.z + (top.z - P.z) * 0.8 - 250 } });
  }
  if (opt.frame) { const xs = context.filter((m) => m.kind === 'column').map((m) => m.start.x); if (xs.length > 1) tags.push({ a: { x: Math.min(...xs), y: P.y, z: 0 }, b: { x: Math.max(...xs), y: P.y, z: 0 }, text: ((Math.max(...xs) - Math.min(...xs)) / 1000).toFixed(2) }); }
  const inward = sel ? Math.sign(top.x - P.x) || 1 : 1;
  return { focus, context, tags, dir: opt.frame ? { th: -0.35, ph: 0.18 } : { th: inward > 0 ? -0.5 : 0.5, ph: 0.2 }, key: `k|${fid}|${opt.frame ? 'F' : ref.id}` };
}

/**
 * 1.58: תצוגה ריאליסטית כללית לכל משפחת רכיבים (אשף אחיד): הרכיב סביב האלמנט שנבחר (או כולו — wide),
 * עם המבנה הראשי שסביבו כהקשר והפטות/חגורות שקופות. match — אילו אלמנטים שייכים לרכיב.
 */
export function familySet(_p: Project, d: DerivedModel, match: (m: Member) => boolean, opt: { memberId?: string; wide?: boolean; key: string; radius?: number }): RealSet | null {
  const isPartK = (m: Member) => m.kind === 'plate' || m.kind === 'bolt' || m.kind === 'cleat' || m.kind === 'anchor';
  const own = d.members.filter((m) => match(m) && !isPartK(m));
  const ownParts = d.members.filter((m) => match(m) && isPartK(m));
  if (!own.length && !ownParts.length) return null;
  const sel = opt.memberId ? d.byId.get(opt.memberId) : undefined;
  const ref = sel && match(sel) ? sel : own[0] ?? ownParts[0];
  const R = opt.radius ?? 3500;
  const c0 = mid(ref);
  const near = (m: Member) => { const q = mid(m); return Math.hypot(q.x - c0.x, q.y - c0.y, q.z - c0.z) < R; };
  const LIM = 260;
  const focusMain = (opt.wide ? own : own.filter(near)).slice(0, LIM);
  const focus = [...focusMain, ...(opt.wide && own.length > 120 ? [] : connParts(d, focusMain.map((m) => m.id))), ...ownParts.filter((m) => opt.wide ? own.length <= 120 : near(m)).slice(0, 400)];
  if (!focus.length) return null;
  const bx = new THREE.Box3();
  for (const m of focus) { bx.expandByPoint(new THREE.Vector3(m.start.x, m.start.y, m.start.z)); bx.expandByPoint(new THREE.Vector3(m.end.x, m.end.y, m.end.z)); }
  const pad = opt.wide ? 600 : 1500;
  const inBox = (q: Vec3) => q.x >= bx.min.x - pad && q.x <= bx.max.x + pad && q.y >= bx.min.y - pad && q.y <= bx.max.y + pad && q.z >= bx.min.z - pad && q.z <= bx.max.z + pad;
  const context: Member[] = [], ghost: Member[] = [];
  const fid = new Set(focus.map((m) => m.id));
  for (const m of d.members) {
    if (fid.has(m.id) || match(m) || isPartK(m)) continue;
    const main = m.kind === 'column' || m.kind === 'rafter' || m.kind === 'beam';
    if (!main && m.kind !== 'purlin' && m.kind !== 'girt') continue;
    if (opt.wide && !main) continue;
    const c = cropTo(m, inBox); if (!c) continue;
    (main ? context : ghost).push(c);
    if (context.length > 400) break;
  }
  const tags: RealTag[] = [];
  const main = [...focusMain].sort((a, b) => len(sub(b.end, b.start)) - len(sub(a.end, a.start)))[0];
  if (main && !opt.wide) tags.push({ a: main.start, b: main.end, text: main.profile, hot: true });
  return { focus, context, ghost, tags, dir: { th: -0.55, ph: opt.wide ? 0.45 : 0.3 }, key: `f|${opt.key}|${opt.wide ? 'W' : ref.id}` };
}
