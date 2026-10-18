import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {wav,cover} from './fixtures.mjs';
import {Store} from '../server/store.mjs';
import {reconcileLines} from '../server/core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'demo');fs.mkdirSync(folder,{recursive:true});
// Do not overwrite a user's edited demo project. Pass --reset for disposable test fixtures only.
if(fs.existsSync(path.join(folder,'.lyricflow-remotion/project.json'))&&!process.argv.includes('--reset')){
 console.log('Demo already exists; preserved. Use --reset only to reset the included synthetic demo.');process.exit(0);
}
if(process.argv.includes('--reset'))fs.rmSync(path.join(folder,'.lyricflow-remotion'),{recursive:true,force:true});
wav(path.join(folder,'01 - 검수 화면 데모.wav'),14,330);wav(path.join(folder,'02 - 반복 구간 데모.wav'),11.4,440);cover(path.join(folder,'cover.png'));
const store=new Store(root);await store.open(folder);store.project.demo=true;store.project.jobs=[];
const texts=[['원문 가사는 그대로 보존합니다.','시간을 옮긴 줄은 자동으로 잠깁니다.','이 음원은 가창이 아닌 합성 신호입니다.'],['같은 문장도 다른 구간입니다.','중간 구간을 확인합니다.','같은 문장도 다른 구간입니다.']];
for(const[tIndex,t]of store.project.tracks.entries()){
 t.sourceLyrics='[Intro no humming]\n[Verse]\n'+texts[tIndex].join('\n');
 t.lines=reconcileLines([],texts[tIndex]).map((line,i)=>({...line,startMs:Math.round((1.4+i*3.3)*1000),endMs:Math.round((3.9+i*3.3)*1000),timestampMs:Math.round((1.4+i*3.3)*1000),origin:'demo',flags:i===1?['demo']:[],locked:false,reviewed:i!==1}));
 t.analysis=null;t.notes=['설명용 합성 신호와 수동 시간입니다. 노래 인식 정확도 검증용이 아닙니다.'];t.history=[];
}
store.save();console.log(`Synthetic review demo created: ${folder}`);
