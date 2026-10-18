"""Local worker: faster-whisper ASR -> optional stable-ts alignment -> evidence JSON.

The UI never treats ASR output as the source lyrics. All timing is in original
mixed-audio coordinates. This worker does not trim silence or call a paid API.
"""
from __future__ import annotations
import argparse
import contextlib
import gc
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import traceback

from alignment import align_to_words, choose_refined
from audio_pipeline import PIPELINE_VERSION, SEPARATION_MODEL, choose_source, decode, key, retry_missing

PREFIX = '@@LYRICFLOW@@'


def emit(stage: str, message: str, **kwargs) -> None:
    print(PREFIX + json.dumps({'stage': stage, 'message': message, **kwargs}, ensure_ascii=False), flush=True)


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False, suffix='.tmp') as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.flush()
        os.fsync(f.fileno())
        temp = f.name
    os.replace(temp, path)


def versions() -> dict:
    data = {'python': sys.version.split()[0], 'executable': sys.executable}
    for name in ['faster-whisper', 'stable-ts', 'ctranslate2', 'torch', 'av', 'audio-separator']:
        try:
            data[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            data[name] = None
    data['pipeline'] = PIPELINE_VERSION
    data['refinement'] = 'ordered-faster-silence-v1'
    data['separationModel'] = SEPARATION_MODEL
    return data


def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main(request_file: Path) -> None:
    req = json.loads(request_file.read_text(encoding='utf-8-sig'))
    audio = Path(req['audioPath'])
    if file_sha(audio) != req['audioSha256']:
        raise RuntimeError('음원이 분석 요청 이후 변경되었습니다. 폴더를 다시 불러와 주세요.')
    settings = req['settings']
    model_name = settings.get('model', 'large-v3')
    requested_device = settings.get('device', 'cpu')
    language = settings.get('language', 'ko') or None
    engine = settings.get('engine', 'anchors')
    audio_source = settings.get('audioSource', 'vocals')
    retry_enabled = settings.get('retryMissing', True)
    if audio_source not in ('original', 'vocals') or not isinstance(retry_enabled, bool):
        raise ValueError('잘못된 분석 음원/재시도 설정입니다.')
    cache = Path(req['cacheDir'])
    cache.mkdir(parents=True, exist_ok=True)
    environment = versions()
    if not environment['faster-whisper']:
        raise RuntimeError('faster-whisper가 설치되지 않았습니다. install_windows.bat 또는 requirements-asr.txt 설치를 실행해 주세요.')
    if engine == 'hybrid' and not environment['stable-ts']:
        raise RuntimeError('원문 정밀 정렬에는 stable-ts가 필요합니다. install_alignment_windows.bat를 실행하거나 정렬 방식을 Whisper 초벌로 바꿔 주세요.')
    original_wav = decode(audio, cache / 'original-16k-v1.wav', req.get('ffmpeg', 'ffmpeg'))
    separation = None
    wav = original_wav
    if audio_source == 'vocals':
        separation_result = cache / 'separation-result.json'
        separation_request = cache / 'separation-request.json'
        atomic_json(separation_request, {**req, 'separationResult': str(separation_result),
                    'separationModelDir': str(Path(__file__).resolve().parents[1] / '.lyricflow-studio' / 'models' / 'separation')})
        subprocess.run([sys.executable, str(Path(__file__).with_name('separate.py')), str(separation_request)], check=True)
        separation = json.loads(separation_result.read_text(encoding='utf-8'))
        wav = Path(separation['audioPath'])
    # CTranslate2 can use the CUDA/cuDNN DLLs shipped in this private PyTorch
    # environment. Do not alter the machine PATH or install a global toolkit.
    dll_directory = None
    if os.name == 'nt' and environment['torch'] and requested_device != 'cpu':
        import importlib.util
        spec = importlib.util.find_spec('torch')
        torch_lib = Path(spec.origin).parent / 'lib'
        if torch_lib.is_dir():
            dll_directory = os.add_dll_directory(str(torch_lib))
            os.environ['PATH'] = str(torch_lib) + os.pathsep + os.environ.get('PATH', '')
    # Use the standard Hub HTTP downloader; optional Xet transport can stall
    # before transferring bytes on portable Windows setups.
    os.environ.setdefault('HF_HUB_DISABLE_XET', '1')
    from faster_whisper import WhisperModel
    import ctranslate2
    device = requested_device
    if device == 'auto':
        device = 'cuda' if ctranslate2.get_cuda_device_count() > 0 else 'cpu'
    emit('device', f'Whisper {model_name} · {device}', model=model_name, device=device)
    # ASR cache intentionally excludes the lyrics, allowing source-text corrections without re-transcription.
    asr_key = key({'audio': file_sha(wav), 'source': audio_source, 'model': model_name, 'language': language, 'device': device, 'versions': environment, 'vad': False})
    asr_path = cache / f'asr-{asr_key}.json'
    asr = json.loads(asr_path.read_text(encoding='utf-8')) if asr_path.exists() else None
    model = None
    def load_model():
        return WhisperModel(model_name, device=device, compute_type='float16' if device == 'cuda' else 'int8',
                            cpu_threads=max(1, min(8, os.cpu_count() or 4)), num_workers=1,
                            download_root=str(Path(__file__).resolve().parents[1] / '.lyricflow-studio' / 'models' / 'whisper'))
    if asr is None:
        emit('model', 'Whisper 모델을 불러옵니다. 첫 실행에는 모델 다운로드가 필요할 수 있습니다.')
        try:
            model = load_model()
        except Exception:
            if requested_device != 'auto' or device != 'cuda':
                raise
            device = 'cpu'
            emit('device', 'GPU 모델 초기화에 실패하여 CPU int8로 재시도합니다.', device=device)
            model = load_model()
        emit('asr', '초벌 단어 위치를 찾습니다. 가사는 이 결과로 덮어쓰지 않습니다.')
        # VAD is disabled for singing: a speech gate may remove sung syllables.
        segments, info = model.transcribe(str(wav), language=language, beam_size=5, word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
        words, transcript = [], []
        for index, seg in enumerate(segments):
            transcript.append({'start': seg.start, 'end': seg.end, 'text': seg.text})
            for word in seg.words or []:
                words.append({'word': word.word, 'start': word.start, 'end': word.end, 'probability': word.probability})
            emit('asr', f'초벌 인식 구간 {index + 1}개 · {seg.end:.1f}초까지 처리', completedSeconds=seg.end, totalSeconds=req['durationMs'] / 1000)
        asr = {'words': words, 'segments': transcript, 'language': info.language, 'device': device}
        atomic_json(asr_path, asr)
    else:
        emit('asr-cache', '저장된 초벌 인식 결과를 재사용합니다.')
    emit('matching', '인식한 단어를 원문 가사의 순서에 맞춰 연결합니다.')
    anchors, evidence = align_to_words(req['lines'], asr['words'], req['durationMs'])
    evidence['initialLines'] = anchors
    evidence['audioSource'] = audio_source
    evidence['separation'] = separation
    selected_source = audio_source
    selected_asr = asr
    if retry_enabled:
        if audio_source == 'vocals' and any(row['flags'] for row in anchors):
            emit('source-compare', '보컬 결과의 누락·의심 줄을 원본 전체 인식과 비교합니다.')
            original_key = key({'audio': file_sha(original_wav), 'source': 'original', 'model': model_name,
                                'language': language, 'device': device, 'versions': environment, 'vad': False})
            original_asr_path = cache / f'asr-{original_key}.json'
            if original_asr_path.exists():
                original_asr = json.loads(original_asr_path.read_text(encoding='utf-8'))
            else:
                if model is None:
                    model = load_model()
                segments, info = model.transcribe(str(original_wav), language=language, beam_size=5,
                       word_timestamps=True, vad_filter=False, condition_on_previous_text=False)
                words, transcript = [], []
                for seg in segments:
                    transcript.append({'start': seg.start, 'end': seg.end, 'text': seg.text})
                    words.extend({'word': w.word, 'start': w.start, 'end': w.end, 'probability': w.probability}
                                 for w in seg.words or [])
                    emit('source-compare', f'원본 비교 인식 · {seg.end:.1f}초까지 처리')
                original_asr = {'words': words, 'segments': transcript, 'language': info.language, 'device': device}
                atomic_json(original_asr_path, original_asr)
            original_anchors, original_evidence = align_to_words(req['lines'], original_asr['words'], req['durationMs'])
            selected_source, anchors = choose_source(anchors, original_anchors)
            if selected_source == 'original':
                selected_asr = original_asr
                evidence['vocalUnmatchedAsrWords'] = evidence['unmatchedAsrWords']
                evidence.update(original_evidence)
            evidence['sourceComparison'] = {'selectedSource': selected_source, 'originalLines': original_anchors,
                                            'originalAsrCache': original_asr_path.name,
                                            'reason': '시간 확보 줄 수, 동률이면 의심 표시 없는 줄 수 비교. 싱크 정확도 판정 아님.'}
            emit('source-selected', '원본 전체의 가사 대응이 더 나아 원본 결과를 사용합니다.' if selected_source == 'original'
                 else '보컬 분리본의 가사 대응을 유지합니다.')
        evidence['selectedInitialLines'] = anchors
        def transcribe_window(source, left, right):
            nonlocal model
            selected_wav = wav if source == 'vocals' else original_wav
            retry_path = cache / ('retry-' + key({'asr': asr_key, 'source': source, 'left': left, 'right': right}) + '.json')
            if retry_path.exists():
                return json.loads(retry_path.read_text(encoding='utf-8'))
            if model is None:
                model = load_model()
            import wave
            import numpy as np
            words = []
            # Long missing runs are retried in bounded chunks with context. Each
            # word belongs to exactly one core interval by its midpoint.
            step = 30000 if right - left > 45000 else right - left
            for core_left in range(left, right, step):
                core_right = min(right, core_left + step)
                clip_left, clip_right = max(left, core_left - 5000), min(right, core_right + 5000)
                with wave.open(str(selected_wav), 'rb') as reader:
                    reader.setpos(round(clip_left * 16))
                    clip = np.frombuffer(reader.readframes(round((clip_right-clip_left) * 16)), dtype=np.int16).astype(np.float32) / 32768.0
                segments, _ = model.transcribe(clip, language=language, beam_size=5, word_timestamps=True,
                                               vad_filter=False, condition_on_previous_text=False)
                for segment in segments:
                    for w in segment.words or []:
                        start, end = w.start + clip_left/1000, w.end + clip_left/1000
                        if core_left <= (start + end) * 500 < core_right:
                            words.append({'word': w.word, 'start': start, 'end': end, 'probability': w.probability})
            atomic_json(retry_path, words)
            return words
        anchors, evidence['retries'] = retry_missing(req['lines'], anchors, req['durationMs'],
                    transcribe_window, [selected_source, 'original' if selected_source == 'vocals' else 'vocals']
                    if audio_source == 'vocals' else ['original'], emit)
    if model is not None:
        del model
        gc.collect()
    result = anchors
    if engine == 'hybrid':
        # stable-ts is an optional, isolated adapter because its upstream is archived.
        import stable_whisper
        emit('align-model', '원문 정렬 모델을 불러옵니다. 초벌 모델은 메모리에서 해제했습니다.')
        with contextlib.redirect_stdout(sys.stderr):
            aligned_model = stable_whisper.load_faster_whisper(model_name, device=device,
                compute_type='float16' if device == 'cuda' else 'int8',
                download_root=str(Path(__file__).resolve().parents[1] / '.lyricflow-studio' / 'models' / 'whisper'))
        # Preserve occurrence order across the whole song. Isolated narrow windows
        # inherit early ASR boundaries and can align a hook to its neighbour.
        import numpy as np
        import wave
        with wave.open(str(wav if selected_source == 'vocals' else original_wav), 'rb') as reader:
            pcm = np.frombuffer(reader.readframes(reader.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        emit('align', '보컬의 발음 구간으로 원문 전체를 정밀 정렬합니다.')
        with contextlib.redirect_stdout(sys.stderr):
            forced = aligned_model.align(pcm, '\n'.join(line['text'] for line in req['lines']),
                language=language or selected_asr['language'], original_split=True,
                regroup=False, suppress_silence=True, vad=False, verbose=None)
        if forced is None:
            raise RuntimeError('정밀 정렬 결과가 없습니다. 기존 타이밍을 유지합니다.')
        words = [{'word': word.word, 'start': word.start, 'end': word.end}
                 for segment in forced.segments for word in segment.words or []]
        refined_lines, refinement_evidence = align_to_words(req['lines'], words, req['durationMs'], 'stable-ts')
        result = choose_refined(anchors, refined_lines)
        for anchor, row in zip(anchors, result):
            if anchor['startMs'] is None or row['startMs'] is None:
                continue
            delta = max(abs(row['startMs'] - anchor['startMs']), abs(row['endMs'] - anchor['endMs']))
            if delta > 2500:
                # Large moves need independent evidence; forced text can land in
                # instrumental/ad-lib sections even when the words were absent.
                row.update(anchor)
            if delta > 200:
                row['flags'] = list(dict.fromkeys(row['flags'] + ['alignment_disagrees']))
        evidence['refinement'] = {'method': 'ordered-faster-silence-v1', 'candidateLines': refined_lines,
                                  'matching': refinement_evidence}
        del aligned_model
        gc.collect()
    if file_sha(audio) != req['audioSha256']:
        raise RuntimeError('처리 중 원본 음원이 변경되었습니다. 결과를 적용하지 않았습니다.')
    output = {'schemaVersion': 1, 'lines': result, 'asrHypothesis': selected_asr, 'evidence': evidence, 'environment': environment, 'actualDevice': selected_asr['device'], 'model': model_name, 'engine': engine, 'audioSource': audio_source, 'selectedSource': selected_source, 'retryMissing': retry_enabled}
    atomic_json(Path(req['outputFile']), output)
    emit('complete', f'정렬 후보 {len(result)}줄을 저장했습니다. 자동 결과는 실제 곡 검수가 필요합니다.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('request', nargs='?', type=Path)
    parser.add_argument('--diagnose', action='store_true')
    args = parser.parse_args()
    if args.diagnose:
        print(json.dumps(versions(), ensure_ascii=False))
    elif args.request:
        try:
            main(args.request)
        except Exception as error:
            emit('error', str(error))
            traceback.print_exc(file=sys.stderr)
            sys.exit(1)
    else:
        parser.error('request 파일을 지정해 주세요.')
