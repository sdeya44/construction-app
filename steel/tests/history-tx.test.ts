import { expect, it } from 'vitest';
import { History } from '../src/commands/history';
import { newProject } from '../src/model/defaults';
import type { Project } from '../src/model/types';

/** TX-01 (1.57): טרנזקציה של אשף — שינוי חי; אישור = צעד Undo אחד; ביטול = חזרה למצב שלפני, בלי "בצע שוב" */
const setW = (w: number) => ({ label: `רוחב ${w}`, run: (p: Project) => ({ ...p, building: { ...p.building, width: w } }) });
it('TX-01: אישור מאחד צעדים, ביטול מחזיר', () => {
  const h = new History(newProject());
  const w0 = h.current.building.width;
  h.exec(setW(10000));
  h.txBegin();
  h.exec(setW(11000)); h.exec(setW(12000)); h.exec(setW(13000));
  expect(h.txSteps).toBe(3);
  h.txCommit('אשף: קשיחות קירות');
  expect(h.current.building.width).toBe(13000);
  expect(h.undoLabel).toBe('אשף: קשיחות קירות');
  h.undo();
  expect(h.current.building.width).toBe(10000); // צעד אחד מחזיר את כל האשף
  // ביטול
  h.txBegin();
  h.exec(setW(15000)); h.exec(setW(16000));
  expect(h.txCancel()).toBe(true);
  expect(h.current.building.width).toBe(10000);
  expect(h.canRedo).toBe(false);
  // ביטול בלי שינויים — לא עושה כלום
  h.txBegin(); expect(h.txCancel()).toBe(false);
  // אישור בלי שינויים — לא נוסף צעד
  h.txBegin(); h.txCommit('x'); expect(h.undoLabel).toBe('רוחב 10000');
  void w0;
});
