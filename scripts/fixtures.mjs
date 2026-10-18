import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function wav(file, seconds=4, frequency=330) {
  const rate=16000, samples=Math.round(seconds*rate), bytes=samples*2;
  const buffer=Buffer.alloc(44+bytes);buffer.write('RIFF',0);buffer.writeUInt32LE(36+bytes,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*2,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(bytes,40);
  for(let i=0;i<samples;i++){const t=i/rate;const gate=(t%3>.3&&t%3<1.6)?Math.sin(Math.PI*(t%3-.3)/1.3)**2:0;buffer.writeInt16LE(Math.round(750*Math.sin(2*Math.PI*frequency*t)*gate),44+i*2);}
  fs.writeFileSync(file,buffer);
}
function crc32(buffer){let c=0xffffffff;for(const b of buffer){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const n=Buffer.alloc(4);n.writeUInt32BE(data.length);const code=Buffer.from(type);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([code,data])));return Buffer.concat([n,code,data,crc]);}
export function cover(file,width=1280,height=720,variant=0){
 const raw=Buffer.alloc((width*3+1)*height);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const nx=x/width,ny=y/height,d=Math.hypot((nx-.69)*1.35,ny-.42),ring=(d>.11&&d<.36),glow=Math.max(0,1-d/.7);
  const color=variant?[18+glow*38,22+glow*36,34+glow*53]:[15+glow*25,27+glow*38,25+glow*29];
  const band=ring?(Math.sin(d*170)>0?.86:1.05):1;
  const at=y*(width*3+1)+1+x*3;for(let c=0;c<3;c++)raw[at+c]=Math.min(255,Math.round(color[c]*band));
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
export function basicFolder(folder){fs.mkdirSync(folder,{recursive:true});wav(path.join(folder,'01 - test.wav'));cover(path.join(folder,'cover.png'),320,180);}
