const assert=require('node:assert/strict');
const {chromium}=require(process.argv[4]);
(async()=>{
 const browser=await chromium.connectOverCDP(process.argv[3]);const ctx=await browser.newContext({viewport:{width:1440,height:950}});
 try{
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const clips=(await (await ctx.request.get(process.argv[2]+'/api/clips')).json()).clips;
  const clip=clips.find(c=>c.pad_inputs && c.audio_tracks?.length>1);assert(clip);
  // Fixture keyboard events exercise preview without changing recorded sidecars.
  clip.keys=true;
  await page.route('**/api/clips',r=>r.fulfill({json:{clips}}));
  await page.route(`**/api/clips/${clip.slug}/keys`,r=>r.fulfill({json:{keys:[[0,60,'W']]}}));
  let saved={version:1,tracks:[{id:'t',type:'text',label:'T1'},{id:'v',type:'video',label:'V1'},{id:'a',type:'audio',label:'A1'}],items:[{id:'source',kind:'clip',trackId:'v',clipId:clip.slug,start:0,dur:60,offset:0}]};
  await page.route('**/api/editor/project',async r=>{if(r.request().method()==='POST'){saved=r.request().postDataJSON();await r.fulfill({json:{ok:true}});}else await r.fulfill({json:{project:saved,missing:[]}});});
  let exported;await page.route('**/api/editor/export',r=>{exported=r.request().postDataJSON();return r.fulfill({status:400,json:{error:'Test only'}});});
  const settle=()=>page.waitForTimeout(900);
  await page.goto(process.argv[2]);await page.getByLabel('More tools').click();await page.getByRole('button',{name:'Editor',exact:true}).click();await page.locator('.ed-item-clip').waitFor();await settle();
  assert.equal(await page.locator('.cut-editor').getAttribute('data-mode'),'easy');
  assert.equal(saved.items.filter(i=>i.kind==='audio').length,clip.audio_tracks.filter(s=>s.title!=='Combined mix').length);
  assert(!saved.tracks.some(t=>t.label==='Combined mix'));
  assert.equal(await page.getByRole('button',{name:'Effects',exact:true}).count(),0);
  assert.equal(await page.locator('.ed-item-audio').count(),0);
  const stage=await page.locator('.ed-stage').boundingBox();assert(stage.height>350,'Large easy preview');
  assert.equal(await page.locator('.cut-monitor input:visible,.cut-monitor [role=switch]:visible').count(),0,'Settings outside monitor');
  await page.waitForFunction(()=>!!document.querySelector('.ed-stage .pad-replay canvas'));
  await page.getByRole('switch',{name:'Keyboard inputs',exact:true}).click();await settle();
  assert(saved.keyboard);await page.locator('.ed-stage .key-overlay').waitFor();await page.locator('.ed-stage [data-key=W][data-down]').waitFor();
  // Capture easy layout before switching to the full timeline.
  if(process.argv[5])await page.screenshot({path:process.argv[5]+'/easy.png'});
  await page.getByRole('button',{name:'Focus preview',exact:true}).click();
  await page.waitForTimeout(150);const focused=await page.locator('.ed-stage').boundingBox();assert(focused.height>stage.height+50);
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();
  await page.getByRole('button',{name:'Advanced',exact:true}).click();await page.locator('.ed-item-audio').first().waitFor();
  await page.locator('.ed-item-clip').first().click({position:{x:40,y:20}});
  await page.getByRole('button',{name:'Unlink audio',exact:true}).click();await settle();assert(saved.items.every(i=>!i.groupId));
  await page.getByRole('button',{name:'Relink audio',exact:true}).click();await settle();assert(saved.items.every(i=>i.groupId));
  await page.keyboard.press('Control+z');await settle();assert(saved.items.every(i=>!i.groupId),'Ctrl+Z undoes relink');
  await page.keyboard.press('Control+Shift+z');await settle();assert(saved.items.every(i=>i.groupId),'Ctrl+Shift+Z redoes relink');
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'ئ',code:'KeyZ',ctrlKey:true,bubbles:true,cancelable:true})));
  await settle();assert(saved.items.every(i=>!i.groupId),'Arabic keyboard undo');
  await page.getByRole('button',{name:'Relink audio',exact:true}).click();await settle();
  const ruler=await page.locator('#ed-ruler').boundingBox();await page.mouse.click(ruler.x+120,ruler.y+10);await page.getByRole('button',{name:'Split',exact:true}).click();await settle();
  assert.equal(saved.items.length,2*clip.audio_tracks.filter(s=>s.title!=='Combined mix').length+2);
  await page.getByRole('button',{name:'Effects',exact:true}).click();await page.locator('.ed-fx-row').first().click();await settle();assert(saved.items.some(i=>i.trans));
  await page.locator('.cut-drawer').getByRole('button',{name:'Close',exact:true}).click();
  if(process.argv[5])await page.screenshot({path:process.argv[5]+'/advanced.png'});
  const before=JSON.stringify(saved.items);await page.getByRole('button',{name:'Easy',exact:true}).click();await settle();assert.equal(JSON.stringify(saved.items),before,'Mode switches preserve edits');
  const mute=page.locator('.cut-source button').first();await mute.click();await settle();assert(saved.tracks.some(t=>t.type==='audio'&&t.muted));
  await page.getByRole('button',{name:'Export',exact:true}).click();
  assert.equal(await page.getByText('Include recorded controller inputs',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Start export',exact:true}).click();await page.waitForTimeout(300);assert(exported.keys && exported.pad_inputs);
  assert(exported.project.keyboard);assert.deepEqual(errors,[]);
  console.log('PASS Easy/Advanced layout, large/focus preview, sources without mix, keyboard/controller preview, relink, Ctrl+Z and Arabic shortcut, linked cuts, effects, nondestructive mode switching and export settings');
 }finally{await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
