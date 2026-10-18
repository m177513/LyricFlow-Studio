import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShortProps,shortRange} from '../server/shorts.mjs';
import {DEFAULT_STYLE,toSrt} from '../server/core.mjs';
const track={id:'test',title:'테스트',audio:{durationMs:200000},imageName:'cover.png',lines:[
  {text:'시작에 걸친 가사',startMs:500,endMs:2000,flags:[],reviewed:true},
  {text:'반복 가사',startMs:3000,endMs:4000,flags:[],reviewed:true},
  {text:'반복 가사',startMs:5000,endMs:7000,flags:[],reviewed:true},
]};
test('shorts preserve lyrics, clip boundaries, offset audio, and do not mutate source',()=>{
 const before=JSON.stringify(track);const props=makeShortProps(track,DEFAULT_STYLE,(_,k)=>k,{startMs:1000,endMs:6000});
 assert.equal(props.style.width,1080);assert.equal(props.style.height,1920);
 const t=props.tracks[0];assert.equal(t.audioStartFrame,30);assert.equal(t.durationInFrames,150);
 assert.deepEqual(t.captions.map(c=>[c.text,c.startMs,c.endMs]),[['시작에 걸친 가사',0,1000],['반복 가사',2000,3000],['반복 가사',4000,5000]]);
 assert.match(toSrt(t.captions),/00:00:04,000 --> 00:00:05,000/);assert.equal(JSON.stringify(track),before);
});
test('instrumental, excluded lines and gaps stay empty',()=>{
 assert.equal(makeShortProps({...track,instrumental:true},DEFAULT_STYLE,()=>'',{startMs:1000,endMs:6000}).tracks[0].captions.length,0);
 assert.equal(makeShortProps(track,DEFAULT_STYLE,()=>'',{startMs:2100,endMs:2900}).tracks[0].captions.length,0);
});
test('invalid ranges and bad lyric timings are rejected',()=>{
 for(const [startMs,endMs] of [[-1,1000],[1000,1000],[2000,1000],[0,200001],[0,180001],[NaN,1000],[0,1]])assert.throws(()=>shortRange(track,{startMs,endMs},30));
 for(const patch of [{startMs:null},{endMs:250000},{startMs:4000,endMs:3000}])assert.throws(()=>makeShortProps({...track,lines:[{...track.lines[0],...patch}]},DEFAULT_STYLE,()=>'',{startMs:1000,endMs:6000}));
});
