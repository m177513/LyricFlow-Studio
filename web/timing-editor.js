import {DEFAULT_GRID,validateGrid,beatTicks} from './timeline-grid.js';
import {gapCandidates,reviewPatch} from './timeline-gaps.js';

export function formatTime(ms) {
 const n=Math.max(0,Math.round(ms||0));
 return `${String(Math.floor(n/60000)).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')}.${String(n%1000).padStart(3,'0')}`;
}
export function parseTime(value){
 const v=value.trim();if(!v)return null;
 if(/^\d+(\.\d{1,3})?$/.test(v))return Math.round(Number(v)*1000);
 const m=/^(\d+):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(v);
 if(!m)throw Error('시간은 00:12.345 또는 12.345초 형식으로 입력하세요.');
 return Number(m[1])*60000+Number(m[2])*1000+Number((m[3]||'').padEnd(3,'0'));
}
export function moveRange(start,end,delta,edge,duration){
 if(edge==='start')return {startMs:Math.max(0,Math.min(end-1,start+delta)),endMs:end};
 if(edge==='end')return {startMs:start,endMs:Math.min(duration,Math.max(start+1,end+delta))};
 const s=Math.max(0,Math.min(duration-(end-start),start+delta));return {startMs:s,endMs:s+end-start};
}
export function createTimingEditor({track,selected,seconds,seek,pause,save,saveGrid,select,selectMany,report,timelineAction,markerAction,onEmptyDoubleClick,listen,isPlaying=()=>false}) {
 const $=id=>document.getElementById(id),host=$('timeline');
 const tools=document.createElement('div');tools.className='timing-tools';
 tools.innerHTML=`<strong>타임라인</strong><span class="wave-status">음원 파형 대기</span><div class="timeline-zoom"><button data-action="out" title="축소">−</button><input id="timeline-zoom" type="range" min="0" max="6" step=".25" value="2" aria-label="타임라인 확대"><button data-action="in" title="확대">＋</button><button data-action="fit">전체</button><button data-action="head">재생 위치</button></div><label class="check"><input type="checkbox" id="timeline-follow" checked>재생 따라가기</label><label class="check"><input type="checkbox" id="timeline-snap" checked>끝점 맞춤</label><div class="timeline-marker-tools"><button data-marker-action="add" title="현재 재생 위치에 마커 추가">마커 추가 (M)</button><button data-marker-action="prev" title="이전 마커로 이동">이전 마커</button><button data-marker-action="next" title="다음 마커로 이동">다음 마커</button><span class="timeline-marker-count"></span></div><div class="timeline-marker-list"></div><div class="timeline-selection-menu" hidden><span class="timeline-selection-count"></span><button data-timeline-action="copy">복사</button><button data-timeline-action="merge" hidden>합치기</button><button data-timeline-action="split" hidden>현재 위치에서 분할</button><button data-timeline-action="delete">삭제</button><button data-timeline-action="ungroup" hidden>아래 레이어로 내리기</button><button data-timeline-action="clear" title="타임라인 선택 해제">선택 해제</button></div>`;
 const gridTools=document.createElement('div');gridTools.className='timeline-grid-tools';
 gridTools.innerHTML=`<div class="grid-modes" role="group" aria-label="타임라인 눈금 단위"><button data-grid-mode="seconds" aria-pressed="true">A · 초</button><button data-grid-mode="beats" aria-pressed="false">B · 박자</button></div><div class="beat-settings" hidden><label>BPM<input id="grid-bpm" aria-label="곡 BPM" type="number" min="20" max="300" step="any"></label><label>박/마디<input id="grid-meter" aria-label="한 마디의 박 수" type="number" min="1" max="12" step="1"></label><label>첫 박 (초)<input id="grid-offset" aria-label="첫 박 시간 (초)" type="number" min="0" step="0.001"></label><button data-grid-action="apply">격자 적용</button><button data-grid-action="head">현재 위치를 첫 박으로</button><span class="grid-status" role="status"></span></div>`;
 tools.prepend(gridTools);
 host.before(tools);host.className='timing-scroll';host.tabIndex=0;
 const detail=document.createElement('div');detail.className='caption-detail';
 detail.innerHTML=`<div class="caption-detail-head"><strong id="selected-caption-label">가사를 선택하세요</strong><button data-detail="previous" title="이전 가사">이전</button><button data-detail="next" title="다음 가사">다음</button><button data-detail="listen">구간 듣기</button><button data-detail="review" class="primary">확인 후 다음</button></div><textarea id="selected-caption-text" rows="2" aria-label="선택 가사 표시 문구" placeholder="오른쪽 목록에서 가사를 선택하세요"></textarea><div class="caption-time-fields"><label>시작<input id="caption-start" placeholder="00:00.000" aria-label="선택 가사 시작 시간"><button data-detail="start">현재 위치로 시작 [I]</button></label><label>종료<input id="caption-end" placeholder="00:00.000" aria-label="선택 가사 종료 시간"><button data-detail="end">현재 위치로 종료 [O]</button></label><button data-detail="apply">시간 적용</button></div><p id="caption-edit-status" role="status"></p>`;
 document.querySelector('.monitor-pane').append(detail);
 const footer=document.createElement('div');footer.className='timeline-help';footer.textContent='A/B: 초·박자 전환  |  ＋ 확대: 세부 박 표시  |  눈금·파형 드래그: 재생 위치  |  자막 몸통: 이동  |  양끝: 길이 조절  |  Ctrl+휠: 확대  |  Space: 재생/정지  |  ← →: 0.1초 (Shift: 1초)';host.after(footer);
 let zoom=4,drag=null,activeTrack=null,activeSelection=null,draft=null,busy=false,serial=0,abort=null,loadKey='',wave=null,waveMessage='음원 파형 대기',raf=0,lastDetail='',manualScrollUntil=0,timelineAnchor=null,lastEmptyClick=null,lastManualDoubleClick=0;
 const cache=new Map();
 let gridFieldsKey='',gridBusy=false;
 function drawGridTools(t){
  const grid=t.timelineGrid||DEFAULT_GRID,key=JSON.stringify([t.id,grid]);
  gridTools.querySelectorAll('[data-grid-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.gridMode===grid.mode)));
  gridTools.querySelector('.beat-settings').hidden=grid.mode!=='beats';
  if(key!==gridFieldsKey){
   $('grid-bpm').value=grid.bpm;$('grid-meter').value=grid.beatsPerBar;$('grid-offset').value=grid.offsetMs/1000;gridFieldsKey=key;
  }
  gridTools.querySelectorAll('button,input').forEach(element=>element.disabled=gridBusy);
  gridTools.querySelector('.grid-status').textContent=gridBusy?'저장 중…':grid.configured?'마디.박 표시 · 첫 박 앞은 도입부 · 고정 BPM':'임시 120 BPM · 곡의 BPM과 첫 박을 설정하세요';
 }
 async function changeGrid(mode,action){
  const t=track();if(!t||busy||gridBusy||drag)return;
  const previous=t.timelineGrid||DEFAULT_GRID;
  const grid=action?{...previous,mode:'beats',bpm:$('grid-bpm').value===''?NaN:Number($('grid-bpm').value),beatsPerBar:Number($('grid-meter').value),offsetMs:action==='head'?Math.round(seconds()*1000):$('grid-offset').value===''?NaN:Math.round(Number($('grid-offset').value)*1000),configured:true}:{...previous,mode};
  validateGrid(grid,t.audio.durationMs);
  gridBusy=true;drawGridTools(t);
  try{await saveGrid(grid,t.id);}finally{gridBusy=false;if(track())draw();}
 }
 gridTools.onclick=e=>{
  const mode=e.target.closest('[data-grid-mode]')?.dataset.gridMode,action=e.target.closest('[data-grid-action]')?.dataset.gridAction;
  if(mode||action){e.stopPropagation();changeGrid(mode,action).catch(report);}
 };
 const chosen=()=>selected().size===1?track()?.lines.find(l=>selected().has(l.id)):null;
 function copyGroups(t){
  const map=new Map();
  t.lines.forEach((line,index)=>{
   if(!line.copyGroupId)return;
   const group=map.get(line.copyGroupId)||{id:line.copyGroupId,lines:[]};group.lines.push({line,index});map.set(line.copyGroupId,group);
  });
  return [...map.values()].sort((a,b)=>a.lines[0].index-b.lines[0].index).map(group=>{
   const current=group.lines.every(({line})=>line.startMs!==null&&line.endMs!==null);
   const values=group.lines.map(({line})=>current?{id:line.id,startMs:line.startMs,endMs:line.endMs}:{id:line.id,startMs:line.copySourceStartMs,endMs:line.copySourceEndMs});
   const timed=values.filter(value=>Number.isFinite(value.startMs)&&Number.isFinite(value.endMs)&&value.endMs>value.startMs);
   const range=timed.length?{startMs:Math.min(...timed.map(value=>value.startMs)),endMs:Math.max(...timed.map(value=>value.endMs))}:null;
   return {...group,values,range,basis:current?'current':'source'};
  });
 }
 function timelineItems(t){
  const groups=copyGroups(t),groupedIds=new Set(groups.flatMap(group=>group.lines.map(({line})=>line.id)));
  const items=groups.map(group=>({key:`group:${group.id}`,lineIds:group.lines.map(({line})=>line.id),index:group.lines[0].index,group:true}));
  t.lines.forEach((line,index)=>{
   if(line.excluded||groupedIds.has(line.id)||line.startMs===null||line.endMs===null)return;
   items.push({key:`line:${line.id}`,lineIds:[line.id],index,group:false});
  });
  return items.sort((a,b)=>a.index-b.index);
 }
 function timelineLineIds(t){return timelineItems(t).flatMap(item=>item.lineIds);}
 function updateSelectionMenu(t){
  const menu=tools.querySelector('.timeline-selection-menu');if(!menu)return;
  const visibleIds=new Set(timelineLineIds(t));
  const ids=[...selected()].filter(id=>visibleIds.has(id));
  menu.hidden=!ids.length;
  menu.querySelector('.timeline-selection-count').textContent=ids.length?`${ids.length}줄 선택됨`:'';
  const ungroup=menu.querySelector('[data-timeline-action="ungroup"]');
  ungroup.hidden=!ids.some(id=>t.lines.find(line=>line.id===id)?.copyGroupId);
  const merge=menu.querySelector('[data-timeline-action="merge"]');
  if(merge){const indexes=ids.map(id=>t.lines.findIndex(line=>line.id===id)).sort((a,b)=>a-b);const contiguous=indexes.length>1&&indexes.every((index,n)=>n===0||index===indexes[n-1]+1);const mergeable=contiguous&&ids.every(id=>{const line=t.lines.find(value=>value.id===id);return line&&!line.excluded&&!line.copyGroupId&&line.startMs!==null&&line.endMs!==null;});merge.hidden=!mergeable;}
  const split=menu.querySelector('[data-timeline-action="split"]');
  if(split){const line=ids.length===1?t.lines.find(value=>value.id===ids[0]):null;split.hidden=!line||line.copyGroupId||line.excluded||line.startMs===null||line.endMs===null;}
 }
 function updateMarkerList(t){
  const list=tools.querySelector('.timeline-marker-list'),count=tools.querySelector('.timeline-marker-count');if(!list||!count)return;
  const markers=[...(t?.markers||[])].sort((a,b)=>a.atMs-b.atMs);
  count.textContent=markers.length?`${markers.length}개`:'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  list.innerHTML=markers.length?markers.map(marker=>`<span class="timeline-marker-item"><button data-marker-action="seek" data-marker-id="${esc(marker.id)}" title="${esc(marker.label)} · ${formatTime(marker.atMs)}">${formatTime(marker.atMs)}</button><input data-marker-label data-marker-id="${esc(marker.id)}" value="${esc(marker.label)}" aria-label="${esc(marker.label)} 마커 이름"><button data-marker-action="delete" data-marker-id="${esc(marker.id)}" title="마커 삭제">×</button></span>`).join(''):'<span class="timeline-marker-empty">마커 없음 · M으로 현재 위치에 추가</span>';
  list.querySelectorAll('[data-marker-label]').forEach(input=>{
   let lastCommitted=input.value,pending=false;
   const commit=async()=>{const value=input.value.trim();if(!value||value===lastCommitted||pending)return;pending=true;try{await markerAction?.('rename',input.dataset.markerId,value);lastCommitted=value;}catch(error){input.value=lastCommitted;report(error);}finally{pending=false;}};
   input.addEventListener('change',()=>{void commit();});input.addEventListener('blur',()=>{void commit();});input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void commit();input.blur();}});
  });
 }
 function selectTimeline(itemIds,{additive=false,range=false,targetId=itemIds.at(-1)}={}){
  const t=track();if(!t||!itemIds.length)return;
  const ordered=timelineLineIds(t),target=targetId||itemIds.at(-1);let next=new Set(selected());
  if(range&&timelineAnchor&&ordered.includes(timelineAnchor)&&ordered.includes(target)){
   const from=ordered.indexOf(timelineAnchor),to=ordered.indexOf(target),ids=ordered.slice(Math.min(from,to),Math.max(from,to)+1);
   if(additive)ids.forEach(id=>next.add(id));else next=new Set(ids);
  }else if(additive){
   const all=itemIds.every(id=>next.has(id));itemIds.forEach(id=>all?next.delete(id):next.add(id));
  }else next=new Set(itemIds);
  timelineAnchor=target;selectMany([...next],target);
 }
 function orderAfterGroupMove(t,ids,edits){
  const groupIds=new Set(ids),byId=new Map(edits.map(edit=>[edit.id,edit])),block=t.lines.filter(line=>groupIds.has(line.id)).sort((a,b)=>(byId.get(a.id)?.startMs??a.startMs??Infinity)-(byId.get(b.id)?.startMs??b.startMs??Infinity));
  if(!block.length)return t.lines.map(line=>line.id);
  const start=Math.min(...block.map(line=>byId.get(line.id)?.startMs??line.startMs).filter(value=>Number.isFinite(value))),remaining=t.lines.filter(line=>!groupIds.has(line.id));
  let insert=remaining.findIndex(line=>Number.isFinite(line.startMs)&&line.startMs>start);if(insert<0)insert=remaining.length;
  remaining.splice(insert,0,...block);return remaining.map(line=>line.id);
 }
 function suggestedRange(l){return l?gapCandidates(track()?.lines||[]).find(g=>g.id===l.id):null;}
 function currentRange(l){return draft&&l&&draft.id===l.id?{startMs:draft.start,endMs:draft.end}:suggestedRange(l)||l;}
 function status(message,error=false){$('caption-edit-status').textContent=message;$('caption-edit-status').classList.toggle('error-status',error);}
 function detailDraw(){
  const l=chosen(),key=JSON.stringify([l,selected().size,draft,busy]);if(key===lastDetail)return;lastDetail=key;
  const range=currentRange(l);$('selected-caption-label').textContent=l?`${track().lines.indexOf(l)+1}번 가사`:(selected().size>1?`${selected().size}줄 선택됨`:'가사를 선택하세요');
  if(document.activeElement!==$('selected-caption-text'))$('selected-caption-text').value=l?.text||'';$('selected-caption-text').disabled=!l||busy;
  for(const [id,k] of [['caption-start','startMs'],['caption-end','endMs']])if(document.activeElement!==$(id))$(id).value=range?.[k]==null?'':formatTime(range[k]);
  detail.querySelectorAll('button,input').forEach(el=>el.disabled=!l||busy);
  detail.querySelector('[data-detail="review"]').disabled=!l||busy||!reviewPatch(track()?.lines||[],l.id)||!!draft||l.flags.some(f=>['overlap','order'].includes(f));
  detail.querySelector('[data-detail="listen"]').disabled=!l||(!suggestedRange(l)&&(l.startMs===null||l.endMs===null));
  if(l)status(busy?'저장 중…':draft?'아직 저장되지 않았습니다. 시작·종료를 지정하고 시간 적용을 누르세요.':suggestedRange(l)?'앞뒤 가사 사이의 위치 후보입니다. 위치가 맞으면 확인 후 다음을 누르세요. 위치 저장과 검수 완료가 함께 적용됩니다.':l.startMs===null?'시간 미지정 · 앞뒤 가사를 들으며 시작 [I] → 종료 [O]를 지정하세요.':l.reviewed?'검수 완료':l.locked?'수동 시간 저장됨 · 들어본 뒤 확인하세요.':'파형과 함께 듣고 자막의 시작·끝을 맞추세요.');
 }
 function pxPerMs(){return host.firstElementChild?.offsetWidth/(track()?.audio.durationMs||1)||1;}
 function draw(){
  if(drag)return;const t=track();if(!t){host.replaceChildren();return;}
  if(activeTrack!==t.id){activeTrack=t.id;zoom=Math.max(1,Math.min(64,t.audio.durationMs/20000));draft=null;activeSelection=null;timelineAnchor=null;host.scrollLeft=0;wave=null;waveMessage='음원 파형 대기';}
  const l=chosen();if(activeSelection!==l?.id){activeSelection=l?.id;draft=null;lastDetail='';}
  const duration=t.audio.durationMs,w=Math.max(1,host.clientWidth*zoom),groups=copyGroups(t),groupedIds=new Set(groups.flatMap(group=>group.lines.map(({line})=>line.id)));
  const canvas=document.createElement('div');canvas.className='timing-canvas';canvas.style.width=w+'px';
  const grid=t.timelineGrid||DEFAULT_GRID;
  drawGridTools(t);
  if(grid.mode==='beats'&&duration>0){
   if(grid.offsetMs>0){const intro=document.createElement('span');intro.className='grid-intro';intro.textContent='도입부';canvas.append(intro);}
   for(const {ms,major,label} of beatTicks(duration,w,grid)){const tick=document.createElement('span');tick.className='timing-tick beat-tick'+(major?' bar-tick':'');tick.style.left=ms/duration*w+'px';tick.textContent=label;tick.title=formatTime(ms);canvas.append(tick);}
  }else{
   const step=[100,200,500,1000,2000,5000,10000,30000,60000,120000,300000].find(s=>s/duration*w>=80)||600000;
   for(let ms=0;ms<duration;ms+=step){const tick=document.createElement('span');tick.className='timing-tick';tick.style.left=ms/duration*w+'px';tick.textContent=formatTime(ms);canvas.append(tick);}
  }
  for(const marker of (t.markers||[])){const pin=document.createElement('button');pin.type='button';pin.className='timing-marker';pin.dataset.markerId=marker.id;pin.style.left=Math.max(0,Math.min(w-1,marker.atMs/duration*w))+'px';pin.title=`${marker.label} · ${formatTime(marker.atMs)}`;pin.innerHTML='<i></i><span></span>';pin.querySelector('span').textContent=marker.label;canvas.append(pin);}
  const groupBand=document.createElement('div');groupBand.className='timing-group-band';canvas.append(groupBand);
  for(const group of groups){
   const block=document.createElement('div');block.className='timing-group'+(group.range?'':' unplaced')+(group.lines.some(({line})=>selected().has(line.id))?' selected':'');block.dataset.group=group.id;block.setAttribute('role','button');block.tabIndex=0;
   const range=group.range||{startMs:0,endMs:Math.min(duration,Math.max(1000,group.lines.length*1000))};
   block.style.left=range.startMs/duration*w+'px';block.style.width=Math.max(12,(range.endMs-range.startMs)/duration*w)+'px';
   block.title=group.range?'복사한 가사 묶음입니다. 드래그하면 줄 사이 간격을 유지한 채 함께 이동합니다.':'복사한 가사 묶음입니다. 원본 줄의 시간이 없어 묶음 이동을 시작할 수 없습니다.';
   const label=document.createElement('span');label.textContent=group.range?`복사 블록 · ${group.lines.length}줄`:`복사 블록 · ${group.lines.length}줄 · 시간 필요`;block.append(label);
   if(group.range){
    const span=Math.max(1,group.range.endMs-group.range.startMs);
    for(const value of group.values){if(!Number.isFinite(value.startMs)||!Number.isFinite(value.endMs))continue;const segment=document.createElement('i');segment.className='timing-group-segment';segment.style.left=((value.startMs-group.range.startMs)/span*100)+'%';segment.style.width=Math.max(.5,(value.endMs-value.startMs)/span*100)+'%';segment.title=formatTime(value.startMs)+' – '+formatTime(value.endMs);block.append(segment);}
   }
   canvas.append(block);
  }
  const band=document.createElement('div');band.className='caption-track-band';canvas.append(band);
  t.lines.forEach((line,i)=>{if(line.excluded||groupedIds.has(line.id)||line.startMs===null||line.endMs===null)return;
   const b=document.createElement('div');b.className='timing-cue'+(selected().has(line.id)?' selected':'')+(line.flags.length&&!line.reviewed?' warn':'')+(line.flags.includes('overlap')?' overlap':'');b.dataset.id=line.id;b.setAttribute('role','button');b.setAttribute('aria-label',`${i+1}번 ${line.text}`);b.tabIndex=0;
   b.style.left=line.startMs/duration*w+'px';b.style.width=Math.max(2,(line.endMs-line.startMs)/duration*w)+'px';b.title=`${i+1}. ${line.text}\n${formatTime(line.startMs)} – ${formatTime(line.endMs)}`;
   const text=document.createElement('span');text.textContent=`${i+1}. ${line.text}`;b.append(text);
   for(const edge of ['start','end']){const h=document.createElement('i');h.dataset.edge=edge;h.className=edge;h.title=edge==='start'?'시작점 조절':'종료점 조절';b.append(h);}canvas.append(b);
  });
  for(const gap of gapCandidates(t.lines)){
   const line=t.lines[gap.index],b=document.createElement('div');
   b.className='timing-cue gap-candidate'+(selected().has(line.id)?' selected':'');b.dataset.id=line.id;b.dataset.candidate='true';b.setAttribute('role','button');b.tabIndex=0;
   b.setAttribute('aria-label',`${gap.index+1}번 위치 후보 ${line.text}`);
   b.style.left=gap.startMs/duration*w+'px';b.style.width=Math.max(2,(gap.endMs-gap.startMs)/duration*w)+'px';
   b.title=`${gap.index+1}. ${line.text}\n앞뒤 가사 기준 위치 후보 · ${formatTime(gap.startMs)} – ${formatTime(gap.endMs)}\n실제 자막 시간은 미저장. 듣고 양끝을 드래그하세요.`;
   const label=document.createElement('span');label.textContent=`${gap.index+1}. ${line.text} · 후보`;b.append(label);
   for(const edge of ['start','end']){const h=document.createElement('i');h.dataset.edge=edge;h.className=edge;h.title=edge==='start'?'후보 시작점 조절':'후보 종료점 조절';b.append(h);}canvas.append(b);
  }
  const waveCanvas=document.createElement('canvas');waveCanvas.className='audio-wave';canvas.append(waveCanvas);
  const head=document.createElement('div');head.className='timing-head';head.innerHTML='<span></span>';canvas.append(head);
  const prevScroll=host.scrollLeft;host.replaceChildren(canvas);host.scrollLeft=prevScroll;
  $('timeline-zoom').value=Math.log2(zoom);tools.querySelector('.wave-status').textContent=waveMessage;
  updateSelectionMenu(t);updateMarkerList(t);detailDraw();update();paintWave();
 }
 function paintWave(){
  const c=host.querySelector('.audio-wave');if(!c)return;const width=host.clientWidth;c.width=width*devicePixelRatio;c.height=60*devicePixelRatio;c.style.width=width+'px';c.style.left=host.scrollLeft+'px';
  const ctx=c.getContext('2d');ctx.scale(devicePixelRatio,devicePixelRatio);ctx.fillStyle='#101d25';ctx.fillRect(0,0,width,60);ctx.strokeStyle='#314650';ctx.beginPath();ctx.moveTo(0,30);ctx.lineTo(width,30);ctx.stroke();
  if(!wave)return;const total=host.firstChild.offsetWidth;ctx.fillStyle='#69b0be';
  for(let x=0;x<width;x++){const a=Math.floor((host.scrollLeft+x)/total*wave.length),b=Math.max(a+1,Math.ceil((host.scrollLeft+x+1)/total*wave.length));let peak=0;for(let n=a;n<Math.min(wave.length,b);n++)peak=Math.max(peak,wave[n]);const h=Math.max(1,peak*52);ctx.fillRect(x,30-h/2,1,h);}
 }
 host.addEventListener('scroll',()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(paintWave);});
  host.addEventListener('wheel',e=>{if(e.ctrlKey){e.preventDefault();setZoom(zoom*(e.deltaY<0?1.25:.8),e.clientX-host.getBoundingClientRect().left);}else{manualScrollUntil=Date.now()+2000;if(Math.abs(e.deltaY)>Math.abs(e.deltaX)){e.preventDefault();host.scrollLeft+=e.deltaY;}}},{passive:false});
  host.addEventListener('dblclick',e=>{
   if(busy||!track()||e.target.closest('.timing-cue,.timing-group,.timing-head,.audio-wave'))return;
   if(performance.now()-lastManualDoubleClick<500){lastManualDoubleClick=0;return;}
   const canvas=host.firstElementChild,rect=canvas?.getBoundingClientRect();if(!rect)return;
   const ms=Math.max(0,Math.min(track().audio.durationMs-1,Math.round((e.clientX-rect.left)/pxPerMs())));
   onEmptyDoubleClick?.(ms);
  });
 function update(){const t=track();if(!t)return;const head=host.querySelector('.timing-head');if(!head)return;const x=seconds()*1000*pxPerMs();head.style.left=x+'px';
  if($('timeline-follow').checked&&isPlaying()&&!drag&&Date.now()>manualScrollUntil&&(x<host.scrollLeft||x>host.scrollLeft+host.clientWidth-35))host.scrollLeft=Math.max(0,x-host.clientWidth*.2);
  for(const el of host.querySelectorAll('.timing-cue')){const l=t.lines.find(l=>l.id===el.dataset.id);el.classList.toggle('at-playhead',!!l&&l.startMs!==null&&seconds()*1000>=l.startMs&&seconds()*1000<l.endMs);}
 }
 function center(ms=seconds()*1000){host.scrollLeft=Math.max(0,ms*pxPerMs()-host.clientWidth/2);}
 function setZoom(value,anchorPx=host.clientWidth/2){const anchor=(host.scrollLeft+anchorPx)/pxPerMs();zoom=Math.max(1,Math.min(64,value));draw();host.scrollLeft=anchor*pxPerMs()-anchorPx;paintWave();}
 function focus(id,{jump=true,select:shouldSelect=true}={}){const t=track(),l=t?.lines.find(l=>l.id===id);if(!l)return;
  if(shouldSelect)select(id);draw();
  if(jump){pause();const index=t.lines.indexOf(l);const previous=t.lines.slice(0,index).reverse().find(l=>l.endMs!==null);const start=l.startMs??previous?.endMs??0;seek(start/1000);center(start);}
  const row=Array.from(document.querySelectorAll('#lines [data-line]')).find(el=>el.dataset.line===id);if(row){const list=row.closest('.table-scroll'),r=row.getBoundingClientRect(),box=list.getBoundingClientRect();if(r.top<box.top+35)list.scrollTop-=box.top+35-r.top;else if(r.bottom>box.bottom)list.scrollTop+=r.bottom-box.bottom;}
 }
 function next(delta){const t=track(),l=chosen();if(!t)return;const index=l?t.lines.indexOf(l):(delta>0?-1:t.lines.length);const candidates=t.lines.filter((c,i)=>!c.excluded&&(delta>0?i>index:i<index)&&(!$('suspicious')?.checked||(c.flags.length&&!c.reviewed)));const target=delta>0?candidates[0]:candidates.at(-1);if(target)focus(target.id);else status('이 방향에 남은 가사가 없습니다.');}
 async function persist(edits,extra={}){if(busy)return;const id=track().id;busy=true;detailDraw();try{await save(edits,id,extra);if(track()?.id===id){draft=null;lastDetail='';}}finally{busy=false;draw();}}
 async function apply(){const l=chosen();if(!l)return;const start=parseTime($('caption-start').value),end=parseTime($('caption-end').value);if(start===null||end===null)throw Error('시작·종료 두 시간을 모두 지정하세요.');if(end<=start||end>track().audio.durationMs)throw Error('시작보다 뒤이며 음원 길이 이내인 종료점을 지정하세요.');await persist([{id:l.id,startMs:start,endMs:end}]);}
 async function stamp(edge){const l=chosen();if(!l)throw Error('먼저 가사 한 줄을 선택하세요.');const range=currentRange(l),ms=Math.round(seconds()*1000);draft={id:l.id,start:range.startMs,end:range.endMs};draft[edge]=ms;lastDetail='';detailDraw();if(draft.start!==null&&draft.end!==null&&draft.end>draft.start)await apply();}
 detail.onclick=e=>{const action=e.target.closest('[data-detail]')?.dataset.detail;if(!action||busy)return;Promise.resolve().then(async()=>{if(action==='previous'||action==='next')return next(action==='previous'?-1:1);if(action==='start'||action==='end')return stamp(action);if(action==='apply')return apply();const l=chosen();if(!l)return;if(action==='listen'){if(listen)listen(l.id);else document.querySelector(`[data-listen="${l.id}"]`)?.click();center(currentRange(l).startMs);return;}if(action==='review'){const edit=reviewPatch(track().lines,l.id);if(!edit)throw Error('확인할 위치 후보가 없습니다.');await persist([edit]);next(1);}}).catch(e=>{status(e.message,true);report(e);});};
 $('selected-caption-text').onchange=()=>{const l=chosen();if(l)persist([{id:l.id,text:$('selected-caption-text').value}]).catch(report);};
 for(const id of ['caption-start','caption-end'])$(id).addEventListener('change',()=>{const l=chosen();if(!l)return;try{draft={id:l.id,start:parseTime($('caption-start').value),end:parseTime($('caption-end').value)};lastDetail='';detailDraw();}catch(e){status(e.message,true);}});
  tools.onclick=e=>{
   const markerButton=e.target.closest('[data-marker-action]');
   if(markerButton){const action=markerButton.dataset.markerAction,id=markerButton.dataset.markerId;Promise.resolve(markerAction?.(action,id)).catch(report);return;}
   const selectionAction=e.target.closest('[data-timeline-action]')?.dataset.timelineAction;
   if(selectionAction){
    const t=track(),visible=new Set(t?timelineLineIds(t):[]),ids=[...selected()].filter(id=>visible.has(id));
    if(selectionAction==='clear'){timelineAnchor=null;selectMany([],null);return;}
    if(ids.length)Promise.resolve(timelineAction?.(selectionAction,ids)).catch(report);
    return;
   }
   const a=e.target.closest('[data-action]')?.dataset.action;if(a==='in')setZoom(zoom*1.5);if(a==='out')setZoom(zoom/1.5);if(a==='fit')setZoom(1);if(a==='head')center();
  };
  $('timeline-zoom').oninput=e=>setZoom(2**Number(e.target.value));
 function seekPointer(e){const r=host.firstChild.getBoundingClientRect();seek(Math.max(0,Math.min(track().audio.durationMs,(e.clientX-r.left)/pxPerMs()))/1000);}
  host.onpointerdown=e=>{if(e.button!==0||busy||!track())return;pause();
   const additive=Boolean(e.ctrlKey||e.metaKey),rangeSelect=Boolean(e.shiftKey);
   const markerEl=e.target.closest('.timing-marker');
   if(markerEl){const marker=track().markers?.find(value=>value.id===markerEl.dataset.markerId);if(marker){seek(marker.atMs/1000);markerAction?.('seek',marker.id);}e.preventDefault();return;}
   const groupEl=e.target.closest('.timing-group');
   if(groupEl){
    const group=copyGroups(track()).find(value=>value.id===groupEl.dataset.group);if(!group)return;
    const ids=group.lines.map(({line})=>line.id);selectTimeline(ids,{additive,range:rangeSelect,targetId:ids[0]});
    if(additive||rangeSelect||!group.range){if(!group.range)status('복사 레이어를 선택했습니다. 개별 시간을 지정하거나 아래 레이어로 내리세요.');e.preventDefault();return;}
    const values=group.values.filter(value=>Number.isFinite(value.startMs)&&Number.isFinite(value.endMs));
    const currentGroupEl=host.querySelector(`[data-group="${group.id}"]`)||groupEl;
    drag={mode:'group',groupId:group.id,ids,track:track().id,snapshot:JSON.stringify(group.lines.map(({line})=>({id:line.id,startMs:line.startMs,endMs:line.endMs,text:line.text}))),x:e.clientX,start:group.range.startMs,end:group.range.endMs,values,group:currentGroupEl,scroll:host.scrollLeft};
    host.setPointerCapture(e.pointerId);e.preventDefault();return;
   }
   const cue=e.target.closest('.timing-cue');if(!cue){
    // Some browser automation paths emit two pointerdowns without a native dblclick.
    // Keep a small manual double-click fallback for the empty caption lane only.
    const hostRect=host.getBoundingClientRect(),localY=e.clientY-hostRect.top;
    const inCaptionLane=localY>=29&&localY<80;
    const now=performance.now();
    if(inCaptionLane&&lastEmptyClick&&now-lastEmptyClick.time<420&&Math.abs(e.clientX-lastEmptyClick.x)<14&&Math.abs(e.clientY-lastEmptyClick.y)<18){
     lastEmptyClick=null;lastManualDoubleClick=now;drag=null;e.preventDefault();onEmptyDoubleClick?.(Math.max(0,Math.min(track().audio.durationMs-1,Math.round((e.clientX-host.firstChild.getBoundingClientRect().left)/pxPerMs()))));return;
    }
    lastEmptyClick=inCaptionLane?{time:now,x:e.clientX,y:e.clientY}:null;
    drag={mode:'seek'};seekPointer(e);host.setPointerCapture(e.pointerId);e.preventDefault();return;}
   lastEmptyClick=null;
   const l=track().lines.find(l=>l.id===cue.dataset.id);if(!l)return;
   if(additive||rangeSelect){selectTimeline([l.id],{additive,range:rangeSelect,targetId:l.id});e.preventDefault();return;}
   timelineAnchor=l.id;const edge=e.target.dataset.edge,range=currentRange(l);select(l.id);const currentCue=host.querySelector(`[data-id="${l.id}"]`)||cue;drag={mode:'clip',id:l.id,track:track().id,snapshot:JSON.stringify(l),x:e.clientX,start:range.startMs,end:range.endMs,edge,cue:currentCue,scroll:host.scrollLeft};detailDraw();currentCue.classList.add('selected');host.setPointerCapture(e.pointerId);e.preventDefault();};
  host.onpointermove=e=>{if(!drag)return;if(drag.mode==='seek'){seekPointer(e);return;}const d=drag;let delta=Math.round((e.clientX-d.x+host.scrollLeft-d.scroll)/pxPerMs());
   if(d.mode==='group'){
    let range=moveRange(d.start,d.end,delta,null,track().audio.durationMs);
    if($('timeline-snap').checked&&!e.altKey){const targets=[Math.round(seconds()*1000),...track().lines.filter(l=>!d.ids.includes(l.id)).flatMap(l=>[l.startMs,l.endMs]).filter(v=>v!==null)];let correction=Infinity;for(const target of targets)for(const point of [range.startMs,range.endMs])if(Math.abs(target-point)<Math.abs(correction))correction=target-point;if(Math.abs(correction)*pxPerMs()<=6)range=moveRange(d.start,d.end,delta+correction,null,track().audio.durationMs);}
    d.next=range;d.delta=range.startMs-d.start;d.group.style.left=range.startMs*pxPerMs()+'px';d.group.style.width=Math.max(12,(range.endMs-range.startMs)*pxPerMs())+'px';status(`${d.ids.length}줄 묶음 이동 · ${formatTime(range.startMs)} → ${formatTime(range.endMs)} · 놓으면 저장`);return;
   }
   let range=moveRange(d.start,d.end,delta,d.edge,track().audio.durationMs);
   if($('timeline-snap').checked&&!e.altKey){const targets=[Math.round(seconds()*1000),...track().lines.filter(l=>l.id!==d.id).flatMap(l=>[l.startMs,l.endMs]).filter(v=>v!==null)];const points=d.edge==='start'?[range.startMs]:d.edge==='end'?[range.endMs]:[range.startMs,range.endMs];let correction=Infinity;for(const target of targets)for(const point of points)if(Math.abs(target-point)<Math.abs(correction))correction=target-point;if(Math.abs(correction)*pxPerMs()<=6)range=moveRange(d.start,d.end,delta+correction,d.edge,track().audio.durationMs);}
   d.next={id:d.id,...range};d.cue.style.left=range.startMs*pxPerMs()+'px';d.cue.style.width=Math.max(2,(range.endMs-range.startMs)*pxPerMs())+'px';$('caption-start').value=formatTime(range.startMs);$('caption-end').value=formatTime(range.endMs);status(`${d.edge?'길이 조절':'구간 이동'} · ${formatTime(range.startMs)} → ${formatTime(range.endMs)} · 놓으면 저장`);
  };
  host.onpointerup=async()=>{if(!drag)return;const d=drag;drag=null;if(d.mode==='seek'){draw();return;}try{if(track().id!==d.track)throw Error('곡이 바뀌어 드래그를 취소했습니다.');if(d.mode==='group'){
     if(d.delta){const current=copyGroups(track()).find(value=>value.id===d.groupId);if(!current||JSON.stringify(current.lines.map(({line})=>({id:line.id,startMs:line.startMs,endMs:line.endMs,text:line.text})))!==d.snapshot)throw Error('가사가 다른 작업에서 변경되었습니다. 다시 선택하세요.');const edits=d.values.map(value=>({id:value.id,startMs:value.startMs+d.delta,endMs:value.endMs+d.delta}));await persist(edits,{lineOrder:orderAfterGroupMove(track(),d.ids,edits)});}else if(selectMany)selectMany(d.ids);return;
    }
    if(d.next&&(d.next.startMs!==d.start||d.next.endMs!==d.end)){if(JSON.stringify(track().lines.find(l=>l.id===d.id))!==d.snapshot)throw Error('가사가 다른 작업에서 변경되었습니다. 다시 선택하세요.');await persist([d.next]);}else focus(d.id);}catch(e){report(e);}draw();};
 host.onpointercancel=()=>{drag=null;draw();};
  host.addEventListener('keydown',e=>{const group=e.target.closest('.timing-group');if(group&&e.key==='Enter'){e.preventDefault();const value=copyGroups(track()).find(item=>item.id===group.dataset.group);if(value)selectMany?.(value.lines.map(({line})=>line.id));return;}const cue=e.target.closest('.timing-cue');if(cue&&e.key==='Enter'){e.preventDefault();focus(cue.dataset.id);}});
 window.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]')||e.ctrlKey||e.metaKey||e.altKey||busy)return;
  if(['a','b'].includes(e.key.toLowerCase())&&!e.repeat){e.preventDefault();changeGrid(e.key.toLowerCase()==='a'?'seconds':'beats').catch(report);return;}
  if(e.key.toLowerCase()==='i'||e.key.toLowerCase()==='o'){e.preventDefault();stamp(e.key.toLowerCase()==='i'?'start':'end').catch(e=>{status(e.message,true);report(e);});}
  if(e.key.toLowerCase()==='m'){e.preventDefault();Promise.resolve(markerAction?.('add')).catch(report);}
  if(e.key==='Home'){e.preventDefault();pause();seek(0);center(0);}
  if(e.key==='End'){e.preventDefault();pause();seek(track()?.audio.durationMs/1000||0);center(track()?.audio.durationMs||0);}
  if(e.key.toLowerCase()==='j'){e.preventDefault();pause();seek(Math.max(0,seconds()-5));center();}
  if(e.key.toLowerCase()==='l'){e.preventDefault();pause();seek(Math.min(track()?.audio.durationMs/1000||0,seconds()+5));center();}
  if(e.key.toLowerCase()==='k'){e.preventDefault();pause();}
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();pause();seek(Math.max(0,Math.min(track()?.audio.durationMs/1000||0,seconds()+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?1:.1))));center();}
  if(e.code==='Space'&&!e.repeat){e.preventDefault();$('play').click();}
 });
 async function loadAudio(url,id,hash){
  const key=id+':'+hash;if(loadKey===key)return;loadKey=key;abort?.abort();abort=new AbortController();const signal=abort.signal,version=++serial;wave=null;
  if(cache.has(key)){wave=cache.get(key);waveMessage='원본 음원 파형';draw();return;}
  waveMessage='음원 파형 읽는 중…';draw();let context;
  try{const response=await fetch(url,{signal});if(!response.ok)throw Error('음원 읽기 실패');const data=await response.arrayBuffer();if(signal.aborted)return;context=new AudioContext();const audio=await context.decodeAudioData(data);if(version!==serial||track()?.id!==id)return;
   const bins=Math.min(20000,Math.ceil(audio.duration*60)),peaks=new Float32Array(bins),samples=audio.getChannelData(0),step=samples.length/bins;
   for(let i=0;i<bins;i++){let peak=0;for(let j=Math.floor(i*step);j<Math.min(samples.length,(i+1)*step);j+=4)peak=Math.max(peak,Math.abs(samples[j]));peaks[i]=peak;}
   cache.set(key,peaks);while(cache.size>2)cache.delete(cache.keys().next().value);wave=peaks;waveMessage='원본 음원 파형';
  }catch(e){if(version===serial)waveMessage=signal.aborted?'음원 파형 대기':'파형을 읽지 못했습니다 · 재생으로 확인하세요.';}finally{await context?.close();if(version===serial)draw();}
 }
 new ResizeObserver(()=>draw()).observe(host);
 return {draw,update,focus,center,loadAudio};
}
