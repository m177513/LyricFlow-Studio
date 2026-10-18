import {mountShorts} from './shorts.js';
import {mountWorkbench} from './workbench.js';
import {createTimingEditor} from './timing-editor.js?v=20261008-workbench1';
import {gapCandidates,reviewPatch,reviewSelection} from './timeline-gaps.js';
import {processingStatus,processingOverview} from './processing-status.js';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = {session:null,project:null,trackId:null,selected:new Set(),selectionAnchor:null,controller:null,playerModule:null,seconds:0,loopLine:null,playing:false,pending:{},saveTimer:null,refreshTimer:null,refreshSerial:0,lastPreview:'',styleDirty:false,saving:Promise.resolve()};
const flags = {unmatched:'위치를 못 찾음',retry_recovered:'구간 재인식으로 찾음 · 청취 확인 필요',partial_text:'원문 일부만 대응',repeat_check:'반복 후렴 위치 확인',long:'긴 표시 구간',short:'짧은 표시 구간',overlap:'다른 줄과 겹침',order:'시간 순서 역전',source_changed:'원문 변경 후 확인 필요',forced_without_asr:'실제 가창 근거 부족',alignment_disagrees:'정렬 결과 간 위치 차이',refinement_failed:'정밀 정렬 실패',manual_copy:'복사한 가사 · 시간 지정 필요',manual_added:'추가한 가사 · 시간 지정 필요',manual_split:'수동 분할 · 청취 확인 필요',manual_merge:'수동 합치기 · 청취 확인 필요',demo:'수동 데모 값'};
const labels = {queued:'대기',running:'진행',completed:'완료',failed:'실패',cancelled:'취소',interrupted:'중단'};
Object.assign(flags,{observed_boundary_review:'시작·종료 경계 확인',phonetic_comparison_review:'발음으로 대응한 가사 확인',translated_asr_review:'번역된 인식 결과와 원문 대응 확인',focused_asr_review:'짧은 구간 재인식 · 청취 확인 필요'});
let lineDialogResolve=null;
function requestLineText(){
 return new Promise(resolve=>{
  lineDialogResolve=resolve;
  const dialog=$('line-editor-dialog');$('line-edit-text').value='';dialog.showModal();$('line-edit-text').focus();
 });
}
function finishLineDialog(value){
 const resolve=lineDialogResolve;lineDialogResolve=null;const dialog=$('line-editor-dialog');if(dialog.open)dialog.close();resolve?.(value);
}
function notice(message,good=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('good',good);}
function time(seconds,tenth=false){const n=Math.max(0,seconds||0);const min=Math.floor(n/60);return `${String(min).padStart(2,'0')}:${String(Math.floor(n)%60).padStart(2,'0')}${tenth?'.'+Math.floor(n%1*10):''}`;}
function track(){return state.project?.tracks.find(t=>t.id===state.trackId)||null;}
async function api(route,options={}){
 const response=await fetch(route,{...options,headers:{'Content-Type':'application/json',...(state.session?{'X-LyricFlow-Token':state.session.token}:{}),...options.headers}});
 if(!response.ok){const result=await response.json().catch(()=>({error:`HTTP ${response.status}`}));throw new Error(result.error||'요청 처리 실패');}
 return response.json();
}
function report(error){notice(error.message||String(error));$('save-state').textContent='저장 상태 확인 필요';$('save-state').classList.add('error-status');}
function safe(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(report);}
function setInput(id,value){const el=$(id);if(document.activeElement!==el&&!Object.hasOwn(state.pending,id))el.value=value??'';}
function setProject(project){
 state.project=project;
 if(project&&!project.tracks.some(t=>t.id===state.trackId))state.trackId=project.tracks[0]?.id||null;
 const current=track();
 state.selected=current?new Set([...state.selected].filter(id=>current.lines.some(line=>line.id===id))):new Set();
 if(current&&!state.selected.size)state.selectionAnchor=null;
 draw();
}
async function refresh(){const serial=++state.refreshSerial;const project=await api('/api/project');if(serial===state.refreshSerial)setProject(project);}
function scheduleRefresh(){clearTimeout(state.refreshTimer);state.refreshTimer=setTimeout(()=>refresh().catch(report),120);}
async function patchTrack(patch){const t=track();if(!t)throw new Error('곡을 선택해 주세요.');const project=await api(`/api/tracks/${t.id}`,{method:'PATCH',body:JSON.stringify({revision:state.project.revision,patch})});setProject(project);$('save-state').textContent='저장됨';$('save-state').classList.remove('error-status');return project;}
function queueSave(id,value){state.pending[id]=value;$('save-state').textContent='저장 대기';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>flushSave().catch(report),700);}
async function flushSave(){
 clearTimeout(state.saveTimer);
 await state.saving;
 if(!Object.keys(state.pending).length)return;
 const pending=state.pending;state.pending={};
 const keys={'title':'title','image':'imageName','instrumental':'instrumental','suno-url':'sunoUrl','source-lyrics':'sourceLyrics'};
 const patch=Object.fromEntries(Object.entries(pending).map(([k,v])=>[keys[k],v]));
 state.saving=patchTrack(patch).catch(error=>{state.pending={...pending,...state.pending};throw error;});
 try{await state.saving;}finally{state.saving=Promise.resolve();}
}
async function selectTrack(id){await flushSave();state.trackId=id;state.selected.clear();state.selectionAnchor=null;state.loopLine=null;state.seconds=0;state.lastPreview='';state.controller?.pause();$('audio').pause();draw();}
function draw(){
 const p=state.project,t=track();
 $('track-count').textContent=p?.tracks.length||0;
 $('analysis-progress').hidden=!p?.tracks.length;
 $('analysis-progress').textContent=p?.tracks.length?processingOverview(p.tracks,p.jobs||[]):'';
 $('tracks').innerHTML=p?.tracks.length?p.tracks.map((item,i)=>{
  const review=item.lines.filter(l=>l.flags?.length&&!l.reviewed).length;
  const desc=processingStatus(item,p.jobs||[]).text;
  return `<div class="track-card ${item.id===state.trackId?'active':''}" data-track="${item.id}" role="button" tabindex="0"><span class="track-index">${String(i+1).padStart(2,'0')}</span><div class="track-text"><strong>${esc(item.title)}</strong><small>${time(item.audio.durationMs/1000)} · ${esc(item.audio.name.split('.').pop()?.toUpperCase())}</small><small class="${review||item.missing?'warning':''}">${esc(desc)}</small><div class="track-controls"><button data-move="${item.id}" data-delta="-1" title="앞으로 이동">↑</button><button data-move="${item.id}" data-delta="1" title="뒤로 이동">↓</button></div></div></div>`;
 }).join(''):'<div class="empty-small">음원과 이미지가 있는<br>폴더를 열어 주세요.</div>';
 for(const id of ['title','image','instrumental','suno-url','source-lyrics','align-one','render-one','fetch-suno','export-srt','save-style','undo','redo'])$(id).disabled=!t;
 $('undo').disabled=!t||!(t.history?.length);
 $('redo').disabled=!t||!(t.redoHistory?.length);
 $('current-title').textContent=t?.title||'음악에 가사를 맞추세요.';
 $('current-meta').textContent=t?`${t.audio.name} · ${time(t.audio.durationMs/1000)} · 원문 보존 / 로컬 처리`:'원문은 그대로, 시간은 필요한 구간만 수정합니다.';
 $('demo-warning').hidden=!p?.demo;
 if(t){
  setInput('title',t.title);setInput('suno-url',t.sunoUrl||'');setInput('source-lyrics',t.sourceLyrics);
  if(document.activeElement!==$('image')){$('image').innerHTML='<option value="">이미지 연결 필요</option>'+p.images.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');$('image').value=t.imageName||'';}
  if(!Object.hasOwn(state.pending,'instrumental'))$('instrumental').checked=t.instrumental;
  $('seek').max=t.audio.durationMs/1000;$('duration').textContent=time(t.audio.durationMs/1000);
  $('track-notes').innerHTML=[...(t.notes||[]),...(t.scanError?[t.scanError]:[])].map(n=>`<p class="note">${esc(n)}</p>`).join('');
  $('analysis-meta').textContent=t.analysis?`최근 분석: ${t.analysis.model} · ${t.analysis.device} · ${t.analysis.audioSource==='vocals'?(t.analysis.selectedSource==='original'?'분리 후 원본 비교 선택':'보컬 분리본'):'원본 음악'} · ${t.analysis.engine}${t.analysis.retryMissing?(t.analysis.audioSource==='vocals'?' · 원본 비교·누락 재시도 사용':' · 누락 재시도 사용'):''}`:'아직 음성 분석을 실행하지 않았습니다.';
  if(t.analysis?.evidence?.unmatchedAsrWords?.length)$('analysis-meta').textContent+=` · 초벌 미대응 단어 ${t.analysis.evidence.unmatchedAsrWords.length}개 (누락 가사·애드리브·오인식 포함)`;
  const s=p.style;if(!state.styleDirty){for(const [id,key]of [['font-size','fontSize'],['bottom','bottomPercent'],['stroke','stroke'],['text-color','color'],['dim','dim'],['fit','fit'],['resolution','width']])setInput(id,s[key]);
  $('show-title').checked=s.showTitle;$('next-line').checked=s.nextLine;}
  updatePreview().catch(report);
 }
 drawLines();drawJobs();
 $('project-status').textContent=p?`${p.folder} · 자동 저장 · 수정 ${p.revision}`:'폴더를 열면 프로젝트가 자동으로 저장됩니다.';
}
function visibleLines(){const t=track();if(!t)return[];const showExcluded=$('show-excluded').checked;const query=($('line-search')?.value||'').trim().toLocaleLowerCase();return t.lines.map((l,i)=>({...l,index:i})).filter(l=>(showExcluded?l.excluded:(!l.excluded&&(!$('suspicious').checked||(l.flags.length&&!l.reviewed))))&&(!query||l.text.toLocaleLowerCase().includes(query)));}
function selectLine(id,event={},redraw=true){
 const t=track(),visible=visibleLines(),index=visible.findIndex(line=>line.id===id);if(!t||index<0)return;
 const additive=Boolean(event.ctrlKey||event.metaKey),anchorIndex=state.selectionAnchor?visible.findIndex(line=>line.id===state.selectionAnchor):-1;
 if(event.shiftKey&&anchorIndex>=0){
  const from=Math.min(anchorIndex,index),to=Math.max(anchorIndex,index),range=visible.slice(from,to+1).map(line=>line.id);
  if(additive)for(const lineId of range)state.selected.add(lineId);else state.selected=new Set(range);
 }else if(additive){
  if(state.selected.has(id))state.selected.delete(id);else state.selected.add(id);
  state.selectionAnchor=id;
 }else{state.selected=new Set([id]);state.selectionAnchor=id;}
 if(redraw)drawLines();
 else{
  for(const row of $('lines').querySelectorAll('[data-line]')){
   const selected=state.selected.has(row.dataset.line);row.classList.toggle('selected',selected);
   row.querySelector('[data-select]').checked=selected;
  }
  $('selection-count').textContent=`${state.selected.size}줄 선택됨`;
  timingEditor.draw();
 }
}
function selectLines(ids,anchor=null){state.selected=new Set(ids);state.selectionAnchor=anchor??ids.at(-1)??null;drawLines();}
function drawLines(){
 timingEditor.draw();
 queueMicrotask(drawExclusionButtons);
 if($('lines').contains(document.activeElement)&&document.activeElement.matches('textarea,input[type=number]'))return;
 const t=track(),lines=visibleLines(),query=($('line-search')?.value||'').trim(),showExcluded=Boolean($('show-excluded')?.checked);
 const gaps=new Map(gapCandidates(t?.lines||[]).map(g=>[g.id,g]));
 $('review-count').textContent=t?processingStatus(t,state.project.jobs||[]).text:'0줄';
 $('selection-count').textContent=state.selected.size?`${state.selected.size}줄 선택됨`:'클릭 · Shift 범위 · Ctrl/Cmd 개별 선택';
 if($('line-filter-status'))$('line-filter-status').textContent=t?(query?`${lines.length}개 검색됨`:showExcluded?`제외한 가사 ${lines.length}개 표시`:''):'';
 $('check-all').checked=Boolean(lines.length&&lines.every(line=>state.selected.has(line.id)));
 $('lines').innerHTML=lines.length?lines.map(l=>{
  const pending=t&&!t.analysis&&['queued','running','waiting'].includes(processingStatus(t,state.project.jobs||[]).kind);
  const manualTiming=l.flags.some(f=>f==='manual_copy'||f==='manual_added');
  const warningFlags=l.flags.filter(f=>!(manualTiming&&f==='unmatched'));
  const warnings=l.reviewed?'':pending?'분석 결과 대기 중':warningFlags.map(f=>f==='unmatched'&&gaps.has(l.id)?'앞뒤 가사 사이에 위치 후보 표시':flags[f]||f).join(' · ');
  const rowState=l.excluded?'excluded':warnings?'attention':l.reviewed?'reviewed':l.locked?'edited':'ready';
  const stateLabel=l.excluded?'제외':warnings?'확인 필요':l.reviewed?'검수 완료':l.locked?'수동 편집':'자동 후보';
  return `<tr data-line="${l.id}" data-state="${rowState}" class="${state.selected.has(l.id)?'selected':''}"><td><input type="checkbox" data-select="${l.id}" ${state.selected.has(l.id)?'checked':''} aria-label="${l.index+1}번째 가사 선택"></td><td class="muted">${l.index+1}</td><td><div class="line-main"><span class="row-state-chip state-${rowState}" aria-label="상태: ${stateLabel}">${stateLabel}</span><button class="line-text" data-focus="${l.id}" title="더블클릭하여 자막 편집 · Enter 저장 · Esc 취소" aria-label="${l.index+1}번째 가사로 이동">${esc(l.text)}</button></div><div class="${l.reviewed?'verified':'flags'}">${l.locked?'수동 잠금 · ':''}${l.reviewed?'검수 완료':esc(warnings)||'자동 정렬 후보'}</div></td><td><input type="number" min="0" step="0.1" value="${l.startMs===null?'':(l.startMs/1000).toFixed(3)}" data-time="startMs" aria-label="${l.index+1}번째 시작 시간"></td><td><input type="number" min="0" step="0.1" value="${l.endMs===null?'':(l.endMs/1000).toFixed(3)}" data-time="endMs" aria-label="${l.index+1}번째 종료 시간"></td><td><button class="row-more" popovertarget="actions-${l.id}" aria-label="${l.index+1}번째 가사 작업">⋯</button><div class="row-actions" popover id="actions-${l.id}"><button data-listen="${l.id}">듣기</button><button data-review="${l.id}" ${!reviewPatch(t.lines,l.id)?'disabled':''}>확인</button><button data-copy-line="${l.id}" title="같은 가사를 다음 줄에 복사">복사</button><button data-add-line="${l.id}" title="이 줄 다음에 새 가사 추가">추가</button><button data-delete-line="${l.id}" title="이 가사 줄 삭제">삭제</button></div></td></tr>`;
 }).join(''):'<tr><td colspan="6" class="empty-small">'+(t?.lines.length?'이 필터에 해당하는 가사가 없습니다.':'원문 가사를 가져오거나 붙여넣어 주세요.')+'</td></tr>';
}
function drawJobs(){const jobs=state.project?.jobs||[];const ordered=[...jobs.filter(j=>j.status==='running'),...jobs.filter(j=>j.status==='queued'),...jobs.filter(j=>!['running','queued'].includes(j.status)).reverse()];$('jobs').innerHTML=jobs.length?ordered.slice(0,12).map(j=>`<div class="job ${j.status}"><div class="job-head"><span>${esc(labels[j.status]||j.status)}</span><strong>${esc(j.title)}</strong>${['queued','running'].includes(j.status)?`<button data-cancel="${j.id}">취소</button>`:''}</div><small>${esc(j.message)}</small>${typeof j.progress==='number'&&j.status==='running'?`<progress max="1" value="${j.progress}"></progress>`:''}<div>${j.outputs.map((o,i)=>`<a href="/api/jobs/${j.id}/output/${i}" download="${esc(o.name)}">${esc(o.name)}</a>`).join('')}</div></div>`).join(''):'<p class="muted">진행 중인 작업이 없습니다.</p>';}
async function updatePreview(){
 const t=track();if(!t||t.missing){state.controller?.destroy();state.controller=null;state.lastPreview='';$('audio').pause();$('audio').removeAttribute('src');$('preview').innerHTML='<div class="preview-placeholder"><strong>음원을 확인해 주세요.</strong></div>';$('audio-fallback').hidden=true;return;}
 const key=JSON.stringify({id:t.id,image:t.imageName,hash:t.audio.sha256,style:state.project.style,lines:t.lines.map(l=>[l.text,l.startMs,l.endMs,l.excluded]),instrumental:t.instrumental});
 if(key===state.lastPreview)return;
 const id=t.id; const props=await api(`/api/tracks/${id}/preview`); if(id!==state.trackId)return;
 state.lastPreview=key;timingEditor.loadAudio(props.tracks[0].audioUrl,t.id,t.audio.sha256);
 if(!state.playerModule&&state.session.playerBuilt){try{state.playerModule=await import('/dist/player.js');}catch(error){notice(`Remotion 미리보기를 불러오지 못했습니다. 오디오 검수 모드를 사용합니다. ${error.message}`);}}
 if(state.playerModule){
  $('audio-fallback').hidden=true;$('audio').pause();
  if(state.controller)state.controller.update(props);
  else{$('preview').innerHTML='';state.controller=state.playerModule.mountPlayer($('preview'),props,onTime,playing=>{state.playing=playing;$('play').textContent=playing?'Ⅱ':'▶';});}
 }else{
  $('audio-fallback').hidden=false;
  $('preview').innerHTML=(props.tracks[0].imageUrl?`<img class="static-cover" src="${esc(props.tracks[0].imageUrl)}" alt="곡 배경 이미지">`:'<div class="preview-placeholder"><strong>배경 이미지를 연결해 주세요.</strong></div>')+'<span class="static-label">정지 이미지 확인 · 영상 미리보기 미설치</span>';
  if($('audio').getAttribute('src')!==props.tracks[0].audioUrl)$('audio').src=props.tracks[0].audioUrl;
 }
}
function seek(seconds){state.seconds=seconds;if(state.controller)state.controller.seek(seconds);else $('audio').currentTime=seconds;onTime(seconds);}
function play(){if(state.controller)state.controller.play();else $('audio').play().catch(report);state.playing=true;$('play').textContent='Ⅱ';}
function pause(){if(state.controller)state.controller.pause();else $('audio').pause();state.playing=false;$('play').textContent='▶';}
function listeningRange(id){const t=track(),line=t?.lines.find(l=>l.id===id);return line?.startMs!=null?line:gapCandidates(t?.lines||[]).find(g=>g.id===id);}
function onTime(seconds){state.seconds=seconds;$('clock').textContent=seconds.toFixed(3)+' 초';timingEditor.update();if(document.activeElement!==$('seek'))$('seek').value=seconds;
 if($('loop').checked&&state.loopLine){const line=listeningRange(state.loopLine);if(line&&seconds>(line.endMs/1000+.4))seek(Math.max(0,line.startMs/1000-.4));}}
function listen(id){const line=listeningRange(id);if(!line)throw new Error('앞뒤 가사로 범위를 좁힐 수 없는 줄입니다. 재생하며 시작·종료를 지정해 주세요.');state.loopLine=id;state.selected=new Set([id]);state.selectionAnchor=id;drawLines();seek(Math.max(0,line.startMs/1000-.4));play();}
function settings(){return{model:$('model').value,device:$('device').value,language:$('language').value,engine:$('engine').value,audioSource:$('audio-source').value,retryMissing:$('retry-missing').checked};}
async function enqueue(type,ids){await flushSave();const failures=[];let count=0;
 const groups=type==='playlist'?[ids]:ids.map(id=>[id]);
 for(const group of groups){try{await api('/api/jobs',{method:'POST',body:JSON.stringify({type,trackIds:group,settings:settings()})});count++;}catch(error){failures.push(error.message);}}
 notice(`${count}개 작업을 등록했습니다.${failures.length?'\n'+failures.join('\n'):''}`,!failures.length);await refresh();}
async function openFolder(folder){await flushSave();pause();$('open-folder').disabled=true;notice('폴더의 음원과 이미지를 확인합니다.');
 try{const project=await api('/api/project/open',{method:'POST',body:JSON.stringify({folder})});state.controller?.destroy();state.controller=null;state.lastPreview='';state.selected.clear();state.selectionAnchor=null;setProject(project);$('folder').value=folder;notice(`${project.tracks.length}곡을 불러왔습니다.`,true);}finally{$('open-folder').disabled=false;}}

$('open-folder').onclick=safe(()=>openFolder($('folder').value.trim()));
$('folder').onkeydown=safe(e=>{if(e.key==='Enter')return openFolder($('folder').value.trim());});
$('open-demo').onclick=safe(()=>openFolder(state.session.demoFolder));
$('refresh-folder').onclick=safe(()=>{if(state.project)return openFolder(state.project.folder);});
$('browse').onclick=safe(async()=>{notice('PC의 폴더 선택 창에서 작업 폴더를 선택해 주세요.');const r=await api('/api/folder-picker',{method:'POST',body:JSON.stringify({})});if(r.folder){$('folder').value=r.folder;await openFolder(r.folder);}else notice('폴더 선택을 취소했습니다.');});
$('tracks').onclick=safe(async e=>{const move=e.target.closest('[data-move]');if(move){e.stopPropagation();await flushSave();const ids=state.project.tracks.map(t=>t.id),index=ids.indexOf(move.dataset.move),target=index+Number(move.dataset.delta);if(target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target],ids[index]];setProject(await api('/api/order',{method:'PATCH',body:JSON.stringify({ids,revision:state.project.revision})}));return;}const row=e.target.closest('[data-track]');if(row)await selectTrack(row.dataset.track);});
$('tracks').onkeydown=safe(e=>{if(e.key==='Enter'){const row=e.target.closest('[data-track]');if(row)return selectTrack(row.dataset.track);}});
for(const id of ['title','suno-url','source-lyrics'])$(id).addEventListener('input',()=>queueSave(id,$(id).value));
$('image').onchange=()=>queueSave('image',$('image').value||null);$('instrumental').onchange=()=>queueSave('instrumental',$('instrumental').checked);
$('fetch-suno').onclick=safe(()=>enqueue('suno',[track()?.id]));
async function downloadImageRequest(selected){
 await flushSave();
 if(!state.project || (selected&&!track()))throw new Error('먼저 곡을 선택해 주세요.');
 const result=await api('/api/image-request',{method:'POST',body:JSON.stringify({revision:state.project.revision,trackId:selected?track().id:null})});
 const text=`음악 폴더: ${JSON.stringify(result.folder)}\n\n${result.text}`;
 const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=selected?`image-request-${track().id}.md`:'missing-image-requests.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 notice('생성 요청 파일을 저장했습니다. Codex에 파일을 전달하면 생성·검수 후 연결할 수 있습니다.',true);
}
$('image-request').onclick=safe(()=>downloadImageRequest(true));
$('missing-image-requests').onclick=safe(()=>downloadImageRequest(false));
$('align-one').onclick=safe(()=>enqueue('align',[track()?.id]));
$('align-all').onclick=safe(()=>enqueue('align',(state.project?.tracks||[]).filter(t=>t.lines.length&&!t.instrumental&&!t.missing).map(t=>t.id)));
$('render-one').onclick=safe(()=>enqueue('render',[track()?.id]));
$('render-all').onclick=safe(()=>enqueue('render',(state.project?.tracks||[]).filter(t=>!t.missing).map(t=>t.id)));
$('playlist').onclick=safe(()=>enqueue('playlist',(state.project?.tracks||[]).filter(t=>!t.missing).map(t=>t.id)));
$('export-srt').onclick=safe(async()=>{await flushSave();const response=await fetch(`/api/tracks/${track().id}/srt`);if(!response.ok){const r=await response.json();throw new Error(r.error);}const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`${track().title.replace(/[<>:"/\\|?*]/g,'_')}.srt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('save-style').onclick=safe(async()=>{await flushSave();const width=Number($('resolution').value);const style={...state.project.style,width,height:width*9/16,fontSize:Number($('font-size').value),bottomPercent:Number($('bottom').value),stroke:Number($('stroke').value),color:$('text-color').value,dim:Number($('dim').value),fit:$('fit').value,showTitle:$('show-title').checked,nextLine:$('next-line').checked};state.styleDirty=false;setProject(await api('/api/style',{method:'PATCH',body:JSON.stringify({revision:state.project.revision,style})}));notice('스타일을 적용했습니다. 기존 분석 결과는 유지됩니다.',true);});
for(const id of ['resolution','font-size','bottom','stroke','text-color','dim','fit','show-title','next-line'])$(id).addEventListener('input',()=>{state.styleDirty=true;});
 $('undo').onclick=safe(async()=>{await flushSave();setProject(await api(`/api/tracks/${track().id}/undo`,{method:'POST',body:JSON.stringify({revision:state.project.revision})}));notice('이전 수정으로 되돌렸습니다.',true);});
 $('redo').onclick=safe(async()=>{await flushSave();setProject(await api(`/api/tracks/${track().id}/redo`,{method:'POST',body:JSON.stringify({revision:state.project.revision})}));notice('되돌린 수정을 다시 적용했습니다.',true);});
$('suspicious').onchange=drawLines;
$('line-search').oninput=drawLines;
$('check-all').onchange=()=>{for(const l of visibleLines())$('check-all').checked?state.selected.add(l.id):state.selected.delete(l.id);state.selectionAnchor=$('check-all').checked?visibleLines().at(-1)?.id||null:null;drawLines();};
$('line-edit-save').onclick=()=>finishLineDialog($('line-edit-text').value);
$('line-edit-cancel').onclick=()=>finishLineDialog(null);
$('line-editor-dialog').addEventListener('cancel',e=>{e.preventDefault();finishLineDialog(null);});
$('line-edit-text').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();finishLineDialog($('line-edit-text').value);}});
function copyLineBlock(ids){
 const t=track(),before=new Set(t?.lines.map(line=>line.id)||[]);if(!t||!ids.length)throw new Error('먼저 복사할 가사 줄을 선택해 주세요.');
 return patchTrack({lineOp:{action:'copy',lineIds:ids,position:'after'}}).then(project=>{
   const next=project.tracks.find(item=>item.id===t.id),created=(next?.lines||[]).filter(line=>!before.has(line.id)&&line.copyGroupId).map(line=>line.id);
   selectLines(created,created[0]||null);return created;
 });
}
async function addLineAtTimeline(ms){
 const t=track();if(!t)throw new Error('곡을 선택해 주세요.');
 const positionable=t.lines.filter(line=>!line.excluded&&Number.isFinite(line.startMs)).sort((a,b)=>a.startMs-b.startMs||t.lines.indexOf(a)-t.lines.indexOf(b));
 const after=positionable.filter(line=>line.startMs>ms)[0]||null;
 const before=positionable.filter(line=>line.startMs<=ms).at(-1)||null;
 const anchor=before||after;
 const position=before?'after':'before';
 const text=await requestLineText();if(text===null)return;
 if(!text.trim())throw new Error('추가할 가사를 입력해 주세요.');
 await flushSave();
 const beforeIds=new Set(t.lines.map(line=>line.id));
 const project=await patchTrack({lineOp:{action:'add',lineId:anchor?.id,position,text}});
 const next=project.tracks.find(item=>item.id===t.id),created=next?.lines.find(line=>!beforeIds.has(line.id));
 if(!created)throw new Error('새 가사 줄을 만들지 못했습니다.');
 const start=Math.max(0,Math.min(t.audio.durationMs-1,Math.round(ms)));
 const nextStart=after&&Number.isFinite(after.startMs)?after.startMs:null;
 const end=Math.max(start+1,Math.min(t.audio.durationMs,nextStart&&nextStart>start?Math.min(nextStart,start+1500):start+1500));
 const timed=await patchTrack({lines:[{id:created.id,startMs:start,endMs:end}]});
 state.selected=new Set([created.id]);state.selectionAnchor=created.id;
 setProject(timed);
 notice(`새 가사를 ${ (start/1000).toFixed(3) }초 위치에 만들었습니다. 시작·종료를 확인해 주세요.`,true);
}
async function markerAction(action,id,value){
 const t=track();if(!t)return;
 const markers=[...(t.markers||[])];
 if(action==='seek'){const marker=markers.find(item=>item.id===id);if(marker){pause();seek(marker.atMs/1000);}return;}
 if(action==='prev'||action==='next'){
  const ordered=markers.sort((a,b)=>a.atMs-b.atMs),now=Math.round(state.seconds*1000);
  const target=action==='prev'?[...ordered].reverse().find(marker=>marker.atMs<now):ordered.find(marker=>marker.atMs>now);
  if(target){pause();seek(target.atMs/1000);timingEditor.center?.(target.atMs);}else notice(action==='prev'?'이전 마커가 없습니다.':'다음 마커가 없습니다.');
  return;
 }
 if(action==='add'){
  const atMs=Math.max(0,Math.min(t.audio.durationMs,Math.round(state.seconds*1000)));
  const nearby=markers.find(marker=>Math.abs(marker.atMs-atMs)<=5);
  if(nearby){notice(`이미 ${nearby.label}가 이 위치에 있습니다.`);return;}
  await flushSave();
  const marker={id:crypto.randomUUID(),atMs,label:`마커 ${markers.length+1}`};
  await patchTrack({markers:[...markers,marker]});notice(`${marker.label}를 ${(atMs/1000).toFixed(3)}초 위치에 추가했습니다.`,true);return;
 }
 if(action==='rename'){
  const label=String(value??'').trim();if(!label)throw new Error('마커 이름을 입력해 주세요.');
  const marker=markers.find(item=>item.id===id);if(!marker)return;
  await flushSave();await patchTrack({markers:markers.map(item=>item.id===id?{...item,label}:item)});return;
 }
 if(action==='delete'){
  if(!markers.some(item=>item.id===id))return;
  await flushSave();await patchTrack({markers:markers.filter(item=>item.id!==id)});notice('마커를 삭제했습니다.',true);
 }
}
function splitTextAtRatio(text,ratio){
 const value=String(text||'').trim();if(value.length<2)return null;
 const target=Math.max(1,Math.min(value.length-1,Math.round(value.length*ratio)));
 let best=-1;
  for(let distance=0;distance<value.length;distance++){
   for(const index of [target-distance,target+distance])if(index>0&&index<value.length&&/\s/.test(value[index-1])){best=index;break;}
   if(best>0)break;
  }
 if(best<1)return null;
 return [value.slice(0,best).trim(),value.slice(best).trim()];
}
async function timelineAction(action,ids){
 const valid=[...new Set(ids)].filter(id=>track()?.lines.some(line=>line.id===id));
 if(!valid.length)throw new Error('타임라인에서 가사를 선택해 주세요.');
 if(action==='copy'){
  await flushSave();const created=await copyLineBlock(valid);
  notice(`${created.length||valid.length}개 가사를 한 묶음으로 복사했습니다. 위쪽 복사 레이어를 드래그해 위치를 지정하세요.`,true);return;
 }
 if(action==='delete'){
  const lines=track().lines.filter(line=>valid.includes(line.id));
  if(!window.confirm(`선택한 ${lines.length}개 가사를 삭제할까요? 이전 수정으로 되돌릴 수 있습니다.`))return;
  await flushSave();state.selected=new Set();state.selectionAnchor=null;await patchTrack({lineOp:{action:'delete',lineIds:valid}});notice(`${lines.length}개 가사를 삭제했습니다.`,true);return;
 }
 if(action==='ungroup'){
  const grouped=track().lines.filter(line=>valid.includes(line.id)&&line.copyGroupId);
  if(!grouped.length)throw new Error('선택한 가사에 복사 레이어가 없습니다.');
  await flushSave();const project=await patchTrack({lineOp:{action:'ungroup',lineIds:grouped.map(line=>line.id)}});
  state.selected=new Set(grouped.map(line=>line.id));state.selectionAnchor=grouped[0].id;setProject(project);notice('복사 레이어를 아래 자막 레이어로 내렸습니다. 이제 일반 가사처럼 다룹니다.',true);return;
 }
 if(action==='merge'){
  const lines=track().lines.filter(line=>valid.includes(line.id));
  if(lines.length<2)throw new Error('합칠 가사를 두 줄 이상 선택해 주세요.');
  await flushSave();const project=await patchTrack({lineOp:{action:'merge',lineIds:valid}});const merged=project.tracks.find(item=>item.id===track().id)?.lines.find(line=>line.mergedFrom?.length===valid.length&&valid.every(id=>line.mergedFrom.includes(id)));if(merged){state.selected=new Set([merged.id]);state.selectionAnchor=merged.id;}notice(`${lines.length}개 가사를 한 줄로 합쳤습니다. 시간을 들어서 확인해 주세요.`,true);return;
 }
 if(action==='split'){
  if(valid.length!==1)throw new Error('분할할 가사 한 줄만 선택해 주세요.');
  const line=track().lines.find(item=>item.id===valid[0]),atMs=Math.round(state.seconds*1000);
  if(!line||line.startMs===null||line.endMs===null||atMs<=line.startMs||atMs>=line.endMs)throw new Error('재생 위치를 선택한 가사 구간 안에 두세요.');
  const parts=splitTextAtRatio(line.text,(atMs-line.startMs)/(line.endMs-line.startMs));if(!parts)throw new Error('가사를 공백 기준으로 나눌 수 없습니다. 문장을 직접 편집해 주세요.');
  await flushSave();const project=await patchTrack({lineOp:{action:'split',lineId:line.id,atMs,textA:parts[0],textB:parts[1]}});const next=project.tracks.find(item=>item.id===track().id),index=next.lines.findIndex(item=>item.id===line.id);const created=next.lines[index+1];state.selected=new Set([line.id,created?.id].filter(Boolean));state.selectionAnchor=created?.id||line.id;notice('재생 위치에서 가사를 두 줄로 나눴습니다. 두 줄을 들어서 확인해 주세요.',true);return;
 }
}
$('copy-selected').onclick=safe(async()=>{
 await flushSave();
 const ids=[...state.selected].filter(id=>track()?.lines.some(line=>line.id===id));
 if(!ids.length)throw new Error('먼저 복사할 가사 줄을 선택해 주세요.');
 const created=await copyLineBlock(ids);
 notice(`${created.length||ids.length}개 가사를 한 묶음으로 복사했습니다. 위쪽 묶음 레이어를 드래그해 위치를 지정하세요.`,true);
});
$('lines').addEventListener('change',safe(async e=>{
 await flushSave();
 const text=e.target.closest('[data-text]');if(text){text.blur();await patchTrack({lines:[{id:text.dataset.text,text:text.value}]});return;}
 const input=e.target.closest('[data-time]');if(input){const row=input.closest('[data-line]');const start=row.querySelector('[data-time="startMs"]').value;const end=row.querySelector('[data-time="endMs"]').value;if(start===''||end==='')return;input.blur();await patchTrack({lines:[{id:row.dataset.line,startMs:Math.round(Number(start)*1000),endMs:Math.round(Number(end)*1000)}]});}
}));
$('lines').onclick=safe(async e=>{
 if(e.target.closest('[data-inline-editor]'))return;
 const select=e.target.closest('[data-select]');
 if(select){e.preventDefault();selectLine(select.dataset.select,e);return;}
 const row=e.target.closest('[data-line]');
 const focus=e.target.closest('[data-focus]');
 if(focus){selectLine(focus.dataset.focus,e,false);return timingEditor.focus(focus.dataset.focus,{select:false});}
 if(row&&!e.target.closest('input,textarea,button')){selectLine(row.dataset.line,e);timingEditor.focus(row.dataset.line,{select:false});return;}
 const copy=e.target.closest('[data-copy-line]');
 if(copy){await flushSave();const created=await copyLineBlock([copy.dataset.copyLine]);notice(`${created.length||1}개 가사를 한 묶음으로 복사했습니다. 위쪽 묶음 레이어를 드래그해 위치를 지정하세요.`,true);return;}
 const add=e.target.closest('[data-add-line]');
 if(add){const text=await requestLineText();if(text===null)return;if(!text.trim())throw new Error('추가할 가사를 입력해 주세요.');await flushSave();await patchTrack({lineOp:{action:'add',lineId:add.dataset.addLine,position:'after',text}});notice('가사 줄을 추가했습니다. 새 줄의 시간을 지정해 주세요.',true);return;}
 const remove=e.target.closest('[data-delete-line]');
 if(remove){const line=track()?.lines.find(l=>l.id===remove.dataset.deleteLine);if(!line)return;if(!window.confirm(`“${line.text}” 가사를 삭제할까요? 이전 수정 취소로 되돌릴 수 있습니다.`))return;await flushSave();state.selected.delete(line.id);if(state.selectionAnchor===line.id)state.selectionAnchor=null;await patchTrack({lineOp:{action:'delete',lineId:line.id}});notice('가사 줄을 삭제했습니다. 필요하면 이전 수정 취소로 되돌리세요.',true);return;}
 const listenButton=e.target.closest('[data-listen]');if(listenButton)return listen(listenButton.dataset.listen);
 const review=e.target.closest('[data-review]');if(review){await flushSave();const edit=reviewPatch(track().lines,review.dataset.review);if(!edit)throw new Error('확인할 위치 후보가 없습니다.');return patchTrack({lines:[edit]});}
});

// Keep the text button mounted on a single click so the second click can edit it.
$('lines').addEventListener('dblclick',e=>{
 const button=e.target.closest('[data-focus]');if(!button)return;
 e.preventDefault();
 const owner=track(),line=owner?.lines.find(item=>item.id===button.dataset.focus);if(!line)return;
 const editor=document.createElement('textarea');
 editor.dataset.inlineEditor=line.id;editor.value=line.text;editor.rows=2;
 editor.setAttribute('aria-label','자막 문구 편집');
 editor.title='Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소';
 editor.style.cssText='flex:1;min-width:0;width:100%;padding:5px 7px;resize:vertical;line-height:1.5';
 button.replaceWith(editor);editor.focus();editor.select();
 let saving=false,finished=false;
 const cancel=()=>{if(saving||finished)return;finished=true;editor.replaceWith(button);button.focus();};
 const save=async()=>{
  if(saving||finished)return;
  if(editor.value===line.text){cancel();return;}
  if(!editor.value.trim()){notice('자막 문구를 입력해 주세요. 삭제는 가사 작업 메뉴를 이용하세요.');editor.focus();return;}
  saving=true;editor.readOnly=true;
  try{
   await flushSave();
   if(track()?.id!==owner.id)throw new Error('곡이 변경되어 저장하지 않았습니다. 원래 곡에서 다시 편집해 주세요.');
   await patchTrack({lines:[{id:line.id,text:editor.value}]});
   finished=true;editor.blur();drawLines();
  }catch(error){editor.readOnly=false;editor.focus();report(error);}
  finally{saving=false;}
 };
 editor.addEventListener('keydown',e=>{
  e.stopPropagation();if(e.isComposing||e.keyCode===229)return;
  if(e.key==='Escape'){e.preventDefault();cancel();}
  else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void save();}
 });
 editor.addEventListener('blur',()=>{void save();});
});

async function bulk(action){await flushSave();const selected=track()?.lines.filter(l=>state.selected.has(l.id))||[];if(!selected.length)throw new Error('먼저 가사 줄을 선택해 주세요.');await patchTrack({lines:selected.map(l=>action(l))});}
const excludedToggle=document.createElement('label');
excludedToggle.className='check';
excludedToggle.innerHTML='<input id="show-excluded" type="checkbox">제외한 가사 보기';
$('suspicious').closest('label').after(excludedToggle);
$('show-excluded').onchange=drawLines;
for(const [label,excluded] of [['선택 줄 제외',true],['선택 줄 복원',false]]){
 const button=document.createElement('button');button.textContent=label;
 button.onclick=safe(()=>bulk(l=>({id:l.id,excluded})));
 $('selection-count').parentElement.append(button);
}
function drawExclusionButtons(){
 const t=track();if(!t)return;
 for(const row of $('lines').querySelectorAll('[data-line]')){
  const line=t.lines.find(l=>l.id===row.dataset.line);if(!line)continue;
  row.style.opacity=line.excluded?'0.6':'';
  if(line.excluded){const label=row.querySelector('.flags,.verified');if(label)label.textContent='영상·자막에서 제외됨';}
  if(row.querySelector('[data-exclusion]'))continue;
  const button=document.createElement('button');button.dataset.exclusion=line.id;
  button.textContent=line.excluded?'복원':'제외';button.title='원문과 시간을 보존하고 영상·SRT에서 제외하거나 복원합니다.';
  button.onclick=safe(async()=>{await flushSave();state.selected.delete(line.id);await patchTrack({lines:[{id:line.id,excluded:!line.excluded}]});});
  row.querySelector('.row-actions').prepend(button);
 }
}
$('shift-minus').onclick=safe(()=>bulk(l=>{if(l.startMs===null)throw new Error('시간이 없는 줄은 이동할 수 없습니다.');return{id:l.id,startMs:l.startMs-100,endMs:l.endMs-100};}));
$('shift-plus').onclick=safe(()=>bulk(l=>{if(l.startMs===null)throw new Error('시간이 없는 줄은 이동할 수 없습니다.');return{id:l.id,startMs:l.startMs+100,endMs:l.endMs+100};}));
$('review-selected').onclick=safe(async()=>{
 await flushSave();
 if(!state.selected.size)throw new Error('먼저 가사 줄을 선택해 주세요.');
 const {edits,pending}=reviewSelection(track().lines,[...state.selected]);
 if(edits.length)await patchTrack({lines:edits});
 if(pending.length){
  state.selected=new Set(pending);state.selectionAnchor=pending[0];drawLines();
  timingEditor.focus(pending[0],{select:false});
  notice(`${edits.length}줄 검수 완료 · 화면에 위치가 없는 ${pending.length}줄만 남았습니다. 부르지 않는 가사는 제외해 주세요.`);
 }else notice(`${edits.length}줄 검수를 완료했습니다.`,true);
});
$('unlock-selected').onclick=safe(()=>bulk(l=>({id:l.id,locked:false})));
 function toggleSettings(){const open=document.body.classList.toggle('settings-open');$('toggle-settings').setAttribute('aria-expanded',String(open));$('settings-tab')?.setAttribute('aria-expanded',String(open));if(open)$('title')?.focus();else $('settings-tab')?.focus();}
 $('toggle-settings').onclick=toggleSettings;$('settings-tab').onclick=toggleSettings;
window.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&!e.altKey&&e.key.toLowerCase()==='f'&&!e.target.closest('input,textarea,select,[contenteditable="true"]')&&!document.querySelector('dialog[open]')){e.preventDefault();$('line-search').focus();$('line-search').select();return;}
 if(!(e.ctrlKey||e.metaKey)||e.altKey||e.target.closest('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open]'))return;
 const key=e.key.toLowerCase();
 if(key==='z'||key==='y'){e.preventDefault();if(key==='y'||e.shiftKey)$('redo').click();else $('undo').click();}
});
$('play').onclick=()=>state.playing?pause():play();$('seek').oninput=()=>seek(Number($('seek').value));
$('audio').ontimeupdate=()=>onTime($('audio').currentTime);$('audio').onplay=()=>{state.playing=true;$('play').textContent='Ⅱ';};$('audio').onpause=()=>{state.playing=false;$('play').textContent='▶';};
$('jobs').onclick=safe(async e=>{const b=e.target.closest('[data-cancel]');if(b){await api(`/api/jobs/${b.dataset.cancel}/cancel`,{method:'POST',body:'{}'});await refresh();}});
$('doctor').onclick=safe(async()=>{$('diagnostics').showModal();$('diagnostics-body').textContent='실제 실행 파일과 패키지를 확인합니다.';const d=await api('/api/doctor');$('diagnostics-body').textContent=JSON.stringify(d,null,2);});
$('close-doctor').onclick=()=>$('diagnostics').close();
window.addEventListener('beforeunload',e=>{if(Object.keys(state.pending).length){e.preventDefault();e.returnValue='';}});

const timingEditor=createTimingEditor({track,listen,selected:()=>state.selected,seconds:()=>state.seconds,seek,pause,report,select:id=>{state.selected=new Set([id]);state.selectionAnchor=id;drawLines();},selectMany:(ids,anchor)=>{state.selected=new Set(ids);state.selectionAnchor=anchor||ids.at(0)||null;drawLines();},timelineAction,markerAction,onEmptyDoubleClick:ms=>safe(()=>addLineAtTimeline(ms))(),isPlaying:()=>state.playing,saveGrid:async(grid,id)=>{await flushSave();if(track()?.id!==id)throw Error('곡이 변경되어 저장하지 않았습니다.');await patchTrack({timelineGrid:grid});},save:async (lines,id,extra={})=>{await flushSave();if(track()?.id!==id)throw Error('곡이 변경되어 저장하지 않았습니다.');await patchTrack({lines,...extra});}});
mountWorkbench();
try{
 state.session=await api('/api/session');$('folder').value=state.session.lastFolder;
 const events=new EventSource('/api/events');
 events.addEventListener('connected',()=>{
  (async()=>{
   const session=await api('/api/session');
   if(state.session.token!==session.token){
    pause();state.controller?.destroy();state.controller=null;
    state.lastPreview='';state.session=session;
    await refresh();
    notice('서버에 다시 연결되어 재생 정보를 갱신했습니다. 원하는 구간을 다시 재생하세요.',true);
   }
   $('connection').textContent='로컬 서버 연결됨';
  })().catch(report);
 });
 events.addEventListener('project',scheduleRefresh);events.addEventListener('jobs',scheduleRefresh);
 events.addEventListener('scan',e=>notice(JSON.parse(e.data).message));
 events.onerror=()=>{$('connection').textContent='서버 연결 확인 필요';};
 await refresh();
}catch(error){report(error);$('connection').textContent='연결 실패';}

mountShorts({track,project:()=>state.project,seconds:()=>state.seconds,pause,api,flushSave,refresh,notice});
