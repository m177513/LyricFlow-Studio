import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp,APP_ROOT} from '../server/main.mjs';
import {basicFolder,wav,cover} from '../scripts/fixtures.mjs';
import {atomicJSON,readJSON} from '../server/core.mjs';

const waitFor=async(fn,ms=10000)=>{const start=Date.now();while(Date.now()-start<ms){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,50));}throw new Error('waitFor timeout');};

test('live local HTTP API, persistence, validation and queue',async(t)=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lyricflow-api-'));basicFolder(folder);
 const testRoot=path.join(folder,'test-app');fs.mkdirSync(path.join(testRoot,'web'),{recursive:true});fs.writeFileSync(path.join(testRoot,'package.json'),'{}');
 const app=await createApp({port:0,appRoot:testRoot});
 const call=async(route,method='GET',data,headers={})=>{
  const response=await fetch(app.url+route,{method,headers:{'Content-Type':'application/json','X-LyricFlow-Token':app.token,...headers},...(data!==undefined?{body:JSON.stringify(data)}:{})});
  return{status:response.status,body:await response.json()};
 };
 let project,track;
 try{
  await t.test('local session is readable and has an ephemeral token',async()=>{const r=await call('/api/session');assert.equal(r.status,200);assert.equal(r.body.token,app.token);});
  await t.test('cross-origin API writes are rejected',async()=>{const r=await call('/api/project/open','POST',{folder},{Origin:'https://evil.example'});assert.equal(r.status,403);});
  await t.test('missing anti-CSRF token is rejected',async()=>{const r=await call('/api/project/open','POST',{folder},{'X-LyricFlow-Token':''});assert.equal(r.status,403);});
  await t.test('folder import probes real WAV and matches cover image',async()=>{const r=await call('/api/project/open','POST',{folder});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.audio.durationMs,4000);assert.equal(track.imageName,'cover.png');assert.equal(track.audio.sha256.length,64);});
  await t.test('original lyrics persist without including production tags in display lines',async()=>{const source='[Verse]\n첫 번째 가사\n(yeah) 두 번째 가사';const r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{sourceLyrics:source}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.sourceLyrics,source);assert.equal(track.lines.length,2);});
  await t.test('candidate confirmation saves timing and review atomically and undo restores missing timing',async()=>{
    const original=structuredClone(track.lines[0]);
    let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:[{id:original.id,startMs:250,endMs:750,reviewed:true}]}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];
    assert.equal(track.lines[0].startMs,250);assert.equal(track.lines[0].endMs,750);assert.equal(track.lines[0].reviewed,true);assert.equal(track.lines[0].locked,true);
    r=await call(`/api/tracks/${track.id}/undo`,'POST',{revision:project.revision});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.deepEqual(track.lines[0],original);
  });
  await t.test('line operations copy, add and delete display lines without changing the preserved source',async()=>{
    const source=track.sourceLyrics;const originalIds=track.lines.map(line=>line.id);const originalCount=track.lines.length;
    let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'copy',lineId:originalIds[0],position:'after'}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.sourceLyrics,source);assert.equal(track.lines.length,originalCount+1);
    const copied=track.lines[1];assert.equal(copied.text,track.lines[0].text);assert.equal(copied.startMs,null);assert.equal(copied.endMs,null);assert(copied.flags.includes('manual_copy'));assert.equal(copied.reviewed,false);assert.equal(track.history.at(-1).reason,'line_operation');
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'add',lineId:copied.id,position:'after',text:'새로 추가한 가사'}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.lines.length,originalCount+2);const added=track.lines[2];assert.equal(added.text,'새로 추가한 가사');assert(added.flags.includes('manual_added'));assert.equal(added.startMs,null);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'delete',lineId:added.id}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.lines.length,originalCount+1);assert(!track.lines.some(line=>line.id===added.id));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'delete',lineId:copied.id}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.deepEqual(track.lines.map(line=>line.id),originalIds);assert.equal(track.sourceLyrics,source);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'copy',lineIds:originalIds,position:'after'}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.lines.length,originalCount*2);assert.deepEqual(track.lines.slice(originalCount).map(line=>line.text),track.lines.slice(0,originalCount).map(line=>line.text));
    const copiedLines=track.lines.slice(originalCount),copiedIds=copiedLines.map(line=>line.id),groupIds=new Set(copiedLines.map(line=>line.copyGroupId));
    assert.equal(groupIds.size,1);assert.deepEqual(copiedLines.map(line=>line.copyGroupIndex),[0,1]);assert(copiedLines.every(line=>line.copyGroupSize===originalCount&&line.copySourceStartMs===null&&line.copySourceEndMs===null));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'delete',lineIds:copiedIds}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.deepEqual(track.lines.map(line=>line.id),originalIds);
    const timed=originalIds.map((id,index)=>({id,startMs:300+index*1500,endMs:1300+index*1500}));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:timed}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'copy',lineIds:originalIds,position:'after'}}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];const timedCopies=track.lines.slice(originalCount);assert(timedCopies.every((line,index)=>line.copySourceStartMs===timed[index].startMs&&line.copySourceEndMs===timed[index].endMs&&line.startMs===null&&line.endMs===null));
    const moved=timedCopies.map((line,index)=>({id:line.id,startMs:800+index*1500,endMs:1800+index*1500}));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:moved,lineOrder:[originalIds[0],timedCopies[0].id,originalIds[1],timedCopies[1].id]}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.deepEqual(track.lines.map(line=>line.id),[originalIds[0],timedCopies[0].id,originalIds[1],timedCopies[1].id]);assert(track.lines.filter(line=>timedCopies.some(copy=>copy.id===line.id)).every(line=>line.flags.includes('manual_copy')&&!line.reviewed));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'split',lineId:timedCopies[0].id,atMs:1000,textA:'복사 앞',textB:'복사 뒤'}}});assert.equal(r.status,400);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'ungroup',lineIds:timedCopies.map(line=>line.id)}}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert(timedCopies.every(copy=>{const line=track.lines.find(item=>item.id===copy.id);return line&&!line.copyGroupId&&line.startMs!==null&&line.endMs!==null;}));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lineOp:{action:'delete',lineIds:timedCopies.map(line=>line.id)}}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];
  });
  await t.test('track edits support undo and redo without crossing a new edit branch',async()=>{
    const originalTitle=track.title;
    let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{title:originalTitle+' · 변경'}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.title,originalTitle+' · 변경');assert.equal(track.redoHistory?.length||0,0);
    r=await call(`/api/tracks/${track.id}/undo`,'POST',{revision:project.revision});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.title,originalTitle);assert.equal(track.redoHistory.length,1);
    r=await call(`/api/tracks/${track.id}/redo`,'POST',{revision:project.revision});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.title,originalTitle+' · 변경');assert.equal(track.redoHistory.length,0);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{title:originalTitle}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];
    r=await call(`/api/tracks/${track.id}/redo`,'POST',{revision:project.revision});assert.equal(r.status,400);
  });
  await t.test('grid preferences persist per track without touching lyric data or undo history',async()=>{
    const original=structuredClone(track),grid={mode:'beats',bpm:127.5,beatsPerBar:3,offsetMs:250,configured:true};
    let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{timelineGrid:grid}});
    assert.equal(r.status,200);project=r.body;track=project.tracks.find(t=>t.id===original.id);
    assert.deepEqual(track.timelineGrid,grid);
    const {timelineGrid,...unchanged}=track;assert.deepEqual(unchanged,original);
    for(const bad of [{...grid,bpm:0},{...grid,offsetMs:4000},{...grid,beatsPerBar:1.5}]){
      r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{timelineGrid:bad}});
      assert.equal(r.status,400);assert.deepEqual(app.store.publicProject(),project);
    }
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{timelineGrid:grid,title:'mixed edit'}});
    assert.equal(r.status,400);assert.deepEqual(app.store.publicProject(),project);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision-1,patch:{timelineGrid:{...grid,mode:'seconds'}}});assert.equal(r.status,409);
    assert.deepEqual(readJSON(app.store.file).tracks.find(t=>t.id===track.id).timelineGrid,grid);
    r=await call('/api/project/open','POST',{folder});assert.equal(r.status,200);project=r.body;track=project.tracks.find(t=>t.id===original.id);
    assert.deepEqual(track.timelineGrid,grid);assert.deepEqual(track.lines,original.lines);
    assert(project.tracks.filter(t=>t.id!==track.id).every(t=>!t.timelineGrid));
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{timelineGrid:{...grid,mode:'seconds'}}});assert.equal(r.status,200);project=r.body;track=project.tracks.find(t=>t.id===original.id);
    assert.deepEqual(track.lines,original.lines);assert.deepEqual(track.history,original.history);assert.equal(track.timelineGrid.bpm,127.5);
  });
  await t.test('stale edit revision is rejected rather than overwriting data',async()=>{const r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:0,patch:{title:'overwrite'}});assert.equal(r.status,409);assert.notEqual(app.store.getTrack(track.id).title,'overwrite');});
  await t.test('analysis API defaults to vocals and retries, and preserves explicit original mode',async()=>{
    const original=app.queue.align;const seen=[];
    // Queue/settings contract only: real inference has a separate song acceptance run.
    app.queue.align=async task=>{seen.push(task.settings);};
    try{
      const base={model:'large-v3',device:'cpu',engine:'anchors',language:'ko'};
      for(const settings of [base,{...base,audioSource:'original',retryMissing:false}]){
        const r=await call('/api/jobs','POST',{type:'align',trackIds:[track.id],settings});assert.equal(r.status,202);
        await waitFor(async()=>app.store.project.jobs.find(j=>j.id===r.body.id)?.status==='completed');
      }
      assert.equal(seen[0].audioSource,'vocals');assert.equal(seen[0].retryMissing,true);
      assert.equal(seen[1].audioSource,'original');assert.equal(seen[1].retryMissing,false);
      const bad=await call('/api/jobs','POST',{type:'align',trackIds:[track.id],settings:{...base,audioSource:'outside'}});
      assert.equal(bad.status,400);
    }finally{app.queue.align=original;project=(await call('/api/project')).body;track=project.tracks[0];}
  });
  await t.test('a rejected patch does not partially mutate the track',async()=>{const before=app.store.getTrack(track.id).title;const r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{title:'should not survive',imageName:'outside.png'}});assert.equal(r.status,400);assert.equal(app.store.getTrack(track.id).title,before);});
  await t.test('manual timing edits are locked and survive an unrelated style change',async()=>{const edits=track.lines.map((l,i)=>({id:l.id,startMs:100+i*1500,endMs:1300+i*1500,reviewed:true}));let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:edits}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert(track.lines.every(l=>l.locked));r=await call('/api/style','PATCH',{revision:project.revision,style:{...project.style,color:'#ffffee'}});assert.equal(r.status,200);project=r.body;assert.equal(project.tracks[0].lines[0].startMs,100);});
  await t.test('SRT export uses preserved text and edited milliseconds',async()=>{const r=await fetch(app.url+`/api/tracks/${track.id}/srt`);assert.equal(r.status,200);const text=await r.text();assert.match(text,/00:00:00,100 --> 00:00:01,300/);assert.match(text,/\(yeah\) 두 번째 가사/);fs.writeFileSync(path.join(APP_ROOT,'verification','api-generated.srt'),text);});
  await t.test('preview props use the same caption fields and style as rendering',async()=>{const r=await call(`/api/tracks/${track.id}/preview`);assert.equal(r.status,200);assert.equal(r.body.tracks[0].captions[0].startMs,100);assert.equal(r.body.style.color,'#ffffee');assert.equal(r.body.tracks[0].durationInFrames,120);});
  await t.test('excluded line persists and disappears from preview and SRT until restored',async()=>{
    const original=structuredClone(track.lines[0]);const source=track.sourceLyrics;
    let r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:[{id:original.id,excluded:true}]}});
    assert.equal(r.status,200);project=r.body;track=project.tracks[0];
    assert.equal(track.sourceLyrics,source);assert.equal(track.lines[0].startMs,original.startMs);
    r=await call(`/api/tracks/${track.id}/preview`);assert.equal(r.body.tracks[0].captions.length,1);
    const srt=await fetch(app.url+`/api/tracks/${track.id}/srt`);assert.equal(srt.status,200);assert(!(await srt.text()).includes(original.text));
    r=await call('/api/project/open','POST',{folder});project=r.body;track=project.tracks[0];assert.equal(track.lines[0].excluded,true);
    r=await call(`/api/tracks/${track.id}`,'PATCH',{revision:project.revision,patch:{lines:[{id:original.id,excluded:false}]}});assert.equal(r.status,200);project=r.body;track=project.tracks[0];
    assert.equal(track.lines[0].id,original.id);assert.equal(track.lines[0].startMs,original.startMs);
    r=await call(`/api/tracks/${track.id}/preview`);assert.equal(r.body.tracks[0].captions.length,2);
  });
  await t.test('registered media supports correct byte range requests',async()=>{const r=await call(`/api/tracks/${track.id}/preview`);const media=await fetch(r.body.tracks[0].audioUrl,{headers:{Range:'bytes=0-43'}});assert.equal(media.status,206);assert.equal((await media.arrayBuffer()).byteLength,44);const bad=await fetch(r.body.tracks[0].audioUrl,{headers:{Range:'bytes=99999999-'}});assert.equal(bad.status,416);});
  await t.test('media URLs without capability keys are rejected',async()=>{const r=await fetch(app.url+`/asset/${track.id}/audio`);assert.equal(r.status,403);});
  await t.test('unknown file paths are not exposed',async()=>{const r=await fetch(app.url+'/..%2fpackage.json');assert.equal(r.status,403);});
  await t.test('reload from disk keeps manual timing and source lyrics',async()=>{const before=track.lines[0].id;const r=await call('/api/project/open','POST',{folder});assert.equal(r.status,200);project=r.body;track=project.tracks[0];assert.equal(track.lines[0].id,before);assert.equal(track.lines[0].startMs,100);assert.equal(track.lines[0].locked,true);});
  await t.test('unfinished jobs recover as interrupted on reopen',async()=>{app.store.project.jobs.push({id:'old-job',status:'running',type:'align',trackIds:[track.id],outputs:[],log:[]});app.store.save();const r=await call('/api/project/open','POST',{folder});assert.equal(r.status,200);project=r.body;assert.equal(project.jobs.find(j=>j.id==='old-job').status,'interrupted');});
  await t.test('two deterministic worker failures do not stop the queue',async()=>{
    // Test queue continuation, not Remotion itself. No network, downloads or render dependencies.
    const original=app.queue.render;let invocations=0;
    app.queue.render=async()=>{invocations++;throw new Error('test: deterministic render worker failure');};
    try{
      const a=await call('/api/jobs','POST',{type:'render',trackIds:[track.id],settings:{}});assert.equal(a.status,202);
      const b=await call('/api/jobs','POST',{type:'render',trackIds:[track.id],settings:{}});assert.equal(b.status,202);
      const jobs=await waitFor(async()=>{const r=await call('/api/jobs');const matched=r.body.filter(j=>[a.body.id,b.body.id].includes(j.id));return matched.length===2&&matched.every(j=>j.status==='failed')?matched:null;});
      assert.equal(invocations,2);assert(jobs.every(j=>j.message==='test: deterministic render worker failure'));
    }finally{app.queue.render=original;}
  });
  await t.test('ambiguous image names are not selected arbitrarily',async()=>{const folder2=path.join(folder,'another');basicFolder(folder2);cover(path.join(folder2,'cover.jpg'),320,180);const r=await call('/api/project/open','POST',{folder:folder2});assert.equal(r.status,200);assert.equal(r.body.tracks[0].imageName,null);});
  await t.test('changing audio bytes invalidates old timing and preserves history',async()=>{await call('/api/project/open','POST',{folder});wav(path.join(folder,'01 - test.wav'),5,420);const r=await call('/api/project/open','POST',{folder});assert.equal(r.status,200);assert.equal(r.body.tracks[0].lines[0].startMs,null);assert(r.body.tracks[0].history.some(h=>h.reason==='audio_changed'));});
 }finally{await app.close();fs.rmSync(folder,{recursive:true,force:true});}
});
