"""Prepare the official large-v3 model with visible byte progress and LFS SHA-256 verification."""
import hashlib
import json
import os
from pathlib import Path
import requests

root = Path(__file__).resolve().parents[1]
repo = 'Systran/faster-whisper-large-v3'
metadata = requests.get('https://huggingface.co/api/models/' + repo, params={'blobs': 'true'}, timeout=30)
metadata.raise_for_status()
data = metadata.json()
revision = data['sha']
entry = next(row for row in data['siblings'] if row['rfilename'] == 'model.bin')
expected = entry['lfs']['sha256']
folder = root / '.lyricflow-studio' / 'models' / 'whisper' / 'models--Systran--faster-whisper-large-v3' / 'snapshots' / revision
folder.mkdir(parents=True, exist_ok=True)
target = folder / 'model.bin'
temp = folder / 'model.download'
h = hashlib.sha256()
count = 0
print('Official model:', repo, revision, 'expected bytes:', entry['size'], flush=True)
with requests.get(f'https://huggingface.co/{repo}/resolve/{revision}/model.bin', stream=True, timeout=(30, 60)) as response:
    response.raise_for_status()
    with temp.open('wb') as stream:
        for chunk in response.iter_content(4 * 1024 * 1024):
            stream.write(chunk)
            h.update(chunk)
            count += len(chunk)
            if count % (64 * 1024 * 1024) < len(chunk):
                print(f'{count}/{entry["size"]} bytes ({count/entry["size"]:.1%})', flush=True)
if count != entry['size'] or h.hexdigest() != expected:
    raise RuntimeError('Official model size/hash mismatch; partial download was not published')
os.replace(temp, target)
print('Verified SHA-256:', expected, flush=True)
(root / 'acceptance' / 'vocals-20260912' / 'whisper-download.json').write_text(json.dumps(
    dict(repository=repo, revision=revision, sha256=expected, bytes=count), indent=2), encoding='utf-8')
