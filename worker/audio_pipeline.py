"""Derived audio and independent-ASR retry helpers. Never trim the song timeline."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import wave
from urllib.request import urlopen
from urllib.error import URLError

from alignment import align_to_words

PIPELINE_VERSION = 'vocals-retry-v4'
SEPARATION_MODEL = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def key(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        name = stream.name
    os.replace(name, path)


def decode(source, target, ffmpeg):
    """Publish only a complete 16 kHz PCM file; cancelled decodes cannot poison cache."""
    target = Path(target)
    if target.exists():
        return target
    temp = target.with_suffix('.partial.wav')
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                    '-i', str(source), '-vn', '-ar', '16000', '-ac', '1',
                    '-c:a', 'pcm_s16le', str(temp)], check=True, capture_output=True)
    os.replace(temp, target)
    return target


def wav_duration(path):
    with wave.open(str(path), 'rb') as reader:
        return reader.getnframes() / reader.getframerate()


def atomic_download(url, target, notify=lambda *args: None, opener=urlopen):
    """Cancelled/short model transfers never acquire the final model filename."""
    target = Path(target)
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.download')
    # audio-separator catches RuntimeError to try its official fallback URL.
    # Preserve that contract when replacing its downloader with atomic writes.
    try:
        response = opener(url, timeout=60)
    except URLError as error:
        raise RuntimeError(f'Model download failed: {error}') from error
    with response, temporary.open('wb') as stream:
        expected = int(response.headers.get('Content-Length', 0))
        size, last_report = 0, 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            stream.write(chunk)
            size += len(chunk)
            if size - last_report >= 32 * 1024 * 1024:
                notify('separation-download', f'보컬 모델 다운로드 {size/expected:.0%}' if expected else f'보컬 모델 다운로드 {size//1048576} MB')
                last_report = size
        if expected and size != expected:
            raise RuntimeError('보컬 모델 다운로드가 중간에 끊겼습니다. 다시 분석하면 재다운로드합니다.')
    os.replace(temporary, target)


def retry_windows(lines, duration_ms):
    """Bound suspect runs by their nearest good neighbours; include those as context."""
    windows = []
    i = 0
    while i < len(lines):
        if lines[i]['startMs'] is not None and not lines[i].get('flags'):
            i += 1
            continue
        first = i
        while i < len(lines) and (lines[i]['startMs'] is None or lines[i].get('flags')):
            i += 1
        last = i
        low = lines[first - 1]['endMs'] if first else 0
        high = lines[last]['startMs'] if last < len(lines) else duration_ms
        # No trustworthy search interval: retain unresolved lines for review.
        if high <= low:
            continue
        context_first, context_last = max(0, first - 1), min(len(lines), last + 1)
        left = max(0, min(low, lines[context_first]['startMs'] or low) - 1500)
        right = min(duration_ms, max(high, lines[context_last - 1]['endMs'] or high) + 1500)
        windows.append(dict(first=first, last=last, contextFirst=context_first,
                            contextLast=context_last, low=low, high=high, left=left, right=right))
    return windows


def choose_source(vocals, original):
    """Lexical coverage guard, NOT a measure of actual singing-time accuracy."""
    def score(rows):
        return (sum(row['startMs'] is not None for row in rows),
                sum(row['startMs'] is not None and not row.get('flags') for row in rows))
    return ('original', original) if score(original) > score(vocals) else ('vocals', vocals)


def retry_missing(source_lines, initial, duration_ms, transcribe, sources, emit):
    """transcribe(source, left_ms, right_ms) returns words in ORIGINAL coordinates.

    Never supplies source lyrics as an ASR prompt. Recovery requires new lexical
    support and cannot steal a neighbouring chorus. Good rows remain unchanged.
    """
    result = [dict(row) for row in initial]
    evidence = []
    for window in retry_windows(initial, duration_ms):
        pending = set(range(window['first'], window['last']))
        attempts = [(source, window['left'], window['right'], False) for source in sources]
        # Whole-context Whisper can omit a phrase that a shorter crop detects.
        # Limit extra work to at most three 20-second crops per source, inside
        # trustworthy neighbouring anchors. Never derive a timestamp from silence.
        span = window['high'] - window['low']
        if 20000 < span <= 60000:
            starts = sorted({window['low'], (window['low'] + window['high'] - 20000) // 2,
                             window['high'] - 20000})
            attempts += [(source, left, left + 20000, True) for left in starts for source in sources]
        for source, left, right, narrow in attempts:
            if not pending:
                break
            if narrow and not any(result[i]['startMs'] is None for i in pending):
                break
            emit('retry', f"누락·의심 구간 재인식 · {source} · {left/1000:.1f}–{right/1000:.1f}초")
            attempt = {'source': source, 'window': window, 'crop': [left, right], 'narrow': narrow, 'acceptedIds': []}
            words = transcribe(source, left, right)
            context = source_lines[window['contextFirst']:window['contextLast']]
            candidates, _ = align_to_words(context, words, duration_ms, 'retry-' + source)
            attempt['words'] = words
            attempt['candidates'] = candidates
            for index in sorted(pending.copy()):
                candidate = candidates[index - window['contextFirst']]
                start, end = candidate['startMs'], candidate['endMs']
                if start is None or candidate['flags'] or start < window['low'] or end > window['high']:
                    continue
                # Compare against all timed rows, including recoveries from the other source.
                if any(row['startMs'] is not None and
                       ((j < index and start < row['endMs']) or (j > index and end > row['startMs']))
                       for j, row in enumerate(result)):
                    continue
                candidate = {**candidate, 'flags': ['retry_recovered']}
                result[index] = candidate
                pending.remove(index)
                attempt['acceptedIds'].append(candidate['id'])
            evidence.append(attempt)
    return result, evidence
