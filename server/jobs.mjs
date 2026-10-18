import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assert, clone, now, atomicJSON, readJSON, hashFile, within, alignmentKey, textFingerprint, mergeAlignment, parseLyrics, reconcileLines, validateLines, toSrt, sanitizeName, playlistSchedule, renderProblems} from './core.mjs';
import {run, python, ffmpeg} from './media.mjs';
import {makeShortProps} from './shorts.mjs';
import {fetchSuno, validateSunoUrl} from './suno.mjs';

export function makeVideoProps(tracks, style, assetUrl) {
  return {style, tracks: playlistSchedule(tracks.map(t => ({
    id: t.id, title: t.title, durationMs: t.audio.durationMs,
    audioUrl: assetUrl(t, 'audio'), imageUrl: t.imageName ? assetUrl(t, 'image') : null,
    captions: t.instrumental ? [] : t.lines.filter(l => !l.excluded && l.startMs !== null && l.endMs !== null).map(l => ({
      text: l.text, startMs: l.startMs, endMs: l.endMs, timestampMs: l.startMs, confidence: null,
    })),
  })), style.fps)};
}
export class JobQueue {
  constructor(store, notify, {singleTrackRender = null} = {}) {
    // Trusted launcher configuration only; never accept executable paths from HTTP job settings.
    if (singleTrackRender) {
      for (const name of ['worker', 'binariesDirectory']) assert(typeof singleTrackRender[name] === 'string' && path.isAbsolute(singleTrackRender[name]), '렌더 실행 경로는 절대 경로여야 합니다.');
      assert(fs.statSync(singleTrackRender.worker).isFile() && fs.statSync(singleTrackRender.binariesDirectory).isDirectory(), '렌더 실행 파일 또는 바이너리 폴더가 없습니다.');
    }
    this.singleTrackRender = singleTrackRender ? {...singleTrackRender} : null;
    this.store = store; this.notify = notify; this.running = false; this.controller = null; this.activeId = null; this.tasks = [];
  }
  busy() { return this.running || this.tasks.length > 0; }
  enqueue(type, ids, settings = {}) {
    const store = this.store;
    assert(store.project, '먼저 작업 폴더를 여세요.');
    assert(['align','suno','render','playlist','shorts'].includes(type), '지원하지 않는 작업입니다.');
    assert(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, '곡을 선택해 주세요.');
    assert(type === 'playlist' || ids.length === 1, '개별 작업은 한 곡씩 등록합니다.');
    const tracks = ids.map(id => clone(store.getTrack(id)));
    if (['render', 'playlist', 'shorts'].includes(type)) {
      for (const t of tracks) assert(renderProblems(t).length === 0, `${t.title}: ${renderProblems(t).join(' ')}`, 422);
    }
    if (type === 'shorts') makeShortProps(tracks[0], store.project.style, () => '', settings);
    if (type === 'align') {
      settings = {audioSource: 'vocals', retryMissing: true, ...settings};
      assert(['vocals', 'original'].includes(settings.audioSource), '지원하지 않는 분석 음원입니다.');
      assert(typeof settings.retryMissing === 'boolean', '누락 재시도 설정이 잘못되었습니다.');
      assert(!tracks[0].missing && !tracks[0].instrumental && tracks[0].lines.length > 0, '가사가 있는 보컬 곡을 선택해 주세요.');
      assert(['tiny', 'base', 'small', 'medium', 'large-v3'].includes(settings.model), '지원하지 않는 모델입니다.');
      assert(['cpu', 'cuda', 'auto'].includes(settings.device), '지원하지 않는 장치입니다.');
      assert(['anchors', 'hybrid'].includes(settings.engine), '지원하지 않는 정렬 방식입니다.');
      assert(['ko','en','ja','fr','es','pt',''].includes(settings.language), '지원하지 않는 언어입니다.');
      // Repeated clicks must not enqueue the same expensive task indefinitely.
      assert(!store.project.jobs.some(j => ['queued','running'].includes(j.status) && j.type === type && j.trackIds[0] === ids[0]), '이미 처리 대기 또는 진행 중인 곡입니다.', 409);
    }
    if (type === 'suno') validateSunoUrl(tracks[0].sunoUrl);
    const job = {id: randomUUID(), type, trackIds: ids, title: tracks.map(t => t.title).join(' / '), status: 'queued', stage: 'queued', message: '대기 중', createdAt: now(), progress: null, outputs: [], log: []};
    store.project.jobs = [...store.project.jobs.slice(-79), job];
    this.tasks.push({job, tracks, settings: clone(settings), style: clone(store.project.style)});
    store.save(); this.notify('jobs', {});
    setImmediate(() => this.drain()); return clone(job);
  }
  update(job, values) {
    Object.assign(job, values); job.updatedAt = now();
    if (values.message) job.log = [...job.log.slice(-59), {at: now(), stage: job.stage, message: values.message}];
    // Persist status independently of content revisions so progress cannot cause edit conflicts.
    atomicJSON(this.store.file, this.store.project); this.notify('jobs', {jobId: job.id});
  }
  cancel(id) {
    const job = this.store.project?.jobs.find(j => j.id === id); assert(job, '작업을 찾을 수 없습니다.', 404);
    if (id === this.activeId) { this.controller?.abort(); return; }
    this.tasks = this.tasks.filter(t => t.job.id !== id);
    if (job.status === 'queued') this.update(job, {status: 'cancelled', message: '작업을 취소했습니다.'});
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.tasks.length) {
        const task = this.tasks.shift(); const {job} = task;
        this.controller = new AbortController(); this.activeId = job.id;
        this.update(job, {status: 'running', stage: 'starting', message: '작업 시작'});
        try {
          if (job.type === 'align') await this.align(task, this.controller.signal);
          else if (job.type === 'suno') await this.suno(task, this.controller.signal);
          else await this.render(task, this.controller.signal);
          assert(!this.controller.signal.aborted, '작업을 취소했습니다.', 409, 'cancelled');
          this.update(job, {status: 'completed', stage: 'complete', message: '완료', completedAt: now()});
        } catch (error) {
          this.update(job, {status: error.code === 'cancelled' || this.controller.signal.aborted ? 'cancelled' : 'failed', stage: 'error', message: String(error.message).slice(-16000), errorCode: error.code || 'failed'});
        } finally { this.activeId = null; this.controller = null; }
      }
    } finally { this.running = false; }
  }
  async checkAudio(track) {
    const file = within(this.store.folder, path.join(this.store.folder, track.audio.name));
    assert(await hashFile(file) === track.audio.sha256, '음원이 변경되었습니다. 폴더를 다시 불러와 주세요.', 409, 'audio_changed');
    return file;
  }
  async align({job, tracks, settings}, signal) {
    const track = tracks[0]; const originalFingerprint = textFingerprint(track); const store = this.store;
    const audioPath = await this.checkAudio(track);
    const diagnose = await run(python(store.appRoot), [path.join(store.appRoot, 'worker', 'align.py'), '--diagnose'], {signal, timeoutMs: 15000});
    const environment = JSON.parse(diagnose.stdout);
    const cacheSettings = {...settings, environment};
    const key = alignmentKey(track, cacheSettings);
    const cacheDir = path.join(store.stateDir, 'cache', track.audio.sha256);
    const outputFile = path.join(cacheDir, `aligned-${key}.json`);
    if (!fs.existsSync(outputFile)) {
      const requestFile = path.join(cacheDir, `request-${job.id}.json`);
      atomicJSON(requestFile, {audioPath, audioSha256: track.audio.sha256, durationMs: track.audio.durationMs,
        lines: track.lines, settings, cacheDir, outputFile, ffmpeg: ffmpeg()});
      await run(python(store.appRoot), [path.join(store.appRoot, 'worker', 'align.py'), requestFile], {
        cwd: store.appRoot, signal, onLine: line => {
          if (!line.startsWith('@@LYRICFLOW@@')) return;
          try { const event = JSON.parse(line.slice(13)); this.update(job, {stage: event.stage, message: event.message}); }
          catch { /* Third-party stdout is not interpreted as a status event. */ }
        },
      });
    } else this.update(job, {stage: 'cache', message: '동일 음원·가사·모델의 정렬 결과를 재사용합니다.'});
    assert(!signal.aborted, '작업을 취소했습니다.', 409, 'cancelled');
    const result = readJSON(outputFile); assert(result?.lines?.length === track.lines.length, '정렬 결과 형식이 일치하지 않습니다.', 500);
    // Cached results need the same final disk check as a freshly run worker.
    await this.checkAudio(track);
    const current = store.getTrack(track.id);
    assert(textFingerprint(current) === originalFingerprint, '처리 중 가사 또는 음원이 바뀌어 결과를 적용하지 않았습니다. 새 입력으로 다시 분석해 주세요.', 409, 'stale_result');
    current.history = [...(current.history || []), {at: now(), reason: 'alignment', sourceLyrics: current.sourceLyrics, lines: clone(current.lines)}].slice(-12);
    const mapped = result.lines.map((l, i) => ({...l, id: current.lines[i].id, text: current.lines[i].text, locked: false, reviewed: false}));
    current.lines = validateLines(mergeAlignment(current.lines, mapped), current.audio.durationMs);
    current.analysis = {at: now(), model: result.model, device: result.actualDevice, engine: result.engine, audioSource: result.audioSource, selectedSource: result.selectedSource, retryMissing: result.retryMissing, environment: result.environment, cacheKey: key, evidence: result.evidence, outputFile: path.basename(outputFile)};
    store.save(); this.update(job, {message: `${current.lines.filter(l => l.flags.length && !l.reviewed).length}줄 검수 필요`});
  }
  async suno({job, tracks}, signal) {
    const track = tracks[0]; const store = this.store;
    this.update(job, {stage: 'suno', message: 'Suno 공개 페이지에서 원문을 찾습니다.'});
    const data = await fetchSuno(track.sunoUrl);
    assert(!signal.aborted, '작업을 취소했습니다.', 409, 'cancelled');
    const current = store.getTrack(track.id);
    assert(current.sourceLyrics === track.sourceLyrics && current.sunoUrl === track.sunoUrl, '가사 또는 링크가 변경되어 가져온 결과를 덮어쓰지 않았습니다.', 409, 'stale_result');
    current.history = [...(current.history || []), {at: now(), reason: 'suno', sourceLyrics: current.sourceLyrics, lines: clone(current.lines)}].slice(-12);
    current.sourceLyrics = data.lyrics; current.lines = reconcileLines(current.lines, parseLyrics(data.lyrics));
    current.lines.forEach(l => { l.reviewed = false; l.flags = [...new Set([...l.flags, 'source_changed'])]; });
    current.sunoMetadata = {...data, fetchedAt: now()}; current.analysis = null;
    current.notes = [];
    if (data.duration && Math.abs(data.duration * 1000 - current.audio.durationMs) > 2500) current.notes.push('Suno 곡 길이와 로컬 음원 길이가 다릅니다. 버전·트리밍 여부를 확인해 주세요.');
    if (data.title && !current.title.toLowerCase().includes(data.title.toLowerCase())) current.notes.push(`Suno 제목: ${data.title} — 파일명과 같은 곡인지 확인해 주세요.`);
    store.save();
  }
  async render({job, tracks, style, settings}, signal) {
    const store = this.store;
    const outputDir = path.join(store.stateDir, 'output', `${now().replace(/[:.]/g, '-')}_${job.id.slice(0,8)}`);
    const assetsDir = path.join(outputDir, 'assets'); fs.mkdirSync(assetsDir, {recursive: true});
    this.update(job, {stage: 'snapshot', message: '렌더링 입력과 수정값을 고정합니다.'});
    const mapped = [];
    for (const track of tracks) {
      const original = await this.checkAudio(track);
      const audioFile = `${track.id}${path.extname(track.audio.name)}`;
      const imageFile = `${track.id}-cover${path.extname(track.imageName)}`;
      fs.copyFileSync(original, path.join(assetsDir, audioFile));
      assert(await hashFile(path.join(assetsDir, audioFile)) === track.audio.sha256, '복사 중 음원이 변경되었습니다.', 409);
      const image = within(store.folder, path.join(store.folder, track.imageName));
      const imageHash = await hashFile(image); fs.copyFileSync(image, path.join(assetsDir, imageFile));
      assert(await hashFile(path.join(assetsDir, imageFile)) === imageHash, '복사 중 이미지가 변경되었습니다.', 409);
      mapped.push({...track, renderAudio: audioFile, renderImage: imageFile});
    }
    const asset = (t, kind) => kind === 'audio' ? t.renderAudio : t.renderImage;
    const props = job.type === 'shorts' ? makeShortProps(mapped[0], style, asset, settings) : makeVideoProps(mapped, style, asset);
    const base = sanitizeName(job.type === 'playlist' ? 'playlist' : tracks[0].title + (job.type === 'shorts' ? '-shorts' : ''));
    const movie = path.join(outputDir, `${base}.mp4`);
    const requestFile = path.join(outputDir, 'render-input.json');
    const runtime = ['render','shorts'].includes(job.type) && tracks.length === 1 ? this.singleTrackRender : null;
    const worker = job.type === 'shorts' ? path.join(store.appRoot, 'worker', 'render.mjs') : runtime?.worker;
    atomicJSON(requestFile, {props, assetsDir, outputFile: movie, appRoot: store.appRoot, browserExecutable: process.env.LYRICFLOW_CHROME || null, ...(runtime ? {binariesDirectory: runtime.binariesDirectory} : {})});
    await run(process.execPath, [worker || path.join(store.appRoot, 'worker', 'render.mjs'), requestFile], {
      cwd: store.appRoot, signal, onLine: line => {
        if (!line.startsWith('@@LYRICFLOW@@')) return;
        try { const event = JSON.parse(line.slice(13)); this.update(job, {stage: event.stage, message: event.message, progress: event.progress ?? null}); } catch { /* Ignore library output. */ }
      },
    });
    assert(!signal.aborted, '작업을 취소했습니다.', 409, 'cancelled');
    const report = readJSON(path.join(outputDir, 'render-verification.json'));
    assert(report?.passed && fs.statSync(movie).size > 0, '출력 검증에 실패했습니다.', 500);
    const combined = [];
    for (const [i, item] of props.tracks.entries()) {
      const offsetMs = item.from / style.fps * 1000;
      for (const line of item.captions) combined.push({...line, startMs: line.startMs + offsetMs, endMs: line.endMs + offsetMs});
      if (job.type === 'playlist') fs.writeFileSync(path.join(outputDir, `${String(i+1).padStart(2,'0')}-${sanitizeName(item.title)}.srt`), toSrt(item.captions), 'utf8');
    }
    fs.writeFileSync(path.join(outputDir, `${base}.srt`), toSrt(combined), 'utf8');
    if (job.type === 'playlist') {
      const chapters = props.tracks.map(t => {
        const seconds = Math.floor(t.from / style.fps); const minutes = Math.floor(seconds / 60);
        const timestamp = minutes >= 60 ? `${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}` : `${String(minutes).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
        return `${timestamp} ${t.title}`;
      }).join('\n');
      fs.writeFileSync(path.join(outputDir, 'youtube-chapters.txt'), chapters, 'utf8');
    }
    job.outputs = fs.readdirSync(outputDir).filter(n => /\.(mp4|srt|txt)$/.test(n)).map(name => ({name, relative: path.relative(store.stateDir, path.join(outputDir, name))}));
    // Keep derived snapshots for reproducibility. Originals are never modified.
    // Users can remove a whole versioned output directory after keeping its final MP4/SRT.
  }
}
