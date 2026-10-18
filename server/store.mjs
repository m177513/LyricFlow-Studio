import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError, assert, clone, now, hashFile, atomicJSON, readJSON, within, naturalCompare, AUDIO_EXT, IMAGE_EXT, DEFAULT_STYLE, validateStyle, parseLyrics, reconcileLines, validateLines, annotateTiming, validateMarkers} from './core.mjs';
import {probe} from './media.mjs';
import {migrateLegacyProject} from './legacy.mjs';
import {rememberFolder, resolveFolder} from './portable-paths.mjs';
import {validateGrid} from '../web/timeline-grid.js';

const HISTORY_LIMIT = 100;

function editableSnapshot(track) {
  return {
    title: track.title,
    imageName: track.imageName,
    instrumental: track.instrumental,
    sunoUrl: track.sunoUrl,
    sourceLyrics: track.sourceLyrics,
    markers: clone(track.markers || []),
    lines: clone(track.lines),
  };
}

function restoreEditableSnapshot(track, snapshot, durationMs) {
  const restored = annotateTiming(validateLines(snapshot.lines, durationMs));
  for (const key of ['title', 'imageName', 'instrumental', 'sunoUrl', 'sourceLyrics']) {
    if (snapshot[key] !== undefined) track[key] = snapshot[key];
  }
  track.lines = restored;
  track.markers = validateMarkers(snapshot.markers || [], durationMs);
  track.analysis = null;
}

export class Store {
  constructor(appRoot, notify = () => {}) { this.appRoot = appRoot; this.notify = notify; this.project = null; this.folder = null; }
  get stateDir() { assert(this.folder, '먼저 작업 폴더를 여세요.'); return path.join(this.folder, '.lyricflow-remotion'); }
  get file() { return path.join(this.stateDir, 'project.json'); }
  getTrack(id) { const t = this.project?.tracks.find(t => t.id === id); assert(t, '곡을 찾지 못했습니다.', 404); return t; }
  ensureRevision(revision) { assert(revision === this.project?.revision, '다른 변경이 먼저 저장되었습니다. 화면을 새로고침한 뒤 다시 적용해 주세요.', 409, 'revision_conflict'); }
  save() { this.project.revision++; this.project.updatedAt = now(); atomicJSON(this.file, this.project); this.notify('project', {revision: this.project.revision}); }
  publicProject() {
    if (!this.project) return null;
    return {...clone(this.project), folder: this.folder, outputFolder: path.join(this.stateDir, 'output')};
  }
  async open(folder, onProgress = () => {}) {
    assert(typeof folder === 'string' && folder.trim().length > 0, '작업 폴더 경로를 입력해 주세요.');
    folder = resolveFolder(this.appRoot, folder);
    assert(fs.existsSync(folder) && fs.statSync(folder).isDirectory(), '폴더가 존재하지 않습니다.');
    const resolved = fs.realpathSync(folder);
    const stateDir = path.join(resolved, '.lyricflow-remotion');
    if (fs.existsSync(stateDir)) within(resolved, stateDir);
    const file = path.join(stateDir, 'project.json');
    let project = readJSON(file);
    if (project) {
      assert(project.schemaVersion === 1 && Array.isArray(project.tracks), '지원하지 않는 프로젝트입니다. 원본을 보존했습니다.', 409);
    } else {
      const legacyFile = path.join(resolved, '.lyricflow', 'project.json');
      const legacy = readJSON(legacyFile);
      project = legacy
        ? migrateLegacyProject(legacy, {sourcePath: path.relative(resolved, legacyFile)})
        : null;
      if (!project) project = {schemaVersion: 1, appVersion: '0.2.0', id: randomUUID(), revision: 0, createdAt: now(), updatedAt: now(), style: {...DEFAULT_STYLE}, tracks: [], jobs: []};
      if (project.migration?.from === '0.1') {
        // 0.1 did not record byte hashes. Adopt the currently present bytes as the
        // first 0.2 snapshot without touching them, so the normal scan can still
        // invalidate the imported timings on every later audio change.
        for (const track of project.tracks) {
          const candidate = track.audio?.name ? path.join(resolved, track.audio.name) : null;
          if (!candidate || !fs.existsSync(candidate)) continue;
          try {
            const absolute = within(resolved, candidate); const stat = fs.statSync(absolute);
            track.audio.sha256 = await hashFile(absolute); track.audio.size = stat.size; track.audio.mtimeMs = stat.mtimeMs;
          } catch { /* The scan below records a user-visible error and preserves the source. */ }
        }
      }
    }
    for (const job of project.jobs) if (['running', 'queued'].includes(job.status)) { job.status = 'interrupted'; job.message = '이전 서버 실행이 종료되었습니다. 필요한 작업을 다시 실행해 주세요.'; }
    const names = fs.readdirSync(resolved).filter(name => {
      try { return fs.statSync(within(resolved, path.join(resolved, name))).isFile(); } catch { return false; }
    });
    const images = names.filter(n => IMAGE_EXT.has(path.extname(n).toLowerCase())).sort(naturalCompare);
    const audio = names.filter(n => AUDIO_EXT.has(path.extname(n).toLowerCase())).sort(naturalCompare);
    const globalImages = images.filter(n => /^(cover|thumbnail|background|bg|image)$/i.test(path.parse(n).name));
    const tracks = project.tracks;
    const found = new Set();
    for (let i = 0; i < audio.length; i++) {
      const name = audio[i]; onProgress({stage: 'scan', message: `음원 확인 ${i + 1}/${audio.length}: ${name}`});
      const absolute = within(resolved, path.join(resolved, name));
      const before = fs.statSync(absolute);
      try {
        const sha256 = await hashFile(absolute); const metadata = await probe(absolute); const after = fs.statSync(absolute);
        assert(before.size === after.size && before.mtimeMs === after.mtimeMs, '파일이 복사/수정 중입니다. 복사가 끝난 뒤 폴더를 다시 여세요.');
        let track = tracks.find(t => t.audio.name === name);
        if (!track) track = tracks.find(t => !found.has(t.id) && t.audio.sha256 === sha256 && !audio.includes(t.audio.name));
        if (!track) {
          track = {id: randomUUID(), title: path.parse(name).name, order: tracks.length, imageName: null, sourceLyrics: '', lines: [], markers: [], instrumental: false, sunoUrl: '', sunoMetadata: null, analysis: null, history: [], notes: []}; tracks.push(track);
        }
        if (!Array.isArray(track.markers)) track.markers = [];
        if (track.audio && track.audio.sha256 !== sha256) {
          track.history = [...(track.history || []), {at: now(), reason: 'audio_changed', lines: clone(track.lines)}].slice(-12);
          track.lines = reconcileLines([], track.lines.map(l => l.text)); track.analysis = null;
          delete track.timelineGrid;
          track.notes = ['음원이 변경되어 이전 타이밍을 현재 음원에 적용하지 않았습니다. 이전 값은 기록에 보존했습니다.'];
        }
        track.audio = {name, sha256, size: after.size, mtimeMs: after.mtimeMs, ...metadata};
        track.missing = false; track.scanError = null; found.add(track.id);
        if (!track.imageName || !images.includes(track.imageName)) {
          const exact = images.filter(n => path.parse(n).name.toLowerCase() === path.parse(name).name.toLowerCase());
          const candidates = exact.length ? exact : globalImages;
          track.imageName = candidates.length === 1 ? candidates[0] : null;
        }
      } catch (error) {
        let track = tracks.find(t => t.audio?.name === name);
        if (!track) { track = {id: randomUUID(), title: path.parse(name).name, order: tracks.length, audio: {name, sha256: '', durationMs: 0}, sourceLyrics: '', lines: [], markers: [], history: [], notes: [], instrumental: false, imageName: null}; tracks.push(track); }
        if (!Array.isArray(track.markers)) track.markers = [];
        track.scanError = error.message; track.missing = true; found.add(track.id);
      }
    }
    for (const t of tracks) { if (!Array.isArray(t.markers)) t.markers = []; if (!found.has(t.id)) t.missing = true; }
    this.folder = resolved; this.project = project; project.images = images;
    this.save();
    atomicJSON(path.join(this.appRoot, '.lyricflow-studio', 'last-project.json'), {folder: rememberFolder(this.appRoot, resolved)});
    return this.publicProject();
  }
  updateTrack(id, patch, revision) {
    this.ensureRevision(revision); const t = this.getTrack(id);
    assert(patch && typeof patch === 'object' && !Array.isArray(patch), '잘못된 곡 수정 요청입니다.');
    // Display preferences neither revalidate lyrics nor consume lyric undo history.
    if ('timelineGrid' in patch) {
      assert(Object.keys(patch).length === 1, '격자 설정은 별도로 저장하세요.');
      let grid;
      try { grid = validateGrid(patch.timelineGrid, t.audio.durationMs); }
      catch (error) { throw new AppError(error.message); }
      t.timelineGrid = grid; this.save(); return this.publicProject();
    }
    // Validate all values on a clone before committing; invalid requests must never mutate in-memory state.
    const next = clone(t);
    let editReason = 'edit';
    if ('title' in patch) { assert(typeof patch.title === 'string' && patch.title.length > 0 && patch.title.length <= 200, '제목은 1~200자여야 합니다.'); next.title = patch.title; }
    if ('imageName' in patch) { assert(patch.imageName === null || this.project.images.includes(patch.imageName), '등록된 이미지를 선택해 주세요.'); next.imageName = patch.imageName; }
    if ('instrumental' in patch) { assert(typeof patch.instrumental === 'boolean', '무보컬 설정이 잘못되었습니다.'); next.instrumental = patch.instrumental; }
    if ('sunoUrl' in patch) { assert(typeof patch.sunoUrl === 'string' && patch.sunoUrl.length < 3000, '곡 링크가 잘못되었습니다.'); next.sunoUrl = patch.sunoUrl; }
    if ('markers' in patch) { next.markers = validateMarkers(patch.markers, next.audio.durationMs); editReason = 'markers'; }
    if ('sourceLyrics' in patch) {
      const parsed = parseLyrics(patch.sourceLyrics);
      next.sourceLyrics = patch.sourceLyrics;
      next.lines = reconcileLines(next.lines, parsed);
      if (patch.sourceLyrics !== t.sourceLyrics) {
        next.analysis = null;
        next.lines = next.lines.map(l => ({...l, reviewed: false, flags: [...new Set([...l.flags, 'source_changed'])]}));
      }
    }
    if ('lineOp' in patch) {
      const op = patch.lineOp;
      assert(op && typeof op === 'object' && !Array.isArray(op), '잘못된 가사 편집 요청입니다.');
      assert(['copy', 'add', 'delete', 'ungroup', 'merge', 'split'].includes(op.action), '지원하지 않는 가사 편집입니다.');
      const position = op.position ?? 'after';
      assert(position === 'before' || position === 'after', '가사 삽입 위치가 잘못되었습니다.');
      const ids = op.lineIds === undefined ? (op.lineId == null ? [] : [op.lineId]) : op.lineIds;
      assert(Array.isArray(ids) && ids.length <= 600 && ids.every(value => typeof value === 'string') && new Set(ids).size === ids.length, '가사 편집 대상이 잘못되었습니다.');
      assert(op.action === 'add' ? ids.length <= 1 : ids.length > 0, '가사 편집 대상이 잘못되었습니다.');
      const located = ids.map(lineId => ({lineId, index: next.lines.findIndex(line => line.id === lineId)}));
      assert(located.every(value => value.index >= 0), '편집할 가사 줄을 찾지 못했습니다. 화면을 새로고침해 주세요.', 404);
      editReason = 'line_operation';
      if (op.action === 'delete') {
        next.lines = next.lines.filter(line => !ids.includes(line.id));
      } else if (op.action === 'add') {
        assert(ids.length === 1, '새 가사는 한 줄씩 추가해 주세요.');
        assert(typeof op.text === 'string' && op.text.trim().length > 0 && op.text.length <= 2000, '추가할 가사를 1~2,000자로 입력해 주세요.');
        const source = next.lines[located[0].index];
        const added = {
          id: randomUUID(), text: op.text.trim(), startMs: null, endMs: null,
          timestampMs: null, confidence: null, coverage: null, origin: 'manual',
          flags: ['manual_added'], locked: false, reviewed: false, excluded: false,
        };
        next.lines.splice(source ? located[0].index + (position === 'after' ? 1 : 0) : (position === 'before' ? 0 : next.lines.length), 0, added);
      } else if (op.action === 'copy') {
        const sources = located.sort((a, b) => a.index - b.index).map(value => next.lines[value.index]);
        const copyGroupId = randomUUID();
        const copies = sources.map((source, copyGroupIndex) => ({
          ...clone(source), id: randomUUID(), startMs: null, endMs: null,
          timestampMs: null, confidence: null, coverage: null, origin: 'manual',
          flags: ['manual_copy'], locked: false, reviewed: false, excluded: false,
          copyGroupId, copyGroupIndex, copyGroupSize: sources.length,
          copySourceId: source.id, copySourceStartMs: source.startMs, copySourceEndMs: source.endMs,
        }));
        const insertAt = position === 'before' ? located[0].index : located.at(-1).index + 1;
        next.lines.splice(insertAt, 0, ...copies);
      } else if (op.action === 'ungroup') {
        const selected = new Set(ids);
        next.lines = next.lines.map(line => {
          if (!selected.has(line.id) || !line.copyGroupId) return line;
          const flattened = {...line};
          for (const key of ['copyGroupId', 'copyGroupIndex', 'copyGroupSize', 'copySourceId', 'copySourceStartMs', 'copySourceEndMs']) delete flattened[key];
          if (flattened.startMs === null && Number.isFinite(line.copySourceStartMs) && Number.isFinite(line.copySourceEndMs) && line.copySourceEndMs > line.copySourceStartMs) {
            flattened.startMs = line.copySourceStartMs;
            flattened.endMs = line.copySourceEndMs;
            flattened.timestampMs = flattened.startMs;
            flattened.locked = false;
            flattened.reviewed = false;
          }
          return flattened;
        });
      } else if (op.action === 'split') {
        assert(ids.length === 1, '가사 분할은 한 줄씩 처리해 주세요.');
        assert(Number.isFinite(op.atMs), '분할 위치가 잘못되었습니다.');
        assert(typeof op.textA === 'string' && op.textA.trim() && typeof op.textB === 'string' && op.textB.trim(), '분할할 가사가 비어 있습니다.');
        const source = next.lines[located[0].index];
        assert(!source.excluded && !source.copyGroupId && Number.isFinite(source.startMs) && Number.isFinite(source.endMs) && op.atMs > source.startMs && op.atMs < source.endMs, '복사 그룹이 아닌 일반 가사 구간 안에서만 분할할 수 있습니다.');
        const first = {...source, text: op.textA.trim(), endMs: Math.round(op.atMs), timestampMs: source.startMs, origin: 'manual', locked: true, reviewed: false, flags: [...new Set([...(source.flags || []).filter(flag => flag !== 'unmatched'), 'manual_split'])]};
        const second = {...source, id: randomUUID(), text: op.textB.trim(), startMs: Math.round(op.atMs), endMs: source.endMs, timestampMs: Math.round(op.atMs), origin: 'manual', locked: true, reviewed: false, excluded: false, flags: ['manual_split']};
        next.lines.splice(located[0].index, 1, first, second);
      } else if (op.action === 'merge') {
        assert(ids.length >= 2, '두 줄 이상을 선택해 합쳐 주세요.');
        const ordered = located.sort((a, b) => a.index - b.index);
        assert(ordered.every((value, index) => index === 0 || value.index === ordered[index - 1].index + 1), '연속된 가사 줄만 합칠 수 있습니다.');
        const sources = ordered.map(value => next.lines[value.index]);
        assert(sources.every(line => !line.excluded && !line.copyGroupId && Number.isFinite(line.startMs) && Number.isFinite(line.endMs)), '시간이 지정된 일반 가사만 합칠 수 있습니다.');
        const first = sources[0];
        const merged = {...first, text: sources.map(line => line.text.trim()).join(' '), endMs: Math.max(...sources.map(line => line.endMs)), timestampMs: first.startMs, origin: 'manual', locked: true, reviewed: false, flags: [...new Set([...(first.flags || []).filter(flag => flag !== 'unmatched'), 'manual_merge'])], mergedFrom: sources.map(line => line.id)};
        next.lines.splice(ordered[0].index, sources.length, merged);
      }
    }
    if ('lines' in patch) {
      const known = new Map(next.lines.map(l => [l.id, l]));
      assert(Array.isArray(patch.lines), '잘못된 가사 수정 목록입니다.');
      const edits = new Map();
      for (const edit of patch.lines) {
        assert(known.has(edit.id) && !edits.has(edit.id), '수정할 가사 ID를 찾을 수 없거나 중복되었습니다.');
        const old = known.get(edit.id);
        const allowed = Object.fromEntries(Object.entries(edit).filter(([k]) => ['id','text','startMs','endMs','locked','reviewed','excluded'].includes(k)));
        const changed = ['text', 'startMs', 'endMs'].some(k => k in allowed && allowed[k] !== old[k]);
        const value = {...old, ...allowed};
        if (changed) {
          value.origin = 'manual'; value.locked = true; value.reviewed = false;
          // A copied/added line still needs an explicit listen-and-confirm step
          // after its timing is placed. Other automatic warning flags are cleared
          // because the user has just replaced that timing manually.
          value.flags = (value.flags || []).filter(flag => ['manual_copy', 'manual_added'].includes(flag));
        }
        if (edit.reviewed === true) value.reviewed = true;
        edits.set(edit.id, value);
      }
      next.lines = next.lines.map(l => edits.get(l.id) || l);
    }
    if ('lineOrder' in patch) {
      assert(Array.isArray(patch.lineOrder) && patch.lineOrder.length === next.lines.length && new Set(patch.lineOrder).size === patch.lineOrder.length, '가사 줄 순서가 잘못되었습니다.');
      const known = new Map(next.lines.map(line => [line.id, line]));
      assert(patch.lineOrder.every(id => known.has(id)), '가사 줄 순서에 알 수 없는 ID가 있습니다.');
      next.lines = patch.lineOrder.map(id => known.get(id));
    }
    next.lines = annotateTiming(validateLines(next.lines, next.audio.durationMs));
    next.history = [...(t.history || []), {at: now(), reason: editReason, ...editableSnapshot(t)}].slice(-HISTORY_LIMIT);
    // A new edit starts a new branch. Forward history must never reapply an
    // abandoned branch after the user changes the document again.
    next.redoHistory = [];
    Object.assign(t, next); this.save(); return this.publicProject();
  }
  undo(id, revision) {
    this.ensureRevision(revision); const t = this.getTrack(id); const previous = t.history?.at(-1);
    assert(previous, '되돌릴 수정 기록이 없습니다.');
    t.redoHistory = [...(t.redoHistory || []), {at: now(), reason: 'redo', ...editableSnapshot(t)}].slice(-HISTORY_LIMIT);
    t.history.pop();
    restoreEditableSnapshot(t, previous, t.audio.durationMs); this.save(); return this.publicProject();
  }
  redo(id, revision) {
    this.ensureRevision(revision); const t = this.getTrack(id); const next = t.redoHistory?.at(-1);
    assert(next, '앞으로 적용할 수정 기록이 없습니다.');
    t.history = [...(t.history || []), {at: now(), reason: 'undo', ...editableSnapshot(t)}].slice(-HISTORY_LIMIT);
    t.redoHistory.pop();
    restoreEditableSnapshot(t, next, t.audio.durationMs); this.save(); return this.publicProject();
  }
  updateStyle(style, revision) { this.ensureRevision(revision); this.project.style = validateStyle(style); this.save(); return this.publicProject(); }
  reorder(ids, revision) {
    this.ensureRevision(revision);
    assert(Array.isArray(ids) && ids.length === this.project.tracks.length && new Set(ids).size === ids.length && ids.every(id => this.project.tracks.some(t => t.id === id)), '곡 순서 목록이 잘못되었습니다.');
    this.project.tracks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)); this.project.tracks.forEach((t, i) => { t.order = i; }); this.save(); return this.publicProject();
  }
}
