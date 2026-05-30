import { useState } from 'react';
import type { CalcRow, Project, Section } from '../types';
import { computeRow, fmt, grandTotals, round, summarizeBySection } from '../lib/calc';

type ReportType = 'all' | 'single' | 'summary';

interface Props {
  project: Project;
  onClose: () => void;
}

export function ReportA4({ project, onClose }: Props) {
  const [type, setType] = useState<ReportType>('all');
  const [showFormulas, setShowFormulas] = useState(true);
  const [sectionId, setSectionId] = useState<string>(project.sections[0]?.id ?? '');

  const sectionsToShow: Section[] =
    type === 'single' ? project.sections.filter((s) => s.id === sectionId) : project.sections;

  // סעיפים שיש בהם שורות + שורות ללא סעיף
  const rowsBySection = (id: string | null) => project.rows.filter((r) => r.sectionId === id);
  const unassigned = rowsBySection(null);

  return (
    <div className="report-overlay">
      <div className="report-toolbar">
        <button className="btn" onClick={onClose}>← חזרה</button>
        <span className="rt-sep" />
        <label className="rt-field">
          סוג דוח:
          <select value={type} onChange={(e) => setType(e.target.value as ReportType)}>
            <option value="all">כל הסעיפים (מפורט)</option>
            <option value="single">סעיף בודד</option>
            <option value="summary">סיכום בלבד</option>
          </select>
        </label>
        {type === 'single' && (
          <label className="rt-field">
            סעיף:
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {project.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
              ))}
            </select>
          </label>
        )}
        {type !== 'summary' && (
          <label className="rt-check">
            <input type="checkbox" checked={showFormulas} onChange={(e) => setShowFormulas(e.target.checked)} />
            הצג נוסחאות
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 הדפסה / שמירה כ-PDF</button>
      </div>

      <div className="report-pages">
        {type === 'summary' ? (
          <SummarySheet project={project} />
        ) : (
          <>
            {sectionsToShow
              .filter((s) => rowsBySection(s.id).length > 0)
              .map((s) => (
                <DetailSheet
                  key={s.id}
                  project={project}
                  section={s}
                  rows={rowsBySection(s.id)}
                  showFormulas={showFormulas}
                />
              ))}
            {type === 'all' && unassigned.length > 0 && (
              <DetailSheet
                project={project}
                section={{ id: '', code: '', name: 'שורות ללא סעיף', unit: '', description: '' }}
                rows={unassigned}
                showFormulas={showFormulas}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ReportHeader({ project }: { project: Project }) {
  return (
    <div className="rp-header">
      <div className="rp-title">דף חישוב כמויות</div>
      <table className="rp-meta">
        <tbody>
          <tr>
            <td className="k">פרויקט</td><td className="v">{project.name}</td>
            <td className="k">מס׳ פרויקט</td><td className="v">{project.projectNumber}</td>
          </tr>
          <tr>
            <td className="k">מזמין</td><td className="v">{project.client}</td>
            <td className="k">תאריך</td><td className="v">{project.date}</td>
          </tr>
          <tr>
            <td className="k">קבלן</td><td className="v">{project.contractor}</td>
            <td className="k">מכין החישוב</td><td className="v">{project.preparedBy}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ReportFooter({ subtotalText, project }: { subtotalText?: string; project: Project }) {
  return (
    <div className="rp-footer">
      {subtotalText && <div className="rp-subtotal">{subtotalText}</div>}
      {project.notes && <div className="rp-notes"><b>הערות:</b> {project.notes}</div>}
      <div className="rp-signatures">
        <div className="rp-sign"><div className="rp-line" /><span>חתימת מכין החישוב</span></div>
        <div className="rp-sign"><div className="rp-line" /><span>בדיקת מהנדס</span></div>
      </div>
    </div>
  );
}

function DetailSheet({ project, section, rows, showFormulas }: { project: Project; section: Omit<Section, 'unit'> & { unit: string }; rows: CalcRow[]; showFormulas: boolean }) {
  const subtotal = round(rows.reduce((a, r) => a + computeRow(r).quantity, 0));
  return (
    <div className="sheet">
      <ReportHeader project={project} />
      <div className="rp-section-title">
        {section.code && <span className="rp-code">{section.code}</span>}
        <span>{section.name}</span>
        {section.description && <span className="rp-sdesc"> — {section.description}</span>}
      </div>
      <table className="rp-table">
        <thead>
          <tr>
            <th className="c-no">מס׳</th>
            <th className="c-desc">תיאור החישוב</th>
            <th className="c-page">עמוד</th>
            {showFormulas && <th className="c-formula">נוסחה</th>}
            <th className="c-qty">כמות</th>
            <th className="c-unit">יח׳</th>
            <th className="c-note">הערה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const { quantity, formula } = computeRow(r);
            const ded = r.kind === 'deduction';
            return (
              <tr key={r.id} className={ded ? 'rp-ded' : ''}>
                <td className="c-no">{i + 1}</td>
                <td className="c-desc">{r.description}{ded && <span className="rp-ded-tag"> (הפחתה)</span>}</td>
                <td className="c-page">{r.page}</td>
                {showFormulas && <td className="c-formula">{formula}</td>}
                <td className="c-qty">{fmt(quantity)}</td>
                <td className="c-unit">{r.unit}</td>
                <td className="c-note">{r.note}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="rp-total">
            <td colSpan={showFormulas ? 4 : 3}>סה״כ סעיף {section.name}</td>
            <td className="c-qty">{fmt(subtotal)}</td>
            <td className="c-unit">{section.unit || rows[0]?.unit}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <ReportFooter project={project} />
    </div>
  );
}

function SummarySheet({ project }: { project: Project }) {
  const summaries = summarizeBySection(project.rows);
  const totals = grandTotals(project.rows);
  return (
    <div className="sheet">
      <ReportHeader project={project} />
      <div className="rp-section-title"><span>סיכום כמויות לפי סעיפים</span></div>
      <table className="rp-table">
        <thead>
          <tr>
            <th className="c-no">מס׳</th>
            <th>קוד סעיף</th>
            <th className="c-desc">תיאור סעיף</th>
            <th>שורות</th>
            <th className="c-qty">כמות נטו</th>
            <th className="c-unit">יח׳</th>
          </tr>
        </thead>
        <tbody>
          {project.sections.map((s, i) => {
            const sum = summaries.get(s.id);
            if (!sum) return null;
            return (
              <tr key={s.id}>
                <td className="c-no">{i + 1}</td>
                <td>{s.code}</td>
                <td className="c-desc">{s.name}</td>
                <td>{sum.rowCount}</td>
                <td className="c-qty">{fmt(sum.total)}</td>
                <td className="c-unit">{s.unit}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="rp-total">
            <td colSpan={4}>סה״כ שורות בפרויקט: {totals.rowCount}</td>
            <td className="c-qty">—</td>
            <td className="c-unit"></td>
          </tr>
        </tfoot>
      </table>
      <ReportFooter project={project} />
    </div>
  );
}
