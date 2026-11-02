"""Run with the project's Python: python tools/checks/port_binding.py."""
import asyncio
import errno
import socket
import unittest
from unittest.mock import patch

from aiohttp import ClientSession, web
from gloaming.share import _bind_site


class BindingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = web.Application()
        async def identity(request):
            return web.Response(text='gloaming-test')
        app.router.add_get('/', identity)
        self.runner = web.AppRunner(app)
        await self.runner.setup()

    async def asyncTearDown(self):
        await self.runner.cleanup()

    async def test_busy_ports_remain_owned_and_http_uses_fallback(self):
        for host in ('127.0.0.1', '0.0.0.0'):
            with socket.socket() as occupied:
                occupied.bind((host, 0))
                occupied.listen()
                port = occupied.getsockname()[1]
                site, actual = await _bind_site(self.runner, host, port)
                self.assertNotEqual(actual, port)
                self.assertEqual(occupied.getsockname()[1], port)
                async with ClientSession() as client:
                    async with client.get(f'http://127.0.0.1:{actual}/') as response:
                        self.assertEqual(await response.text(), 'gloaming-test')
                await site.stop()

    async def test_free_port_is_kept(self):
        site, port = await _bind_site(self.runner, '127.0.0.1', 0)
        await site.stop()
        site, actual = await _bind_site(self.runner, '127.0.0.1', port)
        self.assertEqual(actual, port)

    async def test_other_bind_errors_are_not_hidden(self):
        with patch('gloaming.share.socket.socket') as factory:
            factory.return_value.bind.side_effect = OSError(errno.EACCES, 'denied')
            with self.assertRaises(PermissionError):
                await _bind_site(self.runner, '127.0.0.1', 8765)
            self.assertEqual(factory.return_value.bind.call_count, 1)
            factory.return_value.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
