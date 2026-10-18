import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Store} from '../server/store.mjs';
import {ffmpeg, run, sendFile} from '../server/media.mjs';

test('WebM Opus imports, preserves bytes, and streams with range support', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lyricflow-webm-'));
  const file = path.join(folder, '01 - 테스트.WEBM');
  let server;
  try {
    await run(ffmpeg(), ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libopus',file]);
    const original = fs.readFileSync(file);
    const appRoot = path.join(folder, 'app'); fs.mkdirSync(appRoot);
    const store = new Store(appRoot); await store.open(folder);
    assert.equal(store.project.tracks.length, 1);
    const track = store.project.tracks[0];
    assert.equal(track.scanError, null);
    assert.equal(track.audio.sampleRate, 48000);
    assert.ok(track.audio.durationMs >= 1000 && track.audio.durationMs < 1100);
    assert.deepEqual(fs.readFileSync(file), original);
    server = http.createServer((req,res) => sendFile(req,res,file,{root:folder}));
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`,{headers:{Range:'bytes=0-31'}});
    assert.equal(response.status,206);
    assert.equal(response.headers.get('content-type'),'audio/webm');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),original.subarray(0,32));
  } finally {
    if(server) {server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));}
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
