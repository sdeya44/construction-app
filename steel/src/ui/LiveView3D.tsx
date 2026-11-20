import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { buildRealScene, fitCamera, RealRenderer, type BuiltScene, type RealSet } from '../view/realView';

/**
 * 1.55: תצוגה תלת-ממדית ריאליסטית וחיה של רכיב — בחלון הרכיב.
 * נבנית מחדש בכל שינוי במודל (rev), שומרת את כיוון המבט. גרירה מסובבת, גלגלת מקרבת, לחיצה כפולה מאפסת.
 */
export function LiveView3D({ set, rev, modes, height = 300 }: { set: RealSet | null; rev: unknown; modes?: ReactNode; height?: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const tagBox = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ rr: RealRenderer; cam: THREE.PerspectiveCamera; built: BuiltScene | null; tagLines: THREE.Group | null; orbit: { th: number; ph: number; zoom: number }; key: string; dirty: boolean; raf: number } | null>(null);
  const setRef = useRef(set); setRef.current = set;
  const [ok, setOk] = useState(true);
  const [, force] = useState(0);

  useEffect(() => {
    const c = cv.current!;
    let rr: RealRenderer;
    try { rr = new RealRenderer(c); } catch { setOk(false); return; }
    rr.R.setPixelRatio(Math.min(2, devicePixelRatio));
    const cam = new THREE.PerspectiveCamera(30, 1, 10, 1e6); cam.up.set(0, 0, 1);
    ctx.current = { rr, cam, built: null, tagLines: null, orbit: { th: -0.8, ph: 0.25, zoom: 1 }, key: '', dirty: true, raf: 0 };
    const loop = () => {
      const k = ctx.current; if (!k) return;
      if (k.dirty && k.built) {
        const fb = k.built.box;
        fitCamera(cam, fb, k.orbit.th, k.orbit.ph, k.orbit.zoom);
        rr.R.render(k.built.scene, cam); k.dirty = false;
        // תגיות מידה (HTML) מעל אמצע הקטע
        const box = tagBox.current, tags = setRef.current?.tags ?? [];
        if (box) {
          const W = c.clientWidth, H = c.clientHeight;
          box.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => {
            const tg = tags[Number(el.dataset.i)]; if (!tg) return;
            const q = tg.at ?? { x: (tg.a.x + tg.b.x) / 2, y: (tg.a.y + tg.b.y) / 2, z: (tg.a.z + tg.b.z) / 2 };
            const m = new THREE.Vector3(q.x, q.y, q.z).project(cam);
            el.style.left = `${((m.x + 1) / 2) * W}px`; el.style.top = `${((1 - m.y) / 2) * H}px`;
            el.style.display = m.z < 1 && Math.abs(m.x) < 1.05 && Math.abs(m.y) < 1.05 ? '' : 'none';
          });
          // תגיות שעולות זו על זו — מזיזים למטה עד שאין חפיפה
          const els = [...box.querySelectorAll<HTMLElement>('[data-i]')].filter((e) => e.style.display !== 'none');
          const placed: { x: number; y: number; w: number; h: number }[] = [];
          els.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).forEach((el) => {
            const w = el.offsetWidth + 6, h = el.offsetHeight + 4, x = parseFloat(el.style.left);
            let y = parseFloat(el.style.top);
            for (let it = 0; it < 12; it++) { const hit = placed.find((q) => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < (q.h + h) / 2); if (!hit) break; y = hit.y + (hit.h + h) / 2; }
            el.style.top = `${Math.min(H - h / 2, y)}px`; placed.push({ x, y, w, h });
          });
        }
      }
      k.raf = requestAnimationFrame(loop);
    };
    loop();
    const ro = new ResizeObserver(() => { const W = c.clientWidth, H = c.clientHeight; if (!W || !H) return; rr.R.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); if (ctx.current) ctx.current.dirty = true; });
    ro.observe(c);
    // גרירה / גלגלת / לחיצה כפולה
    let drag: { x: number; y: number; th: number; ph: number } | null = null;
    const down = (e: PointerEvent) => { const k = ctx.current; if (!k) return; drag = { x: e.clientX, y: e.clientY, th: k.orbit.th, ph: k.orbit.ph }; c.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => { const k = ctx.current; if (!k || !drag) return; k.orbit.th = drag.th - (e.clientX - drag.x) * 0.008; k.orbit.ph = Math.max(-0.05, Math.min(1.45, drag.ph + (e.clientY - drag.y) * 0.006)); k.dirty = true; };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => { const k = ctx.current; if (!k) return; e.preventDefault(); k.orbit.zoom = Math.max(0.5, Math.min(4, k.orbit.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); k.dirty = true; };
    const dbl = () => { const k = ctx.current, s = setRef.current; if (!k) return; k.orbit = { th: s?.dir?.th ?? -0.8, ph: s?.dir?.ph ?? 0.25, zoom: 1 }; k.dirty = true; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('dblclick', dbl);
    force((x) => x + 1);
    return () => {
      cancelAnimationFrame(ctx.current?.raf ?? 0); ro.disconnect();
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      c.removeEventListener('wheel', wheel); c.removeEventListener('dblclick', dbl);
      ctx.current?.built?.dispose(); rr.dispose(); ctx.current = null;
    };
  }, []);

  // בנייה מחדש בכל שינוי במודל; מבט חדש רק כשמתחלף מה שמוצג (מפתח / צומת אחר)
  useEffect(() => {
    const k = ctx.current; if (!k || !set) return;
    k.built?.dispose();
    try { k.built = buildRealScene(set, k.rr.env, 2048); } catch (e) { console.warn('תצוגה תלת-ממדית: לא ניתן לבנות', e); k.built = null; return; }
    // קווי מידה (כחול) — מתחת לתגיות
    const g = new THREE.Group();
    for (const t of set.tags ?? []) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(t.a.x, t.a.y, t.a.z), new THREE.Vector3(t.b.x, t.b.y, t.b.z)]);
      const ln = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: t.hot ? 0xe07b1a : 0x2563a8, depthTest: false, transparent: true, opacity: 0.85 }));
      ln.renderOrder = 10; g.add(ln);
    }
    k.built.scene.add(g); k.tagLines = g;
    if (k.key !== set.key) { k.orbit = { th: set.dir?.th ?? -0.8, ph: set.dir?.ph ?? 0.25, zoom: 1 }; k.key = set.key; }
    k.dirty = true;
  }, [set?.key, rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const turn = (dt: number) => { const k = ctx.current; if (!k) return; k.orbit.th += dt; k.dirty = true; };
  const view = (v: 'iso' | 'front') => { const k = ctx.current, s = setRef.current; if (!k) return; const th0 = s?.dir?.th ?? -0.8; k.orbit = v === 'iso' ? { th: th0, ph: s?.dir?.ph ?? 0.25, zoom: 1 } : { th: Math.round(th0 / (Math.PI / 2)) * (Math.PI / 2), ph: 0.02, zoom: 1 }; k.dirty = true; };
  return (
    <div className="live3d" data-testid="live3d">
      <div className="live3d-stage" style={{ height }}>
        <canvas ref={cv} className="live3d-cv" data-testid="live3d-canvas" aria-label="תצוגה תלת-ממדית חיה של הרכיב" />
        <div ref={tagBox} className="live3d-tags" aria-hidden="true">
          {(set?.tags ?? []).map((t, i) => t.onLock
            ? <button key={`${set?.key}-${i}`} data-i={i} className={`live3d-tag lk${t.lock ? ' on' : ''}${t.hot ? ' hot' : ''}`} onClick={t.onLock} data-testid={t.id ? `tag-${t.id}` : undefined} title={t.lock ? 'מידה קובעת — לחיצה משחררת' : 'לחיצה: המידה הזו תקבע (ומשחררת את הקובעת הוותיקה)'}><LockIc on={!!t.lock} />{t.text}</button>
            : <span key={`${set?.key}-${i}`} data-i={i} className={`live3d-tag${t.hot ? ' hot' : ''}`}>{t.text}</span>)}
        </div>
        {!set && <div className="live3d-empty">אין עדיין אלמנטים ברכיב — הוספה בהגדרות</div>}
        {!ok && <div className="live3d-empty">תצוגת תלת-ממד אינה זמינה בדפדפן זה</div>}
        <span className="live3d-live"><i />חי</span>
      </div>
      <div className="live3d-bar">
        <button className="vbtn" onClick={() => turn(0.35)} aria-label="סיבוב שמאלה" title="סיבוב" data-testid="live3d-rot-l">⟲</button>
        <button className="vbtn" onClick={() => turn(-0.35)} aria-label="סיבוב ימינה" title="סיבוב" data-testid="live3d-rot-r">⟳</button>
        <button className="vbtn" onClick={() => view('iso')} data-testid="live3d-iso">איזומטרי</button>
        <button className="vbtn" onClick={() => view('front')} data-testid="live3d-front">חזית</button>
        <span className="sp" />
        {modes}
      </div>
    </div>
  );
}

/** מנעול: סגור = המידה קובעת; פתוח = נגזרת */
export function LockIc({ on }: { on: boolean }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" />{on ? <path d="M8 11V8a4 4 0 0 1 8 0v3" /> : <path d="M8 11V8a4 4 0 0 1 7.5-2" />}</svg>;
}
