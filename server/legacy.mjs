import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AUDIO_EXT, DEFAULT_STYLE, parseLyrics, reconcileLines, validateStyle} from './core.mjs';

const AUDIO_EXTENSIONS = AUDIO_EXT;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const SECTIONAL_SOURCES = new Set(['matched', 'partial', 'manual']);

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function normalized(text) {
  return String(text ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function topLevelFile(value, extensions) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalizedPath = value.replaceAll('\\', '/').trim();
  if (path.posix.isAbsolute(normalizedPath) || normalizedPath.split('/').length !== 1) return null;
  const name = path.basename(normalizedPath);
  return extensions.has(path.extname(name).toLowerCase()) ? name : null;
}

function titleFromAudio(name, fallback) {
  const stem = path.parse(name).name;
  const title = stem.replace(/^\s*\d+\s*[-_. )]+\s*/, '').trim();
  return String(fallback ?? '').trim() || title || stem;
}

function timingOf(subtitle, durationMs) {
  if (!subtitle || !SECTIONAL_SOURCES.has(String(subtitle.source ?? '').toLowerCase())) return null;
  const start = number(subtitle.start);
  const end = number(subtitle.end);
  if (start === null || end === null || start < 0 || end <= start) return null;
  const startMs = Math.round(start * 1000);
  const endMs = Math.round(end * 1000);
  if (durationMs > 0 && endMs > durationMs) return null;
  return {startMs, endMs};
}

function oldSubtitleFor(text, index, subtitles) {
  const direct = subtitles[index];
  if (direct && normalized(direct.text) === normalized(text)) return direct;
  const wanted = normalized(text);
  if (!wanted) return null;
  for (let i = index; i < subtitles.length; i++) {
    if (normalized(subtitles[i]?.text) === wanted) return subtitles[i];
  }
  return null;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

export function migrateLegacyStyle(settings = {}) {
  const style = {...DEFAULT_STYLE};
  if ([1280, 1920].includes(Number(settings.width)) && Number(settings.height) === Number(settings.width) * 9 / 16) {
    style.width = Number(settings.width);
    style.height = Number(settings.height);
  }
  if ([24, 30, 60].includes(Number(settings.fps))) style.fps = Number(settings.fps);
  if (number(settings.lyric_font_size) !== null) style.fontSize = clamp(Number(settings.lyric_font_size), 24, 120);
  if (typeof settings.lyric_text_color === 'string' && /^#[\da-f]{6}$/i.test(settings.lyric_text_color)) style.color = settings.lyric_text_color;
  if (number(settings.lyric_margin_v) !== null) style.bottomPercent = clamp(Number(settings.lyric_margin_v) / style.height * 100, 3, 70);
  if (typeof settings.show_title === 'boolean') style.showTitle = settings.show_title;
  if (typeof settings.show_next_line === 'boolean') style.nextLine = settings.show_next_line;
  return validateStyle(style);
}

function migrateTrack(legacyTrack, index, imageName) {
  const audioName = topLevelFile(legacyTrack?.audio_file, AUDIO_EXTENSIONS);
  if (!audioName) return null;
  const sourceLyrics = typeof legacyTrack.lyrics === 'string' ? legacyTrack.lyrics : '';
  const displayLines = parseLyrics(sourceLyrics);
  const baseLines = reconcileLines([], displayLines);
  const durationMs = Math.max(0, Math.round((number(legacyTrack.duration) ?? 0) * 1000));
  const subtitles = Array.isArray(legacyTrack.subtitles) ? legacyTrack.subtitles : [];
  let unresolved = 0;
  let carried = 0;
  const lines = baseLines.map((line, lineIndex) => {
    const old = oldSubtitleFor(line.text, lineIndex, subtitles);
    const source = String(old?.source ?? '').toLowerCase();
    const timing = timingOf(old, durationMs);
    if (timing) carried++;
    if (!timing) unresolved++;
    const interpolated = source === 'interpolated' || source === 'evenly_spaced';
    const flags = timing ? ['legacy_import'] : [interpolated ? 'legacy_interpolated' : 'legacy_unresolved', 'unmatched'];
    return {
      ...line,
      ...timing,
      timestampMs: timing?.startMs ?? null,
      confidence: timing ? number(old.confidence) : null,
      coverage: null,
      origin: timing ? (source === 'manual' ? 'legacy_manual' : 'legacy_import') : (interpolated ? 'legacy_interpolated' : 'unmatched'),
      flags,
      locked: source === 'manual' && Boolean(timing),
      reviewed: false,
    };
  });
  const notes = [
    '0.1 프로젝트에서 변환했습니다. 원문과 줄 순서는 보존했으며, 변환된 타이밍은 0.2 검수 대상입니다.',
    ...(unresolved ? [`${unresolved}줄은 0.1의 보간/누락 타이밍이어서 비워 두었습니다.`] : []),
    ...(carried ? [`${carried}줄의 실제 매칭/수동 타이밍을 후보값으로 가져왔습니다.`] : []),
    ...(legacyTrack.rendered_file ? ['0.1에서 만든 영상 파일은 0.2 Remotion 출력과 달라 재사용하지 않습니다.'] : []),
  ];
  return {
    id: typeof legacyTrack.id === 'string' && legacyTrack.id && !legacyTrack.id.includes('/') ? legacyTrack.id : randomUUID(),
    title: titleFromAudio(audioName, legacyTrack.title),
    order: number(legacyTrack.order) ?? index,
    imageName,
    sourceLyrics,
    lines,
    instrumental: false,
    sunoUrl: '',
    sunoMetadata: null,
    analysis: null,
    history: [],
    notes,
    audio: {name: audioName, sha256: '', size: 0, mtimeMs: 0, durationMs},
    missing: false,
    scanError: null,
  };
}

export function migrateLegacyProject(legacy, {sourcePath = '.lyricflow/project.json', importedAt = new Date().toISOString()} = {}) {
  if (!legacy || typeof legacy !== 'object' || !Array.isArray(legacy.tracks)) return null;
  const imageName = topLevelFile(legacy.cover_file, IMAGE_EXTENSIONS);
  const tracks = [];
  const ids = new Set();
  for (const [index, legacyTrack] of legacy.tracks.entries()) {
    const track = migrateTrack(legacyTrack, index, imageName);
    if (!track || ids.has(track.id)) continue;
    ids.add(track.id); tracks.push(track);
  }
  tracks.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ko', {numeric: true, sensitivity: 'base'}));
  tracks.forEach((track, index) => { track.order = index; });
  return {
    schemaVersion: 1,
    appVersion: '0.2.0',
    id: randomUUID(),
    revision: 0,
    createdAt: importedAt,
    updatedAt: importedAt,
    style: migrateLegacyStyle(legacy.settings),
    tracks,
    jobs: [],
    migration: {
      from: '0.1',
      importedAt,
      source: sourcePath,
      policy: 'manual/matched/partial timings are candidates; interpolated/evenly_spaced timings remain unresolved',
    },
  };
}
