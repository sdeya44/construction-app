// Drawing groups reference existing production IDs. They never change shop assemblies or quantities.
export function structuralGroups(parts,connections,building={}){
 const groups=new Map,ensure=(id,family,title,axes)=>{if(!groups.has(id))groups.set(id,{id,family,title,axes,memberIds:new Set,connectionIds:new Set});return groups.get(id)};
 for(const p of parts){const id=p.memberId;let m;
  if((m=/^BB\.(\d+)\.([^.]+)(?:\.|$)/.exec(id)))ensure(`BB.${m[1]}.${m[2]}`,'portal',`אגד B — ציר ${m[2]}, מפתח ${m[1]}`,[1,2]).memberIds.add(id);
  if((m=/^LT\.(\d+)\.([^.]+)\./.exec(id)))ensure(`LT.${m[1]}.${m[2]}`,'lock',`מסבך נעילה — ציר ${m[2]}, מפתח ${m[1]}`,[1,2]).memberIds.add(id);
  if((m=/^TB\.([^.]+)(?:\.|$)/.exec(id))&&parts.some(p=>p.memberId.startsWith('TB.'+m[1]+'.TR.')))ensure(`TB.${m[1]}`,'carrying',`מסבך קורה נושאת ${m[1]}`,[1,2]).memberIds.add(id);
 }
 const rt=building.roofTruss;if(rt?.enabled)for(const fr of building.frames||[]){if(rt.frames!=='all'&&!rt.frames?.includes(fr.id))continue;const selected=parts.filter(p=>p.memberId.startsWith(`TR.${fr.id}.`)||p.memberId.startsWith(`${fr.id}.BC.`)||new RegExp('^'+fr.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.S[0-9]+\\.BC\\.').test(p.memberId));if(!selected.length)continue;const g=ensure(`ROOF.${fr.id}`,'roof',`מסבך גג — מסגרת ${fr.id}`,[0,2]);for(const p of selected)g.memberIds.add(p.memberId);for(const p of parts)if(p.memberId.startsWith(`${fr.id}.RAF.`))g.memberIds.add(p.memberId);}
 for(const g of groups.values())for(const c of connections||[]){const explicit=g.family==='roof'?['C.TR.','C.TRS.','C.TRE.'].some(prefix=>c.id===prefix+g.id.slice(5)||c.id.startsWith(prefix+g.id.slice(5)+'.')):c.id.startsWith('C.'+g.id+'.');if(explicit||(c.members||[]).some(id=>g.memberIds.has(id))){g.connectionIds.add(c.id);for(const id of c.parts||[])g.memberIds.add(id);}}
 return [...groups.values()].map(g=>({...g,memberIds:[...g.memberIds],connectionIds:[...g.connectionIds],partIds:parts.filter(p=>g.memberIds.has(p.memberId)).map(p=>p.id)})).filter(g=>g.partIds.length);
}
