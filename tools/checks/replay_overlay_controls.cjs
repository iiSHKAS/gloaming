// node tools/checks/replay_overlay_controls.cjs PLAYWRIGHT_MODULE CHROMIUM_BINARY
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.argv[2]);
(async () => {
  const browser = await chromium.launch({executablePath: process.argv[3], headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.hostMessages = [];
      window.webkit = {messageHandlers: {
        gloamingReplayFullscreen: {postMessage: value => window.hostMessages.push(value)},
        gloamingOverlay: {postMessage: value => window.hostMessages.push('close:' + value)},
      }};
    });
    let controller;
    await page.routeWebSocket('**/api/controller/events', socket => {controller = socket;});
    await page.route('http://replay.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/live') return route.fulfill({json: {enabled: false}});
      if (url.pathname.startsWith('/api/')) return route.fulfill({status: 503, json: {error: 'No recorder in control test'}});
      const file = path.join(__dirname, '../../gloaming/ui', url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
      return route.fulfill({path: file});
    });
    await page.goto('http://replay.test/?replayOverlay=1');
    await page.locator('.controller-tools').waitFor();
    const muted = () => page.locator('video').evaluate(video => video.muted);
    const fullscreen = () => page.locator('.replay-overlay-page').getAttribute('data-fullscreen');
    assert.equal(await muted(), true);
    await page.keyboard.press('m');
    assert.equal(await muted(), false);
    await page.keyboard.press('m');
    assert.equal(await muted(), true);
    // Physical shortcut with an Arabic keyboard layout.
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'ة', code: 'KeyM', bubbles: true})));
    assert.equal(await muted(), false);
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    assert.equal(await fullscreen(), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await fullscreen(), null);
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'ب', code: 'KeyF', bubbles: true})));
    await page.waitForFunction(() => document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    assert.equal(await fullscreen(), 'true');
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'f', code: 'KeyF', repeat: true, bubbles: true})));
    assert.equal(await fullscreen(), 'true', 'Holding F must not toggle repeatedly');
    const pad = async button => {
      controller.send(JSON.stringify({button, down: true, layout: 'xbox'}));
      controller.send(JSON.stringify({button, down: false}));
    };
    await pad('BTN_EAST');
    await page.waitForFunction(() => !document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    await pad('BTN_START');
    await page.waitForFunction(() => document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    await pad('BTN_THUMBR');
    await page.waitForFunction(() => !document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    await pad('BTN_THUMBL');
    await page.waitForFunction(() => document.querySelector('video').muted);
    await pad('BTN_THUMBL');
    await page.waitForFunction(() => !document.querySelector('video').muted);
    await page.getByRole('button', {name: 'Mute', exact: true}).click();
    assert.equal(await muted(), true);
    await page.getByRole('button', {name: 'Fullscreen', exact: true}).click();
    await page.waitForFunction(() => document.querySelector('.replay-overlay-page').hasAttribute('data-fullscreen'));
    assert.equal(await fullscreen(), 'true');
    await page.getByRole('button', {name: 'Exit fullscreen', exact: true}).click();
    assert.deepEqual(await page.evaluate(() => window.hostMessages), ['enter','exit','enter','exit','enter','exit','enter','exit']);
    assert.deepEqual(errors, []);
    console.log('PASS: keyboard, Arabic physical shortcuts, key repeat, controller socket, mouse, video mute property, fullscreen bridge and Back priority');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
