import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateLegacyProject,migrateLegacyStyle} from '../server/legacy.mjs';

test('0.1 migration preserves raw lyrics and carries only evidenced timings',()=>{
  const project=migrateLegacyProject({
    version:1,
    cover_file:'cover.png',
    settings:{width:1280,height:720,fps:24,lyric_font_size:64,lyric_margin_v:72},
    tracks:[{id:'legacy-track',order:4,title:'이전 제목',audio_file:'01 - song.wav',duration:8,lyrics:'[Verse 1]\n첫 줄\n둘째 줄\n셋째 줄',subtitles:[
      {index:0,text:'첫 줄',start:1.1,end:2.2,confidence:.9,source:'matched'},
      {index:1,text:'둘째 줄',start:2.3,end:3.1,confidence:1,source:'manual'},
      {index:2,text:'셋째 줄',start:3.2,end:4,confidence:.1,source:'interpolated'},
    ],rendered_file:'old.mp4'}]
  },{importedAt:'2026-09-11T00:00:00.000Z'});
  assert.equal(project.migration.from,'0.1');
  assert.equal(project.tracks[0].sourceLyrics,'[Verse 1]\n첫 줄\n둘째 줄\n셋째 줄');
  assert.deepEqual(project.tracks[0].lines.map(line=>[line.startMs,line.endMs]),[[1100,2200],[2300,3100],[null,null]]);
  assert.equal(project.tracks[0].lines[1].locked,true);
  assert.equal(project.tracks[0].lines[2].flags.includes('legacy_interpolated'),true);
  assert.match(project.tracks[0].notes.join(' '),/재사용하지 않습니다/);
  assert.deepEqual([project.style.width,project.style.height,project.style.fps],[1280,720,24]);
});

test('0.1 migration skips unsafe nested media names and duplicate IDs',()=>{
  const project=migrateLegacyProject({tracks:[
    {id:'same',audio_file:'nested/a.wav',lyrics:'가사'},
    {id:'same',audio_file:'02.wav',lyrics:'가사'},
    {id:'third',audio_file:'03.wav',lyrics:'가사'},
  ]});
  assert.deepEqual(project.tracks.map(track=>track.audio.name),['02.wav','03.wav']);
  assert.equal(new Set(project.tracks.map(track=>track.id)).size,2);
});

test('legacy style falls back to the supported 0.2 canvas',()=>{
  const style=migrateLegacyStyle({width:999,height:999,fps:29,lyric_text_color:'red'});
  assert.deepEqual([style.width,style.height,style.fps,style.color],[1920,1080,30,'#ffffff']);
});
