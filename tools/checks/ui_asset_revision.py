"""Rebuilding assets must invalidate URLs without restarting the daemon."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from gloaming.share import _ui_asset_rev


class AssetRevisionTest(unittest.TestCase):
    def test_live_rebuild_and_font_timestamp(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            for kind in ('scripts', 'styles', 'fonts'):
                (base / kind).mkdir()
            script = base / 'scripts/app.js'
            script.write_text('old')
            (base / 'styles/app.css').write_text('body{}')
            font = base / 'fonts/test.woff2'
            font.write_bytes(b'font')
            os.utime(font, ns=(9_000_000_000_000_000_000,) * 2)
            with patch('gloaming.share._resolve_ui_asset_dir', side_effect=lambda kind: base / kind):
                before = _ui_asset_rev()
                self.assertEqual(before, _ui_asset_rev())
                script.write_text('new')  # Same length, and older than the font.
                self.assertNotEqual(before, _ui_asset_rev())
                before = _ui_asset_rev()
                script.unlink()
                self.assertNotEqual(before, _ui_asset_rev())


if __name__ == '__main__':
    unittest.main()
