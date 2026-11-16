import * as THREE from 'three';
import { memberSolid, type Solid } from '../geometry/solid';
import type { DerivedModel, Member, MemberKind } from '../model/types';

export const KIND_COLOR: Record<MemberKind, number> = {
  column: 0x5f6a66, rafter: 0x7c8781, beam: 0x8a948e, brace: 0x9a8a68, purlin: 0xb2ada2, cleat: 0x4f7f66, plate: 0x6f8a5a, bolt: 0x8a5a2b, anchor: 0x7a6a5a,
};
const MANUAL_COLOR = 0xb08a4a;

const solidCache = new Map<string, Solid>();
function solidKey(m: Member) {
  return JSON.stringify([m.start, m.end, m.profile, m.rollDeg, m.mirror, m.anchor, m.refUp, m.startCut, m.endCut]);
}
export function clearSceneCache() { solidCache.clear(); }
export function cachedSolid(m: Member): Solid {
  const k = solidKey(m);
  let s = solidCache.get(k);
  if (!s) {
    s = memberSolid(m);
    if (solidCache.size > 50000) solidCache.clear();
    solidCache.set(k, s);
  }
  return s;
}

export interface ModelBuffers {
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  /** אינדקס משולש → מזהה אלמנט */
  triOwner: Int32Array;
  ids: string[];
  box: THREE.Box3;
}

/** בונה גיאומטריה ממוזגת אחת לכל האלמנטים הגלויים (קריאת ציור אחת, מתאים לאלפי אלמנטים). */
export function buildModel(members: Member[], material: THREE.Material, edgeMat: THREE.LineBasicMaterial, colorOf?: (m: Member) => number | undefined): ModelBuffers {
  let triCount = 0, edgeCount = 0;
  const solids = members.map((m) => {
    const s = cachedSolid(m);
    triCount += s.tris.length / 9;
    edgeCount += s.edges.length / 6;
    return s;
  });
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  const owner = new Int32Array(triCount);
  const ep = new Float32Array(edgeCount * 6);
  let tp = 0, ti = 0, eo = 0;
  const c = new THREE.Color();
  members.forEach((m, mi) => {
    const s = solids[mi];
    const cc = colorOf?.(m);
    if (cc !== undefined) c.setHex(cc);
    else {
      c.setHex(m.source === 'manual' ? MANUAL_COLOR : KIND_COLOR[m.kind]);
      if (m.manualPlacement && m.source === 'generated') c.offsetHSL(0.08, 0.15, 0);
    }
    pos.set(s.tris, tp);
    for (let i = 0; i < s.tris.length; i += 3) { col[tp + i] = c.r; col[tp + i + 1] = c.g; col[tp + i + 2] = c.b; }
    const n = s.tris.length / 9;
    owner.fill(mi, ti, ti + n);
    tp += s.tris.length; ti += n;
    ep.set(s.edges, eo); eo += s.edges.length;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  g.computeBoundingBox(); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const edges = new THREE.LineSegments(eg, edgeMat);
  return { mesh, edges, triOwner: owner, ids: members.map((m) => m.id), box: g.boundingBox ?? new THREE.Box3() };
}

export function visibleMembers(d: DerivedModel, hidden: string[], isolated: string[] | null): Member[] {
  const h = new Set(hidden);
  const iso = isolated ? new Set(isolated) : null;
  return d.members.filter((m) => !h.has(m.id) && (!iso || iso.has(m.id)));
}
