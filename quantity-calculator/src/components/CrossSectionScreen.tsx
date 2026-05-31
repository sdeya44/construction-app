import { useEffect, useRef, useState } from 'react';
import type { CrossSection, CrossSectionData, Project } from '../types';
import { useStore } from '../store/projectStore';
import { uid } from '../store/factory';
import {
  CS_COLORS,
  CS_H,
  CS_W,
  computeVolumes,
  drawSection,
  round2,
  sectionAreas,
} from '../lib/crossSection';

interface Props {
  project: Project;
  onClose: () => void;
}

function defaultData(): CrossSectionData {
  return { scaleW: 20, scaleH: 10, sections: [] };
}

function fmt(n: number): string {
  if (n == null || isNaN(n)) return '0';
  return round2(n).toLocaleString('he-IL', { maximumFractionDigits: 2 });
}

export function CrossSectionScreen({ project, onClose }: Props) {
  const { mutate, showToast } = useStore();
  const cs = project.crossSection ?? defaultData();
  const [editId, setEditId] = useState<string | null>(null);

  // עדכון נתוני החתכים בתוך הפרויקט (נשמר אוטומטית)
  function update(fn: (d: CrossSectionData) => void) {
    mutate((draft) => {
      if (!draft.crossSection) draft.crossSection = defaultData();
      fn(draft.crossSection);
    });
  }

  const { rows, spans, totCut, totFill } = computeVolumes(cs.sections, cs.scaleW, cs.scaleH);

  function addSection() {
    const sec: CrossSection = {
      id: uid('cs'),
      name: `חתך ${cs.sections.length + 1}`,
      station: '',
      dist: 10,
      existing: [],
      proposed: [],
    };
    update((d) => d.sections.push(sec));
    setEditId(sec.id);
  }

  return (
    <div className="cs-overlay">
      <div className="cs-topbar">
        <button className="btn" onClick={onClose}>← חזרה</button>
        <h2>כמויות חפירה / מילוי — חתכים</h2>
        <span className="cs-sub">שיטת שטח קצה ממוצע (Average End Area)</span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => printReport(project, cs)}>🖨 הפק דוח / PDF</button>
      </div>

      <div className="cs-content">
        {/* קנה מידה */}
        <div className="cs-card">
          <div className="cs-card-title">קנה מידה של הקנבס</div>
          <div className="cs-scale-row">
            <label className="field">
              <span>רוחב (מ׳)</span>
              <input
                type="number" min={1} step={1} value={cs.scaleW}
                onChange={(e) => update((d) => { d.scaleW = Math.max(1, +e.target.value || 20); })}
              />
            </label>
            <label className="field">
              <span>גובה (מ׳)</span>
              <input
                type="number" min={1} step={1} value={cs.scaleH}
                onChange={(e) => update((d) => { d.scaleH = Math.max(1, +e.target.value || 10); })}
              />
            </label>
          </div>
        </div>

        {/* סיכום נפחים */}
        <div className="cs-card">
          <div className="cs-card-title">סיכום נפחים ({cs.sections.length} חתכים)</div>
          <div className="cs-totals">
            <div className="cs-total cut">
              <div className="cs-total-num">{fmt(totCut)}</div>
              <div className="cs-total-lbl">חפירה מ״ק</div>
            </div>
            <div className="cs-total fill">
              <div className="cs-total-num">{fmt(totFill)}</div>
              <div className="cs-total-lbl">מילוי מ״ק</div>
            </div>
          </div>
          {spans.length > 0 && (
            <table className="cs-vol-table">
              <thead>
                <tr><th>מקטע</th><th>L (מ׳)</th><th>חפירה (מ״ק)</th><th>מילוי (מ״ק)</th></tr>
              </thead>
              <tbody>
                {spans.map((s, i) => (
                  <tr key={i}>
                    <td>{s.from.name} ← {s.to.name}</td>
                    <td>{fmt(s.L)}</td>
                    <td className="cut">{fmt(s.vCut)}</td>
                    <td className="fill">{fmt(s.vFill)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* רשימת חתכים */}
        <div className="cs-card">
          <div className="cs-card-title">חתכים</div>
          {rows.length === 0 && <div className="cs-empty">אין חתכים עדיין. הוסף חתך ראשון כדי להתחיל.</div>}
          <div className="cs-list">
            {rows.map((r) => (
              <SectionThumb key={r.sec.id} sec={r.sec} scaleW={cs.scaleW} scaleH={cs.scaleH}
                cut={r.areas.cut} fill={r.areas.fill} onClick={() => setEditId(r.sec.id)} />
            ))}
          </div>
          <button className="btn btn-primary cs-add" onClick={addSection}>➕ הוסף חתך</button>
        </div>
      </div>

      {editId && (
        <SectionEditor
          section={cs.sections.find((s) => s.id === editId)!}
          scaleW={cs.scaleW}
          scaleH={cs.scaleH}
          onChange={(fn) => update((d) => { const s = d.sections.find((x) => x.id === editId); if (s) fn(s); })}
          onDelete={() => { update((d) => { d.sections = d.sections.filter((x) => x.id !== editId); }); setEditId(null); }}
          onClose={() => setEditId(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function SectionThumb({ sec, scaleW, scaleH, cut, fill, onClick }: {
  sec: CrossSection; scaleW: number; scaleH: number; cut: number; fill: number; onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSection(ref.current, sec, scaleW, scaleH);
  }, [sec, scaleW, scaleH]);
  return (
    <div className="cs-thumb" onClick={onClick}>
      <canvas ref={ref} width={CS_W} height={CS_H} />
      <div className="cs-thumb-info">
        <div className="cs-thumb-name">{sec.name || 'חתך ללא שם'}</div>
        <div className="cs-thumb-sub">{sec.station ? `תחנה ${sec.station} · ` : ''}מרחק לבא: {fmt(+sec.dist || 0)} מ׳</div>
        <div className="cs-thumb-areas">
          <span className="cut">חפירה {fmt(cut)}</span> · <span className="fill">מילוי {fmt(fill)}</span> מ״ר
        </div>
      </div>
      <span className="cs-chev">‹</span>
    </div>
  );
}

type ProfileMode = 'existing' | 'proposed';

function SectionEditor({ section, scaleW, scaleH, onChange, onDelete, onClose, showToast }: {
  section: CrossSection;
  scaleW: number; scaleH: number;
  onChange: (fn: (s: CrossSection) => void) => void;
  onDelete: () => void;
  onClose: () => void;
  showToast: (m: string) => void;
}) {
  const [mode, setMode] = useState<ProfileMode>('existing');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) drawSection(canvasRef.current, section, scaleW, scaleH);
  }, [section, scaleW, scaleH]);

  const areas = sectionAreas(section, scaleW, scaleH);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * CS_W);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * CS_H);
    if (x < 0 || x > CS_W || y < 0 || y > CS_H) return;
    const arr = section[mode];
    const last = arr[arr.length - 1];
    if (last && x <= last.x) { showToast('יש לשרטט משמאל לימין'); return; }
    onChange((s) => s[mode].push({ x, y }));
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-wide cs-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>עריכת חתך</h3>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <label className="field field-wide"><span>שם החתך</span>
              <input value={section.name} onChange={(e) => onChange((s) => { s.name = e.target.value; })} placeholder="לדוגמה: חתך 1-1" />
            </label>
            <label className="field"><span>תחנה (אופציונלי)</span>
              <input value={section.station} onChange={(e) => onChange((s) => { s.station = e.target.value; })} placeholder="0+00" />
            </label>
            <label className="field"><span>מרחק לחתך הבא (מ׳)</span>
              <input type="number" min={0} step={0.5} value={section.dist}
                onChange={(e) => onChange((s) => { s.dist = +e.target.value || 0; })} />
            </label>
          </div>

          <div className="cs-legend">
            <span><i style={{ background: CS_COLORS.existing }} /> קיים</span>
            <span><i className="dash" style={{ background: CS_COLORS.proposed }} /> מתוכנן</span>
            <span><i style={{ background: CS_COLORS.cut }} /> חפירה</span>
            <span><i style={{ background: CS_COLORS.fill }} /> מילוי</span>
          </div>

          <canvas
            ref={canvasRef}
            width={CS_W}
            height={CS_H}
            className="cs-edit-canvas"
            onClick={handleClick}
          />
          <div className="cs-edit-hint">
            קנה מידה: {scaleW}מ׳ רוחב × {scaleH}מ׳ גובה · לחץ על הקנבס לסימון נקודות, משמאל לימין
          </div>

          <div className="cs-mode-row">
            <button className={'btn btn-sm' + (mode === 'existing' ? ' btn-primary' : '')} onClick={() => setMode('existing')}>פרופיל קיים</button>
            <button className={'btn btn-sm' + (mode === 'proposed' ? ' btn-primary' : '')} onClick={() => setMode('proposed')}>פרופיל מתוכנן</button>
            <button className="btn btn-sm" onClick={() => onChange((s) => { s[mode].pop(); })}>↶ בטל נקודה</button>
            <button className="btn btn-sm" onClick={() => onChange((s) => { s[mode] = []; })}>🗑 נקה</button>
          </div>

          <div className="cs-edit-areas">
            <div className="cut"><b>{fmt(areas.cut)}</b><span>חפירה מ״ר</span></div>
            <div className="fill"><b>{fmt(areas.fill)}</b><span>מילוי מ״ר</span></div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-danger" onClick={() => { if (confirm('למחוק את החתך?')) onDelete(); }}>מחק חתך</button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={onClose}>סיום</button>
        </div>
      </div>
    </div>
  );
}

// ── PDF / הדפסה ────────────────────────────────────────────────────────────
function printReport(project: Project, cs: CrossSectionData) {
  const { rows, spans, totCut, totFill } = computeVolumes(cs.sections, cs.scaleW, cs.scaleH);
  if (rows.length === 0) { alert('אין חתכים לייצוא'); return; }

  // צילום כל חתך לתמונה
  const imgs = rows.map((r) => {
    const cv = document.createElement('canvas');
    cv.width = CS_W;
    cv.height = CS_H;
    drawSection(cv, r.sec, cs.scaleW, cs.scaleH);
    return cv.toDataURL('image/png');
  });

  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const f = (n: number) => fmt(n);

  const secBlocks = rows.map((r, i) => `
    <div class="sec">
      <div class="sec-h">${esc(r.sec.name || 'חתך ' + (i + 1))}${r.sec.station ? ' · תחנה ' + esc(r.sec.station) : ''}</div>
      <img src="${imgs[i]}" class="sec-img">
      <table class="mini"><tr>
        <td>חפירה</td><td class="cut">${f(r.areas.cut)} מ״ר</td>
        <td>מילוי</td><td class="fill">${f(r.areas.fill)} מ״ר</td>
        <td>מרחק לבא</td><td>${f(+r.sec.dist || 0)} מ׳</td>
      </tr></table>
    </div>`).join('');

  const volRows = spans.map((s) => `<tr>
    <td>${esc(s.from.name)} ← ${esc(s.to.name)}</td>
    <td>${f(s.L)}</td>
    <td>${f(s.a1.cut)} / ${f(s.a2.cut)}</td>
    <td class="cut">${f(s.vCut)}</td>
    <td class="fill">${f(s.vFill)}</td>
  </tr>`).join('');

  const today = new Date().toLocaleDateString('he-IL');
  const html = `<!DOCTYPE html><html dir="rtl" lang="he"><head><meta charset="UTF-8">
  <style>
    *{font-family:'Segoe UI',Arial,sans-serif;box-sizing:border-box}
    body{margin:18px;direction:rtl;color:#1c2430;background:#fff;font-size:12px}
    h1{color:#1f5fb0;text-align:center;font-size:20px;margin:2px 0}
    .sub{color:#6b7686;text-align:center;font-size:12px;margin-bottom:14px}
    .meta{font-size:12px;margin-bottom:12px}
    .grid{display:flex;flex-wrap:wrap;gap:12px}
    .sec{width:calc(50% - 6px);border:1px solid #c9d0d9;border-radius:8px;padding:8px;page-break-inside:avoid}
    .sec-h{font-weight:700;font-size:13px;margin-bottom:6px;color:#2a3441}
    .sec-img{width:100%;height:auto;border:1px solid #eee;border-radius:6px;background:#fbfbf8}
    table{width:100%;border-collapse:collapse;margin-top:8px}
    .mini td{padding:4px 5px;font-size:10px;border:1px solid #e3e7ec;text-align:center}
    h3{color:#1f5fb0;margin:22px 0 6px;font-size:15px}
    .vol th{background:#2a3441;color:#fff;padding:8px 6px;font-size:11px}
    .vol td{padding:7px 6px;border:1px solid #c9d0d9;font-size:11px;text-align:center}
    .vol tfoot td{background:#2a3441;color:#fff;font-weight:700}
    .cut{color:#c0392b;font-weight:700}.fill{color:#1f5fb0;font-weight:700}
    .sign{margin-top:26px;display:flex;gap:40px}
    .sign div{flex:1;text-align:center;border-top:1px solid #2a3441;padding-top:4px;font-size:11px;color:#6b7686}
    @media print{body{margin:8px}@page{size:A4;margin:10mm}}
  </style></head><body>
    <h1>כמויות חפירה ומילוי — חתכים</h1>
    <div class="sub">שיטת שטח קצה ממוצע (Average End Area) · קנה מידה ${cs.scaleW}×${cs.scaleH} מ׳ · ${today}</div>
    <div class="meta"><b>פרויקט:</b> ${esc(project.name)} ${project.projectNumber ? ' · מס׳ ' + esc(project.projectNumber) : ''}
      ${project.preparedBy ? ' · מכין החישוב: ' + esc(project.preparedBy) : ''}</div>

    <h3>חתכים (${rows.length})</h3>
    <div class="grid">${secBlocks}</div>

    <h3>נפחים בין חתכים</h3>
    <table class="vol">
      <thead><tr><th>מקטע</th><th>אורך L (מ׳)</th><th>שטחי חפירה A1/A2 (מ״ר)</th><th>נפח חפירה (מ״ק)</th><th>נפח מילוי (מ״ק)</th></tr></thead>
      <tbody>${volRows || '<tr><td colspan="5">דרושים לפחות שני חתכים לחישוב נפח</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">סה״כ</td><td>${f(totCut)}</td><td>${f(totFill)}</td></tr></tfoot>
    </table>

    <div class="sign"><div>חתימת מכין החישוב</div><div>בדיקת מהנדס</div></div>
  </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('יש לאשר חלונות קופצים'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 600);
}
