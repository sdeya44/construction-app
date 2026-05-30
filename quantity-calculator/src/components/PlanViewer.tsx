import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalcRow, PageScale, Project } from '../types';
import { useStore } from '../store/projectStore';
import { Point, dist, polygonArea, polylineLength, pixelAreaToM2, pixelsToMeters } from '../lib/geometry';
import { fmt, round } from '../lib/calc';
import { Modal } from './Modal';

export type Tool = 'pan' | 'scale' | 'length' | 'area' | 'count';

interface Props {
  project: Project;
  tool: Tool;
  setTool: (t: Tool) => void;
  onMeasured: (initial: Partial<CalcRow>) => void;
}

interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
  rotation: number; // 0/90/180/270
}

const FIT_MARGIN = 0.96;

export function PlanViewer({ project, tool, setTool, onMeasured }: Props) {
  const { ui, selectPage, setPageScale } = useStore();
  const page = project.pages.find((p) => p.id === ui.selectedPageId) ?? null;

  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [view, setView] = useState<ViewTransform>({ zoom: 1, panX: 0, panY: 0, rotation: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [points, setPoints] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [pendingScale, setPendingScale] = useState<number | null>(null); // מרחק בפיקסלים שממתין להזנת מטרים
  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  // התאמה למסך
  const fit = useCallback(
    (nat = natural, rotation = view.rotation) => {
      const vp = viewportRef.current;
      if (!vp || !nat.w || !nat.h) return;
      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const rotated = rotation % 180 !== 0;
      const cw = rotated ? nat.h : nat.w;
      const ch = rotated ? nat.w : nat.h;
      const zoom = Math.min(vw / cw, vh / ch) * FIT_MARGIN;
      const panX = vw / 2 - (nat.w / 2) * zoom;
      const panY = vh / 2 - (nat.h / 2) * zoom;
      setView({ zoom, panX, panY, rotation });
    },
    [natural, view.rotation],
  );

  // טעינת תמונת העמוד
  useEffect(() => {
    setPoints([]);
    if (!page?.dataUrl) {
      setNatural({ w: 0, h: 0 });
      return;
    }
    const img = new Image();
    img.onload = () => {
      const nat = { w: img.naturalWidth, h: img.naturalHeight };
      setNatural(nat);
      fit(nat, 0);
    };
    img.src = page.dataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, page?.dataUrl]);

  // נקה מדידה בעת החלפת כלי
  useEffect(() => setPoints([]), [tool]);

  /** ממיר נקודת מסך לקואורדינטות תמונה טבעיות (מטפל בזום/pan/סיבוב) */
  function screenToImage(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: loc.x, y: loc.y };
  }

  const scale = page?.scale;
  const needsScale = tool === 'length' || tool === 'area';
  const hasScale = !!scale?.pixelsPerMeter;

  function handleSvgClick(e: React.MouseEvent) {
    if (tool === 'pan') return;
    if (needsScale && !hasScale) return; // אזהרה מוצגת בנפרד
    const p = screenToImage(e.clientX, e.clientY);
    if (!p) return;

    if (tool === 'scale') {
      const next = [...points, p];
      if (next.length === 2) {
        const px = dist(next[0], next[1]);
        setPoints(next);
        setPendingScale(px);
      } else {
        setPoints([p]);
      }
      return;
    }
    setPoints((prev) => [...prev, p]);
  }

  function finishMeasurement() {
    if (!page) return;
    if (tool === 'length' && points.length >= 2) {
      const px = polylineLength(points);
      const meters = round(pixelsToMeters(px, scale!.pixelsPerMeter));
      onMeasured({ type: 'measured_length', measuredValue: meters, unit: 'מ׳', page: page.name, length: meters });
      setPoints([]);
    } else if (tool === 'area' && points.length >= 3) {
      const pxArea = polygonArea(points);
      const m2 = round(pixelAreaToM2(pxArea, scale!.pixelsPerMeter));
      onMeasured({ type: 'measured_area', measuredValue: m2, unit: 'מ״ר', page: page.name });
      setPoints([]);
    } else if (tool === 'count' && points.length >= 1) {
      onMeasured({ type: 'count', count: points.length, unit: 'יח׳', page: page.name });
      setPoints([]);
    }
  }

  function applyScale(meters: number) {
    if (pendingScale && meters > 0 && page) {
      const newScale: PageScale = {
        pixelsPerMeter: pendingScale / meters,
        refPixels: round(pendingScale, 1),
        refMeters: meters,
      };
      setPageScale(page.id, newScale);
    }
    setPendingScale(null);
    setPoints([]);
    setTool('pan');
  }

  // Pan
  function onPointerDown(e: React.MouseEvent) {
    if (tool !== 'pan') return;
    panState.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  }
  function onPointerMove(e: React.MouseEvent) {
    if (tool !== 'pan' && tool !== 'scale' && tool !== 'length' && tool !== 'area') {
      // עדיין נעדכן סמן עבור count אם רוצים, אך לא חובה
    }
    if (panState.current) {
      const dx = e.clientX - panState.current.x;
      const dy = e.clientY - panState.current.y;
      setView((v) => ({ ...v, panX: panState.current!.panX + dx, panY: panState.current!.panY + dy }));
      return;
    }
    if (points.length > 0 && (tool === 'length' || tool === 'area')) {
      setCursor(screenToImage(e.clientX, e.clientY));
    }
  }
  function onPointerUp() {
    panState.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const vp = viewportRef.current;
    if (!vp) return;
    const rect = vp.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const newZoom = Math.min(40, Math.max(0.05, v.zoom * factor));
      const sx = (cx - v.panX) / v.zoom;
      const sy = (cy - v.panY) / v.zoom;
      return { ...v, zoom: newZoom, panX: cx - sx * newZoom, panY: cy - sy * newZoom };
    });
  }

  function rotate() {
    const rotation = (view.rotation + 90) % 360;
    fit(natural, rotation);
  }

  // תצוגת ערך חי
  let liveText = '';
  if ((tool === 'length' || tool === 'area') && hasScale && points.length > 0) {
    const pts = cursor ? [...points, cursor] : points;
    if (tool === 'length' && pts.length >= 2) {
      liveText = `אורך: ${fmt(pixelsToMeters(polylineLength(pts), scale!.pixelsPerMeter))} מ׳`;
    } else if (tool === 'area' && pts.length >= 3) {
      liveText = `שטח: ${fmt(pixelAreaToM2(polygonArea(pts), scale!.pixelsPerMeter))} מ״ר`;
    }
  }
  if (tool === 'count') liveText = `נספרו: ${points.length} פריטים`;

  const cursorStyle = tool === 'pan' ? (panState.current ? 'grabbing' : 'grab') : 'crosshair';
  const sw = (n: number) => n / view.zoom; // עובי קו קבוע על המסך

  return (
    <div className="panel plan-panel">
      <div className="panel-head">
        <h2>אזור עבודה</h2>
        <div className="page-tabs">
          {project.pages.map((p) => (
            <button
              key={p.id}
              className={'page-tab' + (p.id === ui.selectedPageId ? ' active' : '')}
              onClick={() => selectPage(p.id)}
              title={p.scale ? 'קנה מידה הוגדר' : 'ללא קנה מידה'}
            >
              {p.scale ? '📐 ' : ''}{p.name}
            </button>
          ))}
        </div>
      </div>

      {/* פס כלי תצוגה */}
      {page && (
        <div className="view-tools">
          <button className="btn btn-sm" onClick={() => fit()} title="התאמה למסך">⤢ התאם</button>
          <button className="btn btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.min(40, v.zoom * 1.2) }))}>＋</button>
          <button className="btn btn-sm" onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) }))}>－</button>
          <button className="btn btn-sm" onClick={rotate} title="סיבוב 90°">⟳</button>
          <span className="zoom-ind">{Math.round(view.zoom * 100)}%</span>
          <span style={{ flex: 1 }} />
          {scale ? (
            <span className="scale-badge ok">קנה מידה: {fmt(scale.refPixels, 0)} פיקסלים = {fmt(scale.refMeters)} מ׳</span>
          ) : (
            <span className="scale-badge none">לא הוגדר קנה מידה</span>
          )}
        </div>
      )}

      <div
        className="viewport"
        ref={viewportRef}
        onWheel={onWheel}
        style={{ cursor: cursorStyle }}
      >
        {!page && <div className="viewport-empty">לא נטענה תוכנית. לחץ על "ייבוא תוכנית" כדי להעלות PDF או תמונה.</div>}

        {needsScale && !hasScale && page && (
          <div className="scale-warning">⚠ יש להגדיר קנה מידה לעמוד זה לפני מדידה. לחץ על "קביעת קנה מידה".</div>
        )}

        {page && (
          <div
            className="stage"
            style={{
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
              transformOrigin: '0 0',
            }}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
          >
            <div
              className="rot"
              style={{
                width: natural.w,
                height: natural.h,
                transform: `rotate(${view.rotation}deg)`,
                transformOrigin: 'center center',
                position: 'relative',
              }}
            >
              <img ref={imgRef} src={page.dataUrl} width={natural.w} height={natural.h} draggable={false} alt={page.name} />
              <svg
                ref={svgRef}
                width={natural.w}
                height={natural.h}
                viewBox={`0 0 ${natural.w} ${natural.h}`}
                style={{ position: 'absolute', inset: 0 }}
                onClick={handleSvgClick}
                onDoubleClick={() => { if (tool === 'length' || tool === 'area') finishMeasurement(); }}
              >
                {/* פוליגון/קו בתהליך */}
                {tool === 'area' && points.length >= 2 && (
                  <polygon
                    points={[...points, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="rgba(37,99,235,0.18)"
                    stroke="#2563eb"
                    strokeWidth={sw(2)}
                  />
                )}
                {(tool === 'length' || tool === 'scale') && points.length >= 1 && (
                  <polyline
                    points={[...points, ...(cursor && tool === 'length' ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={tool === 'scale' ? '#dc2626' : '#2563eb'}
                    strokeWidth={sw(2)}
                  />
                )}
                {points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={sw(4)} fill={tool === 'scale' ? '#dc2626' : tool === 'count' ? '#16a34a' : '#2563eb'} stroke="#fff" strokeWidth={sw(1)} />
                ))}
                {tool === 'count' && points.map((p, i) => (
                  <text key={'t' + i} x={p.x} y={p.y - sw(7)} fontSize={sw(13)} textAnchor="middle" fill="#16a34a" fontWeight="bold">{i + 1}</text>
                ))}
              </svg>
            </div>
          </div>
        )}

        {/* בקרת מדידה צפה */}
        {tool !== 'pan' && page && (hasScale || tool === 'count' || tool === 'scale') && (
          <div className="measure-hud">
            <div className="mh-title">
              {tool === 'scale' && 'כיול קנה מידה: סמן שתי נקודות'}
              {tool === 'length' && 'מדידת אורך: לחץ נקודות, לחיצה כפולה לסיום'}
              {tool === 'area' && 'מדידת שטח: לחץ נקודות, לחיצה כפולה לסיום'}
              {tool === 'count' && 'ספירה: לחץ על כל פריט'}
            </div>
            {liveText && <div className="mh-live">{liveText}</div>}
            <div className="mh-btns">
              {tool !== 'scale' && <button className="btn btn-sm btn-primary" onClick={finishMeasurement}>סיום</button>}
              <button className="btn btn-sm" onClick={() => setPoints([])}>נקה</button>
              <button className="btn btn-sm" onClick={() => setTool('pan')}>בטל כלי</button>
            </div>
          </div>
        )}
      </div>

      {pendingScale !== null && (
        <ScalePrompt
          pixels={pendingScale}
          onConfirm={applyScale}
          onCancel={() => { setPendingScale(null); setPoints([]); }}
        />
      )}
    </div>
  );
}

function ScalePrompt({ pixels, onConfirm, onCancel }: { pixels: number; onConfirm: (m: number) => void; onCancel: () => void }) {
  const [meters, setMeters] = useState('');
  const m = Number(meters);
  return (
    <Modal
      title="קביעת קנה מידה"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>ביטול</button>
          <button className="btn btn-primary" disabled={!(m > 0)} onClick={() => onConfirm(m)}>הגדר קנה מידה</button>
        </>
      }
    >
      <p>סימנת קו באורך <b>{fmt(pixels, 1)}</b> פיקסלים על התוכנית.</p>
      <label className="field field-wide">
        <span>הזן את האורך האמיתי במטרים</span>
        <input autoFocus type="number" step="any" value={meters} onChange={(e) => setMeters(e.target.value)} placeholder="לדוגמה: 5.00" />
      </label>
      {m > 0 && <p className="hint">קנה מידה: {fmt(pixels / m, 1)} פיקסלים = 1 מטר</p>}
    </Modal>
  );
}
