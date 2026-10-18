// Candidate ranges stay visual until the user explicitly confirms or edits them.
export function gapCandidates(lines) {
 const result=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(line.excluded||line.copyGroupId||line.locked||line.reviewed||line.origin==='manual'||line.startMs!==null||line.endMs!==null)continue;
  const before=lines.slice(0,i).filter(l=>!l.excluded).at(-1);
  const after=lines.slice(i+1).find(l=>!l.excluded);
  // A run of several missing lyrics has no observed internal boundaries.
  if(!before||!after||!Number.isFinite(before.endMs)||!Number.isFinite(after.startMs))continue;
  const startMs=before.endMs,endMs=after.startMs;
  if(endMs-startMs<250||endMs-startMs>12000)continue;
  result.push({id:line.id,index:i,startMs,endMs,beforeId:before.id,afterId:after.id});
 }
 return result;
}

// The same explicit confirmation is used by row, detail and bulk review actions.
export function reviewPatch(lines, id) {
 const line=lines.find(l=>l.id===id);
 if(!line)return null;
 if(Number.isFinite(line.startMs)&&Number.isFinite(line.endMs)&&line.endMs>line.startMs)
  return {id,reviewed:true};
 const candidate=gapCandidates(lines).find(g=>g.id===id);
 return candidate?{id,startMs:candidate.startMs,endMs:candidate.endMs,reviewed:true}:null;
}

// An unplaced row must not discard confirmations for the rest of the selection.
export function reviewSelection(lines, ids) {
 const selected=new Set(ids), edits=[], pending=[];
 for(const line of lines){
  if(!selected.has(line.id)||line.excluded)continue;
  const edit=reviewPatch(lines,line.id);
  if(edit)edits.push(edit);else pending.push(line.id);
 }
 return {edits,pending};
}
