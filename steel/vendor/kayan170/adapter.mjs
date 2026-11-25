import {structuralGroups} from './drawings/structural-groups.mjs';
import {trimPlateEndPlanes} from "./drawings/plate-end-trim.mjs";
import {applyProjectNotches} from './drawings/project-notches.mjs';
import {validateNotches} from './drawings/notch-engine.mjs';
// Read-only adapter over KAYAN's original manufacturing model. No second project model is created.
export const vec=p=>Array.isArray(p)?p:[p.x,p.y,p.z];
export const add=(a,b)=>a.map((v,i)=>v+b[i]);
export const sub=(a,b)=>a.map((v,i)=>v-b[i]);
export const mul=(a,s)=>a.map(v=>v*s);
export const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0);
export const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len=a=>Math.hypot(...a);
export const unit=a=>{let l=len(a);if(l<1e-9)throw Error('ציר באורך אפס');return mul(a,1/l)};
export const point=(start,axes,t=0,u=0,v=0)=>add(start,add(mul(axes.ex,t),add(mul(axes.u,u),mul(axes.v,v))));
export const area=poly=>Math.abs(poly.reduce((a,p,i)=>{let q=poly[(i+1)%poly.length];return a+p[0]*q[1]-q[0]*p[1]},0)/2);
export function convexHull(points){let pts=[...new Map(points.map(p=>[p.map(v=>v.toFixed(7)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let turn=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);if(pts.length<3)throw Error('פלטה ללא קו מתאר תקין');let lo=[],hi=[];for(let p of pts){while(lo.length>1&&turn(lo.at(-2),lo.at(-1),p)<=1e-8)lo.pop();lo.push(p)}for(let p of [...pts].reverse()){while(hi.length>1&&turn(hi.at(-2),hi.at(-1),p)<=1e-8)hi.pop();hi.push(p)}return [...lo.slice(0,-1),...hi.slice(0,-1)];}
function clip(poly,x,keepRight){let out=[];for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],ina=keepRight?a[0]>=x-1e-6:a[0]<=x+1e-6,inb=keepRight?b[0]>=x-1e-6:b[0]<=x+1e-6;if(ina)out.push(a);if(ina!==inb){let t=(x-a[0])/(b[0]-a[0]);out.push([x,a[1]+t*(b[1]-a[1])]);}}return out;}
export function adaptPart(member,profile,basis,geometry,fab,boltMap=new Map){
 let start=vec(member.start),axes={ex:vec(basis.ex),u:vec(basis.u),v:vec(basis.v)},hand=dot(cross(axes.u,axes.v),axes.ex)>0?1:-1,pts=[...geometry.startRing,...geometry.endRing].map(vec),ts=pts.map(p=>dot(sub(p,start),axes.ex)),minT=Math.min(...ts),maxT=Math.max(...ts),t0=fab?.t0??minT,t1=fab?.t1??maxT,first=!fab||fab.index===1,last=!fab||t1>=maxT-.02;
 let part={id:fab?.id??member.id,memberId:member.id,mark:fab?.mark??member.id,signature:fab?.signature??'',assembly:fab?.assembly??'',name:fab?.desc??member.partDesc??member.label,kind:member.kind,family:profile.family,profile:member.profile,material:member.material,sourceFrame:{origin:start,...axes},section:{outer:profile.outline.outer.map(p=>[p.u,p.v*hand]),inners:profile.outline.holes.map(r=>r.map(p=>[p.u,p.v*hand]))},frame:{origin:point(start,axes,0,geometry.du,geometry.dv),x:axes.u,y:mul(axes.v,hand),z:axes.ex},extent:[Math.min(minT,t0)-10,Math.max(maxT,t1)+10],endPlanes:[],drills:[],warnings:[],grossWeight:fab?.weight,sourceLength:t1-t0};
 for(let [which,keepPositive]of [['start',true],['end',false]]){let useOriginal=which==='start'?first:last,cut=member[which+'Cut'],p=useOriginal?(cut?.point??member[which]):{x:point(start,axes,which==='start'?t0:t1)[0],y:point(start,axes,which==='start'?t0:t1)[1],z:point(start,axes,which==='start'?t0:t1)[2]},normal=useOriginal&&cut?vec(cut.normal):axes.ex;part.endPlanes.push({origin:vec(p),normal,keep:dot(normal,axes.ex)>0===keepPositive?'positive':'negative'});}
 if(profile.family==='PL'){
  let outline=member.contour?.length>=3?member.contour.map(p=>[p.s,p.u]):convexHull(pts.map(p=>{let q=sub(p,start);return [dot(q,axes.ex),dot(q,axes.u)]}));outline=clip(clip(outline,t0,true),t1,false);if(outline.length<3||area(outline)<.01)throw Error(`${part.id}: קו מתאר פלטה ריק`);
  let z=unit(cross(axes.ex,axes.u)),normalHand=dot(z,axes.v)>0?1:-1,t=profile.dims.t,origin=point(start,axes,0,0,geometry.dv-normalHand*t/2);
  part.plate={outline,thickness:t,width:Math.max(...outline.map(p=>p[0]))-Math.min(...outline.map(p=>p[0])),height:Math.max(...outline.map(p=>p[1]))-Math.min(...outline.map(p=>p[1])),holes:[],frame:{origin,x:axes.ex,y:axes.u,z}};
  for(let side of ['startCut','endCut'])if(member[side]&&Math.abs(dot(vec(member[side].normal),axes.v))>1e-6)part.warnings.push('PLATE_BEVEL: חיתוך משופע דרך עובי הפלטה אינו ניתן לייצוא כחיתוך לייזר שטוח');
 }
 let holes=fab?.holes??[];for(let h of holes){let absoluteT=t0+h.t,b=boltMap.get(h.boltId),axis,center,halfDepth;
  if(b){axis=unit(vec(b.axis));center=vec(b.p);halfDepth=Math.max(b.grip??0,profile.dims.t??0,30)+h.d+5;}
  else if(h.face==='flange'){axis=axes.v;center=point(start,axes,absoluteT,h.c,h.c2??geometry.dv);halfDepth=Math.max(profile.props.h??0,profile.dims.t??0)+10;}
  else if(h.face==='web'){axis=axes.u;center=point(start,axes,absoluteT,h.c2??geometry.du,h.c);halfDepth=Math.max(profile.props.b??0,profile.dims.t??0)+10;}
  else if(h.face==='section'){axis=axes.ex;center=point(start,axes,absoluteT,h.c,h.c2??0);halfDepth=Math.max(profile.dims.t??0,100);}
  else throw Error(`${part.id}: פאת קידוח לא מוכרת ${h.face}`);
  let slotExtra=Math.max(0,(h.slot??h.d)-h.d),slotAxis=h.face==='section'?axes.u:axes.ex;
  part.drills.push({id:h.boltId??'',center,axis,diameter:h.d,slotExtra,slotAxis,halfDepth});
  if(part.plate){let q=sub(center,part.plate.frame.origin),normalMatch=Math.abs(dot(axis,part.plate.frame.z));if(normalMatch<.999)part.warnings.push('OBLIQUE_HOLE: קדח שאינו ניצב לפלטה אינו נכלל ב־DXF שטוח');else part.plate.holes.push({id:h.boltId??'',x:dot(q,part.plate.frame.x),y:dot(q,part.plate.frame.y),diameter:h.d,slot:slotExtra});}
 }
 if(member.notches?.length){part.notches=structuredClone(member.notches);validateNotches(part);}
 if(member.snip&&!part.plate)throw Error(`${part.id}: קיטום שאינו בפלטה טרם נתמך`);
 part.warnings=[...new Set(part.warnings)];return trimPlateEndPlanes(part);
}
export function snapshot(bridge){let state=bridge.getState(),fab=bridge.manufacturing().fab,boltMap=new Map;for(let c of state.derived.connections)for(let b of c.bolts)boltMap.set(b.id,b);let parts=[],errors=[];for(let f of fab.parts){try{let m=state.derived.byId.get(f.memberId);if(!m)throw Error('אלמנט המקור חסר');parts.push(adaptPart(m,bridge.profile(m.profile),bridge.frame(m),bridge.geometry(m),f,boltMap))}catch(e){errors.push({id:f.id,message:e.message})}}const result=applyProjectNotches({projectId:state.project.id,projectName:state.project.meta.name,revision:state.revision,parts,errors,sourcePartCount:fab.parts.length,assemblyCount:fab.assemblies.length},state.project.fabricationNotches);result.building=state.project.building;result.drawingSettings=state.project.drawingSettings;result.drawingReviews=state.project.drawingReviews;result.materialStock=state.project.materialStock;result.productionSettings=state.project.productionSettings;result.connections=state.derived.connections.map(c=>({id:c.id,label:c.label,type:c.type,members:c.members,parts:c.parts,bolts:c.bolts,welds:c.welds}));result.structuralGroups=structuralGroups(result.parts,result.connections,result.building);return result;}
export function sourceFingerprint(snapshot){return JSON.stringify([snapshot.projectId,snapshot.revision,snapshot.parts.map(p=>[p.id,p.signature,p.frame,p.endPlanes,p.drills,p.plate,p.notches])]);}
