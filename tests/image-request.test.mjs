import test from 'node:test';
import assert from 'node:assert/strict';
import {imageRequest} from '../server/image-request.mjs';
const project = {tracks:[{id:'a',title:'검증곡 B',imageName:null,audio:{name:'a.wav'},sourceLyrics:'설명용 테스트 문장'}, {id:'b',title:'기존 곡',imageName:'cover.png',audio:{name:'b.wav'},sourceLyrics:'보존'}]};
test('missing-image request preserves title and lyrics and excludes existing covers', () => {
  const before = JSON.stringify(project), text = imageRequest(project);
  assert.match(text,/검증곡 B/); assert.match(text,/설명용 테스트 문장/);
  assert.match(text,/16:9/); assert.match(text,/하단 35%/);
  assert.doesNotMatch(text,/기존 곡/); assert.equal(JSON.stringify(project),before);
});
test('explicit selection can request a version without replacing the current image', () => {
  assert.match(imageRequest(project,'b'),/cover.png/);
  assert.throws(()=>imageRequest(project,'missing'));
  assert.throws(()=>imageRequest({tracks:[project.tracks[1]]}));
});
