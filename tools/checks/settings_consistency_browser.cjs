// node tools/checks/settings_consistency_browser.cjs PLAYWRIGHT_MODULE CHROMIUM_BINARY
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.argv[2]);
(async () => {
  const browser = await chromium.launch({executablePath: process.argv[3], headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    page.setDefaultTimeout(6000);
    const errors = [], writes = [];
    page.on('pageerror', e => {errors.push(e.message); console.error(e.message);});
    let config = {recording: {backend:'gsr', fps:60, resolution:'1920x1080', color_depth:'8', video_quality:'high', encoder:'auto', buffer_duration:90, clip_duration:20, capture_audio:true, capture_microphone:true, gsr_audio_source:"device:game.monitor", audio_output_slots:[{source:"device:media.monitor",enabled:true},{source:"",enabled:false}]},hotkeys:{},output:{},ui:{},overlay:{}};
    await page.addInitScript(() => localStorage.setItem('gloaming_tutorial_shown', '1'));
    await page.routeWebSocket('**/api/**', () => {});
    await page.route('http://settings.test/**', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/config') {
        if (route.request().method() === 'POST') {
          const patch = route.request().postDataJSON(); writes.push(patch);
          for (const [key, value] of Object.entries(patch)) config[key] = {...config[key], ...value};
          return route.fulfill({json:{ok:true, applied:true}});
        }
        return route.fulfill({json: config});
      }
      const fixtures = {'/api/status':{backend:'gpu-screen-recorder'},'/api/clips':{clips:[]}, '/api/images':{images:[]}, '/api/playlists':{playlists:[]}, '/api/live':{enabled:false}, '/api/app-state':{tutorial_seen:true}, '/api/displays':{displays:[]}, '/api/audio-sources':{sources:[{id:'device:game.monitor',label:'Device: Monitor of Game',kind:'monitor'},{id:'device:media.monitor',label:'Device: Monitor of Media',kind:'monitor'}]}};
      if (url.pathname.startsWith('/api/')) return route.fulfill({json:fixtures[url.pathname] ?? {}});
      const file = path.join(__dirname, '../../gloaming/ui', url.pathname === '/' ? 'index.html' : url.pathname);
      return fs.existsSync(file) ? route.fulfill({path:file}) : route.fulfill({status:404,body:''});
    });
    await page.goto('http://settings.test/');
    await page.locator('.studio-header-right button.studio-icon').click();
    const basic = page.locator('[aria-labelledby="basic-settings-label"]');
    const advanced = page.locator('[aria-labelledby="advanced-settings-label"]');
    const quality = page.locator('#settings-quality');
    if(process.argv[4]) await page.screenshot({animations:'disabled',path:process.argv[4]+'/recording-quality.png'});
    const customBuffer = quality.getByRole('radio', {name:/Custom ·/});
    assert.equal(await customBuffer.getAttribute('aria-checked'), 'true');
    await customBuffer.click();
    const slider = page.locator('#settings-buffer-duration');
    await slider.waitFor();
    assert.equal(await slider.evaluate(e => document.activeElement === e), true);
    assert.equal(await slider.inputValue(), '90');
    if(process.argv[4]) {
      await page.screenshot({animations:'disabled',path:process.argv[4]+'/recording-advanced.png'});
      await page.locator('#settings-recording .recording-group').filter({hasText:'Capture method'}).scrollIntoViewIfNeeded();
      await page.screenshot({animations:'disabled',path:process.argv[4]+'/recording-capture.png'});
      await slider.scrollIntoViewIfNeeded();
    }
    const box = await slider.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.keyboard.down('Shift'); await page.mouse.move(x,y); await page.mouse.down();
    assert.equal(await slider.inputValue(), '90', 'Shift starts relative to the saved duration');
    await page.mouse.move(x+1,y); assert.equal(await slider.inputValue(),'91');
    await page.mouse.move(x+7,y); assert.equal(await slider.inputValue(),'97');
    await page.mouse.move(x+6,y); assert.equal(await slider.inputValue(),'96');
    await page.mouse.up(); await page.keyboard.up('Shift');
    await slider.press('Shift+ArrowRight'); assert.equal(await slider.inputValue(),'97');
    await slider.press('ArrowRight'); assert.equal(await slider.inputValue(),'127');
    await basic.getByRole('button',{name:/Recording quality/}).click();
    assert.equal(await quality.getByRole('radio',{name:/Custom ·/}).getAttribute('aria-checked'),'true');
    const profiles = quality.getByRole('radiogroup',{name:'Quality',exact:true});
    assert.equal(await profiles.getByRole('radio',{name:/Balanced/}).getAttribute('aria-checked'),'true');
    await profiles.getByRole('radio',{name:/Custom/}).click();
    assert.equal(await profiles.getByRole('radio',{name:/Balanced/}).getAttribute('aria-checked'),'true','Opening custom controls preserves the matched profile');
    await quality.getByRole('combobox',{name:'Colour depth'}).click();
    assert(await page.getByRole('option',{name:'10-bit (HEVC or AV1)',exact:true}).isVisible());
    await page.keyboard.press('Escape');
    await profiles.getByRole('radio',{name:/Balanced/}).click();
    assert.equal(await quality.getByRole('combobox',{name:'Frame rate'}).count(),0);
    await advanced.getByRole('button',{name:/Recording/}).click();
    await page.locator('#settings-recording').getByRole('combobox',{name:'Frame rate'}).click();
    const fpsMenu = page.getByRole('listbox',{name:'Frame rate'});
    assert.equal(await fpsMenu.evaluate(e=>parseFloat(getComputedStyle(e).maxHeight)),190,'Five rows plus padding and border');
    assert(await fpsMenu.evaluate(e=>e.scrollHeight>e.clientHeight),'Sixth option needs scrolling');
    await fpsMenu.evaluate(e=>{e.getAnimations().forEach(a=>a.finish());e.scrollTop=18;});
    const beforeHover = await fpsMenu.evaluate(e=>e.scrollTop);
    const menuBox = await fpsMenu.boundingBox();
    await page.mouse.move(menuBox.x+30,menuBox.y+menuBox.height-12);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await fpsMenu.evaluate(e=>e.scrollTop),beforeHover,'Hovering the partially visible last option must not scroll');
    await page.getByRole('combobox',{name:'Frame rate',exact:true}).press('End');
    assert(await fpsMenu.evaluate(e=>e.scrollTop>0),'Keyboard navigation reveals the last option');
    await page.getByRole('combobox',{name:'Frame rate',exact:true}).press('Home');
    await page.getByRole('option',{name:'30 fps',exact:true}).click();
    await basic.getByRole('button',{name:/Recording quality/}).click();
    assert.equal(await profiles.getByRole('radio',{name:/Custom/}).getAttribute('aria-checked'),'true');
    assert(await quality.getByRole('combobox',{name:'Frame rate'}).isVisible());
    await quality.getByRole('combobox',{name:'Frame rate'}).click();
    await page.getByRole('option',{name:'60 fps',exact:true}).click();
    assert.equal(await profiles.getByRole('radio',{name:/Balanced/}).getAttribute('aria-checked'),'true');
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:1000});
      assert(await page.locator('.settings-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Quality fits '+width);
    }
    await page.setViewportSize({width:1440,height:1000});
    await advanced.getByRole('button',{name:/Recording/}).click();
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:1000});
      assert(await page.locator('.settings-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Advanced recording fits '+width);
    }
    await page.setViewportSize({width:1440,height:1000});
    await basic.getByRole('button',{name:/Recording quality/}).click();
    assert(await quality.isVisible());
    await basic.getByRole('button',{name:/Audio/}).click();
    const basicAudio = page.locator('#settings-sound');
    assert.equal(await basicAudio.locator('.audio-device-card').count(),2);
    if(process.argv[4]) await page.screenshot({animations:'disabled',path:process.argv[4]+'/audio-basic.png'});
    const sourceLabel = await basicAudio.getByRole('combobox',{name:'Microphone source'}).innerText();
    assert(await basicAudio.getByRole('switch',{name:'Output 1',exact:true}).isVisible());
    await basicAudio.getByRole('switch',{name:'Microphone',exact:true}).click();
    await basicAudio.getByRole('button',{name:'Manage audio tracks'}).click();
    assert.equal(await page.locator('#settings-extra-outputs').evaluate(e=>document.activeElement===e),true);
    const advancedAudio = page.locator('#settings-audio');
    assert.equal(await advancedAudio.getByRole('switch',{name:'Microphone',exact:true}).getAttribute('aria-checked'),'false');
    assert.equal(await advancedAudio.getByRole('combobox',{name:'Microphone source'}).innerText(),sourceLabel);
    assert(await advancedAudio.getByRole('combobox',{name:'Output 1 source',exact:true}).isVisible());
    const outputs = advancedAudio.locator('.audio-device-card:not(.audio-device-mic)');
    assert.equal(await outputs.count(),3);
    const positions = await outputs.evaluateAll(cards=>cards.map(card=>({source:card.querySelector('.ui-select').getBoundingClientRect().y,volume:card.querySelector('.slider').getBoundingClientRect().y})));
    assert(positions.every(p=>Math.abs(p.source-positions[0].source)<1&&Math.abs(p.volume-positions[0].volume)<1),'Output sources and volume controls align');
    assert(await outputs.nth(2).getByRole('slider').isDisabled());
    await advancedAudio.getByRole('switch',{name:'Output 3',exact:true}).click();
    assert(!(await outputs.nth(2).getByRole('slider').isDisabled()));
    await advancedAudio.getByRole('switch',{name:'Output 3',exact:true}).click();
    assert(await outputs.nth(2).getByRole('slider').isDisabled());
    if(process.argv[4]) await page.screenshot({animations:'disabled',path:process.argv[4]+'/audio-advanced.png'});
    const micMode = advancedAudio.getByRole('combobox',{name:'wf-recorder microphone mode'});
    await micMode.scrollIntoViewIfNeeded();
    await micMode.click();
    const micMenu = page.getByRole('listbox',{name:'wf-recorder microphone mode'});
    assert.equal(await micMenu.getAttribute('data-placement'),'top','Bottom-of-window microphone menu opens above');
    assert.equal(await micMenu.evaluate(e=>e.scrollHeight<=e.clientHeight),true,'All three microphone modes fit');
    assert(await micMenu.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
    await page.keyboard.press('Escape');
    // Place this shared control near the top to exercise the opposite branch.
    await micMode.evaluate(e=>{e.style.position='fixed';e.style.top='80px';e.style.left='400px';e.style.zIndex='9999';});
    await micMode.click();
    assert.equal(await micMenu.getAttribute('data-placement'),'bottom');
    await page.keyboard.press('Escape');
    await micMode.evaluate(e=>e.removeAttribute('style'));
    for(const width of [1024,768,390]){
      await page.setViewportSize({width,height:1000});
      const fits = await page.locator('.settings-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
      if(!fits) console.log(await page.locator('.settings-body').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,nodes:[...e.querySelectorAll('*')].filter(n=>n.getBoundingClientRect().right>e.getBoundingClientRect().right).map(n=>[n.className,n.getBoundingClientRect().width]).slice(0,20)})));
      assert(fits,'Audio fits viewport '+width);
    }
    await basic.getByRole('button',{name:/Audio/}).click();
    for(const width of [390,768,1024,1440]){
      await page.setViewportSize({width,height:1000});
      assert(await page.locator('.settings-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Basic audio fits viewport '+width);
      assert.equal(await basicAudio.locator('.audio-device-card').count(),2);
    }
    assert(writes.some(p => p.recording?.buffer_duration === 127));
    assert.deepEqual(errors,[]);
    console.log('PASS: custom buffer selection/navigation/focus, Shift pixel precision, keyboard precision, shared profile state, custom details, depth labels, audio labels, synchronized microphone, aligned output controls, disabled levels, advanced navigation and responsive audio layouts');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
