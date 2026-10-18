export function processingStatus(track, jobs = []) {
 const excluded=track.lines.filter(l=>l.excluded).length;
 if(excluded){if(excluded===track.lines.length)return {kind:'ready',text:`전체 ${excluded}줄 제외 · 가사 없이 출력`};const result=processingStatus({...track,lines:track.lines.filter(l=>!l.excluded)},jobs);return {...result,text:`${result.text} · ${excluded}줄 제외`};}
 const relevant = jobs.filter(j => j.type === 'align' && j.trackIds?.includes(track.id));
 const active = relevant.find(j => j.status === 'running') || relevant.find(j => j.status === 'queued');
 if (active) return {kind:active.status, text:active.status === 'running' ? `분석 중 · ${active.message || '처리 중'}` : '분석 대기 · 자동으로 순서대로 처리됩니다'};
 if (track.missing) return {kind:'error',text:'음원 확인 필요'};
 if (track.instrumental) return {kind:'ready',text:'무보컬 곡'};
 if (!track.lines.length) return {kind:'waiting',text:'가사 입력 대기'};
 if (!track.analysis && !track.lines.some(l => l.startMs != null && l.endMs != null)) {
  const last = relevant.at(-1);
  return {kind:'waiting',text:last && ['failed','interrupted','cancelled'].includes(last.status) ? `분석 미완료 · ${last.message || last.status}` : '가사 준비됨 · 분석 전'};
 }
 const missing = track.lines.filter(l => l.startMs == null || l.endMs == null).length;
 const review = track.lines.filter(l => l.flags?.length && !l.reviewed).length;
 const reviewed = track.lines.filter(l => l.reviewed && l.startMs != null && l.endMs != null).length;
 const automatic = track.lines.filter(l => !l.reviewed && !l.flags?.length && l.startMs != null && l.endMs != null).length;
 return {kind:'review',text:`${track.lines.length}줄${automatic ? ` · 자동 배치 ${automatic}줄` : ''}${reviewed ? ` · 검수 완료 ${reviewed}줄` : ''}${review ? ` · ${review}줄 확인 필요` : ''}${missing ? ` (시간 미지정 ${missing}줄 포함)` : ''}`};
}

export function processingOverview(tracks, jobs) {
 const vocal = tracks.filter(t => !t.instrumental);
 const statuses = vocal.map(t => processingStatus(t,jobs));
 const count = kind => statuses.filter(s => s.kind === kind).length;
 const active = jobs.find(j => j.type === 'align' && j.status === 'running' && tracks.some(t=>j.trackIds?.includes(t.id)));
 return `가사 분석 ${count('review')}/${vocal.length}곡 완료 · 처리 중 ${count('running')}곡 · 대기 ${count('queued')}곡${count('waiting') + count('error') ? ` · 미완료 ${count('waiting')+count('error')}곡` : ''}${active ? ` — ${active.title}: ${active.message}` : ''}`;
}
