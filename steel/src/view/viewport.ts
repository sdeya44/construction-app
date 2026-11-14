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

interface Label { p: THREE.Vector3; text: string; cls: string; dir?: THREE.Vector3 }

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
  lastPick?: { x: number; y: number; ids: string[]; i: number };

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
    const a = this.rect.w / Math.max(1, this.rect.h);
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
    if (!d || d.b !== 0) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
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
    for (const l of labels) {
      // מידה שנצפית בקצה (כיוונה מקביל לכיוון המבט) אינה מוצגת — היא מתנוונת לנקודה
      if (l.dir && Math.abs(l.dir.dot(viewDir)) > 0.97) continue;
      const s = this.toScreen(l.p);
      if (!s.visible || s.x < -50 || s.y < -50 || s.x > this.rect.w + 50 || s.y > this.rect.h + 50) continue;
      let el = this.labelPool[i];
      if (!el) { el = document.createElement('div'); this.labelLayer.appendChild(el); this.labelPool[i] = el; }
      el.className = `vp-label ${l.cls}`;
      el.textContent = l.text;
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
export class Viewport {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  panes: Pane[] = [];
  model?: ModelBuffers;
  modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.15, roughness: 0.65, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  edgeMat = new THREE.LineBasicMaterial({ color: 0x2a3440, transparent: true, opacity: 0.55 });
  selMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x7a3300, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  selEdgeMat = new THREE.LineBasicMaterial({ color: 0xb34d00 });
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
    this.scene.background = new THREE.Color(0xeef1f4);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, -1, 1.4);
    this.scene.add(sun);
    this.scene.add(this.helpers, this.selGroup, this.measureGroup);
    this.layoutPanes(store.state.view.split);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.unsub = store.subscribe(() => this.sync(store.state));
    this.sync(store.state);
    this.resize();
    const loop = () => {
      if (this.disposed) return;
      if (this.dirty) { this.dirty = false; this.render(); }
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
    this.requestRender();
  }

  /** סנכרון מצב האפליקציה לסצנה. בונה מחדש רק מה שהשתנה. */
  sync(s: AppState) {
    if ((this.panes.length > 1) !== s.view.split) this.layoutPanes(s.view.split);
    const main = this.panes[0];
    if (main.projection !== s.view.projection) { main.setProjection(s.view.projection); }
    const visKey = `${s.hidden.join(',')}|${s.isolated?.join(',') ?? ''}`;
    if (s.derived !== this.lastDerived || visKey !== this.lastVisKey) {
      this.lastDerived = s.derived; this.lastVisKey = visKey;
      this.rebuildModel(s);
      this.lastSel = '';
      if (!this.firstFit && this.model && !this.model.box.isEmpty()) {
        this.firstFit = true;
        for (const p of this.panes) p.fit(this.model.box);
      }
    }
    const selKey = s.selection.join(',');
    if (selKey !== this.lastSel) { this.lastSel = selKey; this.rebuildSelection(s); }
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
    const vis = visibleMembers(s.derived, s.hidden, s.isolated);
    this.model = buildModel(vis, this.modelMat, this.edgeMat);
    this.scene.add(this.model.mesh, this.model.edges);
  }

  private rebuildSelection(s: AppState) {
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
    for (const m of [this.modelMat, this.edgeMat, this.selMat, this.selEdgeMat]) m.clippingPlanes = planes;
  }

  private rebuildHelpers(s: AppState) {
    for (const c of [...this.helpers.children]) { this.helpers.remove(c); (c as THREE.Line).geometry?.dispose(); }
    this.labels = [];
    const d = s.derived;
    const b = s.project.building;
    const unit = s.project.displayUnit;
    const fmt = (mm: number) => (unit === 'm' ? fromMm(mm, 'm').toFixed(2) : mm.toFixed(0));
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
      const dimLine = (a: Vec3, c: Vec3, tick: Vec3, text: string) => {
        pts.push(a.x, a.y, a.z, c.x, c.y, c.z);
        for (const p of [a, c]) pts.push(p.x - tick.x, p.y - tick.y, p.z - tick.z, p.x + tick.x, p.y + tick.y, p.z + tick.z);
        const dir = new THREE.Vector3(c.x - a.x, c.y - a.y, c.z - a.z).normalize();
        this.labels.push({ p: new THREE.Vector3((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2), text, cls: 'dim', dir });
      };
      const off = 1400;
      // רוחב, לפני המסגרת הראשונה
      dimLine({ x: x0, y: y0 - off, z }, { x: x1, y: y0 - off, z }, { x: 0, y: 200, z: 0 }, fmt(x1 - x0));
      // מרווחי מסגרות וסה"כ אורך לאורך ציר א
      for (let i = 1; i < ys.length; i++) dimLine({ x: x0 - off, y: ys[i - 1], z }, { x: x0 - off, y: ys[i], z }, { x: 200, y: 0, z: 0 }, fmt(ys[i] - ys[i - 1]));
      if (ys.length > 2) dimLine({ x: x0 - 2 * off, y: y0, z }, { x: x0 - 2 * off, y: y1, z }, { x: 200, y: 0, z: 0 }, fmt(y1 - y0));
      // גבהים במסגרת הראשונה
      dimLine({ x: x0 - off, y: y0, z }, { x: x0 - off, y: y0, z: b.eaveLeft }, { x: 200, y: 0, z: 0 }, fmt(b.eaveLeft - z));
      dimLine({ x: x1 + off, y: y0, z }, { x: x1 + off, y: y0, z: b.eaveRight }, { x: 200, y: 0, z: 0 }, fmt(b.eaveRight - z));
      if (d.roof.ridgeZ !== undefined) {
        dimLine({ x: b.ridgeX, y: y0 - off, z }, { x: b.ridgeX, y: y0 - off, z: d.roof.ridgeZ }, { x: 200, y: 0, z: 0 }, fmt(d.roof.ridgeZ - z));
      }
      // פריסת פטות: מידות לאורך השיפוע, לפני המסגרת הראשונה, מעט מעל מישור הגג
      const purl = d.members.filter((m) => m.purlin).sort((a, b) => a.purlin!.index - b.purlin!.index);
      for (const side of ['L', 'R', 'M'] as const) {
        const ls = purl.filter((m) => m.purlin!.side === side);
        if (!ls.length) continue;
        const n = ls[0].purlin!.roofNormal;
        const yy = Math.min(...ys) - b.purlinOverhangStart - 900;
        const lift = 450;
        const at = (x: number, zz: number) => ({ x: x + n.x * lift, y: yy, z: zz + n.z * lift });
        let prev = side === 'M' ? null : { x: b.ridgeX, z: d.roof.ridgeZ ?? 0 };
        for (const m of ls) {
          const cur = { x: m.start.x, z: m.start.z };
          if (prev) {
            const a = at(prev.x, prev.z), c = at(cur.x, cur.z);
            pts.push(a.x, a.y, a.z, c.x, c.y, c.z);
            for (const q of [a, c]) pts.push(q.x - n.x * 120, q.y, q.z - n.z * 120, q.x + n.x * 120, q.y, q.z + n.z * 120);
            const span = Math.hypot(cur.x - prev.x, cur.z - prev.z);
            const rem = m.purlin!.isLast && m.purlin!.index > 1 && Math.abs(span - (side === 'R' ? b.purlins.right : b.purlins.left).spacing) > 0.5;
            const dir = new THREE.Vector3(c.x - a.x, 0, c.z - a.z).normalize();
            this.labels.push({ p: new THREE.Vector3((a.x + c.x) / 2, yy, (a.z + c.z) / 2), text: fmt(span), cls: rem ? 'dim rem' : 'dim small', dir });
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
    for (const sp of d.splices) {
      this.labels.push({ p: new THREE.Vector3(sp.p.x, sp.p.y, sp.p.z), text: '◆', cls: 'splice' });
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
    return { ids, points, tri };
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
    if (!r.ids.length) {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) store.select([]);
      p.lastPick = undefined;
      return;
    }
    // לחיצה חוזרת באותה נקודה בוחרת את האלמנט הבא מאחור
    let idx = 0;
    const lp = p.lastPick;
    if (lp && Math.hypot(lp.x - e.clientX, lp.y - e.clientY) < 5 && lp.ids.join() === r.ids.join()) idx = (lp.i + 1) % r.ids.length;
    p.lastPick = { x: e.clientX, y: e.clientY, ids: r.ids, i: idx };
    const id = r.ids[idx];
    store.select([id], e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');
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

  fitSelection() {
    const s = store.state;
    const box = new THREE.Box3();
    for (const id of s.selection) {
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
