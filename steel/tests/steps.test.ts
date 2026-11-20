import { expect, it } from 'vitest';
import { newProject } from '../src/model/defaults';
import { generate } from '../src/geometry/generate';
import { STEPS, stepExists, stepMarks, stepOfNav, stepState } from '../src/ui/steps';

/** ST-01 (1.59): מצבי שלבי העבודה — לא הוגדר / לא נדרש / הושלם / הערות; פרויקט ישן — מה שקיים נחשב שאושר */
it('ST-01: מצבי השלבים והסימונים', () => {
  const p = newProject();
  const d = generate(p);
  const S = (k: string) => STEPS.find((s) => s.key === k)!;
  const none = { err: 0, warn: 0 };
  // פרויקט ישן (בלי meta.steps): רכיב קיים = הושלם, רכיב שלא קיים = לא נדרש
  const legacy = stepMarks(p, d);
  expect(legacy['b:roof']).toBe('done');
  expect(stepState(S('b:roof'), p, d, legacy, none)).toBe('ok');
  expect(stepState(S('b:tb'), p, d, legacy, none)).toBe('skip');
  // פרויקט חדש (meta.steps = {}): הכל "לא הוגדר", גם שלבי הבסיס וגם רכיבים שקיימים
  p.meta.steps = {};
  const m0 = stepMarks(p, d);
  expect(stepState(S('s:geometry'), p, d, m0, none)).toBe('todo');
  expect(stepState(S('b:roof'), p, d, m0, none)).toBe('todo');
  expect(stepState(S('b:tb'), p, d, m0, none)).toBe('todo');
  // אישור באשף → הושלם; עם הערות → כתום; "לא נדרש" לרכיב שלא קיים → נספר
  expect(stepState(S('b:roof'), p, d, { 'b:roof': 'done' }, none)).toBe('ok');
  expect(stepState(S('b:roof'), p, d, { 'b:roof': 'done' }, { err: 0, warn: 2 })).toBe('warn');
  expect(stepState(S('b:tb'), p, d, { 'b:tb': 'skip' }, none)).toBe('skip');
  // "לא נדרש" אבל הרכיב נוסף אחר כך — חוזר ל"לא הוגדר" עד אישור
  p.building.bracing.roof.enabled = true;
  expect(stepState(S('b:roof'), p, d, { 'b:roof': 'skip' }, none)).toBe('todo');
  // רכיב שאושר ואז כובה באשף — נחשב החלטה ("לא נדרש")
  p.building.bracing.roof.enabled = false; p.building.bracing.rafterStruts = undefined;
  expect(stepExists('b:roof', p, d)).toBe(false);
  expect(stepState(S('b:roof'), p, d, { 'b:roof': 'done' }, none)).toBe('skip');
  // מיפוי כלי → שלב
  expect(stepOfNav('r:right')).toBe('r:left');
  expect(stepOfNav('b:truss')).toBe('b:tb');
  expect(stepOfNav('w:openings')).toBe('w:roof');
  expect(stepOfNav('k:column')).toBeNull();
});
