import { useMemo, useState } from 'react';
import type { CalcRow, CalcType, Section, Unit } from '../types';
import { CALC_TYPES, UNITS, calcTypeMeta } from '../types';
import { computeRow } from '../lib/calc';
import { Modal } from './Modal';

interface Props {
  initial: Partial<CalcRow>;
  sections: Section[];
  pages: { id: string; name: string }[];
  onSave: (row: Partial<CalcRow>) => void;
  onClose: () => void;
}

const numOrNull = (v: string): number | null => {
  if (v.trim() === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export function RowEditor({ initial, sections, pages, onSave, onClose }: Props) {
  const [type, setType] = useState<CalcType>(initial.type ?? 'box_volume');
  const [sectionId, setSectionId] = useState<string | null>(initial.sectionId ?? sections[0]?.id ?? null);
  const [description, setDescription] = useState(initial.description ?? '');
  const [page, setPage] = useState(initial.page ?? '');
  const [length, setLength] = useState(initial.length != null ? String(initial.length) : '');
  const [width, setWidth] = useState(initial.width != null ? String(initial.width) : '');
  const [height, setHeight] = useState(initial.height != null ? String(initial.height) : '');
  const [count, setCount] = useState(String(initial.count ?? 1));
  const [coefficient, setCoefficient] = useState(String(initial.coefficient ?? 1));
  const [unit, setUnit] = useState<Unit>(initial.unit ?? calcTypeMeta(type).unit);
  const [note, setNote] = useState(initial.note ?? '');
  const [kind, setKind] = useState(initial.kind ?? 'normal');

  const meta = calcTypeMeta(type);
  const measured = type === 'measured_length' || type === 'measured_area';

  const draft: CalcRow = useMemo(
    () => ({
      id: initial.id ?? 'preview',
      sectionId,
      description,
      page,
      type,
      length: numOrNull(length),
      width: numOrNull(width),
      height: numOrNull(height),
      count: Number(count) || 1,
      coefficient: Number(coefficient) || 1,
      unit,
      note,
      kind,
      measuredValue: initial.measuredValue,
      createdAt: initial.createdAt ?? Date.now(),
    }),
    [sectionId, description, page, type, length, width, height, count, coefficient, unit, note, kind, initial],
  );

  const { quantity, formula } = computeRow(draft);

  function changeType(t: CalcType) {
    setType(t);
    const m = calcTypeMeta(t);
    setUnit(m.unit);
  }

  function handleSave() {
    onSave({
      sectionId,
      description,
      page,
      type,
      length: numOrNull(length),
      width: numOrNull(width),
      height: numOrNull(height),
      count: Number(count) || 1,
      coefficient: Number(coefficient) || 1,
      unit,
      note,
      kind,
      measuredValue: initial.measuredValue,
    });
  }

  return (
    <Modal
      title={initial.id ? 'עריכת שורת חישוב' : 'הוספת חישוב ידני'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>ביטול</button>
          <button className="btn btn-primary" onClick={handleSave}>שמירה</button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          <span>סוג חישוב</span>
          <select value={type} onChange={(e) => changeType(e.target.value as CalcType)} disabled={measured}>
            {CALC_TYPES.filter((c) => (measured ? true : !c.fromPlanOnly)).map((c) => (
              <option key={c.type} value={c.type}>{c.label}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>סעיף</span>
          <select value={sectionId ?? ''} onChange={(e) => setSectionId(e.target.value || null)}>
            <option value="">— ללא סעיף —</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.code ? s.code + ' · ' : ''}{s.name}</option>
            ))}
          </select>
        </label>

        <label className="field field-wide">
          <span>תיאור החישוב</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="לדוגמה: קיר בטון ציר A" />
        </label>

        <label className="field">
          <span>עמוד / תוכנית</span>
          <input list="pages-list" value={page} onChange={(e) => setPage(e.target.value)} placeholder="עמוד מקור" />
          <datalist id="pages-list">
            {pages.map((p) => <option key={p.id} value={p.name} />)}
          </datalist>
        </label>

        {measured && (
          <label className="field">
            <span>ערך שנמדד</span>
            <input value={initial.measuredValue ?? 0} readOnly />
          </label>
        )}

        {meta.fields.includes('length') && (
          <label className="field">
            <span>{meta.fieldLabels.length}</span>
            <input type="number" step="any" value={length} onChange={(e) => setLength(e.target.value)} />
          </label>
        )}
        {meta.fields.includes('width') && (
          <label className="field">
            <span>{meta.fieldLabels.width}</span>
            <input type="number" step="any" value={width} onChange={(e) => setWidth(e.target.value)} />
          </label>
        )}
        {meta.fields.includes('height') && (
          <label className="field">
            <span>{meta.fieldLabels.height}</span>
            <input type="number" step="any" value={height} onChange={(e) => setHeight(e.target.value)} />
          </label>
        )}

        <label className="field">
          <span>{type === 'count' ? 'מספר פריטים' : 'מספר יחידות'}</span>
          <input type="number" step="any" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>

        <label className="field">
          <span>מקדם</span>
          <input type="number" step="any" value={coefficient} onChange={(e) => setCoefficient(e.target.value)} />
        </label>

        <label className="field">
          <span>יחידה</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>

        <label className="field">
          <span>סוג שורה</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'normal' | 'deduction')}>
            <option value="normal">רגיל (תוספת)</option>
            <option value="deduction">הפחתה</option>
          </select>
        </label>

        <label className="field field-wide">
          <span>הערות</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className={'formula-preview' + (kind === 'deduction' ? ' deduction' : '')}>
        <div className="fp-label">נוסחה מוצגת:</div>
        <div className="fp-formula">{formula}</div>
        <div className="fp-qty">כמות: <b>{quantity}</b> {unit}</div>
      </div>
    </Modal>
  );
}
