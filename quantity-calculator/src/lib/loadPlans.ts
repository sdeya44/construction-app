// ============================================================================
// טעינת תוכניות: PDF (כל עמוד מומר לתמונה) ו-תמונות (PNG/JPG)
// המרת PDF לתמונות מפשטת את אזור העבודה - תמיד עובדים על תמונה.
// ============================================================================

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PlanPage } from '../types';
import { uid } from '../store/factory';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// רזולוציית רסטור ל-PDF - גבוהה מספיק למדידה מדויקת
const PDF_RENDER_SCALE = 2.0;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pdfToPages(file: File): Promise<PlanPage[]> {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages: PlanPage[] = [];
  const baseName = file.name.replace(/\.pdf$/i, '');
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d')!;
    // רקע לבן (PDF שקוף ייראה שחור אחרת)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    pages.push({
      id: uid('pg'),
      name: pdf.numPages > 1 ? `${baseName} - עמוד ${n}` : baseName,
      kind: 'image',
      dataUrl,
      pdfPageNumber: n,
    });
  }
  return pages;
}

async function imageToPage(file: File): Promise<PlanPage> {
  const dataUrl = await readDataUrl(file);
  return {
    id: uid('pg'),
    name: file.name.replace(/\.(png|jpg|jpeg)$/i, ''),
    kind: 'image',
    dataUrl,
  };
}

/** טוען קובץ אחד או יותר ומחזיר רשימת עמודי תוכנית */
export async function loadFilesAsPages(files: FileList | File[]): Promise<PlanPage[]> {
  const arr = Array.from(files);
  const result: PlanPage[] = [];
  for (const file of arr) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      result.push(...(await pdfToPages(file)));
    } else if (/\.(png|jpg|jpeg)$/i.test(file.name) || file.type.startsWith('image/')) {
      result.push(await imageToPage(file));
    }
  }
  return result;
}
