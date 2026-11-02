const assert=require('node:assert/strict');
const {chromium}=require(process.argv[4]);
(async()=>{
 const browser=await chromium.connectOverCDP(process.argv[3]);const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 try{
  const page=await ctx.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
  let config=await (await ctx.request.get(process.argv[2]+'/api/config')).json();config.recording.live_replay=true;
  let status=await (await ctx.request.get(process.argv[2]+'/api/status')).json();status.running=true;
  await ctx.addInitScript(()=>{localStorage.setItem('gloaming_tutorial_shown','1');});
  await page.route('**/api/config',r=>{if(r.request().method()==='POST'){const patch=r.request().postDataJSON();writes.push(patch);for(const [key,v] of Object.entries(patch))config[key]={...config[key],...v};return r.fulfill({json:{ok:true,applied:true}});}return r.fulfill({json:config});});
  await page.route('**/api/status',r=>r.fulfill({json:status}));
  await page.route('**/api/live',r=>r.fulfill({json:{enabled:true,running:true}}));
  await page.goto(process.argv[2]);await page.locator('.capture-home').waitFor();
  const toggle=page.getByRole('switch',{name:'Live preview',exact:true});await toggle.click();assert.equal(await page.locator('.capture-live').count(),0);assert.equal(writes.length,0,'Hiding preview never changes recording');
  await page.reload();await page.locator('.capture-home').waitFor();assert.equal(await toggle.getAttribute('aria-checked'),'false');assert.equal(await page.locator('.capture-live').count(),0);
  const oldColor=await page.locator('.studio-nav [aria-current]').evaluate(e=>getComputedStyle(e).color);
  await page.evaluate(()=>{localStorage.setItem('gloaming-custom-accent','#da79ac');localStorage.setItem('gloaming-theme','custom');window.dispatchEvent(new StorageEvent('storage',{key:'gloaming-theme'}));});
  await page.waitForTimeout(150);const newColor=await page.locator('.studio-nav [aria-current]').evaluate(e=>getComputedStyle(e).color);assert.notEqual(newColor,oldColor,'Navigation follows custom theme');
  for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No page overflow '+width);assert(await page.locator('.frame-content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'No content overflow '+width);}
  await page.setViewportSize({width:1440,height:1000});
  if(process.argv[5])await page.screenshot({path:process.argv[5]+'/capture-home.png'});
  await page.getByRole('switch',{name:'Microphone',exact:true}).click();assert(writes.some(p=>p.recording?.capture_microphone!==undefined));
  const writeCount=writes.length;await toggle.click();assert.equal(await page.locator('.capture-live').count(),1);await toggle.click();assert.equal(await page.locator('.capture-live').count(),0);assert.equal(writes.length,writeCount);
  config.recording.live_replay=false;status.running=false;await page.reload();await page.locator('.capture-home').waitFor();assert.equal(await page.locator('.capture-live').count(),0);assert.equal(await toggle.count(),0);assert(await page.getByRole('button',{name:'Set up Live Replay'}).isVisible());assert.equal(await page.locator('.capture-save-panel').count(),0);
  await page.getByRole('button',{name:'Library',exact:true}).click();assert.equal(await page.locator('.studio-frame[data-capture-home]').count(),0);await page.getByRole('button',{name:'GLOAMING home'}).click();assert.equal(await page.locator('.studio-frame[data-capture-home]').count(),1);
  assert.deepEqual(errors,[]);console.log('PASS: theme, responsive layout, preview preference without recorder changes, disabled replay, removed save card, mocked audio, library navigation');
 }finally{await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
