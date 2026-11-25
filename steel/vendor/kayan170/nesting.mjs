import {nestContours,mapContourPoint,verifyContourNesting} from './polygon-nesting.mjs';
export const defaultMachine={name:'Bodor P3 reference — DXF/CAM',width:3000,height:1500,margin:12,gap:8,allowRotation:true};
export function validateMachine(m){if([m.width,m.height].some(x=>!Number.isFinite(x)||x<100)||[m.margin,m.gap].some(x=>!Number.isFinite(x)||x<0)||m.margin*2>=Math.min(m.width,m.height))throw Error('מידות לוח, שוליים או רווחים אינם תקינים');const ids=new Set;for(const s of m.stockSheets||[]){if(!s.id||ids.has(s.id)||s.id==='REFERENCE'||![s.width,s.height].every(x=>Number.isFinite(x)&&x>=100)||!Number.isInteger(s.qty)||s.qty<0||s.thickness!=null&&!(s.thickness>0))throw Error('מלאי לוחות לא תקין');ids.add(s.id);}}
export function nest(parts,m){validateMachine(m);const r=nestContours(parts,m);verifyContourNesting(r,m);return r;}
export const mapped=mapContourPoint;
export const validateNesting=verifyContourNesting;
