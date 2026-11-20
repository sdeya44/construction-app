import { claddingTakeoff } from '../geometry/cladding';
import type { Member } from '../model/types';
import { sizingAll, SIZE_COLOR } from '../model/sizing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fromMm } from '../core/units';
import type { Vec3 } from '../core/vec';
import { store, type AppState, type ViewName } from '../store';
import { buildModel, cachedSolid, visibleMembers, type ModelBuffers } from './scene';

const DIRS: Record<ViewName, THREE.Vector3> = {
  iso: new THREE.Vector3(-0.85, -1.35, 0.95),
  front: new THREE.Vector3(0, -1, 0),
  back: new THREE.Vector3(0, 1, 0),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, -1e-4, 1),
};
export const VIEW_LABEL: Record<ViewName, string> = {
  iso: 'איזומטרי', front: 'חזית', back: 'אחור', left: 'שמאל', right: 'ימין', top: 'תוכנית',
};

interface Label { p: THREE.Vector3; text: string; cls: string; dir?: THREE.Vector3; edit?: string; value?: number }

class Pane {
  el: HTMLDivElement;
  labelLayer: HTMLDivElement;
  axes: SVGSVGElement;
  title: HTMLDivElement;
  persp = new THREE.PerspectiveCamera(35, 1, 10, 1e7);
  ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e7, 1e7);
  controls!: OrbitControls;
  projection: 'ortho' | 'persp';
  rect = { x: 0, y: 0, w: 1, h: 1 };
  orthoHalfH = 10000;
  labelPool: HTMLDivElement[] = [];
  down?: { x: number; y: number; t: number; b: number };
  lastPick?: { x: number; y: number; ids: string[]; i: number; /** הלחיצה הקודמת פגעה במזחלה שלפני האלמנטים */ gutter?: boolean };

  constructor(public vp: Viewport, public view: ViewName, projection: 'ortho' | 'persp') {
    this.projection = projection;
    this.el = document.createElement('div');
    this.el.className = 'vp-pane';
    this.el.dataset.view = view;
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'vp-labels';
    this.axes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.axes.setAttribute('class', 'vp-axes');
    this.axes.setAttribute('viewBox', '-40 -40 80 80');
    this.title = document.createElement('div');
    this.title.className = 'vp-title';
    this.el.append(this.labelLayer, this.axes, this.title);
    for (const c of [this.persp, this.ortho]) c.up.set(0, 0, 1);
    this.makeControls();
    this.el.addEventListener('pointerdown', (e) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
    this.el.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // מידה ניתנת לעריכה: לחיצה על התווית (לא מעבירה בחירה למודל)
    const isEdit = (e: Event) => (e.target as HTMLElement)?.dataset?.edit;
    this.labelLayer.addEventListener('pointerdown', (e) => { if (isEdit(e)) e.stopPropagation(); });
    this.labelLayer.addEventListener('pointerup', (e) => {
      const t = e.target as HTMLElement;
      if (!t?.dataset?.edit) return;
      e.stopPropagation();
      this.vp.onDimEdit?.(t.dataset.edit, Number(t.dataset.value), e.clientX, e.clientY);
    });
  }

  get camera(): THREE.Camera { return this.projection === 'ortho' ? this.ortho : this.persp; }

  makeControls() {
    const old = this.controls;
    const target = old ? old.target.clone() : new THREE.Vector3();
    old?.dispose();
    const c = new OrbitControls(this.camera as THREE.PerspectiveCamera, this.el);
    c.target.copy(target);
    c.enableDamping = false;
    c.zoomToCursor = true;
    c.screenSpacePanning = true;
    c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
    c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    c.addEventListener('change', () => this.vp.requestRender());
    c.addEventListener('start', () => { this.vp.userMoved = true; });
    this.controls = c;
  }

  setProjection(p: 'ortho' | 'persp') {
    if (p === this.projection) return;
    const from = this.camera;
    const t = this.controls.target;
    const dist = from.position.distanceTo(t);
    if (p === 'ortho') {
      this.ortho.position.copy(from.position);
      this.ortho.quaternion.copy(from.quaternion);
      this.orthoHalfH = dist * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      this.ortho.zoom = 1;
    } else {
      const halfH = this.orthoHalfH / this.ortho.zoom;
      const d = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
      const dir = new THREE.Vector3().subVectors(this.ortho.position, t).normalize();
      this.persp.position.copy(t).addScaledVector(dir, d);
    }
    this.projection = p;
    this.makeControls();
    this.updateCams();
  }

  updateCams() {
    const a = this.rect.w / Math.max(1, this.rect.h);
    this.persp.aspect = a;
    this.persp.updateProjectionMatrix();
    const h = this.orthoHalfH;
    Object.assign(this.ortho, { left: -h * a, right: h * a, top: h, bottom: -h });
    this.ortho.updateProjectionMatrix();
  }

  /** התאמה למסך: שומרת יחס ממדים (אין מתיחה), מתחשבת ביחס הצדדים של החלון. */
  customDir?: THREE.Vector3;
  fit(box: THREE.Box3, view?: ViewName, dirOverride?: THREE.Vector3) {
    if (view) { this.view = view; this.customDir = undefined; }
    if (dirOverride) this.customDir = dirOverride.clone().normalize();
    if (box.isEmpty()) box = new THREE.Box3(new THREE.Vector3(-5000, -5000, 0), new THREE.Vector3(5000, 5000, 5000));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = (this.customDir ?? DIRS[this.view]).clone().normalize();
    const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const cov = this.vp.safe && this.vp.panes.length === 1 ? this.vp.safe.l + this.vp.safe.r : 0;
    const a = Math.max(120, this.rect.w - cov) / Math.max(1, this.rect.h);
    cam.position.copy(center).addScaledVector(dir, size * 2);
    cam.up.set(0, 0, 1);
    cam.lookAt(center);
    cam.updateMatrixWorld(true);
    // היקף ה-box במערכת המצלמה
    const inv = cam.matrixWorldInverse;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(inv);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const shift = right.multiplyScalar((x0 + x1) / 2).add(up.multiplyScalar((y0 + y1) / 2));
    const target = center.clone().add(shift);
    const margin = 1.12;
    const halfH = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / a) * margin;
    // 1.55.2: חלון צף מכסה צד של המודל — ההתאמה ממרכזת את המודל בחלק הגלוי (המודל לא זז בפתיחת/סגירת החלון — רק בהתאמה)
    const sf = this.vp.safe, sx = sf && this.vp.panes.length === 1 ? (sf.r - sf.l) / 2 : 0;
    if (sx) target.add(new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).multiplyScalar((sx * 2 * halfH) / Math.max(1, this.rect.h)));
    if (this.projection === 'ortho') {
      this.orthoHalfH = halfH;
      this.ortho.zoom = 1;
      this.ortho.position.copy(target).addScaledVector(dir, size * 2);
    } else {
      const d = halfH / Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2)) + size / 2;
      this.persp.position.copy(target).addScaledVector(dir, d);
      this.persp.near = Math.max(1, d / 1000); this.persp.far = d * 20;
    }
    this.controls.target.copy(target);
    this.updateCams();
    this.controls.update();
    this.vp.requestRender();
  }

  onUp(e: PointerEvent) {
    const d = this.down;
    this.down = undefined;
    if (!d) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (d.b === 2) { if (moved <= 6) this.vp.handleContext(this, e); return; }
    if (d.b !== 0) return;
    // גרירה מסובבת/מזיזה את המצלמה — אינה מתפרשת כלחיצה
    if (moved > 6 || performance.now() - d.t > 700) return;
    this.vp.handleClick(this, e);
  }

  ndc(clientX: number, clientY: number) {
    const r = this.el.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  toScreen(p: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.rect.w, y: ((1 - v.y) / 2) * this.rect.h, visible: v.z > -1 && v.z < 1 };
  }

  drawLabels(labels: Label[]) {
    let i = 0;
    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir);
    // מניעת חפיפה: עדיפות (מדידה > בועות > מידות ניתנות לעריכה > מידות > מידות פטות > חיבורי המשך), כל תווית שחופפת לתווית שכבר הוצבה — מוסתרת
    const prio = (c: string) => (c.includes('measure') || c.includes('tag') ? 0 : c.includes('bubble') ? 1 : c.includes('slope') ? 2 : c.includes('small') || c.includes('rem') ? 4 : c.includes('dim') ? 3 : c.includes('splice') ? 6 : 5);
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const order = labels.map((l, k) => ({ l, k, pr: prio(l.cls) })).sort((a, b) => a.pr - b.pr || a.k - b.k);
    for (const { l, pr } of order) {
      // מידה שנצפית בקצה (כיוונה מקביל לכיוון המבט) אינה מוצגת — היא מתנוונת לנקודה
      if (l.dir && Math.abs(l.dir.dot(viewDir)) > 0.97) continue;
      const s = this.toScreen(l.p);
      if (!s.visible || s.x < -50 || s.y < -50 || s.x > this.rect.w + 50 || s.y > this.rect.h + 50) continue;
      if (pr > 0) {
        const hw = l.cls.includes('bubble') ? 13 : l.cls.includes('splice') ? 5 : l.text.length * 3.6 + 5, hh = l.cls.includes('bubble') ? 13 : l.cls.includes('splice') ? 5 : 8;
        const r = { x0: s.x - hw, x1: s.x + hw, y0: s.y - hh, y1: s.y + hh };
        if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
        placed.push(r);
      }
      let el = this.labelPool[i];
      if (!el) { el = document.createElement('div'); this.labelLayer.appendChild(el); this.labelPool[i] = el; }
      el.className = `vp-label ${l.cls}${l.edit ? ' editable' : ''}`;
      el.textContent = l.text;
      if (l.edit) { el.dataset.edit = l.edit; el.dataset.value = String(l.value ?? 0); el.title = 'לחיצה לשינוי המידה'; } else { delete el.dataset.edit; el.removeAttribute('title'); }
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
      el.style.display = '';
      i++;
    }
    for (; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
    // מחוון צירים
    const q = this.camera.quaternion.clone().invert();
    const parts: string[] = [];
    const axes: [THREE.Vector3, string, string][] = [
      [new THREE.Vector3(1, 0, 0), 'X', '#d0453b'], [new THREE.Vector3(0, 1, 0), 'Y', '#3b9a4a'], [new THREE.Vector3(0, 0, 1), 'Z', '#2f6fd0'],
    ];
    for (const [v, n, c] of axes) {
      const p = v.applyQuaternion(q);
      const x = p.x * 26, y = -p.y * 26;
      parts.push(`<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`);
      parts.push(`<text x="${(x * 1.3).toFixed(1)}" y="${(y * 1.3 + 4).toFixed(1)}" fill="${c}" font-size="11" font-weight="700" text-anchor="middle">${n}</text>`);
    }
    this.axes.innerHTML = parts.join('');
    this.title.textContent = `${this.customDir ? "מבט מותאם" : VIEW_LABEL[this.view]} · ${this.projection === 'ortho' ? 'אורתוגרפי' : 'פרספקטיבה'}`;
  }

  dispose() { this.controls.dispose(); this.el.remove(); }
}

/** מנוע תצוגה תלת־ממדי: תצוגה בלבד; כל שינוי במודל עובר דרך store/פקודות. */
/** מודל גדול (מעל 6000 חלקי ברגים): ברגים מוסתרים בסקירה הכללית */
export const largeModel = (d: { members: { kind: string }[] }) => { let n = 0; for (const m of d.members) if (m.kind === 'bolt' && ++n > 6000) return true; return false; };

export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  panes: Pane[] = [];
  model?: ModelBuffers;
  modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.65, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  edgeMat = new THREE.LineBasicMaterial({ color: 0x2b322e, transparent: true, opacity: 0.5 });
  selMat = new THREE.MeshStandardMaterial({ color: 0x2f8a5f, emissive: 0x0e3a24, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  selEdgeMat = new THREE.LineBasicMaterial({ color: 0x14432d });
  /** הדגשת ההיקף (1.49): האלמנטים שהשינוי יחול עליהם — כתום, מתחת לשכבת הבחירה */
  hiMat = new THREE.MeshStandardMaterial({ color: 0xe08a2e, emissive: 0x5a2a00, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 });
  hiEdgeMat = new THREE.LineBasicMaterial({ color: 0x8a4a10 });
  hiGroup = new THREE.Group();
  private lastHi = '';
  helpers = new THREE.Group();
  selGroup = new THREE.Group();
  measureGroup = new THREE.Group();
  labels: Label[] = [];
  private dirty = true;
  private lastDerived?: unknown;
  private lastVisKey = '';
  private lastSel = '';
  private ro: ResizeObserver;
  private unsub: () => void;
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private disposed = false;
  private firstFit = false;

  constructor(public host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    const cv = this.renderer.domElement;
    cv.className = 'vp-canvas';
    host.appendChild(cv);
    this.scene.background = new THREE.Color(0xf3efe6);
    this.scene.add(new THREE.HemisphereLight(0xfffdf6, 0x9a9484, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, -1, 1.4);
    this.scene.add(sun);
    this.scene.add(this.helpers, this.hiGroup, this.selGroup, this.measureGroup);
    this.layoutPanes(store.state.view.split);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = store.subscribe(() => this.sync(store.state));
    this.sync(store.state);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      if (this.dirty) { this.dirty = false; this.render(); for (const f of this.frameListeners) f(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  requestRender() { this.dirty = true; }

  layoutPanes(split: boolean) {
    for (const p of this.panes) p.dispose();
    const proj = store.state.view.projection;
    this.panes = split
      ? [new Pane(this, 'iso', proj), new Pane(this, 'front', 'ortho'), new Pane(this, 'right', 'ortho'), new Pane(this, 'top', 'ortho')]
      : [new Pane(this, 'iso', proj)];
    for (const p of this.panes) this.host.appendChild(p.el);
    this.resize();
    for (const p of this.panes) p.fit(this.model?.box ?? new THREE.Box3());
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const n = this.panes.length;
    this.panes.forEach((p, i) => {
      if (n === 1) p.rect = { x: 0, y: 0, w, h };
      else {
        const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
        p.rect = { x: (i % 2) * hw, y: Math.floor(i / 2) * hh, w: i % 2 ? w - hw : hw, h: i < 2 ? hh : h - hh };
      }
      Object.assign(p.el.style, { left: `${p.rect.x}px`, top: `${p.rect.y}px`, width: `${p.rect.w}px`, height: `${p.rect.h}px` });
      p.updateCams();
    });
    // לפני שהמשתמש הזיז את המצלמה — התאמה מחדש לגודל החלון (טלפון: הסרגלים נטענים אחרי הבנייה הראשונה)
    if (!this.userMoved && this.model && !this.model.box.isEmpty() && performance.now() - this.bootAt < 2500) for (const p of this.panes) p.fit(this.model.box);
    this.requestRender();
  }
  /** המשתמש סובב/הזיז/הגדיל — לא להתאים את המבט אוטומטית; התאמה אוטומטית רק בשניות הראשונות (התייצבות הפריסה) */
  userMoved = false;
  /** רוחב שמכוסה בחלון צף משמאל/מימין לחלונית המודל (פיקסלים) */
  safe = { l: 0, r: 0 };
  setSafe(l: number, r: number) {
    l = Math.max(0, Math.round(l)); r = Math.max(0, Math.round(r));
    if (l === this.safe.l && r === this.safe.r) return;
    this.safe = { l, r };
  }
  private bootAt = performance.now();

  /** סנכרון מצב האפליקציה לסצנה. בונה מחדש רק מה שהשתנה. */
  sync(s: AppState) {
    if ((this.panes.length > 1) !== s.view.split) this.layoutPanes(s.view.split);
    const main = this.panes[0];
    if (main.projection !== s.view.projection) { main.setProjection(s.view.projection); }
    const visKey = `${s.hidden.join(',')}|${s.isolated?.join(',') ?? ''}|${Object.entries(s.filter).filter(([, v]) => !v).map(([k]) => k).join(',')}|${s.colorMode}|${s.colorMode === 'sizing' ? JSON.stringify(s.project.settings.sizing ?? {}) : ''}`;
    if (s.derived !== this.lastDerived || visKey !== this.lastVisKey) {
      this.lastDerived = s.derived; this.lastVisKey = visKey;
      this.rebuildModel(s);
      this.lastSel = ''; this.lastHi = '#';
      if (!this.firstFit && this.model && !this.model.box.isEmpty()) {
        this.firstFit = true;
        for (const p of this.panes) p.fit(this.model.box);
      }
    }
    const selKey = s.selection.join(',');
    if (selKey !== this.lastSel) { this.lastSel = selKey; this.rebuildSelection(s); }
    const hiKey = (s.scopeHi ?? []).join(',');
    if (hiKey !== this.lastHi) {
      this.lastHi = hiKey;
      for (const c of [...this.hiGroup.children]) { this.hiGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
      const sel = new Set(s.selection);
      const hs = (s.scopeHi ?? []).filter((id) => !sel.has(id)).map((id) => s.derived.byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof s.derived.byId.get>>[];
      if (hs.length) { const b = buildModel(hs, this.hiMat, this.hiEdgeMat); this.hiGroup.add(b.mesh, b.edges); }
    }
    if (this.model) {
      this.model.mesh.visible = s.view.render === 'solid';
      this.edgeMat.opacity = s.view.render === 'solid' ? 0.55 : 1;
    }
    this.applyClip(s);
    this.rebuildHelpers(s);
    this.rebuildMeasure(s);
    this.requestRender();
  }

  private rebuildModel(s: AppState) {
    if (this.model) {
      this.scene.remove(this.model.mesh, this.model.edges);
      this.model.mesh.geometry.dispose(); this.model.edges.geometry.dispose();
    }
    let vis = visibleMembers(s.derived, s.hidden, s.isolated).filter((m) => s.filter[m.kind] !== false);
    // מודל גדול: ברגים (רוב הגיאומטריה) מוצגים רק במצב בידוד — ובבחירה (שכבת הבחירה) — כדי שהתצוגה תישאר מהירה
    if (!s.isolated && largeModel(s.derived)) vis = vis.filter((m) => m.kind !== 'bolt');
    let colorOf: ((m: Member) => number | undefined) | undefined;
    if (s.colorMode === 'sizing') {
      const sz = sizingAll(s.project, s.derived);
      colorOf = (m) => SIZE_COLOR[sz.get(m.id)?.status ?? 'na'];
    }
    this.model = buildModel(vis, this.modelMat, this.edgeMat, colorOf);
    this.scene.add(this.model.mesh, this.model.edges);
  }

  private rebuildSelection(s: AppState) {
    // מודל גדול: בבחירה מוצגים גם הברגים של החיבורים של האלמנט הנבחר
    if (largeModel(s.derived) && s.selection.length && s.selection.length < 200) {
      const ids = new Set(s.selection);
      const extra: string[] = [];
      for (const c of s.derived.connections) if (c.parts.some((x) => ids.has(x)) || c.members.some((x) => ids.has(x))) for (const b of c.bolts) extra.push(`${b.id}.H`, `${b.id}.S`, `${b.id}.N`);
      s = { ...s, selection: [...s.selection, ...extra.filter((x) => s.derived.byId.has(x))] };
    }
    for (const c of [...this.selGroup.children]) { this.selGroup.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    const ms = s.selection.map((id) => s.derived.byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof s.derived.byId.get>>[];
    if (!ms.length) return;
    const b = buildModel(ms, this.selMat, this.selEdgeMat);
    this.selGroup.add(b.mesh, b.edges);
  }

  private applyClip(s: AppState) {
    const c = s.view.clip;
    const planes = c.enabled ? [this.clipPlane] : [];
    if (c.enabled) {
      const n = new THREE.Vector3(c.axis === 'X' ? 1 : 0, c.axis === 'Y' ? 1 : 0, c.axis === 'Z' ? 1 : 0);
      if (c.flip) n.negate();
      // מציג את הצד שבו n·p + d >= 0 ; משאיר את מה שמעבר למישור
      this.clipPlane.set(n, -(c.flip ? -c.pos : c.pos));
    }
    for (const m of [this.modelMat, this.edgeMat, this.selMat, this.selEdgeMat, this.hiMat, this.hiEdgeMat]) m.clippingPlanes = planes;
  }

  private rebuildHelpers(s: AppState) {
    for (const c of [...this.helpers.children]) { this.helpers.remove(c); (c as THREE.Line).geometry?.dispose(); }
    this.labels = [];
    const d = s.derived;
    const b = s.project.building;
    const unit = s.project.displayUnit;
    const fmt = (mm: number) => (unit === 'm' ? fromMm(mm, 'm').toFixed(2) : mm.toFixed(0));
    // משטחי חיפוי שקופים (גג וקירות)
    this.gutterMeshes = [];
    if (b.cladding) {
      const t = claddingTakeoff(s.project, d);
      // מזחלות וירידות — מוצגות תמיד (גם כששכבת החיפוי כבויה) וניתנות לבחירה בלחיצה; פנלי חיפוי — לפי השכבה
      if (t) for (const sf of t.surfaces.filter((x) => s.view.cladding || x.kind === 'gutter' || x.kind === 'pipe')) {
        const pos: number[] = [];
        for (let i = 1; i < sf.pts.length - 1; i++) for (const q of [sf.pts[0], sf.pts[i], sf.pts[i + 1]]) pos.push(q.x, q.y, q.z);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: sf.kind === 'roof' ? 0x6f8fa8 : sf.kind === 'gutter' ? 0x8c9aa6 : sf.kind === 'pipe' ? 0x7a8790 : 0x9aa8a0, transparent: true, opacity: sf.kind === 'roof' ? 0.16 : sf.kind === 'gutter' || sf.kind === 'pipe' ? 0.75 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
        mesh.renderOrder = 2;
        if ((sf.kind === 'gutter' || sf.kind === 'pipe') && sf.ref) { mesh.userData.gutter = sf.ref; this.gutterMeshes.push(mesh); if (s.activeGutter === sf.ref) (mesh.material as THREE.MeshBasicMaterial).color.set(0xe0662c); }
        this.helpers.add(mesh);
        const lp: number[] = []; for (let i = 0; i < sf.pts.length; i++) { const a = sf.pts[i], c = sf.pts[(i + 1) % sf.pts.length]; lp.push(a.x, a.y, a.z, c.x, c.y, c.z); }
        const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
        this.helpers.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x5a7486, transparent: true, opacity: 0.5 })));
      }
    }
    if (!d.members.length) return;
    const ys = d.grid.filter((g) => g.dir === 'Y').map((g) => g.pos);
    const xs = d.grid.filter((g) => g.dir === 'X').map((g) => g.pos);
    const y0 = Math.min(...ys), y1 = Math.max(...ys), x0 = Math.min(...xs), x1 = Math.max(...xs);
    const ext = 2500, z = b.baseElevation;
    if (s.view.grid) {
      const pts: number[] = [];
      for (const g of d.grid) {
        if (g.dir === 'X') {
          pts.push(g.pos, y0 - ext, z, g.pos, y1 + ext, z);
          this.labels.push({ p: new THREE.Vector3(g.pos, y0 - ext - 700, z), text: g.label, cls: 'bubble' });
          this.labels.push({ p: new THREE.Vector3(g.pos, y1 + ext + 700, z), text: g.label, cls: 'bubble' });
        } else {
          pts.push(x0 - ext, g.pos, z, x1 + ext, g.pos, z);
          this.labels.push({ p: new THREE.Vector3(x0 - ext - 700, g.pos, z), text: g.label, cls: 'bubble' });
          this.labels.push({ p: new THREE.Vector3(x1 + ext + 700, g.pos, z), text: g.label, cls: 'bubble' });
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const line = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({ color: 0x7a8794, dashSize: 600, gapSize: 250 }));
      line.computeLineDistances();
      this.helpers.add(line);
    }
    if (s.view.dims) {
      const pts: number[] = [];
      const dimLine = (a: Vec3, c: Vec3, tick: Vec3, text: string, edit?: string, value?: number) => {
        pts.push(a.x, a.y, a.z, c.x, c.y, c.z);
        for (const p of [a, c]) pts.push(p.x - tick.x, p.y - tick.y, p.z - tick.z, p.x + tick.x, p.y + tick.y, p.z + tick.z);
        const dir = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z).normalize();
        this.labels.push({ p: new THREE.Vector3((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2), text, cls: 'dim', dir, edit, value });
      };
      const off = 1400;
      // מרווחים בין צירי העמודים (לחיצה = עריכה) ורוחב כולל, לפני המסגרת הראשונה
      const xsS = [...xs].sort((p, q) => p - q);
      if (xsS.length > 2) for (let i = 1; i < xsS.length; i++) dimLine({ x: xsS[i - 1], y: y0 - off, z }, { x: xsS[i], y: y0 - off, z }, { x: 0, y: 200, z: 0 }, fmt(xsS[i] - xsS[i - 1]), `x:${i - 1}`, xsS[i] - xsS[i - 1]);
      dimLine({ x: x0, y: y0 - off * (xsS.length > 2 ? 2 : 1), z }, { x: x1, y: y0 - off * (xsS.length > 2 ? 2 : 1), z }, { x: 0, y: 200, z: 0 }, fmt(x1 - x0), xsS.length > 2 ? undefined : 'w', x1 - x0);
      // מרווחי מסגרות (לחיצה = עריכה) וסה"כ אורך לאורך ציר א
      for (let i = 1; i < ys.length; i++) dimLine({ x: x0 - off, y: ys[i - 1], z }, { x: x0 - off, y: ys[i], z }, { x: 200, y: 0, z: 0 }, fmt(ys[i] - ys[i - 1]), `y:${i - 1}`, ys[i] - ys[i - 1]);
      if (ys.length > 2) dimLine({ x: x0 - 2 * off, y: y0, z }, { x: x0 - 2 * off, y: y1, z }, { x: 200, y: 0, z: 0 }, fmt(y1 - y0));
      // גבהים במסגרת הראשונה
      // גובה פני עליון בכל ציר עמודים במסגרת הראשונה, וגובה רכס
      const f0 = b.frames[0]?.id;
      for (const c of d.members.filter((m) => m.kind === 'column' && m.frameId === f0)) {
        const outside = c.start.x <= x0 + 1 ? -off : c.start.x >= x1 - 1 ? off : 0;
        dimLine({ x: c.start.x + outside, y: y0 - (outside ? 0 : off), z }, { x: c.start.x + outside, y: y0 - (outside ? 0 : off), z: c.end.z }, { x: 200, y: 0, z: 0 }, fmt(c.end.z - z), 'hz', c.end.z - z);
      }
      // שיפוע כל מישור גג — על הקורה במסגרת הראשונה (לחיצה = שינוי; הקצה הנעול נשאר)
      for (const r of d.members.filter((m) => m.kind === 'rafter' && m.frameId === f0)) {
        const pid = r.planeId ?? (r.side ?? 'M');
        const sl = Math.abs((r.end.z - r.start.z) / (r.end.x - r.start.x)) * 100;
        const mid = new THREE.Vector3((r.start.x + r.end.x) / 2, y0 - 250, (r.start.z + r.end.z) / 2 + 450);
        this.labels.push({ p: mid, text: `${sl.toFixed(1)}%`, cls: 'dim slope', edit: `sl:${pid}`, value: sl * 1000 });
      }
      for (const nd of d.nodes.filter((n) => n.frameId === f0 && n.role === 'רכס')) {
        dimLine({ x: nd.p.x, y: y0 - off, z }, { x: nd.p.x, y: y0 - off, z: nd.p.z }, { x: 200, y: 0, z: 0 }, fmt(nd.p.z - z));
      }
      // פריסת פטות: מידות לאורך השיפוע, לפני המסגרת הראשונה, מעט מעל מישור הגג
      const purl = d.members.filter((m) => m.purlin).sort((a, b) => a.purlin!.index - b.purlin!.index);
      for (const side of [...new Set(purl.map((m) => m.purlin!.side))]) {
        const ls = purl.filter((m) => m.purlin!.side === side);
        if (!ls.length) continue;
        const n = ls[0].purlin!.roofNormal;
        const yy = Math.min(...ys) - b.purlinOverhangStart - 900;
        const lift = 450;
        const at = (x: number, zz: number) => ({ x: x + n.x * lift, y: yy, z: zz + n.z * lift });
        const plS = d.section?.planes.find((q) => q.id === side);
        const sp = plS ? (plS.startAt === 'b' ? plS.b : plS.a) : { x: b.ridgeX, z: d.roof.ridgeZ ?? 0 };
        let prev = (ls[0].purlin!.startFree ?? side === 'M') ? null : { x: sp.x, z: sp.z };
        for (const m of ls) {
          const cur = { x: m.start.x, z: m.start.z };
          if (prev) {
            const a = at(prev.x, prev.z), c = at(cur.x, cur.z);
            pts.push(a.x, a.y, a.z, c.x, c.y, c.z);
            for (const q of [a, c]) pts.push(q.x - n.x * 120, q.y, q.z - n.z * 120, q.x + n.x * 120, q.y, q.z + n.z * 120);
            const span = Math.hypot(cur.x - prev.x, cur.z - prev.z);
            const rem = m.purlin!.isLast && m.purlin!.index > 1 && Math.abs(span - (side === 'R' ? b.purlins.right : b.purlins.left).spacing) > 0.5;
            const dir = new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize();
            const pkey = m.purlin!.paramKey ?? (side === 'R' ? 'right' : 'left');
            this.labels.push({ p: new THREE.Vector3((a.x + c.x) / 2, yy, (a.z + c.z) / 2), text: fmt(span), cls: rem ? 'dim rem' : 'dim small', dir, edit: `ps:${pkey}`, value: span });
          }
          prev = cur;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.helpers.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x1f5fa8 })));
    }
    // ריתוכים (מסגריה) — קו כתום לאורך הריתוך
    const wp: number[] = [];
    for (const c of d.connections) for (const w of c.welds) if (w.from.x !== w.to.x || w.from.y !== w.to.y || w.from.z !== w.to.z) wp.push(w.from.x, w.from.y, w.from.z, w.to.x, w.to.y, w.to.z);
    if (wp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      this.helpers.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe8730c })));
    }
    // חיבורי המשך: סמן בכל מיקום, מסומן "דורש תכנון"
    if (s.view.dims) for (const sp of d.splices) {
      this.labels.push({ p: new THREE.Vector3(sp.p.x, sp.p.y, sp.p.z), text: '◇', cls: 'splice' });
    }
    if (s.view.labels) {
      for (const id of s.selection.slice(0, 50)) {
        const m = d.byId.get(id);
        if (!m) continue;
        this.labels.push({ p: new THREE.Vector3((m.start.x + m.end.x) / 2, (m.start.y + m.end.y) / 2, (m.start.z + m.end.z) / 2), text: `${m.id} · ${m.profile}`, cls: 'tag' });
      }
    }
  }

  private rebuildMeasure(s: AppState) {
    for (const c of [...this.measureGroup.children]) { this.measureGroup.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const { a, b } = s.measure;
    const mk = (p: Vec3) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xd0006f, depthTest: false }));
      m.position.set(p.x, p.y, p.z);
      m.userData.marker = true;
      m.renderOrder = 10;
      return m;
    };
    if (a) this.measureGroup.add(mk(a));
    if (b) this.measureGroup.add(mk(b));
    if (a && b) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xd0006f, depthTest: false }));
      l.renderOrder = 10;
      this.measureGroup.add(l);
      const dd = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      this.labels.push({ p: new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), text: `${dd.toFixed(1)} מ"מ`, cls: 'measure' });
    }
  }

  render() {
    const { renderer } = this;
    const H = this.host.clientHeight;
    renderer.setScissorTest(true);
    for (const p of this.panes) {
      const { x, y, w, h } = p.rect;
      renderer.setViewport(x, H - y - h, w, h);
      renderer.setScissor(x, H - y - h, w, h);
      // גודל סמני מדידה קבוע בפיקסלים
      const worldPerPx = this.worldPerPixel(p);
      for (const c of this.measureGroup.children) if (c.userData.marker) c.scale.setScalar(worldPerPx * 5);
      renderer.render(this.scene, p.camera);
      p.drawLabels(this.labels);
    }
  }

  /** תמונת PNG של המודל (לחלונית הראשית) — להצעת מחיר ללקוח */
  snapshot(): string {
    const helpersVis = this.helpers.visible;
    this.render();
    const url = this.renderer.domElement.toDataURL('image/png');
    this.helpers.visible = helpersVis;
    return url;
  }

  /**
   * תמונה ריאליסטית ללקוח: חיפוי אטום בצבעי הפנלים, קרקע, שמיים, שמש עם צללים, פלדה צבועה.
   * מרונדר מחוץ למסך בגודל W×H מכיוון המבט הנוכחי (פרספקטיבה), בלי רשת/מידות/בחירה. מחזיר data-URL של PNG.
   */
  presentationShot(W = 2400, H = 1500, withClad = true): string {
    if (!this.model) return '';
    const s = store.state, b = s.project.building, r = this.renderer;
    const box = this.model.box.clone();
    const ctr = box.getCenter(new THREE.Vector3()), R = Math.max(1000, box.getSize(new THREE.Vector3()).length() / 2);
    const tmp = new THREE.Group();
    const disp: { dispose(): void }[] = [];
    const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide, ...o }); disp.push(m); return m; };
    // קרקע: חצץ/אדמה, ומשטח בטון מתחת למבנה
    const zG = b.baseElevation;
    const gG = new THREE.PlaneGeometry(R * 16, R * 16); disp.push(gG);
    const ground = new THREE.Mesh(gG, std(0xa9a48f, { roughness: 1, metalness: 0 })); ground.position.set(ctr.x, ctr.y, zG - 30); ground.receiveShadow = true; tmp.add(ground);
    const slabG = new THREE.PlaneGeometry(box.max.x - box.min.x + 3000, box.max.y - box.min.y + 3000); disp.push(slabG);
    const slab = new THREE.Mesh(slabG, std(0xc9c6bd, { roughness: 0.95, metalness: 0 })); slab.position.set(ctr.x, ctr.y, zG - 10); slab.receiveShadow = true; tmp.add(slab);
    // חיפוי אטום
    if (withClad && b.cladding) {
      const t = claddingTakeoff(s.project, s.derived);
      const col = { roof: 0x8e9ba5, wall: 0xdad6cb, gutter: 0x9aa5ad, pipe: 0x8f9aa2 } as const;
      if (t) for (const sf of t.surfaces) {
        const pos: number[] = [];
        for (let i = 1; i < sf.pts.length - 1; i++) for (const q of [sf.pts[0], sf.pts[i], sf.pts[i + 1]]) pos.push(q.x, q.y, q.z);
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); disp.push(g);
        const m = new THREE.Mesh(g, std(col[sf.kind], { metalness: sf.kind === 'wall' ? 0.1 : 0.35, roughness: 0.55 }));
        m.castShadow = true; m.receiveShadow = true; tmp.add(m);
      }
    }
    // שמש עם צללים
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(ctr.x - R * 1.3, ctr.y - R * 1.7, ctr.z + R * 2.4); sun.target.position.copy(ctr);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera; sc.left = -R * 1.6; sc.right = R * 1.6; sc.top = R * 1.6; sc.bottom = -R * 1.6; sc.near = 10; sc.far = R * 8; sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = R * 0.0006;
    tmp.add(sun, sun.target);
    // שמיים: מעבר צבע
    const cv = document.createElement('canvas'); cv.width = 4; cv.height = 256;
    const cx = cv.getContext('2d')!; const gr = cx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#7fa6c9'); gr.addColorStop(0.65, '#cfdde8'); gr.addColorStop(1, '#ece6d8');
    cx.fillStyle = gr; cx.fillRect(0, 0, 4, 256);
    const sky = new THREE.CanvasTexture(cv); sky.colorSpace = THREE.SRGBColorSpace; disp.push(sky);
    // פלדה צבועה אחידה
    const steel = std(0x5d6b77, { metalness: 0.45, roughness: 0.45 });
    // מצלמה: אותו כיוון מבט כמו החלונית הראשית, פרספקטיבה
    const p0 = this.panes[0];
    const dir = p0.camera.position.clone().sub(p0.controls.target).normalize();
    { const h = Math.hypot(dir.x, dir.y) || 1; const z = Math.min(0.42, Math.max(0.2, dir.z)); const k = Math.sqrt(1 - z * z) / h; dir.set(dir.x * k, dir.y * k, z); }
    const cam = new THREE.PerspectiveCamera(32, W / H, 10, R * 40); cam.up.set(0, 0, 1);
    const dist = R / Math.sin(THREE.MathUtils.degToRad(32 / 2)) * (W / H < 1.2 ? 1.25 : 0.95);
    cam.position.copy(ctr).addScaledVector(dir, dist); cam.lookAt(ctr);
    // שמירת מצב
    const prev = { bg: this.scene.background, fog: this.scene.fog, helpers: this.helpers.visible, sel: this.selGroup.visible, hi: this.hiGroup.visible, meas: this.measureGroup.visible, edges: this.model.edges.visible, mVis: this.model.mesh.visible, mat: this.model.mesh.material, shadow: r.shadowMap.enabled, pr: r.getPixelRatio(), tm: r.toneMapping };
    try {
      this.helpers.visible = false; this.selGroup.visible = false; this.hiGroup.visible = false; this.measureGroup.visible = false; this.model.edges.visible = false;
      this.model.mesh.visible = true; this.model.mesh.material = steel; this.model.mesh.castShadow = true; this.model.mesh.receiveShadow = true;
      this.scene.background = sky; this.scene.fog = new THREE.Fog(0xdfe6ea, R * 5, R * 14);
      this.scene.add(tmp);
      r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.toneMapping = THREE.ACESFilmicToneMapping;
      r.setPixelRatio(1); r.setSize(W, H, false); r.setScissorTest(false); r.setViewport(0, 0, W, H);
      r.render(this.scene, cam);
      return r.domElement.toDataURL('image/png');
    } finally {
      this.scene.remove(tmp);
      this.scene.background = prev.bg; this.scene.fog = prev.fog;
      this.helpers.visible = prev.helpers; this.selGroup.visible = prev.sel; this.hiGroup.visible = prev.hi; this.measureGroup.visible = prev.meas; this.model.edges.visible = prev.edges;
      this.model.mesh.visible = prev.mVis; this.model.mesh.material = prev.mat; this.model.mesh.castShadow = false; this.model.mesh.receiveShadow = false;
      r.shadowMap.enabled = prev.shadow; r.toneMapping = prev.tm; r.setPixelRatio(prev.pr);
      sun.shadow.map?.dispose();
      for (const x of disp) x.dispose();
      this.modelMat.needsUpdate = true;
      this.resize(); this.render(); this.requestRender();
    }
  }

  worldPerPixel(p: Pane): number {
    if (p.projection === 'ortho') return (2 * p.orthoHalfH) / p.ortho.zoom / p.rect.h;
    const d = p.persp.position.distanceTo(p.controls.target);
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(p.persp.fov / 2))) / p.rect.h;
  }

  /** כל האלמנטים שהקרן פוגעת בהם, ממוינים לפי מרחק, ללא כפילויות, לפי מסנן הבחירה. */
  pickAll(p: Pane, clientX: number, clientY: number): { ids: string[]; points: THREE.Vector3[]; tri?: THREE.Vector3[] } {
    if (!this.model) return { ids: [], points: [] };
    const rc = new THREE.Raycaster();
    rc.setFromCamera(p.ndc(clientX, clientY), p.camera);
    rc.params.Line = { threshold: 0 };
    const hits = rc.intersectObject(this.model.mesh, false);
    const clip = store.state.view.clip;
    const filter = store.state.filter;
    const ids: string[] = [], points: THREE.Vector3[] = [];
    let tri: THREE.Vector3[] | undefined;
    for (const h of hits) {
      if (clip.enabled && this.clipPlane.distanceToPoint(h.point) < 0) continue;
      const id = this.model.ids[this.model.triOwner[h.faceIndex!]];
      const m = store.state.derived.byId.get(id);
      if (!m || !filter[m.kind]) continue;
      if (!tri) {
        const pos = this.model.mesh.geometry.getAttribute('position');
        const f = h.faceIndex! * 3;
        tri = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, f + k));
      }
      if (!ids.includes(id)) { ids.push(id); points.push(h.point.clone()); }
    }
    const pref = store.state.pickPrefer;
    if (pref && ids.length > 1) {
      const re = new RegExp(pref), ord = ids.map((_, i) => i).sort((a, b) => Number(!re.test(ids[a])) - Number(!re.test(ids[b])) || a - b);
      return { ids: ord.map((i) => ids[i]), points: ord.map((i) => points[i]), tri };
    }
    return { ids, points, tri };
  }

  gutterMeshes: THREE.Mesh[] = [];
  pickGutter(p: Pane, clientX: number, clientY: number): { ref: string; d: number } | null {
    if (!this.gutterMeshes.length) return null;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(p.ndc(clientX, clientY), p.camera);
    const h = rc.intersectObjects(this.gutterMeshes, false)[0];
    return h ? { ref: h.object.userData.gutter as string, d: h.distance } : null;
  }

  handleClick(p: Pane, e: PointerEvent) {
    const s = store.state;
    const r = this.pickAll(p, e.clientX, e.clientY);
    if (s.tool === 'measure') {
      if (!r.points.length) return;
      const pt = this.snap(p, r, e);
      const m = s.measure;
      const v = { x: pt.x, y: pt.y, z: pt.z };
      store.set({ measure: !m.a || m.b ? { a: v } : { a: m.a, b: v } });
      return;
    }
    // מזחלה/ירידה לפני כל אלמנט אחר בקרן — פתיחת אשף המזחלה
    const g = this.pickGutter(p, e.clientX, e.clientY);
    const lp0 = p.lastPick;
    // סבב בלחיצות חוזרות באותה נקודה: מזחלה (אם לפני) → אלמנט 1 → אלמנט 2 → … → חזרה למזחלה (1.54: קודם המזחלה "תפסה" שוב כבר בלחיצה השלישית)
    const same = !!lp0 && Math.hypot(lp0.x - e.clientX, lp0.y - e.clientY) < 5 && lp0.ids.join() === r.ids.join();
    const gFront = !!g && (!r.points.length || g.d < r.points[0]!.distanceTo(p.camera.position) - 1);
    if (gFront && (!same || (!lp0!.gutter && lp0!.i >= r.ids.length - 1) || !r.ids.length)) {
      store.select([]);
      store.set({ activeGutter: g!.ref, activeConn: null, pickNext: r.ids[0] ?? null });
      p.lastPick = { x: e.clientX, y: e.clientY, ids: r.ids, i: -1, gutter: true };
      return;
    }
    if (s.activeGutter) store.set({ activeGutter: null });
    if (!r.ids.length) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) store.select([]);
      p.lastPick = undefined;
      return;
    }
    // לחיצה חוזרת באותה נקודה בוחרת את האלמנט הבא מאחור
    const idx = same ? (lp0!.gutter ? 0 : (lp0!.i + 1) % r.ids.length) : 0;
    p.lastPick = { x: e.clientX, y: e.clientY, ids: r.ids, i: idx };
    const id = r.ids[idx];
    store.select([id], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
    // רמז: מה תבחר לחיצה נוספת באותה נקודה (אלמנט מאחור / המזחלה שלפני)
    const nx = idx + 1 < r.ids.length ? r.ids[idx + 1] : gFront ? 'gutter' : r.ids.length > 1 ? r.ids[0] : null;
    if (nx) store.set({ pickNext: nx });
  }

  /** לחיצה על מידה ניתנת לעריכה בתצוגה: key = 'x:i' (מרווח צירים) / 'y:i' (מרווח מסגרות) / 'w' (רוחב) */
  onDimEdit?: (key: string, value: number, clientX: number, clientY: number) => void;

  /** לחיצה ימנית ללא גרירה: בחירת האלמנט שמתחת (אם אינו בבחירה) ופתיחת התפריט המעגלי. */
  onContext?: (clientX: number, clientY: number) => void;
  handleContext(p: Pane, e: PointerEvent) {
    const r = this.pickAll(p, e.clientX, e.clientY);
    const s = store.state;
    if (r.ids.length && !s.selection.includes(r.ids[0])) store.select([r.ids[0]]);
    if (!r.ids.length && !s.selection.length) return;
    this.onContext?.(e.clientX, e.clientY);
  }

  /** מאזינים לכל ציור (תנועת מצלמה) — לעדכון מיקום הסרגל ההקשרי. */
  frameListeners = new Set<() => void>();
  private selPts: { key: string; pts: THREE.Vector3[] } = { key: '', pts: [] };
  /** מלבן המסך (ביחס ל-host) של הבחירה בחלונית הראשית, או null אם אינה נראית. */
  selectionScreenBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    const s = store.state;
    if (!s.selection.length || !this.panes.length) return null;
    const key = s.selection.join('|') + '#' + s.derived.members.length;
    if (this.selPts.key !== key) {
      const pts: THREE.Vector3[] = [];
      for (const id of s.selection.slice(0, 60)) {
        const m = s.derived.byId.get(id);
        if (!m) continue;
        const sol = cachedSolid(m);
        for (const q of [...sol.startRing, ...sol.endRing]) pts.push(new THREE.Vector3(q.x, q.y, q.z));
      }
      this.selPts = { key, pts };
    }
    const p = this.panes[0];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, vis = 0;
    for (const q of this.selPts.pts) {
      const sc = p.toScreen(q);
      if (!sc.visible) continue;
      vis++;
      x0 = Math.min(x0, sc.x); y0 = Math.min(y0, sc.y); x1 = Math.max(x1, sc.x); y1 = Math.max(y1, sc.y);
    }
    if (!vis) return null;
    return { x0: x0 + p.rect.x, y0: y0 + p.rect.y, x1: x1 + p.rect.x, y1: y1 + p.rect.y };
  }

  /** הצמדה: לקודקוד המשולש או לקצה האלמנט הקרוב ביותר על המסך (עד 14px), אחרת נקודת הפגיעה. */
  snap(p: Pane, r: ReturnType<Viewport['pickAll']>, e: PointerEvent): THREE.Vector3 {
    const rect = p.el.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const tri = r.tri ?? [];
    const cands: THREE.Vector3[] = [...tri];
    const m = store.state.derived.byId.get(r.ids[0]);
    if (m && tri.length === 3) {
      // רק פינות שנמצאות על מישור הפאה שנפגעה (נראות), לא קודקודים מוסתרים מאחוריה
      const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0])).normalize();
      const s = cachedSolid(m);
      for (const q of [...s.startRing, ...s.endRing]) {
        const v = new THREE.Vector3(q.x, q.y, q.z);
        if (Math.abs(v.clone().sub(tri[0]).dot(n)) < 0.5) cands.push(v);
      }
    }
    let best = r.points[0], bd = 14;
    for (const c of cands) {
      const sc = p.toScreen(c);
      const dd = Math.hypot(sc.x - mx, sc.y - my);
      if (dd < bd) { bd = dd; best = c; }
    }
    return best;
  }

  fitAll(view?: ViewName) {
    const box = this.model?.box ?? new THREE.Box3();
    if (view) this.panes[0].fit(box, view);
    else for (const p of this.panes) p.fit(box);
  }

  /** התמקדות בבחירה מכיוון מבט נתון (עולם). */
  fitSelectionFrom(dir: Vec3) {
    const s = store.state;
    const box = new THREE.Box3();
    for (const id of s.selection) {
      const m = s.derived.byId.get(id);
      if (!m) continue;
      const sol = cachedSolid(m);
      for (const q of [...sol.startRing, ...sol.endRing]) box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    }
    if (box.isEmpty()) return;
    box.expandByScalar(250);
    this.panes[0].fit(box, undefined, new THREE.Vector3(dir.x, dir.y, dir.z));
  }

  /** מבט לפני "התמקדות בצומת" (1.51) — לחזרה למודל המלא בכפתור */
  private savedView: { pos: THREE.Vector3; target: THREE.Vector3; zoom: number; halfH: number; customDir?: THREE.Vector3; view: ViewName } | null = null;
  /** התמקדות בצומת/חיבור: שומר את המבט הנוכחי (פעם אחת) ומקרב מאותו כיוון מבט */
  focusIds(ids: string[], pad = 500) {
    const s = store.state, p = this.panes[0];
    if (!p) return;
    const box = new THREE.Box3();
    for (const id of ids) {
      const m = s.derived.byId.get(id);
      if (!m) continue;
      const sol = cachedSolid(m);
      for (const q of [...sol.startRing, ...sol.endRing]) box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    }
    if (box.isEmpty()) return;
    if (!this.savedView) this.savedView = { pos: p.camera.position.clone(), target: p.controls.target.clone(), zoom: p.ortho.zoom, halfH: p.orthoHalfH, customDir: p.customDir?.clone(), view: p.view };
    box.expandByScalar(pad);
    const dir = p.camera.position.clone().sub(p.controls.target).normalize();
    p.fit(box, undefined, dir);
    if (!s.viewFocused) store.set({ viewFocused: true });
  }
  /** חזרה למבט שלפני ההתמקדות */
  restoreView() {
    const v = this.savedView, p = this.panes[0];
    this.savedView = null;
    if (store.state.viewFocused) store.set({ viewFocused: false });
    if (!v || !p) return;
    p.view = v.view; p.customDir = v.customDir;
    p.orthoHalfH = v.halfH; p.ortho.zoom = v.zoom;
    p.persp.position.copy(v.pos); p.ortho.position.copy(v.pos);
    p.controls.target.copy(v.target);
    const dd = v.pos.distanceTo(v.target); p.persp.near = Math.max(1, dd / 1000); p.persp.far = dd * 20;
    p.updateCams(); p.controls.update();
    this.requestRender();
  }

  /** התמקדות באוסף אלמנטים (היקף שנבחר בפאנל — מכלול / ציר / כל הדומים) */
  fitIds(ids: string[]) { this.fitSelection(ids); }

  fitSelection(only?: string[]) {
    const s = store.state;
    const box = new THREE.Box3();
    for (const id of only ?? s.selection) {
      const m = s.derived.byId.get(id);
      if (!m) continue;
      const sol = cachedSolid(m);
      for (const q of [...sol.startRing, ...sol.endRing]) box.expandByPoint(new THREE.Vector3(q.x, q.y, q.z));
    }
    if (box.isEmpty()) return this.fitAll();
    box.expandByScalar(300);
    for (const p of this.panes) p.fit(box);
  }

  /** מיקום מסך (פיקסלים ביחס לחלון) של נקודת עולם בחלונית נתונה — לבדיקות אוטומטיות. */
  screenOf(pt: Vec3, pane = 0) {
    const p = this.panes[pane];
    const s = p.toScreen(new THREE.Vector3(pt.x, pt.y, pt.z));
    const r = p.el.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y, visible: s.visible };
  }

  dispose() {
    this.disposed = true;
    this.unsub(); this.ro.disconnect();
    for (const p of this.panes) p.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
