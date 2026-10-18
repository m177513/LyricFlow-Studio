import {assert, renderProblems} from './core.mjs';

export function shortRange(track, settings, fps) {
  const {startMs, endMs} = settings || {};
  assert(Number.isFinite(startMs) && Number.isFinite(endMs), '시작과 끝 시간을 입력해 주세요.', 422);
  assert(startMs >= 0 && endMs > startMs && endMs <= track.audio.durationMs, '음원 안에서 시작보다 늦은 끝 시간을 선택해 주세요.', 422);
  assert(endMs - startMs <= 180000, '쇼츠 구간은 최대 3분입니다.', 422);
  const startFrame = Math.round(startMs * fps / 1000);
  const endFrame = Math.min(Math.floor(track.audio.durationMs * fps / 1000), Math.round(endMs * fps / 1000));
  assert(endFrame > startFrame, '최소 한 프레임 이상의 구간을 선택해 주세요.', 422);
  return {startFrame, startMs: startFrame * 1000 / fps, endMs: endFrame * 1000 / fps, frames: endFrame - startFrame};
}

export function makeShortProps(track, style, assetUrl, settings) {
  const range = shortRange(track, settings, style.fps);
  const problems = renderProblems(track);
  assert(!problems.length, problems.join(' '), 422);
  const lines = track.instrumental ? [] : track.lines.filter(l => !l.excluded);
  let previousEnd = 0;
  for (const line of lines) {
    assert(Number.isFinite(line.startMs) && Number.isFinite(line.endMs) && line.startMs >= previousEnd && line.endMs > line.startMs && line.endMs <= track.audio.durationMs, '가사 시간의 누락·역전·겹침·범위 초과를 수정해 주세요.', 422);
    previousEnd = line.endMs;
  }
  return {
    style: {...style, width:1080, height:1920, portrait:true, fontSize:Math.max(48, style.fontSize), bottomPercent:24, nextLine:false, showTitle:true},
    tracks: [{id:track.id, title:track.title, from:0, durationMs:range.endMs-range.startMs, durationInFrames:range.frames,
      audioStartFrame:range.startFrame, audioUrl:assetUrl(track,'audio'), imageUrl:assetUrl(track,'image'),
      captions:lines.filter(l => l.startMs < range.endMs && l.endMs > range.startMs).map(l => ({
        text:l.text, startMs:Math.max(0,l.startMs-range.startMs), endMs:Math.min(range.endMs,l.endMs)-range.startMs,
        timestampMs:Math.max(0,l.startMs-range.startMs), confidence:null,
      })),
    }],
  };
}
