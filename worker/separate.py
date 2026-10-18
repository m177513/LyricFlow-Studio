"""Run separation in its own process so GPU memory is released before Whisper."""
import contextlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from audio_pipeline import SEPARATION_MODEL, atomic_download, atomic_json, decode, key, sha, wav_duration


def emit(stage, message):
    print('@@LYRICFLOW@@' + json.dumps(dict(stage=stage, message=message), ensure_ascii=False), flush=True, file=sys.__stdout__)


def main(request_file):
    req = json.loads(Path(request_file).read_text(encoding='utf-8-sig'))
    # audio-separator probes the literal command name ``ffmpeg`` during
    # initialisation.  LyricFlow passes a portable ffmpeg path in the
    # request, so expose that executable's directory to the child process as
    # well as using the absolute path for decoding below.
    ffmpeg_path = Path(req.get('ffmpeg', 'ffmpeg'))
    if ffmpeg_path.is_absolute() and ffmpeg_path.exists():
        os.environ['PATH'] = str(ffmpeg_path.parent) + os.pathsep + os.environ.get('PATH', '')
    cache = Path(req['cacheDir'])
    cache.mkdir(parents=True, exist_ok=True)
    try:
        version = importlib.metadata.version('audio-separator')
    except importlib.metadata.PackageNotFoundError:
        raise RuntimeError('보컬 분리 라이브러리가 없습니다. install_audio_windows.bat을 실행하거나 원본 음악 분석을 선택하세요.')
    identity = dict(version=1, audio=req['audioSha256'], model=SEPARATION_MODEL,
                    separator=version, sampleRate=44100, segmentSize=256, overlap=8, batchSize=1)
    # Full identity is checked in the manifest; keep Windows filenames short.
    folder = cache / ('vocals-' + key(identity)[:16])
    folder.mkdir(parents=True, exist_ok=True)
    manifest = folder / 'manifest.json'
    output = folder / 'vocals-16k.wav'
    if manifest.exists() and output.exists():
        meta = json.loads(manifest.read_text(encoding='utf-8'))
        if meta.get('identity') == identity and meta.get('sha256') == sha(output):
            atomic_json(req['separationResult'], {**meta, 'audioPath': str(output), 'cached': True})
            emit('separation-cache', '저장된 보컬 분리본을 재사용합니다.')
            return
    emit('separation-model', 'BS-RoFormer 보컬 분리 모델을 준비합니다. 첫 실행에는 모델을 다운로드합니다.')
    from audio_separator.separator import Separator
    class CachedSeparator(Separator):
        def download_file_if_not_exists(self, url, output_path):
            atomic_download(url, output_path, emit)
    scratch = Path(req['separationModelDir']).parent.parent / 'tmp'
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sep-', dir=scratch) as work:
        # Compressed sources can report subtypes such as MPEG_LAYER_III to
        # soundfile. audio-separator reuses that subtype for its WAV output,
        # which fails after inference. Decode only the temporary input to PCM
        # so both import and stem export use a valid WAV encoding.
        input_copy = Path(work) / 'input.wav'
        subprocess.run([str(ffmpeg_path), '-v', 'error', '-nostdin', '-y',
                        '-i', req['audioPath'], '-map', '0:a:0', '-vn',
                        '-c:a', 'pcm_s24le', str(input_copy)], check=True,
                       creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        # The library may log to stdout; keep the status stream machine-readable.
        with contextlib.redirect_stdout(sys.stderr):
            separator = CachedSeparator(log_level=logging.INFO, output_dir=work, output_format='WAV',
                                  model_file_dir=req['separationModelDir'], output_single_stem='Vocals',
                                  sample_rate=44100, use_soundfile=True,
                                  mdxc_params={'segment_size': 256, 'override_model_segment_size': True,
                                               'batch_size': 1, 'overlap': 8, 'pitch_shift': 0})
            separator.load_model(model_filename=SEPARATION_MODEL)
        emit('separation', '반주에서 보컬을 분리합니다. 완료까지 시간이 걸릴 수 있습니다.')
        with contextlib.redirect_stdout(sys.stderr):
            outputs = separator.separate(str(input_copy))
        if len(outputs) != 1:
            raise RuntimeError('보컬 분리 결과가 1개가 아닙니다. 결과를 적용하지 않았습니다.')
        stem = Path(outputs[0])
        if not stem.is_absolute():
            stem = Path(work) / stem
        if not stem.resolve().is_relative_to(Path(work).resolve()):
            raise RuntimeError('보컬 출력 경로가 작업 폴더를 벗어났습니다.')
        converted = decode(stem, Path(work) / 'analysis.wav', req.get('ffmpeg', 'ffmpeg'))
        duration = wav_duration(converted)
        if abs(duration * 1000 - req['durationMs']) > 50:
            raise RuntimeError('보컬 분리본과 원곡 길이가 다릅니다. 시간축 보존 확인이 필요합니다.')
        os.replace(converted, output)
    meta = dict(identity=identity, sha256=sha(output), durationMs=round(duration * 1000),
                model=SEPARATION_MODEL, device=str(separator.torch_device),
                modelSha256=sha(Path(req['separationModelDir']) / SEPARATION_MODEL))
    atomic_json(manifest, meta)
    atomic_json(req['separationResult'], {**meta, 'audioPath': str(output), 'cached': False})
    emit('separation-complete', '보컬 분리를 완료했습니다. 원본 음악은 그대로 유지됩니다.')


if __name__ == '__main__':
    main(sys.argv[1])
