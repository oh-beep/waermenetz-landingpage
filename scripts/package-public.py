"""Build a public-only release; server code and credentials are never included."""
import hashlib
from pathlib import Path
import tarfile
import sys

PUBLIC = ('index.html', 'impressum.html', 'datenschutz.html', 'bestaetigt.html', 'assets')

def package(source, output):
    source, output = Path(source), Path(output)
    for name in PUBLIC:
        path = source / name
        if not path.exists() or path.is_symlink():
            raise ValueError('missing_or_linked_public_entry')
        paths = [path, *path.rglob('*')] if path.is_dir() else [path]
        if any(p.is_symlink() or not (p.is_file() or p.is_dir()) or p.name.startswith('.') for p in paths):
            raise ValueError('unsafe_public_asset')
    with tarfile.open(output, 'w:gz') as archive:
        for name in PUBLIC:
            archive.add(source / name, arcname=name)
    return hashlib.sha256(output.read_bytes()).hexdigest()

if __name__ == '__main__':
    print(package(sys.argv[1], sys.argv[2]))
