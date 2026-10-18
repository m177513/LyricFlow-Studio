import {AppError, assert} from './core.mjs';

export function validateSunoUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('올바른 Suno 곡 링크를 입력해 주세요.'); }
  assert(url.protocol === 'https:' && ['suno.com', 'www.suno.com'].includes(url.hostname.toLowerCase()) && !url.port && !url.username && !url.password, 'https://suno.com/song/… 형식만 허용합니다.');
  const match = url.pathname.match(/^\/song\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  assert(match, '개별 곡의 /song/ 링크를 입력해 주세요. 공유 단축 링크는 곡 페이지에서 다시 복사해 주세요.');
  url.search = ''; url.hash = '';
  return {url: url.href, songId: match[1].toLowerCase()};
}
function unescapeHtml(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
export function parseSunoHtml(html, songId) {
  const roots = [];
  const flightStrings = [];
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const s = match[1].trim();
    try { roots.push(JSON.parse(s)); } catch { /* Public Next/React script fragments are handled below. */ }
    // Parse string literals as JSON only; never evaluate scripts from a page.
    for (const literal of s.matchAll(/"(?:\\.|[^"\\])*"/g)) {
      try {
        const decoded = JSON.parse(literal[0]);
        if (typeof decoded !== 'string') continue;
        flightStrings.push(decoded);
        if (!decoded.includes(songId)) continue;
        for (const row of decoded.split('\n')) {
          const at = row.indexOf(':');
          for (const candidate of [row, at >= 0 ? row.slice(at + 1) : '']) {
            try { roots.push(JSON.parse(candidate)); } catch { /* Not a JSON payload. */ }
          }
        }
      } catch { /* Malformed payload: leave manual paste available. */ }
    }
  }
  const candidates = [];
  const textRefs = new Map();
  const flight = flightStrings.join('');
  for (const match of flight.matchAll(/(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g)) {
    const start = match.index + match[0].length;
    const bytes = Buffer.from(flight.slice(start), 'utf8');
    const length = parseInt(match[2],16);
    textRefs.set('$' + match[1], bytes.subarray(0, length).toString('utf8'));
    // A text row is length-delimited: the next row follows it without a newline.
    const next = bytes.subarray(length).toString('utf8').split('\n', 1)[0];
    try { roots.push(JSON.parse(next.slice(next.indexOf(':') + 1))); } catch { /* Not a JSON payload. */ }
  }
  let visited = 0;
  function walk(value, inheritedId = '', depth = 0) {
    if (depth > 32 || ++visited > 60000 || value === null || typeof value !== 'object') return;
    const id = typeof value.id === 'string' ? value.id.toLowerCase() : inheritedId;
    const exact = id === songId;
    if (exact && !Array.isArray(value)) {
      let lyric = typeof value.lyrics === 'string' ? value.lyrics
        : typeof value.metadata?.prompt === 'string' ? value.metadata.prompt
        : typeof value.prompt === 'string' ? value.prompt : null;
      if (lyric && /^\$[0-9a-f]+$/.test(lyric)) lyric = textRefs.get(lyric) || null;
      if (lyric?.trim()) candidates.push({lyrics: lyric, title: value.title || '', duration: Number(value.metadata?.duration ?? value.duration) || null});
    }
    for (const item of Object.values(value)) walk(item, id, depth + 1);
  }
  roots.forEach(r => walk(r));
  // Only a matching song object may supply lyrics; never use recommended/related songs.
  if (!candidates.length) {
    // Ordinary Suno pages carry config keys such as "hcaptchaFallback…"; match the standalone word only.
    const blocked = /\bcaptcha\b|verify you are human|access denied/i.test(html);
    throw new AppError(blocked ? '공개 페이지 접근이 제한되었습니다. 가사를 직접 붙여넣어 주세요.' : '이 공개 페이지에서 해당 곡의 원문 가사를 찾지 못했습니다. 가사를 직접 붙여넣어 주세요.', 422, blocked ? 'suno_access_limited' : 'suno_lyrics_not_found');
  }
  const distinct = [...new Set(candidates.map(c => c.lyrics))];
  assert(distinct.length === 1, '같은 곡에 서로 다른 가사 후보가 있어 자동 확정하지 않았습니다. 직접 붙여넣어 주세요.', 422, 'suno_ambiguous');
  const choice = candidates.find(c => c.title) ?? candidates[0];
  if (!choice.title) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (title) choice.title = unescapeHtml(title[1]).replace(/\s*[|–-]\s*Suno.*$/i, '').trim();
  }
  return {...choice, method: 'public-page-json', songId};
}
export async function fetchSuno(value) {
  const {url: initial, songId} = validateSunoUrl(value);
  let url = initial;
  for (let i = 0; i < 4; i++) {
    let response;
    try {
      response = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(15000), headers: {'User-Agent': 'LyricFlowStudio/0.2 (local lyrics import)', Accept: 'text/html'}});
    } catch { throw new AppError('Suno 연결에 실패했습니다. 인터넷 연결을 확인하거나 가사를 직접 붙여넣어 주세요.', 502, 'suno_network'); }
    if (response.status >= 300 && response.status < 400) {
      url = validateSunoUrl(new URL(response.headers.get('location') ?? '', url).href).url;
      assert(validateSunoUrl(url).songId === songId, '다른 곡으로의 이동은 자동 처리하지 않습니다.', 422);
      continue;
    }
    assert(response.ok, `Suno 페이지를 읽지 못했습니다(HTTP ${response.status}). 가사를 직접 붙여넣어 주세요.`, 422, 'suno_http');
    assert((response.headers.get('content-type') || '').includes('text/html'), 'Suno 응답이 HTML 페이지가 아닙니다.', 422);
    const reader = response.body.getReader(); const chunks = []; let size = 0;
    try {
      while (true) {
        const {done, value: chunk} = await reader.read(); if (done) break;
        size += chunk.length; assert(size <= 5 * 1024 * 1024, 'Suno 페이지가 너무 큽니다. 직접 붙여넣어 주세요.', 422);
        chunks.push(Buffer.from(chunk));
      }
    } finally { await reader.cancel().catch(() => {}); }
    return {...parseSunoHtml(Buffer.concat(chunks).toString('utf8'), songId), url: initial};
  }
  throw new AppError('Suno 페이지 이동이 반복됩니다. 원문을 직접 붙여넣어 주세요.', 422);
}
