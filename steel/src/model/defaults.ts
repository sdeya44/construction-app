import { uid } from '../core/ids';
import type { BuildingParams, FrameDef, Project, PurlinSideParams, PurlinSystem } from './types';
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

export function defaultPurlinSide(): PurlinSideParams {
  return {
    enabled: true, profile: 'C200x80x20x3', first: 300, spacing: 1500, measure: 'slope',
    edgeOffset: 0, opening: 'up', manualPositions: null,
  };
}

export function defaultPurlins(): PurlinSystem {
  return { material: 'S235', left: defaultPurlinSide(), right: defaultPurlinSide(), monoStart: 'high' };
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
    nextFrameNo: building.frames.length + 1,
    nextMemberNo: 1,
  };
}
