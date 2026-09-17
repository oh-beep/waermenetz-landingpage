"""Activate one verified public artifact with a private backup and rollback."""
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

PUBLIC = ('index.html', 'impressum.html', 'datenschutz.html', 'bestaetigt.html', 'assets')
BASE = Path('/var/www/waermenetz.hhb-agrarenergie.de')
STATE = Path('/home/deploy/.local/state/waermenetz-releases')

def validate_members(members):
    total = 0
    for m in members:
        p = PurePosixPath(m.name)
        if p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] not in PUBLIC:
            raise ValueError('archive_path')
        if not (m.isfile() or m.isdir()) or (p.parts[0] != 'assets' and len(p.parts) != 1):
            raise ValueError('archive_type_or_scope')
        if any(x.startswith('.') for x in p.parts):
            raise ValueError('hidden_public_file')
        total += m.size
    if len(members) > 5000 or total > 100 * 1024 * 1024:
        raise ValueError('archive_size')
    if not all(any(m.name == name for m in members) for name in PUBLIC):
        raise ValueError('archive_incomplete')

def main(sha, archive_hash, run_id):
    if not re.fullmatch('[0-9a-f]{40}', sha) or not re.fullmatch('[0-9a-f]{64}', archive_hash) or not re.fullmatch('[0-9]+-[0-9]+', run_id):
        raise ValueError('release_identity')
    incoming = Path('/home/deploy/.local/state/waermenetz-incoming') / run_id / 'public.tar.gz'
    if incoming.is_symlink() or hashlib.sha256(incoming.read_bytes()).hexdigest() != archive_hash:
        raise ValueError('archive_digest')
    if BASE.is_symlink() or not BASE.is_dir():
        raise ValueError('public_root')
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
    with open(STATE / 'deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        work = STATE / (sha + '-' + run_id)
        work.mkdir(mode=0o700)
        unpack = work / 'candidate'; unpack.mkdir(mode=0o700)
        backup = work / 'previous'; backup.mkdir(mode=0o700)
        with tarfile.open(incoming) as archive:
            validate_members(archive.getmembers())
            archive.extractall(unpack, filter='data')
        for p in [unpack, *unpack.rglob('*')]:
            os.chmod(p, 0o755 if p.is_dir() else 0o644)
        expected = {name: hashlib.sha256((unpack / name).read_bytes()).hexdigest() for name in PUBLIC if name != 'assets'}
        changed = []
        try:
            for name in PUBLIC:
                old = BASE / name
                if old.is_symlink():
                    raise ValueError('public_entry_link')
                if old.exists():
                    old.rename(backup / name)
                changed.append(name)
                (unpack / name).rename(old)
            subprocess.run(['sudo', '-n', '/usr/local/sbin/kz-nginx-verify-reload'], check=True, capture_output=True, timeout=30)
            class NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, *args, **kwargs):
                    return None
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
            for name, digest in expected.items():
                url = 'https://waermenetz.hhb-agrarenergie.de/' + name + '?release=' + sha
                for attempt in range(5):
                    try:
                        with opener.open(url, timeout=10) as response:
                            if response.status == 200 and hashlib.sha256(response.read()).hexdigest() == digest:
                                break
                    except Exception:
                        pass
                    if attempt == 4:
                        raise ValueError('public_readback_mismatch')
                    time.sleep(2)
        except Exception:
            for name in reversed(changed):
                current = BASE / name
                if current.exists():
                    current.rename(work / ('failed-' + name))
                if (backup / name).exists():
                    (backup / name).rename(current)
            raise
        proof = {'releaseSha': sha, 'runId': run_id, 'archiveSha256': archive_hash, 'publicHashes': expected, 'backup': str(backup), 'publicReadback': True, 'formServiceChanged': False}
        (work / 'proof.json').write_text(json.dumps(proof, indent=2))
        incoming.unlink()
        print(json.dumps(proof))

if __name__ == '__main__':
    main(*sys.argv[1:])
