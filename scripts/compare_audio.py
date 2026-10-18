"""Non-destructive real-song comparison; never applies results to project.json."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'worker'))
from audio_pipeline import atomic_json, sha

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('folder', type=Path)
parser.add_argument('--device', choices=['cpu', 'cuda'], default='cpu')
parser.add_argument('--track', default='')
parser.add_argument('--output', default='vocals-20260912')
args = parser.parse_args()
folder = args.folder.resolve()
project_file = folder / '.lyricflow-remotion' / 'project.json'
project_hash = sha(project_file)
project = json.loads(project_file.read_text(encoding='utf-8-sig'))
if Path(args.output).name != args.output:
    parser.error('--output must be a directory name')
out = root / 'acceptance' / args.output
out.mkdir(parents=True, exist_ok=True)
summary = []
for track in project['tracks']:
    if args.track and args.track != track['title']:
        continue
    audio = folder / track['audio']['name']
    before = sha(audio)
    assert before == track['audio']['sha256'].lower()
    evidence = {'title': track['title'], 'originalSha256': before, 'device': args.device,
                'existingTimed': sum(row['startMs'] is not None for row in track['lines']), 'runs': {}}
    for source in ['original', 'vocals']:
        target = out / (track['id'] + '-' + source + '.json')
        req_file = out / (track['id'] + '-' + source + '-request.json')
        request = dict(audioPath=str(audio), audioSha256=before, durationMs=track['audio']['durationMs'],
                       lines=track['lines'], settings=dict(model='large-v3', device=args.device,
                       language='ko', engine='anchors', audioSource=source, retryMissing=source=='vocals'),
                       cacheDir=str(folder / '.lyricflow-remotion' / 'cache' / before),
                       outputFile=str(target), ffmpeg='ffmpeg')
        atomic_json(req_file, request)
        print(f"START {track['title']} {source}", flush=True)
        started = time.monotonic()
        with (out / (track['id'] + '-' + source + '.log')).open('w', encoding='utf-8') as log:
            completed = subprocess.run([sys.executable, str(root / 'worker' / 'align.py'), str(req_file)],
                          stdout=log, stderr=subprocess.STDOUT,
                          env={**os.environ, 'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
        if completed.returncode:
            print(f"FAILED {track['title']} {source}: {completed.returncode}", flush=True)
            sys.exit(completed.returncode)
        result = json.loads(target.read_text(encoding='utf-8'))
        initial = result['evidence']['initialLines']
        final = result['lines']
        evidence['runs'][source] = dict(seconds=round(time.monotonic()-started, 2),
                     selectedSource=result.get('selectedSource', source),
                     initialTimed=sum(row['startMs'] is not None for row in initial),
                     finalTimed=sum(row['startMs'] is not None for row in final),
                     review=sum(bool(row['flags']) for row in final),
                     recovered=[row for row in final if 'retry_recovered' in row['flags']],
                     unresolved=[row for row in final if row['startMs'] is None], file=target.name)
        print(json.dumps(evidence['runs'][source], ensure_ascii=False), flush=True)
    original = json.loads((out / evidence['runs']['original']['file']).read_text(encoding='utf-8'))['lines']
    vocals = json.loads((out / evidence['runs']['vocals']['file']).read_text(encoding='utf-8'))['lines']
    evidence['changedTimingOver500ms'] = [dict(id=a['id'], text=a['text'], before=[a['startMs'],a['endMs']],
                   after=[b['startMs'],b['endMs']]) for a,b in zip(original,vocals)
                   if a['startMs'] is not None and b['startMs'] is not None and
                   max(abs(a['startMs']-b['startMs']),abs(a['endMs']-b['endMs'])) > 500]
    evidence['lostTimedIds'] = [a['id'] for a,b in zip(original,vocals) if a['startMs'] is not None and b['startMs'] is None]
    assert sha(audio) == before
    assert sha(project_file) == project_hash
    atomic_json(out / (track['id'] + '-summary.json'), evidence)
    summary.append(evidence)
atomic_json(out / ('comparison' + ('-' + args.track if args.track else '') + '.json'), summary)
print('COMPLETED; original audio and project.json hashes unchanged', flush=True)
