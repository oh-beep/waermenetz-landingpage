import importlib.util
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import hashlib

def module(path, name):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

pack=module('scripts/package-public.py','pack')
activate=module('deploy/activate-static.py','activate')

class PublicReleaseTest(unittest.TestCase):
    def test_only_public_files_and_nested_fonts_are_packaged(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            for name in pack.PUBLIC[:-1]: (root/name).write_text('public')
            (root/'assets/fonts').mkdir(parents=True);(root/'assets/fonts/font.woff2').write_bytes(b'font')
            for name in ['.env','google-apps-script.js','secret.js']: (root/name).write_text('PRIVATE_MARKER')
            (root/'services').mkdir();(root/'services/server.cjs').write_text('PRIVATE_MARKER')
            output=root/'release.tar.gz';pack.package(root,output)
            with tarfile.open(output) as t:
                activate.validate_members(t.getmembers())
                self.assertIn('assets/fonts/font.woff2',t.getnames())
                self.assertFalse(any('PRIVATE_MARKER' in t.extractfile(m).read().decode(errors='ignore') for m in t.getmembers() if m.isfile()))
            (root/'assets/leak').symlink_to(root/'.env')
            with self.assertRaises(ValueError): pack.package(root,output)

    def test_activation_rejects_scope_escape_and_links(self):
        good=[tarfile.TarInfo(n) for n in pack.PUBLIC]
        good[-1].type=tarfile.DIRTYPE
        for name in ['../.env','/tmp/x','services/server.cjs','.env','assets/../../x','assets/.env']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                activate.validate_members(good+[tarfile.TarInfo(name)])
        link=tarfile.TarInfo('assets/link');link.type=tarfile.SYMTYPE;link.linkname='/etc/passwd'
        with self.assertRaises(ValueError): activate.validate_members(good+[link])
        with self.assertRaises(ValueError): activate.validate_members([])

    def test_failed_public_readback_restores_all_previous_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);base=root/'public';base.mkdir();candidate=root/'candidate';candidate.mkdir()
            for directory,content in [(base,'previous'),(candidate,'candidate')]:
                for name in pack.PUBLIC[:-1]: (directory/name).write_text(content)
                (directory/'assets').mkdir();(directory/'assets/image.svg').write_text(content)
            incoming=root/'incoming';(incoming/'1-1').mkdir(parents=True)
            archive=incoming/'1-1/public.tar.gz';digest=pack.package(candidate,archive)
            class Unavailable:
                def open(self,*a,**kw): raise OSError('synthetic unreachable')
            with patch.object(activate,'BASE',base),patch.object(activate,'STATE',root/'state'),patch.object(activate,'INCOMING',incoming),patch.object(activate.subprocess,'run') as command,patch.object(activate.urllib.request,'build_opener',return_value=Unavailable()),patch.object(activate.time,'sleep'):
                with self.assertRaisesRegex(ValueError,'public_readback_mismatch'):
                    activate.main('a'*40,digest,'1-1')
                command.assert_called_once()
            for name in pack.PUBLIC[:-1]:self.assertEqual((base/name).read_text(),'previous')
            self.assertEqual((base/'assets/image.svg').read_text(),'previous')
            self.assertFalse((base/'.restore').exists())

if __name__=='__main__': unittest.main()
