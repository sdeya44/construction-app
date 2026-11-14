import { uid } from '../core/ids';
import type { BoltSpec, BracingParams, BuildingParams, CleatParams, ConnectionDefaults, FrameDef, Project, PurlinSideParams, PurlinSystem } from './types';
import { SCHEMA_VERSION } from './types';

/** יוצר מסגרות במרווח אחיד או לפי רשימת מרווחים. */
export function framesFromSpacings(spacings: number[], startNo = 1): FrameDef[] {
  const frames: FrameDef[] = [{ id: `F${startNo}`, y: 0 }];
  let y = 0;
  spacings.forEach((s, i) => { y += s; frames.push({ id: `F${startNo + i + 1}`, y }); });
  return frames;
}

export function uniformFrames(count: number, length: number): FrameDef[] {
  if (count < 2) throw new RangeError('נדרשות לפחות 2 מסגרות');
  return framesFromSpacings(Array.from({ length: count - 1 }, () => length / (count - 1)));
}

export const bolt = (d: number): BoltSpec => ({ d, grade: '8.8', standard: 'ISO 4017', clearance: 2 });

/** זוויתן ברירת מחדל: רגל בסיס 80, עובי 8, גובה = גובה הפטה, 2 ברגי M12 בשורה אחת. */
export function defaultCleat(): CleatParams {
  return {
    enabled: true, height: null, base: 80, thickness: 8, width: 100, bolt: bolt(12),
    rows: 1, perRow: 2, pitch: 50, rowPitch: 60, holeHeight: null, weldSize: 4,
  };
}

export function defaultPurlinSide(): PurlinSideParams {
  return {
    enabled: true, profile: 'C200x80x20x3', first: 300, spacing: 1500, measure: 'slope',
    edgeOffset: 0, opening: 'down', cleat: defaultCleat(), manualPositions: null,
  };
}

/** ברירות מחדל לחיבורים — הצעה גיאומטרית בלבד, לא מאומתת. */
export function defaultConnections(): ConnectionDefaults {
  return {
    eave: { enabled: true, t: 15, w: 200, l: 340, bolt: bolt(16), cols: 2, rows: 2, gauge: 100, pitch: 260, weldSize: 6 },
    ridge: { enabled: true, t: 15, w: 160, l: 0, bolt: bolt(16), cols: 2, rows: 2, gauge: 90, pitch: 0, weldSize: 6 },
    // לפי פרט K-02: PL 230×230×20 מבוטנת, 8 מוטות Φ20 מרותכים מתחת (עיגון 800), העמוד מרותך מסביב בשטח
    base: { enabled: true, mode: 'embedded', t: 20, w: 230, l: 230, bolt: { ...bolt(20), standard: 'מוט מצולע', grade: 'B500' }, cols: 3, rows: 3, gauge: 80, pitch: 80, weldSize: 4, anchorLength: 800 },
  };
}

export function defaultPurlins(): PurlinSystem {
  return { material: 'S235', left: defaultPurlinSide(), right: defaultPurlinSide(), monoStart: 'high' };
}

export function defaultBracing(): BracingParams {
  return {
    roof: { enabled: true, profile: 'L50x5', bays: [0, -1] },
    walls: { enabled: true, profile: 'L50x5', left: [0, -1], right: [0, -1] },
    purlinTies: { enabled: true, profile: 'L40x4' },
  };
}

/** ברירת מחדל: מבנה GEO-01 — סככה דו־שיפועית 18×30 מ', 6 מסגרות, עמודים 6 מ', שיפוע 10%. */
export function defaultBuilding(): BuildingParams {
  return {
    roofType: 'gable',
    heightRef: 'TOS',
    width: 18000,
    eaveLeft: 6000,
    eaveRight: 6000,
    ridgeX: 9000,
    slopeLeftPct: 10,
    frames: uniformFrames(6, 30000),
    rafterOverhangLeft: 0,
    rafterOverhangRight: 0,
    purlinOverhangStart: 0,
    purlinOverhangEnd: 0,
    columnProfile: 'HEA200',
    rafterProfile: 'IPE300',
    material: 'S235',
    baseElevation: 0,
    purlins: defaultPurlins(),
    bracing: defaultBracing(),
  };
}

export function newProject(name = 'פרויקט חדש', building: BuildingParams = defaultBuilding()): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('P'),
    meta: { name, number: '', description: '', designer: '', client: '', createdAt: now, updatedAt: now },
    displayUnit: 'm',
    settings: { stockLength: 12000 },
    building,
    memberOverrides: {},
    manualMembers: [],
    deleted: [],
    splices: {},
    connectionDefaults: defaultConnections(),
    connectionOverrides: {},
    connectionTemplates: [],
    cleatOverrides: {},
    nextFrameNo: building.frames.length + 1,
    nextMemberNo: 1,
  };
}
