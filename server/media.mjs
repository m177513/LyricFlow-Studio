import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {AppError, assert, within} from './core.mjs';
export const ffmpeg = () => process.env.LYRICFLOW_FFMPEG || 'ffmpeg';
export const ffprobe = () => process.env.LYRICFLOW_FFPROBE || 'ffprobe';
export const python = (root) => process.env.LYRICFLOW_PYTHON || (
  fs.existsSync(path.join(root, '.venv-audio', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
    ? path.join(root, '.venv-audio', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') :
  fs.existsSync(path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'))
    ? path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    : process.platform === 'win32' ? 'python' : 'python3');
export function run(command, args, {cwd, onLine, signal, timeoutMs = 0, maxOutput = 8000000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32', env: {...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8'}});
    let output = '', errors = '', pending = '', done = false, killed = false;
    function kill() {
      killed = true;
      if (!child.pid) return;
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill(); } }
    }
    const timer = timeoutMs ? setTimeout(kill, timeoutMs) : null;
    const onAbort = () => kill(); signal?.addEventListener('abort', onAbort, {once: true});
    if (signal?.aborted) kill();
    function finish(err, result) {
      if (done) return; done = true;
      if (timer) clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (err) reject(err); else resolve(result);
    }
    child.stdout.on('data', data => {
      const text = data.toString('utf8'); output = (output + text).slice(-maxOutput); pending += text;
      let at;
      while ((at = pending.indexOf('\n')) !== -1) { const line = pending.slice(0, at); pending = pending.slice(at + 1); onLine?.(line); }
    });
    child.stderr.on('data', data => { errors = (errors + data.toString('utf8')).slice(-24000); });
    child.on('error', err => finish(new AppError(`${command} 실행 실패: ${err.message}`, 500, 'dependency_missing')));
    child.on('close', code => {
      if (pending) onLine?.(pending);
      if (killed) return finish(new AppError(signal?.aborted ? '작업을 취소했습니다.' : '작업 제한 시간을 초과했습니다.', 409, 'cancelled'));
      if (code !== 0) return finish(new AppError(`${command} 처리 실패 (종료 ${code})\n${errors || output}`, 500, 'worker_failed'));
      finish(null, {stdout: output, stderr: errors});
    });
  });
}
export async function probe(file) {
  const result = await run(ffprobe(), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], {timeoutMs: 30000});
  const meta = JSON.parse(result.stdout); const audio = meta.streams?.find(s => s.codec_type === 'audio');
  assert(audio, '오디오 스트림이 없는 파일입니다.');
  const durationMs = Math.round(Number(meta.format?.duration ?? audio.duration) * 1000);
  assert(Number.isFinite(durationMs) && durationMs > 0, '음원 길이를 확인할 수 없습니다.');
  assert(durationMs <= 6 * 3600000, '단일 파일은 6시간 이내로 제한합니다.');
  return {durationMs, sampleRate: Number(audio.sample_rate), channels: audio.channels};
}
export function sendFile(req, res, file, {root, cors = false} = {}) {
  if (root) file = within(root, file);
  const stat = fs.statSync(file); assert(stat.isFile(), '일반 파일이 아닙니다.', 404);
  const types = {'.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.wav':'audio/wav', '.mp3':'audio/mpeg', '.mp4':'video/mp4', '.flac':'audio/flac', '.m4a':'audio/mp4', '.aac':'audio/aac', '.ogg':'audio/ogg', '.opus':'audio/ogg', '.webm':'audio/webm', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.srt':'application/x-subrip; charset=utf-8'};
  const headers = {'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'};
  if (cors) headers['Access-Control-Allow-Origin'] = '*';
  let start = 0, end = stat.size - 1;
  if (req.headers.range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); res.end(); return; }
    if (!m[1]) start = Math.max(0, stat.size - Number(m[2]));
    else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    if (start > end || start >= stat.size) { res.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); res.end(); return; }
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(req.headers.range ? 206 : 200, headers);
  if (req.method === 'HEAD' || stat.size === 0) { res.end(); return; }
  const stream = fs.createReadStream(file, {start, end});
  stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
}
