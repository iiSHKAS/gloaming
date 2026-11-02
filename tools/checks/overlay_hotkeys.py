"""Overlay shortcut registration, conflict validation and persistent toggle checks."""
import tempfile
from pathlib import Path
import unittest
from unittest.mock import AsyncMock, Mock, patch

from gloaming import config
from gloaming.main import GloamingDaemon


class OverlayHotkeys(unittest.IsolatedAsyncioTestCase):
    async def test_pad_binding_toggles_only_pad_and_persists(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(config, 'CONFIG_DIR', Path(tmp)), patch.object(config, 'CONFIG_PATH', Path(tmp)/'config.toml'):
            cfg = config.Config()
            cfg.hotkeys.pad_overlay = 'KEY_RIGHTCTRL+KEY_F8'
            cfg.overlay.keys = True
            cfg.overlay.pad = False
            config.save(cfg)
            daemon = GloamingDaemon.__new__(GloamingDaemon)
            daemon.cfg = cfg
            daemon.share = None
            daemon.controller = Mock()
            daemon.hotkeys = Mock()
            daemon._sync_pad_overlay = AsyncMock()
            daemon._sync_key_overlay = AsyncMock()
            GloamingDaemon._bind_hotkeys(daemon)
            callbacks = dict(call.args for call in daemon.hotkeys.on.call_args_list)
            callback = callbacks['KEY_LEFTCTRL+KEY_F8']
            await callback()
            self.assertTrue(daemon.cfg.overlay.pad)
            self.assertTrue(config.load().overlay.pad)
            self.assertTrue(config.load().overlay.keys)
            await callback()
            self.assertFalse(config.load().overlay.pad)
            self.assertTrue(config.load().overlay.keys)
            self.assertEqual(daemon._sync_pad_overlay.await_count, 2)
            daemon._sync_key_overlay.assert_not_awaited()
            daemon.hotkeys.reset_mock()
            cfg.hotkeys.pad_overlay = None
            GloamingDaemon._bind_hotkeys(daemon)
            self.assertNotIn('KEY_LEFTCTRL+KEY_F8', dict(call.args for call in daemon.hotkeys.on.call_args_list))

    def test_collisions_include_other_overlay_and_clip_keys(self):
        for conflict in ('KEY_F9', 'KEY_LEFTCTRL+KEY_F8'):
            cfg = config.Config()
            cfg.hotkeys.key_overlay = 'KEY_RIGHTCTRL+KEY_F8'
            cfg.hotkeys.pad_overlay = conflict
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                config.validate_hotkeys(cfg.hotkeys)
        cfg.hotkeys.pad_overlay = 'KEY_F10'
        config.validate_hotkeys(cfg.hotkeys)


if __name__ == '__main__':
    unittest.main()
