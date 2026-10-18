import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run,python,ffmpeg,ffprobe} from '../server/media.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const info={node:process.version,platform:process.platform,arch:process.arch,playerBuilt:fs.existsSync(path.join(root,'web/dist/player.js')),remotionInstalled:fs.existsSync(path.join(root,'node_modules/remotion/package.json')),ffmpeg:false,ffprobe:false,python:null,errors:[]};
for(const[key,cmd]of[['ffmpeg',ffmpeg()],['ffprobe',ffprobe()]])try{await run(cmd,['-version'],{timeoutMs:5000});info[key]=true;}catch(e){info.errors.push(e.message);}
try{info.python=JSON.parse((await run(python(root),[path.join(root,'worker/align.py'),'--diagnose'],{timeoutMs:15000})).stdout);}catch(e){info.errors.push(e.message);}
if(info.python&&!info.python['faster-whisper'])info.errors.push('Whisper 미설치: install_audio_windows.bat을 실행하세요.');
if(info.python&&!info.python['audio-separator'])info.errors.push('기본 보컬 분리 미설치: install_audio_windows.bat을 실행하거나 원본 분석을 선택하세요.');
console.log(JSON.stringify(info,null,2));
