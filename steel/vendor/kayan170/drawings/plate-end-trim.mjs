// Clip the flat contour against the original modeled end-cut half spaces.
// A cut inclined through thickness is explicitly unsupported, never flattened silently.
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]);
const area=p=>Math.abs(p.reduce((s,q,i)=>{let r=p[(i+1)%p.length];return s+q[0]*r[1]-q[1]*r[0]},0)/2);
const EPS=1e-7;
function clean(poly){return poly.filter((q,i)=>Math.hypot(q[0]-poly[(i+poly.length-1)%poly.length][0],q[1]-poly[(i+poly.length-1)%poly.length][1])>EPS);}
export function trimPlateEndPlanes(part){if(!part.plate||part.warnings?.length)return part;const a=part.plate,f=a.frame;let poly=a.outline.map(q=>[...q]);const old=area(poly);for(const cut of part.endPlanes||[]){const sign=cut.keep==='positive'?1:-1;const nx=dot(cut.normal,f.x)*sign,ny=dot(cut.normal,f.y)*sign,nz=dot(cut.normal,f.z)*sign,k=dot(cut.normal,sub(f.origin,cut.origin))*sign;const signed=q=>nx*q[0]+ny*q[1]+k;let d=poly.map(signed);if(Math.abs(nz)>EPS){if(d.some(x=>Math.min(x,x+nz*a.thickness)<-EPS))return {...part,warnings:[...(part.warnings||[]),'חיתוך משופע דרך עובי פלטה דורש גוף תלת־ממדי']};continue;}if(d.every(x=>x>=-EPS))continue;const clipped=[];for(let i=0;i<poly.length;i++){let j=(i+1)%poly.length,A=poly[i],B=poly[j],da=d[i],db=d[j];const ia=da>=-EPS,ib=db>=-EPS;if(ia)clipped.push(A);if(ia!==ib){let t=da/(da-db);t=Math.max(0,Math.min(1,t));clipped.push(A.map((v,k)=>v+t*(B[k]-v)));}}poly=clean(clipped);if(poly.length<3||area(poly)<.01)throw Error('מישור חיתוך מקור מבטל את הפלטה: '+part.id);}
 const removed=old-area(poly);if(removed<1e-5)return part;return {...part,plate:{...a,outline:poly,width:Math.max(...poly.map(q=>q[0]))-Math.min(...poly.map(q=>q[0])),height:Math.max(...poly.map(q=>q[1]))-Math.min(...poly.map(q=>q[1]))},endTrim:{source:'endPlanes',removedArea:removed,removedVolume:removed*a.thickness}};
}
export function trimSnapshot(s){return {...s,parts:s.parts.map(trimPlateEndPlanes)};}
