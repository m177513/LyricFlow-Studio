import os from 'node:os';
import {run} from '../server/media.mjs';

export function renderConcurrency(env = process.env, resources = {threads: os.availableParallelism(), freeBytes: os.freemem()}) {
  const supplied = env.LYRICFLOW_RENDER_CONCURRENCY;
  if (supplied !== undefined && (!/^\d+$/.test(supplied) || Number(supplied) < 1 || Number(supplied) > 16)) throw new Error('LYRICFLOW_RENDER_CONCURRENCY는 1~16 정수여야 합니다.');
  if (supplied !== undefined) return Math.min(Number(supplied), resources.threads);
  const memorySlots = Math.max(1, Math.floor((resources.freeBytes / 2**30 - 2) / 0.75));
  return Math.max(1, Math.min(8, Math.floor(resources.threads / 2), memorySlots));
}

export async function renderProfile({sampleImage, style, env = process.env, platform = process.platform, probe, resources}) {
  const mode = env.LYRICFLOW_RENDER_DEVICE || 'auto';
  if (!['auto','gpu','cpu'].includes(mode)) throw new Error('LYRICFLOW_RENDER_DEVICE는 auto, gpu, cpu 중 하나여야 합니다.');
  const concurrency = renderConcurrency(env, resources);
  const encoder = platform === 'darwin' ? 'h264_videotoolbox' : ['win32','linux'].includes(platform) ? 'h264_nvenc' : null;
  let reason = mode === 'cpu' ? 'CPU 직접 선택' : '지원하는 GPU 인코더 없음';
  if (mode !== 'cpu' && encoder) {
    try {
      await probe(encoder, sampleImage);
      const videoBitrate = `${Math.max(6, Math.round(12 * style.width * style.height / (1920 * 1080) * Math.max(1, style.fps / 30)))}M`;
      return {device:'gpu', encoder, concurrency, reason:'GPU 실제 인코딩 시험 통과', options:{hardwareAcceleration:'required', videoBitrate}};
    } catch (error) {
      reason = `GPU 시험 실패: ${String(error.message).slice(-600)}`;
      if (mode === 'gpu') throw new Error(reason);
    }
  }
  if (mode === 'gpu') throw new Error(reason);
  return {device:'cpu', encoder:'libx264', concurrency, reason, options:{hardwareAcceleration:'disable', crf:18}};
}

export async function probeHardwareEncoder(encoder, sampleImage) {
  // Use the same pinned FFmpeg binary that renderMedia will use, including its driver requirements.
  const {RenderInternals} = await import('@remotion/renderer');
  const executable = RenderInternals.getExecutablePath({type:'ffmpeg', indent:false, logLevel:'error', binariesDirectory:null});
  await run(executable, ['-v','error','-nostdin','-i',sampleImage,'-frames:v','1','-an','-c:v',encoder,'-f','null','-'], {timeoutMs:15000});
}
