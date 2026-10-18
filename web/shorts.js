export function mountShorts({track, project, seconds, pause, api, flushSave, refresh, notice}) {
  const button=document.createElement('button');button.textContent='쇼츠 만들기';button.id='make-shorts';
  document.querySelector('.head-buttons').append(button);
  const dialog=document.createElement('dialog');dialog.id='shorts-dialog';
  dialog.innerHTML=`<div class="section-head"><h2>쇼츠 만들기</h2><button id="shorts-close">닫기</button></div>
    <p id="shorts-title"></p><p>원곡 기준 초 단위로 선택하세요. 기존 가사 타이밍이 그대로 적용됩니다.</p>
    <div class="two-fields"><label class="field">시작(초)<input id="shorts-start" type="number" min="0" step="0.001"></label><label class="field">끝(초)<input id="shorts-end" type="number" min="0" step="0.001"></label></div>
    <div class="shorts-actions"><button id="shorts-current-start">현재 위치를 시작으로</button><button id="shorts-current-end">현재 위치를 끝으로</button><button id="shorts-lines">선택한 가사 구간</button></div>
    <p id="shorts-length" role="status"></p><p id="shorts-error" role="alert"></p>
    <div class="shorts-actions"><button id="shorts-preview-button">세로 미리보기</button><button id="shorts-render" class="primary">쇼츠 MP4 출력</button></div>
    <div id="shorts-preview"></div><p class="hint">1080 × 1920 · 최대 3분 · 출력은 프레임 단위로 맞춰집니다. 가로 영상의 스타일과 원본 가사 시간은 바뀌지 않습니다.</p>`;
  document.body.append(dialog);
  const $=id=>document.getElementById(id);
  let controller=null, serial=0, selectedTrack=null, key='', busy=false;
  const settings=()=>({startMs:$('shorts-start').value===''?NaN:Number($('shorts-start').value)*1000,endMs:$('shorts-end').value===''?NaN:Number($('shorts-end').value)*1000});
  function invalidate(){serial++;controller?.destroy();controller=null;$('shorts-preview').replaceChildren();}
  function changed(){invalidate();const s=settings();$('shorts-length').textContent=Number.isFinite(s.endMs-s.startMs)?`선택 길이: ${((s.endMs-s.startMs)/1000).toFixed(3)}초`:'';$('shorts-error').textContent='';try{localStorage.setItem(key,JSON.stringify(s));}catch{}}
  function validate(){const s=settings();if(!selectedTrack||track()?.id!==selectedTrack.id)throw Error('곡이 바뀌었습니다. 쇼츠 창을 다시 열어 주세요.');if(!Number.isFinite(s.startMs)||!Number.isFinite(s.endMs)||s.startMs<0||s.endMs<=s.startMs||s.endMs>selectedTrack.audio.durationMs||s.endMs-s.startMs>180000)throw Error('음원 범위 안에서 시작과 끝을 선택해 주세요. 길이는 최대 3분입니다.');return s;}
  const safe=fn=>async()=>{try{await fn();}catch(e){$('shorts-error').textContent=e.message;}};
  button.onclick=safe(async()=>{
    if(!track())return notice('먼저 곡을 선택해 주세요.');await flushSave();pause();selectedTrack=track();
    key=`lyricflow-shorts:${project().folder}:${selectedTrack.id}`;
    let s={startMs:0,endMs:Math.min(30000,selectedTrack.audio.durationMs)};try{const saved=JSON.parse(localStorage.getItem(key));if(saved&&Number.isFinite(saved.startMs)&&Number.isFinite(saved.endMs))s=saved;}catch{}
    $('shorts-start').value=s.startMs/1000;$('shorts-end').value=s.endMs/1000;
    for(const id of ['shorts-start','shorts-end'])$(id).max=selectedTrack.audio.durationMs/1000;
    $('shorts-title').textContent=selectedTrack.title;changed();dialog.showModal();
  });
  for(const id of ['shorts-start','shorts-end'])$(id).oninput=changed;
  $('shorts-current-start').onclick=()=>{$('shorts-start').value=seconds().toFixed(3);changed();};
  $('shorts-current-end').onclick=()=>{$('shorts-end').value=seconds().toFixed(3);changed();};
  $('shorts-lines').onclick=safe(()=>{const lines=selectedTrack.lines.filter(l=>document.querySelector(`input[data-select="${l.id}"]`)?.checked&&!l.excluded);if(!lines.length||lines.some(l=>l.startMs==null||l.endMs==null))throw Error('시간이 지정된 가사를 목록에서 선택한 뒤 다시 열어 주세요.');$('shorts-start').value=Math.min(...lines.map(l=>l.startMs))/1000;$('shorts-end').value=Math.max(...lines.map(l=>l.endMs))/1000;changed();});
  $('shorts-preview-button').onclick=safe(async()=>{const s=validate();invalidate();const request=serial;const props=await api(`/api/tracks/${selectedTrack.id}/preview?shorts=1&startMs=${s.startMs}&endMs=${s.endMs}`);const {mountPlayer}=await import('/dist/player.js');if(request!==serial||!dialog.open)return;controller=mountPlayer($('shorts-preview'),props,()=>{});});
  $('shorts-render').onclick=safe(async()=>{if(busy)return;const s=validate();busy=true;$('shorts-render').disabled=true;try{await flushSave();await api('/api/jobs',{method:'POST',body:JSON.stringify({type:'shorts',trackIds:[selectedTrack.id],settings:s})});dialog.close();notice('쇼츠 출력을 등록했습니다. 처리 상황에서 MP4와 SRT를 받을 수 있습니다.',true);await refresh();}finally{busy=false;$('shorts-render').disabled=false;}});
  $('shorts-close').onclick=()=>dialog.close();dialog.addEventListener('close',invalidate);
}
