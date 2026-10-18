import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gapCandidates,reviewPatch,reviewSelection} from '../web/timeline-gaps.js';
const timed=(id,startMs,endMs)=>({id,text:id,startMs,endMs});
const missing=id=>timed(id,null,null);
test('one missing lyric appears in its neighbours gap without mutating caption times',()=>{
 const lines=[timed('4',20000,22980),missing('5'),timed('6',24700,27120)],before=structuredClone(lines);
 assert.deepEqual(gapCandidates(lines),[{id:'5',index:1,startMs:22980,endMs:24700,beforeId:'4',afterId:'6'}]);
 assert.deepEqual(lines,before);
});
test('no invented placement for consecutive missing lines, overlap, long gaps or unbounded intro/outro',()=>{
 for(const lines of [[missing('1'),timed('2',1000,2000)],[timed('1',1000,2000),missing('2')],[timed('1',1000,2000),missing('2'),missing('3'),timed('4',5000,6000)],[timed('1',1000,3000),missing('2'),timed('3',2500,4000)],[timed('1',1000,2000),missing('2'),timed('3',22000,24000)]])assert.deepEqual(gapCandidates(lines),[]);
});
test('excluded rows are skipped but protected manual or copy rows never get inferred ranges',()=>{
 const lines=[timed('1',0,1000),{...missing('excluded'),excluded:true},missing('3'),timed('4',2000,3000)];
 assert.equal(gapCandidates(lines)[0].id,'3');
 for(const protectedFields of [{locked:true},{reviewed:true},{origin:'manual'},{copyGroupId:'copy'}])assert.deepEqual(gapCandidates([lines[0],{...lines[2],...protectedFields},lines[3]]),[]);
});

test('confirmation accepts visible candidates together with timed lines without a drag',()=>{
 const lines=[timed('4',20000,22980),missing('5'),timed('6',24700,27120),missing('7'),timed('8',28780,30000)],before=structuredClone(lines);
 assert.deepEqual(lines.map(l=>reviewPatch(lines,l.id)),[
  {id:'4',reviewed:true},{id:'5',startMs:22980,endMs:24700,reviewed:true},
  {id:'6',reviewed:true},{id:'7',startMs:27120,endMs:28780,reviewed:true},{id:'8',reviewed:true}
 ]);
 assert.deepEqual(lines,before);
 assert.equal(reviewPatch([missing('unbounded')],'unbounded'),null);
 assert.equal(reviewPatch(lines,'deleted'),null);
});

test('bulk review confirms placed rows while retaining unplaced rows for review',()=>{
 const lines=[timed('1',0,1000),missing('2'),missing('3'),timed('4',2000,3000),{...missing('5'),excluded:true}],before=structuredClone(lines);
 assert.deepEqual(reviewSelection(lines,lines.map(l=>l.id)),{edits:[{id:'1',reviewed:true},{id:'4',reviewed:true}],pending:['2','3']});
 assert.deepEqual(lines,before);
 assert.deepEqual(reviewSelection(lines,['4']),{edits:[{id:'4',reviewed:true}],pending:[]});
});
