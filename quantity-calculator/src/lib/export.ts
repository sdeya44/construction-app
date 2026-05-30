// ============================================================================
// ייצוא: JSON (גיבוי פרויקט), CSV ו-Excel של טבלת החישובים
// ============================================================================

import * as XLSX from 'xlsx';
import type { CalcRow, Project, Section } from '../types';
import { computeRow } from './calc';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(s: string): string {
  return (s || 'project').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
}

/** ייצוא הפרויקט המלא ל-JSON (גיבוי) */
export function exportProjectJson(project: Project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  download(blob, `${safeName(project.name)}.json`);
}

function sectionLabel(sections: Section[], id: string | null): { code: string; name: string } {
  const s = sections.find((x) => x.id === id);
  return { code: s?.code ?? '', name: s?.name ?? 'ללא סעיף' };
}

/** בניית מטריצת שורות לטבלה (לשימוש ב-CSV / Excel) */
function buildMatrix(project: Project): (string | number)[][] {
  const header = [
    'מס׳', 'קוד סעיף', 'תיאור סעיף', 'תיאור החישוב', 'עמוד/תוכנית', 'סוג שורה',
    'אורך', 'רוחב', 'גובה', 'מס׳ יחידות', 'מקדם', 'נוסחה', 'כמות', 'יחידה', 'הערות',
  ];
  const rows: (string | number)[][] = [header];
  project.rows.forEach((r: CalcRow, i) => {
    const { quantity, formula } = computeRow(r);
    const { code, name } = sectionLabel(project.sections, r.sectionId);
    rows.push([
      i + 1,
      code,
      name,
      r.description,
      r.page,
      r.kind === 'deduction' ? 'הפחתה' : 'רגיל',
      r.length ?? '',
      r.width ?? '',
      r.height ?? '',
      r.count,
      r.coefficient,
      formula,
      quantity,
      r.unit,
      r.note,
    ]);
  });
  return rows;
}

/** ייצוא CSV (עם BOM לתמיכה בעברית באקסל) */
export function exportCsv(project: Project) {
  const matrix = buildMatrix(project);
  const csv = matrix
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  download(blob, `${safeName(project.name)}-חישובים.csv`);
}

/** ייצוא Excel (xlsx) */
export function exportExcel(project: Project) {
  const matrix = buildMatrix(project);
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  ws['!cols'] = [
    { wch: 5 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 14 }, { wch: 8 },
    { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 7 }, { wch: 28 }, { wch: 10 }, { wch: 7 }, { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'חישוב כמויות');
  XLSX.writeFile(wb, `${safeName(project.name)}-חישובים.xlsx`);
}

/** קריאת קובץ JSON שנבחר ע״י המשתמש */
export function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
