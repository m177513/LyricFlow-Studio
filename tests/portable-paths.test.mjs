import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {rememberFolder, resolveFolder} from '../server/portable-paths.mjs';

test('saved folder survives portable disk drive changes', () => {
  const saved = rememberFolder('G:/workspace/demo-project/LyricFlow-Studio', 'G:/demo-music/sample-playlist', path.win32);
  assert.equal(path.win32.isAbsolute(saved), false);
  assert.equal(resolveFolder('Q:/workspace/demo-project/LyricFlow-Studio', saved, path.win32), 'Q:\\demo-music\\sample-playlist');
  assert.equal(resolveFolder('R:/workspace/demo-project/LyricFlow-Studio', saved, path.win32), 'R:\\demo-music\\sample-playlist');
});

test('workspace child paths and folders on a different disk retain their meaning', () => {
  const app = 'Q:/workspace/demo-project/LyricFlow-Studio';
  assert.equal(resolveFolder(app, '../input/검증곡 D', path.win32), 'Q:\\workspace\\demo-project\\input\\검증곡 D');
  assert.equal(rememberFolder(app, 'C:/Music', path.win32), 'C:/Music');
  assert.equal(resolveFolder(app, 'C:/Music', path.win32), 'C:\\Music');
  assert.equal(resolveFolder(app, '', path.win32), '');
});
