"""Run with the project's Python: python tools/checks/local_guard.py."""
import unittest

from aiohttp import ClientSession, web
from gloaming.share import _local_guard


class LocalGuardTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app = web.Application(middlewares=[_local_guard])
        async def ok(request):
            return web.Response(text='ok')
        app.router.add_get('/', ok)
        app.router.add_post('/api/quit', ok)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, '127.0.0.1', 0)
        await site.start()
        self.port = site._server.sockets[0].getsockname()[1]
        self.base = f'http://127.0.0.1:{self.port}'

    async def asyncTearDown(self):
        await self.runner.cleanup()

    async def status(self, method, path='/', **headers):
        async with ClientSession() as session:
            async with session.request(method, self.base + path, headers=headers) as response:
                return response.status

    async def test_same_origin_and_plain_clients_pass(self):
        self.assertEqual(await self.status('GET'), 200)
        self.assertEqual(await self.status('POST', '/api/quit'), 200)
        self.assertEqual(await self.status('POST', '/api/quit', Origin=self.base), 200)

    async def test_cross_origin_writes_are_refused(self):
        self.assertEqual(await self.status('POST', '/api/quit', Origin='https://evil.example'), 403)
        self.assertEqual(await self.status('POST', '/api/quit', Origin='http://127.0.0.1:1'), 403)
        self.assertEqual(await self.status('POST', '/api/quit', **{'Sec-Fetch-Site': 'cross-site'}), 403)

    async def test_cross_origin_reads_do_not_get_through_as_websockets(self):
        self.assertEqual(await self.status('GET', Origin='https://evil.example', Upgrade='websocket'), 403)

    async def test_rebinding_host_is_refused(self):
        self.assertEqual(await self.status('GET', Host='evil.example'), 403)


if __name__ == '__main__':
    unittest.main()
