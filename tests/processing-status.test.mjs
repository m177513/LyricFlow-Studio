import test from 'node:test';
import assert from 'node:assert/strict';
import {processingStatus,processingOverview} from '../web/processing-status.js';
const source={id:'t',lines:[{startMs:null,endMs:null,flags:['unmatched'],reviewed:false}]};
test('unanalysed lyrics are not presented as failed recognition',()=>{
 assert.equal(processingStatus(source).text,'가사 준비됨 · 분석 전');
 const jobs=[{type:'align',trackIds:['t'],status:'cancelled'},{type:'align',trackIds:['t'],status:'queued'}];
 assert.equal(processingStatus(source,jobs).kind,'queued');
 assert.doesNotMatch(processingStatus(source,jobs).text,/확인 필요/);
});
test('completed result reports missing times separately inside the review count',()=>{
 const t={...source,analysis:{device:'cuda'}};
 assert.match(processingStatus(t).text,/1줄 확인 필요 \(시간 미지정 1줄 포함\)/);
 assert.match(processingOverview([t],[]),/1\/1곡 완료/);
});
test('active rerun stays in progress while old results and other project jobs exist',()=>{
 const t={...source,analysis:{}};
 const jobs=[{type:'align',trackIds:['other'],status:'running',title:'wrong'}, {type:'align',trackIds:['t'],status:'running',title:'Current',message:'보컬 분리'}];
 assert.match(processingStatus(t,jobs).text,/분석 중 · 보컬 분리/);
 const overview=processingOverview([t],jobs);
 assert.match(overview,/0\/1곡 완료 · 처리 중 1곡/);
 assert.match(overview,/Current/); assert.doesNotMatch(overview,/wrong/);
});

test('automatic placement, specific warnings and human approval stay distinct',()=>{
 const placed={startMs:100,endMs:900,flags:[],reviewed:false};
 const t={id:'t',analysis:{},lines:[placed,{...placed,reviewed:true},{...placed,flags:['partial_text']},{startMs:null,endMs:null,flags:['unmatched'],reviewed:false},{...placed,excluded:true}]};
 const before=structuredClone(t);
 const status=processingStatus(t);
 assert.equal(status.text,'4줄 · 자동 배치 1줄 · 검수 완료 1줄 · 2줄 확인 필요 (시간 미지정 1줄 포함) · 1줄 제외');
 assert.deepEqual(t,before);
 assert.equal(processingStatus({...t,lines:[placed]}).text,'1줄 · 자동 배치 1줄');
 assert.doesNotMatch(processingStatus({...t,lines:[placed]}).text,/검수 완료/);
});
