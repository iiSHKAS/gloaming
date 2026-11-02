// Optional integration check: node script URL CDP_URL PLAYWRIGHT_MODULE.
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[4]);
(async()=>{
 const browser=await chromium.connectOverCDP(process.argv[3]);
 const ctx=await browser.newContext({viewport:{width:1280,height:900}});
 try {
  const page=await ctx.newPage(),errors=[];let renders=0;
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(r.url().endsWith('/api/controller-preview'))renders++;});
  const open=async()=>{
   await page.goto(process.argv[2]);
   await page.getByText('Library',{exact:true}).first().click();
   await page.locator('.clip-card').first().dblclick();
   await page.locator('.pad-replay').waitFor();
   await page.waitForFunction(()=>{const c=document.querySelector('.pad-replay canvas');return c && c.getContext('2d').getImageData(0,0,400,328).data.some(v=>v);});
  };
  await open();
  await page.waitForTimeout(150);const before=renders;await page.waitForTimeout(200);
  assert.equal(renders,before,'Unchanged paused state must not keep rendering');
  const pad=page.locator('.pad-replay');const box=await pad.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x-300,box.y-250,{steps:6});await page.mouse.up();
  assert.equal(await page.locator('.viewer-video').evaluate(v=>v.paused),true,'Dragging must not toggle playback');
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('gloaming-viewer-pad-position')));
  assert(stored[0]<.9 && stored[1]<.9,'Dragging updates normalized position');
  await pad.focus();await page.keyboard.press('ArrowLeft');
  const keyPosition=await page.evaluate(()=>JSON.parse(localStorage.getItem('gloaming-viewer-pad-position')));
  assert(keyPosition[0]<stored[0],'Arrow keys move the overlay');
  await page.locator('.viewer-video').evaluate(v=>{v.currentTime=60;});await page.waitForTimeout(250);
  await page.locator('.viewer-video').evaluate(v=>{v.currentTime=0;});await page.waitForTimeout(250);
  assert.equal(await pad.locator('[role=status]').count(),0,'Seek preserves preview');
  await open();
  const restored=await page.evaluate(()=>JSON.parse(localStorage.getItem('gloaming-viewer-pad-position')));
  assert.deepEqual(restored,keyPosition);
  const visible=await pad.boundingBox(),area=await page.locator('.pad-replay-area').boundingBox();
  assert(visible.x>=area.x && visible.y>=area.y && visible.x+visible.width<=area.x+area.width+1);
  assert.deepEqual(errors,[]);
  console.log('PASS current artwork, idle rendering, drag without playback, keyboard, seek, position persistence and video bounds');
 } finally {await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
