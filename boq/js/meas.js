// Quantity-calculation engine — ported verbatim from the KAYAN execution-accounts app
// (branch claude/kayan-execution-accounts-gyx9hw, v3.0.0, 2026-11-01). Shapes, formulas, the N
// multiplier, deductions (sign), claimed-vs-approved logic and the SVG drawings are unchanged.
// Only adaptation: the unit → geometry "kind" mapping understands the Binarit/SKN unit labels
// used in this application (מטר, קומפ', נק' …).
import { unitCode } from './skn.js';

function nz(v){ if(v===''||v==null) return 0; const n=parseFloat(String(v).replace(',','.').replace(/[^\d.\-]/g,'')); return isNaN(n)?0:n; }
function fn(v,dp=1){ const n=+v; if(isNaN(n))return'0'; return n.toLocaleString('he-IL',{minimumFractionDigits:0,maximumFractionDigits:dp}); }
function fq(v){ const n=+v; if(isNaN(n))return'0'; return n.toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fnum(v){ const n=parseFloat(v); return isNaN(n)?'':(n%1===0?String(n):parseFloat(n.toFixed(3))); }
function money(v){ const n=+v||0; return '₪'+n.toLocaleString('he-IL',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function pct(v){ const n=+v||0; return n.toLocaleString('he-IL',{minimumFractionDigits:1,maximumFractionDigits:1})+'%'; }
function esc(s){ return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export { nz, fn, fq, fnum, pct, esc };
export const moneyFmt = (v) => '₪' + (+v || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// SKN unit code → measurement kind (02 length, 03 area, 04 volume, everything else is counted)
const KIND_BY_CODE = { '02': 'length', '03': 'area', '04': 'volume' };
export const KIND_LABEL = { area: 'שטח', volume: 'נפח', length: 'אורך', count: 'כמות' };
export function unitKind(unit) { return KIND_BY_CODE[unitCode(unit)] ?? 'count'; }

// cross-section shapes usable for AREA and VOLUME (volume = cross-section area × extrusion length)
const CROSS = {
  'מלבן':  {d:['אורך','רוחב'],              area:(a,b)=>a*b,           forKinds:['area','volume'], lbl:'אורך × רוחב'},
  'משולש': {d:['בסיס','גובה'],              area:(a,b)=>a*b/2,         forKinds:['area','volume'], lbl:'(בסיס × גובה) ÷ 2'},
  'טרפז':  {d:['בסיס א׳','בסיס ב׳','גובה'], area:(a,b,c)=>(a+b)*c/2,   forKinds:['area','volume'], lbl:'(א׳+ב׳) × גובה ÷ 2'},
  'עיגול': {d:['קוטר Ø'],                   area:(a)=>Math.PI*(a/2)**2,forKinds:['area','volume'], lbl:'π × (Ø÷2)²'},
  'חצי-עיגול': {d:['קוטר Ø'],               area:(a)=>Math.PI*(a/2)**2/2, forKinds:['area','volume'], lbl:'π × (Ø÷2)² ÷ 2'},
  'שטח מיוחד': {d:['שטח חתך'],              area:(a)=>a,               forKinds:['area','volume'], lbl:'שטח נתון', custom:true},
};
// non cross-section shapes, one per non-area/volume kind
const LINE_SHAPE={d:['אורך'],lbl:'אורך',forKinds:['length']};
const COUNT_SHAPE={d:[],lbl:'ספירה',forKinds:['count']};
function shapesForKind(kind){
  if(kind==='length') return ['קו'];
  if(kind==='count') return ["יחידה"];
  // area & volume both draw from CROSS, but "volume" requires extrusion length (t) in addition
  return Object.keys(CROSS);
}
function shapeDims(shape){
  if(shape==='קו') return LINE_SHAPE.d;
  if(shape==='יחידה') return COUNT_SHAPE.d;
  return CROSS[shape]?CROSS[shape].d:[];
}
export { CROSS, shapesForKind, shapeDims };
function itemUnitKind(item){ return item ? unitKind(item.unit) : 'volume'; }
function inferKindFromShape(m){ // fallback used only by legacy migration (no item context yet)
  if(m.shape==='קו') return 'length';
  if(m.shape==='יחידה') return 'count';
  return nz(m.t)>0 ? 'volume' : 'area';
}
// raw geometric value before N and sign, plus its natural unit + completeness flag
function baseVal(m,kind){
  kind = kind || inferKindFromShape(m);
  if(kind==='length') return {v:nz(m.d1), u:'מ"א', complete:nz(m.d1)>0};
  if(kind==='count')  return {v:(m.d1===''||m.d1==null)?1:nz(m.d1), u:"יח'", complete:true};
  const c=CROSS[m.shape];
  if(!c) return {v:0,u:'',complete:false};
  const area = c.custom ? nz(m.d1) : c.area(nz(m.d1),nz(m.d2),nz(m.d3));
  if(kind==='area') return {v:area, u:'מ"ר', complete:area>0};
  // volume: cross-section area × extrusion length (t) — both required
  const t=nz(m.t);
  return {v:area*t, u:'מ"ק', complete:area>0 && t>0};
}
function calcRow(m,item){
  if(m.isGroup||m.cancelled) return 0;
  const kind = item ? itemUnitKind(item) : inferKindFromShape(m);
  const {v}=baseVal(m,kind);
  const n=(m.qty===''||m.qty==null)?1:nz(m.qty);
  return v*n*(m.sign||1);
}
// ── submission vs. approval ──
// calcRow() above is what the field/contractor CLAIMS from the raw geometry.
// A row is approved-as-claimed by default (m.approval absent) — zero extra
// clicks for the common case. A reviewer only has to act to REDUCE, REJECT,
// or hold a claim PENDING; that decision is what actually gets frozen into
// history/snapshots at lock time (see Accounts.lock), not the raw claim —
// so the official cumulative is always "what was approved," while the
// claimed figure stays available alongside it for audit/comparison.
function approvedRowValue(m,item){
  if(m.isGroup||m.cancelled) return 0;
  const claimed=calcRow(m,item);
  if(!m.approval) return claimed;
  if(m.approval.status==='reduced') return nz(m.approval.value);
  return 0; // 'rejected' or 'pending'
}
const APPROVAL_STATUS_LABEL={reduced:'הופחת',rejected:'נדחה',pending:'ממתין לאישור'};
const APPROVAL_STATUS_CLASS={reduced:'grow',rejected:'chg',pending:'new'};
function approvalBadge(m){
  if(!m.approval) return {label:'מאושר כמוגש',cls:'ok'};
  return {label:APPROVAL_STATUS_LABEL[m.approval.status]||'מאושר כמוגש',cls:APPROVAL_STATUS_CLASS[m.approval.status]||'ok'};
}
// if the underlying claim changed since a reduce/reject/pending decision was made on it
// (dims edited, sign flipped, etc.), that decision no longer refers to the same number —
// it must not silently keep applying to a different claim. Re-open it for review instead
// of leaving a stale ₪ figure standing against a claim nobody actually looked at.
function approvalIsStale(m,item){
  return !!(m.approval && Math.abs(calcRow(m,item)-nz(m.approval.claimedAtDecision))>1e-9);
}
// called after any edit that can change calcRow() — silently reopens a stale decision as
// "pending" rather than leaving a reduce/reject figure attached to a claim that no longer exists
function revalidateApproval(m,item){
  if(approvalIsStale(m,item)) m.approval={status:'pending',value:0,
    note:'התביעה שונתה לאחר ההחלטה הקודמת — ממתינה לבדיקה מחדש',claimedAtDecision:calcRow(m,item)};
}
function rowUnit(m,kind){ return baseVal(m,kind).u; }
function rowComplete(m,kind){ return baseVal(m,kind||inferKindFromShape(m)).complete; }
function rowFormulaLabel(m,kind){
  kind=kind||inferKindFromShape(m);
  if(kind==='length') return 'אורך';
  if(kind==='count') return 'ספירה';
  const c=CROSS[m.shape]; if(!c) return '';
  return kind==='volume' ? `(${c.lbl}) × עובי` : c.lbl;
}
// the abstract pattern above ("אורך × רוחב") doesn't show HOW a result was reached —
// this substitutes the row's actual entered numbers into it, e.g. "5 × 2 = 10.000",
// so a calculation sheet (on screen or printed) can be checked/audited by eye.
function rowFormulaText(m,kind){
  kind=kind||inferKindFromShape(m);
  const bv=baseVal(m,kind);
  const d1=fnum(m.d1)||0, d2=fnum(m.d2)||0, d3=fnum(m.d3)||0, t=fnum(m.t)||0;
  const n=(m.qty===''||m.qty==null)?1:nz(m.qty);
  const nSuffix=Math.abs(n-1)>1e-9 ? ` × ${fnum(n)}` : '';
  const total=bv.v*n;
  if(kind==='length') return `${d1}${nSuffix} = ${fn(total)}`;
  if(kind==='count') return `${fnum(m.d1)||1}${nSuffix} = ${fn(total)}`;
  const c=CROSS[m.shape]; if(!c) return '';
  let areaExpr;
  if(c.custom) areaExpr=`${d1}`;
  else if(m.shape==='מלבן') areaExpr=`${d1} × ${d2}`;
  else if(m.shape==='משולש') areaExpr=`(${d1} × ${d2}) ÷ 2`;
  else if(m.shape==='טרפז') areaExpr=`(${d1}+${d2}) × ${d3} ÷ 2`;
  else if(m.shape==='עיגול') areaExpr=`π×(${d1}÷2)²`;
  else if(m.shape==='חצי-עיגול') areaExpr=`π×(${d1}÷2)²÷2`;
  else areaExpr=c.lbl;
  if(kind==='area') return `${areaExpr}${nSuffix} = ${fn(total)}`;
  return `(${areaExpr}) × ${t}${nSuffix} = ${fn(total)}`; // volume: cross-section area × extrusion length
}
function rowSig(m){ return JSON.stringify([m.shape,m.d1,m.d2,m.d3,m.t,m.qty,m.sign]); }
// ── SVG drawing engine (isometric extrusion for volumes, flat face for areas) ──
function normSet(vals,maxPx,minPx){ const mx=Math.max(...vals.filter(v=>v>0),0.001);
  return vals.map(v=>!v?0:Math.max(minPx,Math.min(maxPx,(v/mx)*maxPx))); }
function dimH(x1,x2,y,l,below){ const ty=below?y+13:y-5;
  return `<line class="dim" x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line class="dim" x1="${x1}" y1="${y-3}" x2="${x1}" y2="${y+3}"/><line class="dim" x1="${x2}" y1="${y-3}" x2="${x2}" y2="${y+3}"/><text class="dimtext" x="${(x1+x2)/2}" y="${ty}">${l}</text>`; }
function dimV(y1,y2,x,l,left){ const tx=left?x-6:x+6,an=left?'end':'start';
  return `<line class="dim" x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line class="dim" x1="${x-3}" y1="${y1}" x2="${x+3}" y2="${y1}"/><line class="dim" x1="${x-3}" y1="${y2}" x2="${x+3}" y2="${y2}"/><text class="dimtext" x="${tx}" y="${(y1+y2)/2+3}" style="text-anchor:${an}">${l}</text>`; }
function isoPrism(pts,o){
  const back=pts.map(p=>[p[0]+o,p[1]-o]);
  let sides='';
  for(let i=0;i<pts.length;i++){ const j=(i+1)%pts.length;
    sides+=`<polygon class="faceSide" points="${pts[i][0]},${pts[i][1]} ${pts[j][0]},${pts[j][1]} ${back[j][0]},${back[j][1]} ${back[i][0]},${back[i][1]}"/>`; }
  const bk=`<polygon class="faceTop" points="${back.map(p=>p.join(',')).join(' ')}"/>`;
  const fr=`<polygon class="face" points="${pts.map(p=>p.join(',')).join(' ')}"/>`;
  return bk+sides+fr;
}
function depthLabel(pts,o,l){
  let idx=0,best=-1e9; pts.forEach((p,i)=>{const s=p[0]-p[1];if(s>best){best=s;idx=i;}});
  const p=pts[idx];
  return `<line class="dim" x1="${p[0]+1}" y1="${p[1]-1}" x2="${p[0]+o+1}" y2="${p[1]-o-1}"/><text class="dimtext" x="${p[0]+o+9}" y="${p[1]-o+2}">${l}</text>`;
}
function shapeSVG(shape,d1,d2,d3,ded,big,t,kind){
  const W=big?175:122, H=big?118:80;
  const cls=(ded?'ded ':'')+'shp';
  d1=nz(d1);d2=nz(d2);d3=nz(d3);t=nz(t);
  if(shape==='קו'){ const[w]=normSet([d1],big?128:82,30); const y=H/2,px=(W-w)/2;
    const inner=`<line x1="${px}" y1="${y}" x2="${px+w}" y2="${y}" stroke="#2B3A52" stroke-width="3"/><line x1="${px}" y1="${y-6}" x2="${px}" y2="${y+6}" stroke="#2B3A52" stroke-width="2"/><line x1="${px+w}" y1="${y-6}" x2="${px+w}" y2="${y+6}" stroke="#2B3A52" stroke-width="2"/>${dimH(px,px+w,y-10,fnum(d1))}`;
    return svgWrap(inner,W,H,cls,big);
  }
  if(shape==='יחידה'){ const inner=`<text x="${W/2}" y="${H/2+9}" style="font:800 26px Heebo;fill:#2B3A52;text-anchor:middle">×${fnum(d1)||1}</text>`; return svgWrap(inner,W,H,cls,big); }
  if(shape==='שטח מיוחד'){
    const inner=`<rect x="${W/2-40}" y="${H/2-24}" width="80" height="48" fill="#DCE6F2" stroke="#2B3A52" stroke-width="1.3" stroke-dasharray="4 3"/><text x="${W/2}" y="${H/2-2}" style="font:800 12px Heebo;fill:#2B3A52;text-anchor:middle">A = ${fnum(d1)}</text><text x="${W/2}" y="${H/2+14}" style="font:600 9px Heebo;fill:#6E7A88;text-anchor:middle">מ"ר (שטח נתון)</text>`;
    return svgWrap(inner,W,H,cls,big);
  }
  const vol = kind==='volume';
  const c=CROSS[shape]; if(!c) return '';
  const o = vol ? Math.max(big?12:8, Math.min(big?30:20, normSet([t,Math.max(d1,d2,d3,0.001)],big?34:24,6)[0])) : 0;
  let inner='';
  const isHalf = shape==='חצי-עיגול';
  if(shape==='עיגול'||isHalf){
    const[dia]=normSet([d1],big?78:50,20); const r=dia/2,cx=W/2;
    if(vol){ const h=Math.max(big?40:26, Math.min(big?70:48, o*3)); const ry=r/3.2,top=(H-h)/2-4;
      const arc = isHalf?`M${cx-r},${top} A${r},${ry} 0 0 1 ${cx+r},${top}`:`M${cx-r},${top} L${cx-r},${top+h} A${r},${ry} 0 0 0 ${cx+r},${top+h} L${cx+r},${top} Z`;
      inner=`<ellipse class="faceTop" cx="${cx}" cy="${top}" rx="${r}" ry="${ry}"/><path class="faceSide" d="${arc}"/><ellipse class="face" cx="${cx}" cy="${top+h}" rx="${r}" ry="${ry}"/>${dimV(top,top+h,cx+r+7,fnum(t),false)}<text class="dimtext" x="${cx}" y="${top+h+17}">Ø${fnum(d1)}</text>`;
    } else { const cy=H/2;
      if(isHalf) inner=`<path class="face" d="M${cx-r},${cy} A${r},${r} 0 0 1 ${cx+r},${cy} Z"/><line class="dim" x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}"/><text class="dimtext" x="${cx}" y="${cy-6}">Ø${fnum(d1)}</text>`;
      else inner=`<circle class="face" cx="${cx}" cy="${cy}" r="${r}"/><line class="dim" x1="${cx-r}" y1="${cy}" x2="${cx+r}" y2="${cy}"/><text class="dimtext" x="${cx}" y="${cy-6}">Ø${fnum(d1)}</text>`;
    }
    return svgWrap(inner,W,H,cls,big);
  }
  let pts=[];
  const availW=(big?118:80)-o;
  if(shape==='מלבן'){ const[w,h]=normSet([d1,d2],Math.min(big?112:74,availW),16);
    const px=(W-w)/2-o/2, py=(H-h)/2+o/2; pts=[[px,py],[px+w,py],[px+w,py+h],[px,py+h]];
    var dims=vol?`${dimH(px,px+w,py+h+4,fnum(d1),true)}${dimV(py,py+h,px-4,fnum(d2),true)}`
            :`${dimH(px,px+w,py-2,fnum(d1))}${dimV(py,py+h,px+w+3,fnum(d2),false)}`;
  }
  else if(shape==='משולש'){ const[b,h]=normSet([d1,d2],Math.min(big?104:66,availW),20);
    const px=(W-b)/2-o/2, y=(H+h)/2+o/2; pts=[[px,y],[px+b,y],[px+b/2,y-h]];
    var dims=`${dimH(px,px+b,y+4,fnum(d1),true)}${dimV(y-h,y,px+b+5,fnum(d2),false)}`;
  }
  else if(shape==='טרפז'){ const[a,b,h]=normSet([d1,d2,d3],Math.min(big?104:64,availW),16);
    const cx=W/2-o/2, y=(H+h)/2+o/2;
    pts=[[cx-a/2,y-h],[cx+a/2,y-h],[cx+b/2,y],[cx-b/2,y]];
    var dims=`${dimH(cx-a/2,cx+a/2,y-h-2,fnum(d1))}${dimH(cx-b/2,cx+b/2,y+4,fnum(d2),true)}${dimV(y-h,y,cx+Math.max(a,b)/2+6,fnum(d3),false)}`;
  }
  if(!pts.length) return '';
  if(vol) inner=isoPrism(pts,o)+dims+depthLabel(pts,o,fnum(t));
  else inner=`<polygon class="face" points="${pts.map(p=>p.join(',')).join(' ')}"/>`+dims;
  return svgWrap(inner,W,H,cls,big);
}
function svgWrap(inner,W,H,cls,big){
  const PAD=big?22:18;
  return `<svg viewBox="${-PAD} ${-PAD} ${W+2*PAD} ${H+2*PAD}" width="${W}" height="${H}" class="${cls}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

export { itemUnitKind, inferKindFromShape, baseVal, calcRow, approvedRowValue, approvalBadge, approvalIsStale, revalidateApproval,
  rowUnit, rowComplete, rowFormulaLabel, rowFormulaText, rowSig, shapeSVG, APPROVAL_STATUS_LABEL, APPROVAL_STATUS_CLASS };
