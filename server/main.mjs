import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {AppError, assert, atomicJSON, readJSON, clone, now, within, toSrt, renderProblems} from './core.mjs';
import {Store} from './store.mjs';
import {resolveFolder} from './portable-paths.mjs';
import {imageRequest} from './image-request.mjs';
import {makeShortProps} from './shorts.mjs';
import {JobQueue, makeVideoProps} from './jobs.mjs';
import {sendFile, run, python, ffmpeg, ffprobe} from './media.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const APP_ROOT = path.resolve(HERE, '..');

export async function createApp({port = Number(process.env.LYRICFLOW_PORT || 4173), appRoot = APP_ROOT, singleTrackRender = null} = {}) {
  if (!singleTrackRender) {
    const runtime = readJSON(path.join(appRoot,'.lyricflow-studio','render-runtime.json'),null);
    if (runtime) singleTrackRender = {worker:path.resolve(appRoot,runtime.worker),binariesDirectory:path.resolve(appRoot,runtime.binariesDirectory)};
  }
  const token = randomBytes(32).toString('hex'); const mediaKey = randomBytes(24).toString('hex');
  const clients = new Set(); let importing = false; let actualPort = port;
  function notify(type, data) { for (const client of clients) client.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  const store = new Store(appRoot, notify); const queue = new JobQueue(store, notify, {singleTrackRender});
  const json = (res, data, code = 200) => { res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(data)); };
  const origin = () => `http://127.0.0.1:${actualPort}`;
  const permittedOrigins = () => new Set([origin(), `http://localhost:${actualPort}`]);
  async function body(req) {
    assert((req.headers['content-type'] || '').startsWith('application/json'), 'JSON 요청만 허용합니다.', 415);
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; assert(size <= 2 * 1024 * 1024, '요청이 너무 큽니다.', 413); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('JSON 형식이 올바르지 않습니다.'); }
  }
  const assetUrl = (t, kind) => `${origin()}/asset/${t.id}/${kind}?key=${mediaKey}`;
  const server = http.createServer(async (req, res) => {
    try {
      // Host validation blocks DNS rebinding. CORS is not enabled for local APIs.
      const hosts = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`]);
      assert(hosts.has(req.headers.host), '허용되지 않은 Host입니다.', 403);
      const url = new URL(req.url, origin()); const route = url.pathname;
      if (route.startsWith('/api/')) {
        assert(req.headers['sec-fetch-site'] !== 'cross-site', '외부 사이트의 로컬 API 요청을 거부했습니다.', 403);
        if (req.headers.origin) assert(permittedOrigins().has(req.headers.origin), '허용되지 않은 Origin입니다.', 403);
        if (!['GET','HEAD'].includes(req.method)) assert(req.headers['x-lyricflow-token'] === token, '로컬 세션 토큰이 필요합니다. 화면을 새로고침해 주세요.', 403);
      }
      if (req.method === 'GET' && route === '/api/session') {
        const last = readJSON(path.join(appRoot, '.lyricflow-studio', 'last-project.json'), {});
        return json(res, {token, version:'0.2.0', lastFolder: resolveFolder(appRoot, last.folder), demoFolder: path.join(appRoot, 'demo'), playerBuilt: fs.existsSync(path.join(appRoot, 'web/dist/player.js'))});
      }
      if (req.method === 'GET' && route === '/api/events') {
        res.writeHead(200, {'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
        res.write('event: connected\ndata: {}\n\n'); clients.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clients.delete(res); clearInterval(heartbeat); }); return;
      }
      if (req.method === 'POST' && route === '/api/folder-picker') {
        await body(req);
        const result = await run(python(appRoot), [path.join(appRoot,'worker/pick_folder.py')], {timeoutMs:180000});
        return json(res, JSON.parse(result.stdout));
      }
      if (req.method === 'GET' && route === '/api/project') return json(res, store.publicProject());
      if (req.method === 'POST' && route === '/api/image-request') {
        const data = await body(req);
        assert(!importing, '폴더 확인 중입니다.', 409);
        store.ensureRevision(data.revision);
        assert(data.trackId == null || typeof data.trackId === 'string', '곡 ID가 올바르지 않습니다.');
        return json(res, {text:imageRequest(store.project, data.trackId), folder:store.folder});
      }
      if (req.method === 'POST' && route === '/api/project/open') {
        const data = await body(req); assert(!importing && !queue.busy(), '작업 중에는 폴더를 바꿀 수 없습니다. 현재 작업을 완료하거나 취소해 주세요.', 409);
        importing = true;
        try { return json(res, await store.open(data.folder, event => notify('scan', event))); }
        finally { importing = false; }
      }
      if (req.method === 'PATCH' && /^\/api\/tracks\/[^/]+$/.test(route)) {
        assert(!importing, '폴더 확인 중입니다.', 409);
        const data = await body(req); return json(res, store.updateTrack(route.split('/')[3], data.patch, data.revision));
      }
      if (req.method === 'POST' && /^\/api\/tracks\/[^/]+\/undo$/.test(route)) {
        const data = await body(req); return json(res, store.undo(route.split('/')[3], data.revision));
      }
      if (req.method === 'POST' && /^\/api\/tracks\/[^/]+\/redo$/.test(route)) {
        const data = await body(req); return json(res, store.redo(route.split('/')[3], data.revision));
      }
      if (req.method === 'PATCH' && route === '/api/style') { const data = await body(req); return json(res, store.updateStyle(data.style, data.revision)); }
      if (req.method === 'PATCH' && route === '/api/order') { const data = await body(req); return json(res, store.reorder(data.ids, data.revision)); }
      if (req.method === 'GET' && /^\/api\/tracks\/[^/]+\/preview$/.test(route)) {
        const track = store.getTrack(route.split('/')[3]); return json(res, url.searchParams.get('shorts') === '1' ? makeShortProps(track, store.project.style, assetUrl, {startMs:Number(url.searchParams.get('startMs')),endMs:Number(url.searchParams.get('endMs'))}) : makeVideoProps([track], store.project.style, assetUrl));
      }
      if (req.method === 'GET' && /^\/api\/tracks\/[^/]+\/srt$/.test(route)) {
        const track = store.getTrack(route.split('/')[3]);
        const issues = renderProblems({...track, imageName: track.imageName || '__subtitle_only__'}); assert(!issues.length, issues.join(' '), 422);
        res.writeHead(200, {'Content-Type':'application/x-subrip; charset=utf-8', 'Content-Disposition':`attachment; filename="subtitles.srt"`, 'Cache-Control':'no-store'});
        return res.end(toSrt(track.instrumental ? [] : track.lines));
      }
      if (req.method === 'POST' && route === '/api/jobs') {
        assert(!importing, '폴더 확인 중에는 작업을 시작할 수 없습니다.', 409);
        const data = await body(req); return json(res, queue.enqueue(data.type, data.trackIds, data.settings), 202);
      }
      if (req.method === 'GET' && route === '/api/jobs') return json(res, store.project?.jobs || []);
      if (req.method === 'POST' && /^\/api\/jobs\/[^/]+\/cancel$/.test(route)) { await body(req); queue.cancel(route.split('/')[3]); return json(res, {ok:true}); }
      if (req.method === 'GET' && /^\/api\/jobs\/[^/]+\/output\/\d+$/.test(route)) {
        const pieces = route.split('/'); const job = store.project?.jobs.find(j => j.id === pieces[3]); const item = job?.outputs[Number(pieces[5])];
        assert(item, '출력 파일이 없습니다.', 404);
        return sendFile(req, res, path.join(store.stateDir, item.relative), {root: store.stateDir});
      }
      if (req.method === 'GET' && route === '/api/doctor') {
        const result = {node: process.version, playerBuilt: fs.existsSync(path.join(appRoot,'web/dist/player.js')), packages: false, ffmpeg: false, ffprobe: false, python: null, errors: []};
        try { result.packages = fs.existsSync(path.join(appRoot,'node_modules/@remotion/renderer/package.json')); } catch {}
        for (const [name, cmd] of [['ffmpeg',ffmpeg()],['ffprobe',ffprobe()]]) {
          try { await run(cmd, ['-version'], {timeoutMs:5000}); result[name] = true; } catch (e) { result.errors.push(e.message); }
        }
        try { const r = await run(python(appRoot), [path.join(appRoot,'worker/align.py'),'--diagnose'], {timeoutMs:15000}); result.python = JSON.parse(r.stdout); }
        catch (e) { result.errors.push(e.message); }
        return json(res, result);
      }
      if (['GET','HEAD'].includes(req.method) && /^\/asset\/[^/]+\/(audio|image)$/.test(route)) {
        assert(url.searchParams.get('key') === mediaKey, '미디어 키가 필요합니다.', 403);
        const [, , id, kind] = route.split('/'); const t = store.getTrack(id);
        const name = kind === 'audio' ? t.audio.name : t.imageName; assert(name, '미디어가 없습니다.', 404);
        return sendFile(req, res, path.join(store.folder, name), {root: store.folder, cors:true});
      }
      if (['GET','HEAD'].includes(req.method) && !route.startsWith('/api/') && !route.startsWith('/asset/')) {
        const filename = route === '/' ? 'index.html' : decodeURIComponent(route.slice(1));
        const webRoot = path.join(appRoot, 'web'); const file = path.resolve(webRoot, filename);
        assert(fs.existsSync(file), '파일을 찾을 수 없습니다.', 404);
        return sendFile(req, res, file, {root:webRoot});
      }
      throw new AppError('요청 경로를 찾을 수 없습니다.', 404);
    } catch (error) {
      if (!res.headersSent) json(res, {error: String(error.message), code:error.code || 'error'}, error.status || 500);
      else res.destroy();
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { actualPort = server.address().port; resolve(); }); });
  return {server, store, queue, url: origin(), token, close: async () => {
    if (queue.controller) queue.controller.abort(); for (const client of clients) client.end();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const app = await createApp();
    console.log(`LyricFlow Studio 0.2\n${app.url}\n원본 음원은 수정하지 않습니다. 종료: Ctrl+C`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
