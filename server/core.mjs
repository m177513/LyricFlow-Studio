import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message); this.status = status; this.code = code;
  }
}
export function assert(condition, message, status = 400, code) {
  if (!condition) throw new AppError(message, status, code);
}
export const clone = (v) => structuredClone(v);
export const now = () => new Date().toISOString();
export const digest = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
export async function hashFile(file) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
export function atomicJSON(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8'); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function readJSON(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw new AppError(`JSON 파일을 읽을 수 없습니다. 원본을 보존했습니다: ${file}`, 500, 'invalid_json'); }
}
export function within(root, candidate) {
  const base = fs.realpathSync(root);
  const actual = fs.realpathSync(candidate);
  const rel = path.relative(base, actual);
  assert(rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)), '등록 폴더 밖의 파일에는 접근할 수 없습니다.', 403);
  return actual;
}
export const naturalCompare = (a, b) => a.localeCompare(b, 'ko', {numeric: true, sensitivity: 'base'});
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.webm']);
export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const DEFAULT_STYLE = Object.freeze({
  width: 1920, height: 1080, fps: 30, fontSize: 58, bottomPercent: 12,
  color: '#ffffff', stroke: 3, lineHeight: 1.35, dim: 0.22,
  fit: 'contain', showTitle: false, nextLine: false,
});
export function validateStyle(value = {}) {
  const s = {...DEFAULT_STYLE, ...value};
  for (const [k, lo, hi] of [['fontSize', 24, 120], ['bottomPercent', 3, 70], ['stroke', 0, 8], ['lineHeight', 1, 2], ['dim', 0, 0.85]]) {
    assert(typeof s[k] === 'number' && Number.isFinite(s[k]) && s[k] >= lo && s[k] <= hi, `잘못된 화면 설정: ${k}`);
  }
  assert([1920, 1280].includes(s.width) && s.height === s.width * 9 / 16, '출력 크기는 1920×1080 또는 1280×720입니다.');
  assert([24, 30, 60].includes(s.fps), '지원하지 않는 프레임 수입니다.');
  assert(/^#[\da-f]{6}$/i.test(s.color), '색상은 #RRGGBB 형식이어야 합니다.');
  assert(['contain', 'cover'].includes(s.fit), '이미지 맞춤 방식이 잘못되었습니다.');
  assert(typeof s.showTitle === 'boolean' && typeof s.nextLine === 'boolean', '표시 옵션이 잘못되었습니다.');
  return Object.fromEntries(Object.keys(DEFAULT_STYLE).map(k => [k, s[k]]));
}
export function parseLyrics(source) {
  assert(typeof source === 'string' && source.length <= 60000, '가사는 60,000자 이내여야 합니다.');
  const sectionWord = '(?:verse|chorus|pre[- ]?chorus|bridge|hook|intro|outro|interlude|instrumental|refrain|drop|break|벌스|후렴|브릿지|인트로|아웃트로|간주)';
  const sectionLabel = new RegExp(`^\\s*(?:[\\[(【][^\\]\\)】]*${sectionWord}[^\\]\\)】]*[\\]\\)】]|${sectionWord}\\s*\\d*)\\s*$`, 'iu');
  const leadingSection = new RegExp(`^\\s*[\\[(【][^\\]\\)】]*${sectionWord}[^\\]\\)】]*[\\]\\)】]\\s*`, 'iu');
  const timestampPrefix = /^\s*(?:\[?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\]?\s*)+/u;
  const productionLabel = /^\s*[\[(【]\s*(?:vocal\b|guitar\s+solo\b|solo\b|spoken\b|rap\b|ad[- ]?libs?\b|backing\b|harmony\b)[^\]\)】]*[\]\)】]\s*$/iu;
  return source.replace(/\r\n?/g, '\n').replace(/\[[^\]]*\]/g, '').split('\n').flatMap(rawLine => {
    let line = rawLine.trim();
    if (!line || sectionLabel.test(line) || productionLabel.test(line)) return [];
    line = line.replace(leadingSection, '').replace(timestampPrefix, '').trim();
    return line && !sectionLabel.test(line) && !productionLabel.test(line) ? [line] : [];
  });
}
// Occurrence-aware LCS: duplicate hooks keep separate IDs, and unchanged manual lines survive source edits.
export function reconcileLines(oldLines, texts) {
  assert(texts.length <= 600, '가사는 최대 600줄까지 지원합니다.');
  const a = oldLines, b = texts;
  const dp = Array.from({length: a.length + 1}, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    dp[i][j] = a[i].text === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const found = new Map();
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].text === b[j]) { found.set(j, a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return texts.map((text, n) => found.has(n) ? clone(found.get(n)) : {
    id: randomUUID(), text, startMs: null, endMs: null, timestampMs: null,
    confidence: null, coverage: null, origin: 'unmatched', flags: ['unmatched'],
    locked: false, reviewed: false,
  });
}
export function validateLines(lines, durationMs) {
  assert(Array.isArray(lines) && lines.length <= 600, '잘못된 가사 목록입니다.');
  const ids = new Set();
  return lines.map(line => {
    assert(typeof line.id === 'string' && !ids.has(line.id), '가사 ID가 중복되었습니다.'); ids.add(line.id);
    assert(typeof line.text === 'string' && line.text.trim().length > 0 && line.text.length <= 2000, '빈 가사 또는 너무 긴 가사입니다.');
    const empty = line.startMs === null && line.endMs === null;
    assert(empty || (Number.isFinite(line.startMs) && Number.isFinite(line.endMs) && line.startMs >= 0 && line.endMs > line.startMs && line.endMs <= durationMs), '자막 시작·종료 시간이 음원 범위에 맞지 않습니다.');
    assert(typeof line.locked === 'boolean' && typeof line.reviewed === 'boolean', '가사 잠금/검수 설정이 잘못되었습니다.');
    assert(line.excluded === undefined || typeof line.excluded === 'boolean', '가사 제외 설정이 잘못되었습니다.');
    return {...clone(line), timestampMs: line.startMs, confidence: null};
  });
}
export function validateMarkers(markers = [], durationMs = Infinity) {
  assert(Array.isArray(markers) && markers.length <= 500, '마커는 최대 500개까지 지원합니다.');
  const ids = new Set();
  const out = markers.map(marker => {
    assert(marker && typeof marker === 'object' && !Array.isArray(marker), '잘못된 마커입니다.');
    assert(typeof marker.id === 'string' && marker.id.length > 0 && !ids.has(marker.id), '마커 ID가 중복되었습니다.');
    ids.add(marker.id);
    assert(Number.isFinite(marker.atMs) && marker.atMs >= 0 && marker.atMs <= durationMs, '마커 위치가 음원 범위를 벗어났습니다.');
    assert(typeof marker.label === 'string' && marker.label.trim().length > 0 && marker.label.length <= 120, '마커 이름은 1~120자여야 합니다.');
    return {id: marker.id, atMs: Math.round(marker.atMs), label: marker.label.trim()};
  });
  return out.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
}
export function annotateTiming(lines) {
  const out = clone(lines);
  let previous = null;
  for (const line of out) {
    line.flags = [...new Set((line.flags ?? []).filter(f => !['overlap', 'order', 'long', 'short', 'unmatched'].includes(f)))];
    if (line.excluded) continue;
    if (line.startMs === null || line.endMs === null) { line.flags.push('unmatched'); continue; }
    if (line.endMs - line.startMs > 14000) line.flags.push('long');
    if (line.endMs - line.startMs < 200) line.flags.push('short');
    if (previous) {
      if (line.startMs < previous.startMs) line.flags.push('order');
      if (line.startMs < previous.endMs) { line.flags.push('overlap'); previous.flags.push('overlap'); }
    }
    previous = line;
  }
  return out;
}
export function mergeAlignment(current, aligned) {
  const byId = new Map(aligned.map(l => [l.id, l]));
  return annotateTiming(current.map(line => {
    if (line.locked || line.reviewed || line.excluded || line.flags?.some(flag => ['manual_copy', 'manual_added'].includes(flag))) return clone(line);
    const next = byId.get(line.id);
    return next ? {...line, ...next, excluded: Boolean(line.excluded), text: line.text, id: line.id, locked: false, reviewed: false, confidence: null} : line;
  }));
}
export function textFingerprint(track) {
  return digest({audio: track.audio.sha256, lines: track.lines.map(l => ({id: l.id, text: l.text})), instrumental: track.instrumental});
}
export function alignmentKey(track, settings) {
  return digest({version: 4, algorithm: 'vocals-retry-v4', audio: track.audio.sha256, texts: track.lines.map(l => l.text), settings});
}
export function sanitizeName(value) {
  return String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'track';
}
export function srtTime(ms) {
  const n = Math.max(0, Math.round(ms));
  return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')},${String(n % 1000).padStart(3, '0')}`;
}
export function toSrt(lines, offsetMs = 0) {
  return lines.filter(l => !l.excluded && l.startMs !== null && l.endMs !== null).map((l, i) =>
    `${i + 1}\n${srtTime(l.startMs + offsetMs)} --> ${srtTime(l.endMs + offsetMs)}\n${l.text}\n`).join('\n');
}
export function playlistSchedule(tracks, fps) {
  let from = 0;
  return tracks.map(track => {
    const durationInFrames = Math.max(1, Math.ceil(track.durationMs / 1000 * fps));
    const scheduled = {...track, from, durationInFrames}; from += durationInFrames; return scheduled;
  });
}
export function renderProblems(track) {
  if (track.missing) return ['음원 파일이 없습니다.'];
  if (!track.imageName) return ['이미지를 연결해 주세요.'];
  if (track.instrumental) return [];
  if (!track.lines.length) return ['가사를 입력하거나 무보컬 곡으로 지정해 주세요.'];
  const problems = [];
  const lines = track.lines.filter(l => !l.excluded);
  if (lines.some(l => l.startMs === null || l.endMs === null)) problems.push('시간이 없는 가사 줄이 있습니다. 시간을 지정하거나 해당 줄을 제외해 주세요.');
  if (lines.some(l => l.flags.some(f => ['order', 'overlap'].includes(f)))) problems.push('자막 순서 역전 또는 겹침을 수정해 주세요.');
  if (lines.some(l => l.flags.length && !l.reviewed)) problems.push('검수하지 않은 의심 구간이 있습니다.');
  return problems;
}
