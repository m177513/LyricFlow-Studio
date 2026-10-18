import assert from 'node:assert/strict';import {test} from 'node:test';import {formatTime,parseTime,moveRange} from '../web/timing-editor.js';
test('time formatting carries milliseconds across second/minute boundaries',()=>{assert.equal(formatTime(59999.8),'01:00.000');assert.equal(parseTime('02:03.045'),123045);assert.equal(parseTime('123.045'),123045);assert.equal(parseTime(''),null);assert.throws(()=>parseTime('01:67.000'));assert.throws(()=>parseTime('-1'));});
test('moving clips preserves duration at both audio boundaries',()=>{assert.deepEqual(moveRange(2000,5000,-9000,null,10000),{startMs:0,endMs:3000});assert.deepEqual(moveRange(2000,5000,9000,null,10000),{startMs:7000,endMs:10000});});
test('trim cannot reverse or exceed audio duration',()=>{assert.deepEqual(moveRange(2000,5000,9000,'start',10000),{startMs:4999,endMs:5000});assert.deepEqual(moveRange(2000,5000,-9000,'end',10000),{startMs:2000,endMs:2001});assert.deepEqual(moveRange(2000,5000,9000,'end',10000),{startMs:2000,endMs:10000});});
import {DEFAULT_GRID,beatTicks,validateGrid} from '../web/timeline-grid.js';
test('beat ruler places measures at their exact time with an intro and odd meter',()=>{
 const grid={...DEFAULT_GRID,mode:'beats',bpm:120,beatsPerBar:3,offsetMs:250};
 const ticks=beatTicks(3000,900,grid);
 assert.deepEqual(ticks.map(t=>[t.ms,t.label,t.major]),[[250,'1.1',true],[750,'1.2',false],[1250,'1.3',false],[1750,'2.1',true],[2250,'2.2',false],[2750,'2.3',false]]);
 assert.deepEqual(beatTicks(0,900,grid),[]);
});
test('fractional BPM has no cumulative drift and overview ticks remain bounded',()=>{
 const grid={...DEFAULT_GRID,mode:'beats',bpm:127.35,configured:true};
 const detailed=beatTicks(300000,19200,grid),last=detailed.at(-1);
 assert.equal(last.ms,(detailed.length-1)*60000/grid.bpm);
 const overview=beatTicks(86400000,800,grid);
 assert(overview.length<20);assert(overview.every(t=>t.major&&t.label.endsWith('.1')));
 assert(overview.at(-1).ms<86400000);
});
test('invalid tempo, meter, offset and mode are rejected',()=>{
 for(const patch of [{bpm:0},{bpm:Infinity},{bpm:'120'},{beatsPerBar:2.5},{beatsPerBar:0},{offsetMs:-1},{offsetMs:4000},{mode:'anything'},{configured:null}])assert.throws(()=>validateGrid({...DEFAULT_GRID,...patch},4000));
 assert.deepEqual(validateGrid(DEFAULT_GRID,4000),DEFAULT_GRID);
});
