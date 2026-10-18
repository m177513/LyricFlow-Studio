import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {atomicJSON, assert, readJSON, within} from '../server/core.mjs';
import {sendFile, run, ffmpeg, ffprobe} from '../server/media.mjs';
const emit = (stage,message,progress) => console.log('@@LYRICFLOW@@'+JSON.stringify({stage,message,progress}));
import {renderProfile, probeHardwareEncoder} from './render-profile.mjs';
let assetServer;
try {
  const req = readJSON(process.argv[2]); assert(req?.props, '렌더링 입력 파일이 잘못되었습니다.');
  let bundle, selectComposition, renderMedia, renderStill;
  try {
    ({bundle} = await import('@remotion/bundler'));
    ({selectComposition,renderMedia,renderStill} = await import('@remotion/renderer'));
  } catch { throw new Error('Remotion 패키지가 설치되지 않았습니다. install_windows.bat 또는 npm install을 실행해 주세요.'); }
  const key = randomBytes(24).toString('hex');
  assetServer = http.createServer((request,response)=>{
    try {
      const u = new URL(request.url,'http://127.0.0.1'); assert(u.searchParams.get('key')===key,'렌더 미디어 키가 잘못되었습니다.',403);
      const name=decodeURIComponent(u.pathname.slice(1)); const file=within(req.assetsDir,path.join(req.assetsDir,name));
      sendFile(request,response,file,{root:req.assetsDir,cors:true});
    } catch(error) { response.writeHead(error.status||500); response.end(error.message); }
  });
  await new Promise(resolve=>assetServer.listen(0,'127.0.0.1',resolve));
  const port=assetServer.address().port;
  const props=structuredClone(req.props);
  for(const t of props.tracks) {
    t.audioUrl=`http://127.0.0.1:${port}/${encodeURIComponent(t.audioUrl)}?key=${key}`;
    t.imageUrl=`http://127.0.0.1:${port}/${encodeURIComponent(t.imageUrl)}?key=${key}`;
  }
  emit('bundle','영상 구성 코드를 묶습니다.');
  const serveUrl=await bundle({entryPoint:path.join(req.appRoot,'video/index.tsx'),onProgress:()=>{}});
  const browserExecutable=req.browserExecutable||undefined;
  const composition=await selectComposition({serveUrl,id:'LyricVideo',inputProps:props,browserExecutable});
  const profile=await renderProfile({sampleImage:path.join(req.assetsDir,req.props.tracks[0].imageUrl),style:props.style,probe:req.binariesDirectory ? (encoder,image) => run(path.join(req.binariesDirectory,'ffmpeg.exe'), ['-v','error','-nostdin','-i',image,'-frames:v','1','-an','-c:v',encoder,'-f','null','-'], {timeoutMs:15000}) : probeHardwareEncoder});
  const encoders=new Set();
  const renderStarted=performance.now();
  emit('render-setup',`${profile.device==='gpu'?'GPU':'CPU'} ${profile.encoder} · 동시 처리 ${profile.concurrency}개 · ${profile.reason}`);
  const separateAudio = Boolean(req.binariesDirectory && props.style.portrait);
  const renderOutput = separateAudio ? path.join(req.assetsDir,'silent-video.mp4') : req.outputFile;
  let last=-1;
  await renderMedia({binariesDirectory:req.binariesDirectory,muted:separateAudio,composition,serveUrl,codec:'h264',audioCodec:'aac',audioBitrate:'320k',pixelFormat:'yuv420p',...profile.options,
    outputLocation:renderOutput,inputProps:props,browserExecutable,concurrency:profile.concurrency,overwrite:false,
    ffmpegOverride:({args})=>{const i=args.indexOf('-c:v');if(i>=0&&args[i+1]!=='copy')encoders.add(args[i+1]);return args;},
    onProgress:({progress,renderedFrames})=>{const percent=Math.floor(progress*100);if(percent!==last){last=percent;emit('render',`${profile.device==='gpu'?'GPU':'CPU'} ${profile.encoder} · 영상 출력 ${percent}% · ${renderedFrames}프레임`,progress);}},
  });
  if (separateAudio) {
    const t=req.props.tracks[0];
    await run(path.join(req.binariesDirectory,'ffmpeg.exe'), ['-v','error','-nostdin','-n','-i',renderOutput,'-ss',String((t.audioStartFrame || 0)/props.style.fps),'-i',path.join(req.assetsDir,t.audioUrl),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','320k','-movflags','+faststart','-t',String(composition.durationInFrames/composition.fps),req.outputFile]);
  }
  const renderSeconds=(performance.now()-renderStarted)/1000;
  assert(encoders.has(profile.encoder),'실제 인코더가 선택한 렌더 설정과 다릅니다.');
  atomicJSON(path.join(path.dirname(req.outputFile),'render-performance.json'),{...profile,actualEncoders:[...encoders],renderSeconds,frames:composition.durationInFrames,framesPerSecond:composition.durationInFrames/renderSeconds});
  emit('verify','출력 파일의 스트림·길이·전체 디코딩을 검사합니다.');
  const metadata=JSON.parse((await run(ffprobe(),['-v','error','-show_streams','-show_format','-of','json',req.outputFile],{timeoutMs:30000})).stdout);
  const video=metadata.streams.find(s=>s.codec_type==='video'); const audio=metadata.streams.find(s=>s.codec_type==='audio');
  const expectedSeconds=composition.durationInFrames/composition.fps;
  assert(video&&audio,'영상 또는 오디오 스트림이 없습니다.');
  assert(video.width===props.style.width&&video.height===props.style.height,'출력 해상도가 입력과 다릅니다.');
  assert(Math.abs(Number(metadata.format.duration)-expectedSeconds)<0.2,'출력 길이가 예상과 다릅니다.');
  // Some portable FFmpeg builds omit the wrapped_avframe encoder that the
  // null muxer otherwise selects automatically. Explicit raw decoders keep
  // this verification portable while still decoding every video/audio frame.
  const decode=await run(ffmpeg(),['-v','error','-xerror','-nostdin','-i',req.outputFile,'-map','0:v:0','-map','0:a:0','-c:v','rawvideo','-c:a','pcm_s16le','-f','null','-']);
  assert(!decode.stderr.trim(),'출력 전체 디코딩 검사에서 오류가 발생했습니다.');
  // Save actual subtitle frames for human layout inspection; this is not OCR or a readability guarantee.
  const stills=[];
  for(const t of props.tracks.slice(0,3)) {
    const line=t.captions[0]; if(!line) continue;
    const frame=t.from+Math.min(t.durationInFrames-1,Math.round((line.startMs+line.endMs)/2000*props.style.fps));
    const output=path.join(path.dirname(req.outputFile),`check-${t.id.slice(0,8)}.png`);
    await renderStill({composition,serveUrl,inputProps:props,frame,output,imageFormat:'png',browserExecutable}); stills.push(path.basename(output));
  }
  atomicJSON(path.join(path.dirname(req.outputFile),'render-verification.json'),{passed:true,expectedSeconds,actualSeconds:Number(metadata.format.duration),width:video.width,height:video.height,audioCodec:audio.codec_name,videoCodec:video.codec_name,fullDecode:true,stills,layoutManuallyVerified:false});
  emit('complete','MP4 출력과 디코딩 검사를 완료했습니다.',1);
} catch(error) { console.error(error.stack||error.message); process.exitCode=1; }
finally { if(assetServer){assetServer.closeAllConnections();await new Promise(resolve=>assetServer.close(resolve));} }

// This dedicated worker has completed all output verification and server cleanup.
process.exit(process.exitCode || 0);
