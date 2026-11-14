import { useMemo } from 'react';
import type { DerivedModel, Project } from '../model/types';
import { useStore } from '../store';
import { computeBom, cutPlans } from './bom';
import { computeFabrication } from './marks';

let last: { d: DerivedModel; p: Project; v: ReturnType<typeof calc> } | null = null;
function calc(p: Project, d: DerivedModel) {
  const fab = computeFabrication(p, d);
  const bom = computeBom(d, fab);
  return { fab, bom, plans: cutPlans(fab, p) };
}
/** ייצור וכמויות, מחושב פעם אחת לכל מצב מודל. */
export function fabFor(p: Project, d: DerivedModel) {
  if (last && last.d === d && last.p === p) return last.v;
  const v = calc(p, d);
  last = { d, p, v };
  return v;
}
export function useFab() {
  const p = useStore((s) => s.project);
  const d = useStore((s) => s.derived);
  return useMemo(() => fabFor(p, d), [p, d]);
}
