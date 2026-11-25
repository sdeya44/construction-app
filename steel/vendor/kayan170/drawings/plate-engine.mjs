// Read-only fabrication drawings. All coordinates in mm. Sheet is ISO A4 landscape.
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const num=v=>Number(v.toFixed(3));
const fmt=v=>String(num(v)).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const near=(a,b)=>Math.abs(a-b)<1e-5;
const dist=(p,a,b)=>{let d=[b[0]-a[0],b[1]-a[1]],t=Math.max(0,Math.min(1,((p[0]-a[0])*d[0]+(p[1]-a[1])*(d[1]))/(dot(d,d)||1)));return Math.hypot(p[0]-a[0]-t*d[0],p[1]-a[1]-t*d[1])};
const inside=(p,poly)=>poly.reduce((v,a,i)=>{let b=poly[(i+1)%poly.length];return ((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])?!v:v},false);
const uniqSorted=vals=>[...new Set(vals.map(v=>num(v)))].sort((a,b)=>a-b);
function segmentDistance(a,b,c,d){const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(dist(a,c,d),dist(b,c,d),dist(c,a,b),dist(d,a,b))}
function line(x1,y1,x2,y2,cls='dim'){return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;}
function txt(x,y,v,cls='text',anchor='start',extra=''){return `<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}" ${extra}>${esc(v)}</text>`;}
function rect(x,y,w,h,cls='frame'){return `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;}
const tick=(x,y)=>line(x-1,y+1,x+1,y-1);
function polyMid(a,b){return [(a[0]+b[0])/2,(a[1]+b[1])/2]}
function holeType(v){return v.slot?`${fmt(v.d)} × ${fmt(v.d+v.slot)} / ${fmt(v.angle)}°`:`Ø${fmt(v.d)}`;}
export function plateData(p){
 const a=p.plate;if(!a||a.outline.length<3)throw Error('Missing plate outline');if(p.warnings?.length)throw Error(p.warnings.join('; '));
 const minX=Math.min(...a.outline.map(v=>v[0])),minY=Math.min(...a.outline.map(v=>v[1]));
 const poly=a.outline.map(v=>[num(v[0]-minX),num(v[1]-minY)]),w=Math.max(...poly.map(v=>v[0])),h=Math.max(...poly.map(v=>v[1]));
 if(![w,h,a.thickness,...poly.flat()].every(Number.isFinite)||Math.min(w,h,a.thickness)<=0)throw Error('Invalid plate geometry');
 if(p.drills.length!==a.holes.length)throw Error('Drill and flat hole counts differ');
 const holes=a.holes.map((v,i)=>{let d=p.drills[i];if(v.id!==d.id||!near(v.diameter,d.diameter)||!near(v.slot||0,d.slotExtra||0))throw Error('Hole identity mismatch');
 let slot=v.slot||0,dx=dot(d.slotAxis,a.frame.x),dy=dot(d.slotAxis,a.frame.y),mag=Math.hypot(dx,dy),angle=slot?((Math.atan2(dy,dx)*180/Math.PI+180)%180):0;if(slot&&mag<.999)throw Error('Invalid slot direction');
 let x=num(v.x-minX),y=num(v.y-minY),r=v.diameter/2,ex=slot/2*Math.cos(angle*Math.PI/180),ey=slot/2*Math.sin(angle*Math.PI/180),start=[x-ex,y-ey],end=[x+ex,y+ey];
 if(![x,y,r,slot,angle].every(Number.isFinite)||r<=0||slot<0||!inside(start,poly)||!inside(end,poly)||poly.some((a,i)=>segmentDistance(start,end,a,poly[(i+1)%poly.length])<r-1e-5))throw Error('Hole outside plate or intersects edge');
 return {x,y,d:num(v.diameter),slot:num(slot),angle:num(angle),start,end};}).sort((a,b)=>a.x-b.x||a.y-b.y||a.d-b.d||a.slot-b.slot||a.angle-b.angle);
 for(let i=0;i<holes.length;i++)for(let j=0;j<i;j++)if(segmentDistance(holes[i].start,holes[i].end,holes[j].start,holes[j].end)<(holes[i].d+holes[j].d)/2-1e-5)throw Error('Overlapping holes');
 const rectangular=poly.length===4&&poly.every(([x,y])=>(x===0||x===w)&&(y===0||y===h));
 const cycles=poly.map((_,i)=>JSON.stringify([...poly.slice(i),...poly.slice(0,i)]));const rev=[...poly].reverse();cycles.push(...rev.map((_,i)=>JSON.stringify([...rev.slice(i),...rev.slice(0,i)])));
 const fingerprint=JSON.stringify([p.material,num(a.thickness),cycles.sort()[0],holes.map(({x,y,d,slot,angle})=>[x,y,d,slot,angle])]);
 return {p,poly,w,h,t:num(a.thickness),holes,rectangular,fingerprint};
}
export function catalog(snapshot){const map=new Map(),errors=[];for(const p of snapshot.parts.filter(p=>p.plate)){try{let d=plateData(p),key=JSON.stringify([p.mark,d.fingerprint]);if(!map.has(key))map.set(key,{...d,ids:[],qty:0});let g=map.get(key);g.ids.push(p.id);g.qty++;}catch(e){errors.push({id:p.id,mark:p.mark,message:e.message})}}const groups=[...map.values()].sort((a,b)=>a.p.mark.localeCompare(b.p.mark,undefined,{numeric:true})||a.fingerprint.localeCompare(b.fingerprint));let counts={};for(let g of groups)counts[g.p.mark]=(counts[g.p.mark]||0)+1;let seq={};for(let g of groups){g.label=g.p.mark+(counts[g.p.mark]>1?` / V${seq[g.p.mark]=(seq[g.p.mark]||0)+1}`:'');g.variant=counts[g.p.mark]>1;}return {groups,errors};}
function analyzeHoles(holes,w,h,rectangular){
 const xs=uniqSorted(holes.map(h=>h.x));
 const ys=uniqSorted(holes.map(h=>h.y));
 const allSame=holes.every(h=>h.d===holes[0]?.d && h.slot===holes[0]?.slot && h.angle===holes[0]?.angle);
 const completeGrid=holes.length===xs.length*ys.length && holes.every(h=>xs.includes(h.x)&&ys.includes(h.y));
 const edgeMarginsX=xs.length?[fmt(xs[0]), fmt(w-xs.at(-1))]:[];
 const edgeMarginsY=ys.length?[fmt(ys[0]), fmt(h-ys.at(-1))]:[];
 const simpleGrid=rectangular && holes.length>0 && allSame && xs.length<=6 && ys.length<=6 && holes.every(h=>!h.slot || h.angle%90===0);
 return {xs,ys,allSame,completeGrid,simpleGrid,edgeMarginsX,edgeMarginsY};
}
function renderCenterlines({xs,ys,X,Y,left,right,top,bottom}){
 let out='';
 for(const x of xs) out += line(X(x), top-8, X(x), bottom+8, 'center');
 for(const y of ys) out += line(left-8, Y(y), right+8, Y(y), 'center');
 return out;
}
function renderPlateGeometry(g,ctx,{showCenterlines=true,callout=true}={}){
 const {poly,holes}=g; const {X,Y,left,right,top,bottom}=ctx; const info=analyzeHoles(holes,g.w,g.h,g.rectangular);
 let out=`<polygon class="object" points="${poly.map(([a,b])=>`${X(a)},${Y(b)}`).join(' ')}"/>`;
 if(showCenterlines) out += renderCenterlines({...info,X,Y,left,right,top,bottom});
 holes.forEach(v=>{let cx=X(v.x),cy=Y(v.y),r=v.d*ctx.s/2,e=v.slot*ctx.s/2;if(v.slot)out+=`<rect class="object" x="${cx-e-r}" y="${cy-r}" width="${2*(e+r)}" height="${2*r}" rx="${r}" transform="rotate(${-v.angle} ${cx} ${cy})"/>`;else out+=`<circle class="object" cx="${cx}" cy="${cy}" r="${r}"/>`;out+=line(cx-2,cy,cx+2,cy,'center')+line(cx,cy-2,cx,cy+2,'center');});
 if(callout && holes.length){
   const text=info.allSame?`${holes.length} × ${holeType(holes[0])}`:`${holes.length} קדחים`;
   const ref=holes[Math.floor(holes.length/2)] ?? holes[0];
   const x1=X(ref.x)+3,y1=Y(ref.y)-2,x2=right+14,y2=Math.max(top+18,Y(ref.y)-18);
   out += line(x1,y1,x2-6,y2,'leader')+line(x2-6,y2,x2+16,y2,'leader')+txt(x2+18,y2+1.3,text,'section');
 }
 return {out,info};
}
function renderSimpleDimensions(g,ctx,info){
 const {w,h}=g; const {X,Y,left,right,top,bottom}=ctx; let out='';
 // Overall width
 const oy=top-20; out+=line(left,top-1,left,oy-1)+line(right,top-1,right,oy-1)+line(left,oy,right,oy)+tick(left,oy)+tick(right,oy)+txt((left+right)/2,oy-2.2,fmt(w),'dimtext','middle');
 // Horizontal chain from edges through hole columns
 const hVals=[0,...info.xs,w]; const hy=top-11; out+=line(left,hy,right,hy); hVals.forEach((v,i)=>{out+=line(X(v),top,X(v),hy-1)+tick(X(v),hy); if(i) out+=txt((X(v)+X(hVals[i-1]))/2,hy-1.7,fmt(v-hVals[i-1]),'dimtext','middle');});
 // Overall height
 const ox=left-20; out+=line(left-1,top,ox+1,top)+line(left-1,bottom,ox+1,bottom)+line(ox,top,ox,bottom)+tick(ox,top)+tick(ox,bottom)+`<text class="dimtext" transform="translate(${ox-2.5} ${(top+bottom)/2}) rotate(-90)" text-anchor="middle">${esc(fmt(h))}</text>`;
 // Vertical chain from edges through hole rows
 const vVals=[0,...info.ys,h]; const vx=left-11; out+=line(vx,top,vx,bottom); vVals.forEach((v,i)=>{out+=line(left,Y(v),vx+1,Y(v))+tick(vx,Y(v)); if(i) out+=`<text class="dimtext" transform="translate(${vx-1.8} ${(Y(v)+Y(vVals[i-1]))/2}) rotate(-90)" text-anchor="middle">${esc(fmt(v-vVals[i-1]))}</text>`;});
 return out;
}
function renderComplexDimensions(g,ctx){
 const {holes,w,h}=g; const {X,Y,left,right,top,bottom,s}=ctx; let out='';
 out+=line(left,top-1,left,top-15)+line(right,top-1,right,top-15)+line(left,top-12,right,top-12)+tick(left,top-12)+tick(right,top-12)+txt((left+right)/2,top-13.8,fmt(w),'dimtext','middle');
 out+=line(left-1,top,left-15,top)+line(left-1,bottom,left-15,bottom)+line(left-12,top,left-12,bottom)+tick(left-12,top)+tick(left-12,bottom)+`<text class="dimtext" transform="translate(${left-14} ${(top+bottom)/2}) rotate(-90)" text-anchor="middle">${esc(fmt(h))}</text>`;
 const xs=uniqSorted(holes.map(v=>v.x).filter(v=>v>0&&v<w));
 const ys=uniqSorted(holes.map(v=>v.y).filter(v=>v>0&&v<h));
 if(xs.length && xs.length<=8 && xs.every((v,i,a)=>i===0 || (v-a[i-1])*s>=7)){
   const yy=top-4.5; out+=line(left,yy,right,yy)+tick(left,yy);
   for(const v of xs){const xx=X(v); out+=line(xx,top,xx,yy-1)+tick(xx,yy)+txt(xx,yy-1.4,fmt(v),'small','middle');}
   out+=txt((left+right)/2,yy-5,'מידות אופקיות מהאפס','small','middle');
 }
 if(ys.length && ys.length<=8 && ys.every((v,i,a)=>i===0 || (v-a[i-1])*s>=7)){
   const xx=right+8; out+=line(xx,top,xx,bottom)+tick(xx,bottom);
   for(const v of ys){const yy=Y(v); out+=line(right,yy,xx-1,yy)+tick(xx,yy)+`<text class="small" transform="translate(${xx+3} ${yy+0.8}) rotate(-90)" text-anchor="middle">${esc(fmt(v))}</text>`;}
   out+=`<text class="small" transform="translate(${xx+8} ${(top+bottom)/2}) rotate(-90)" text-anchor="middle">${esc('מידות אנכיות מהאפס')}</text>`;
 }
 return out;
}
function renderTable(rows,yy,heading,lastColTitle){let out=txt(165,yy,heading,'section');yy+=4;out+=rect(165,yy,124,6,'headfill');const xx=[167,190,218,246.5];['סימון','X','Y',lastColTitle].forEach((v,i)=>out+=txt(xx[i],yy+4,v,'small'));yy+=6;for(let r of rows){out+=line(165,yy+5,289,yy+5,'grid');r.forEach((v,i)=>out+=txt(xx[i],yy+3.6,v,'small'));yy+=5;}return {out,y:yy+7};}
function renderComplexTables(g){
 const dataRows=g.holes.map((v,i)=>[`ק${i+1}`,fmt(v.x),fmt(v.y),holeType(v)]);
 const vertexRows=g.rectangular?[]:g.poly.map(([x,y],i)=>[`פ${i+1}`,fmt(x),fmt(y),'']);
 if(dataRows.length>17||vertexRows.length>17||dataRows.length+vertexRows.length>21)throw Error('Coordinate table requires a continuation sheet');
 let tb=renderTable(dataRows,29,`טבלת קדחים (${g.holes.length})`,'סוג קדח');
 let tables=tb.out;
 if(!g.holes.length) tables+=txt(167,tb.y-3,'ללא קדחים','small');
 if(vertexRows.length) tables+=renderTable(vertexRows,tb.y+2,'נקודות קו מתאר לפי סדר','הערה').out;
 return tables;
}
function renderTitleBlock(g,meta,scale){
 const {p,t,qty,label}=g;
 return `${line(159,177,159,205)}${txt(166,183,'מהדורה','small')}${txt(166,189,`${meta.revision??'-'}`,'section')}${txt(198,183,'חומר / עובי','small')}${txt(198,189,`${p.material} / ${fmt(t)} מ״מ`,'section')}${txt(248,183,'סימון חלק','small')}${txt(248,190,label,'title')}${line(159,193,292,193,'grid')}${txt(166,200,`כמות: ${qty}`,'section')}${txt(202,200,`קנה מידה: ${scale}`,'section')}${txt(247,200,'גיליון: A4 · טיוטה','section')}`;
}
export function drawPlate(g,meta={}){
 const {w,h,t,holes,p}=g;
 const info=analyzeHoles(holes,w,h,g.rectangular);
 const simpleStyle=info.simpleGrid;
 const drawZone={x: simpleStyle?26:32, y: simpleStyle?25:35, w: simpleStyle?118:108, h: simpleStyle?128:107};
 const scales=[2,1,.5,.4,.25,.2,.1,.05,.025,.02,.01];
 let s=scales.find(s=>w*s<=drawZone.w&&h*s<=drawZone.h);if(!s)throw Error('Plate too large for A4 at supported scales');
 let x=drawZone.x+(drawZone.w-w*s)/2, y=drawZone.y+(drawZone.h-h*s)/2;
 const X=v=>num(x+v*s), Y=v=>num(y+(h-v)*s), left=X(0), right=X(w), top=Y(h), bottom=Y(0);
 const ctx={s,X,Y,left,right,top,bottom};
 let {out:geom}=renderPlateGeometry(g,ctx,{showCenterlines:true,callout:true});
 let dims=simpleStyle?renderSimpleDimensions(g,ctx,info):renderComplexDimensions(g,ctx);
 let notes=txt(left+2,bottom+6,'אפס 0,0','small')+txt(32,153,`מבט ראשי · קנה מידה ${s>=1?`${fmt(s)}:1`:`1:${fmt(1/s)}`} · למעלה Y+ / ימינה X+`,'small');
 let side='';
 const sideY=161, sideH=t*s;
 if(sideH>11) side=txt(32,165,`עובי פלטה = ${fmt(t)} מ״מ · מבט שפה מושמט בגלל קנה המידה`,'section');
 else side=txt(32,160.5,'מבט שפה: עובי פלטה','small')+rect(left,164,w*s,sideH,'object')+line(right+2,164,right+9,164)+line(right+2,164+sideH,right+9,164+sideH)+line(right+7,164,right+7,164+sideH)+txt(right+10,164+sideH/2+1,fmt(t),'dimtext');
 let tables='';
 if(!simpleStyle) tables=renderComplexTables(g);
 else tables=txt(165,29,'סיכום מידות','section')+
             txt(167,36,`פלטה: ${fmt(w)} × ${fmt(h)} × ${fmt(t)} מ״מ`,'text')+
             txt(167,42,`קדחים: ${holes.length? (info.allSame? `${holes.length} × ${holeType(holes[0])}`:`${holes.length} קדחים`) : 'ללא קדחים'}`,'text')+
             txt(167,48,`סוג פלטה: ${g.rectangular?'מלבנית':'מיוחדת'}`,'text')+
             (g.variant?txt(167,55,'לתשומת לב: קיימות וריאציות גיאומטריה לאותו סימון חלק.','note'):txt(167,55,'') );
 const scale=s>=1?`${fmt(s)}:1`:`1:${fmt(1/s)}`;
 const warn=g.variant?'טיוטה לבדיקה. קיימות וריאציות גיאומטריה לאותו סימון חלק.':'טיוטה לבדיקה. יש לאמת מול מודל המקור לפני הוצאה לייצור.';
 const style=`<style>.frame{fill:none;stroke:#17242f;stroke-width:.22}.object{fill:none;stroke:#1e2d3a;stroke-width:.45;stroke-linejoin:round}.dim{stroke:#506475;stroke-width:.18;fill:none}.center{stroke:#8697a4;stroke-width:.13;stroke-dasharray:5 2}.leader{stroke:#506475;stroke-width:.18;fill:none}.grid{stroke:#c5cfd5;stroke-width:.16}.headfill{fill:#e8eef1;stroke:none}.text,.small,.dimtext,.section,.title,.brand,.note{font-family:'Arial','Assistant',sans-serif;fill:#17242f}.text{font-size:3.2px}.small{font-size:2.7px}.dimtext{font-size:3px}.section{font-size:3.5px;font-weight:bold}.title{font-size:5.7px;font-weight:bold}.brand{font-size:4.6px;font-weight:bold}.note{font-size:2.8px;fill:#805023}</style>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" role="img"><title>שרטוט ייצור פלטה ${esc(g.label)}</title>${style}<rect width="297" height="210" fill="white"/>${rect(5,5,287,200)}${txt(9,12,'כיאן · שרטוטי פלדה','brand')}${txt(289,12,'תוכנית ייצור · פלטה בודדת','section','end')}${line(5,17,292,17)}${txt(9,23,`פרויקט: ${meta.projectName||'פרויקט חדש'}`,'small')}${txt(289,23,`חומר: ${p.material} | סימון חלק: ${g.label}`,'section','end')}${line(159,17,159,177,'grid')}${geom}${dims}${notes}${side}${tables}${line(5,177,292,177)}${txt(9,182,warn,'note')}${txt(9,188,'כל המידות במילימטרים. במצב פלטה פשוטה מוצגות מידות ייצור מועדפות ללא מידות מצטברות מיותרות.','small')}${txt(9,193,'בפלטות מיוחדות או מורכבות המערכת מציגה גם טבלאות קדחים או נקודות לפי הצורך.','small')}${renderTitleBlock(g,meta,scale)}</svg>`;
}
