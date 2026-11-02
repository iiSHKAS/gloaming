const assert=require('node:assert/strict');
const {chromium}=require(process.argv[4]);
(async()=>{
 const browser=await chromium.connectOverCDP(process.argv[3]);
 const ctx=await browser.newContext({viewport:{width:1600,height:1100}});
 try{
  const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const api=process.argv[2];
  const clips=(await (await ctx.request.get(api+'/api/clips')).json()).clips;
  const clip=clips.find(c=>c.pad_inputs && c.audio_tracks?.length>1);assert(clip,'Need a controller clip with separate audio');
  const sourceCount=clip.audio_tracks.filter(s=>s.title!=='Combined mix').length;
  let saved={version:1,tracks:[{id:'t',type:'text',label:'T1'},{id:'v',type:'video',label:'V1'},{id:'a',type:'audio',label:'A1'}],items:[{id:'source',kind:'clip',trackId:'v',clipId:clip.slug,start:0,dur:Math.min(60,clip.duration),offset:0}]};
  await page.route('**/api/editor/project',async route=>{
    if(route.request().method()==='POST'){saved=route.request().postDataJSON();await route.fulfill({json:{ok:true}});}
    else await route.fulfill({json:{project:saved,missing:[]}});
  });
  let exported=null;
  await page.route('**/api/editor/export',route=>{exported=route.request().postDataJSON();return route.fulfill({status:400,json:{error:'Test only: no file created'}});});
  const settle=()=>page.waitForTimeout(950);
  await page.goto(api);await page.getByLabel('More tools').click();await page.getByRole('button',{name:'Editor',exact:true}).click();await page.getByRole('button',{name:'Advanced',exact:true}).click();
  await page.locator('.ed-item-audio').first().waitFor();await settle();
  assert.equal(saved.items.filter(i=>i.kind==='audio').length,sourceCount);
  await page.waitForFunction(()=>{const c=document.querySelector('.ed-stage .pad-replay canvas');return c && c.getContext('2d').getImageData(0,0,400,328).data.some(v=>v);});
  // Moving, trimming and duplicating video must carry its audio, too.
  const videoItem=page.locator('.ed-item-clip').first();
  let vb=await videoItem.boundingBox();
  await page.mouse.move(vb.x+40,vb.y+20);await page.mouse.down();await page.mouse.move(vb.x+120,vb.y+20,{steps:5});await page.mouse.up();await settle();
  assert(saved.items[0].start>0);assert.equal(new Set(saved.items.map(i=>i.start)).size,1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  const handle=await videoItem.locator('[data-handle="r"]').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x-100,handle.y+handle.height/2,{steps:5});await page.mouse.up();await settle();
  assert(saved.items[0].dur<60);assert.equal(new Set(saved.items.map(i=>i.dur)).size,1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  await videoItem.click({position:{x:40,y:20}});await page.getByRole('button',{name:'Duplicate',exact:true}).click();await settle();
  assert.equal(saved.items.length,2*(sourceCount+1));
  assert.equal(new Set(saved.items.filter(i=>i.start>0).map(i=>i.groupId)).size,1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  // Cut all sources at the same playhead, retaining offsets and links.
  await page.locator('.ed-item-clip').click({position:{x:40,y:20}});
  const ruler=await page.locator('#ed-ruler').boundingBox();await page.mouse.click(ruler.x+12*10,ruler.y+10);
  await page.getByRole('button',{name:'Split',exact:true}).click();await settle();
  assert.equal(saved.items.length,2*(sourceCount+1));
  const starts=[...new Set(saved.items.map(i=>i.start))];assert.equal(starts.length,2);
  for(const start of starts){const group=saved.items.filter(i=>i.start===start);assert.equal(new Set(group.map(i=>i.groupId)).size,1);assert.equal(new Set(group.map(i=>i.dur)).size,1);}
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();assert.equal(saved.items.length,sourceCount+1);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await settle();assert.equal(saved.items.length,2*(sourceCount+1));
  await page.locator('.ed-item-clip').first().click({position:{x:30,y:20}});
  await page.getByRole('button',{name:'Unlink audio',exact:true}).click();await settle();
  assert(saved.items.filter(i=>i.start===0).every(i=>!i.groupId));
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  await page.getByRole('button',{name:'Delete',exact:true}).click();await settle();
  assert.equal(saved.items.length,sourceCount+1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await settle();
  // Mute is a track property and remains independent of group selection.
  const mute=page.locator('[data-track-mute][aria-pressed=false]').first();const lane=await mute.getAttribute('data-track-mute');await mute.click();await settle();assert(saved.tracks.find(t=>t.id===lane).muted);
  // Controller is editable in the stage and persists with this project.
  const pad=page.locator('.ed-stage .pad-replay');const b=await pad.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x-100,b.y-80,{steps:5});await page.mouse.up();await settle();
  assert(saved.controller.enabled);assert(saved.controller.position[0]<.98);
  await page.locator('.ed-item-clip').first().click({position:{x:30,y:20}});
  await page.getByRole('button',{name:'Effects',exact:true}).click();await page.locator('.ed-fx-row').first().click();await settle();assert(saved.items.find(i=>i.id==='source').trans);
  assert.equal(await page.locator('.cut-edit-tools button').count(),3);
  assert.equal(await page.locator('.cut-edit-tools .cut-clear').count(),0,'Reset outside tool group');
  const junction=page.locator('[data-junction="source"]');
  await junction.hover();
  const popup=page.locator('body > .ed-junction-pill.floating');await popup.waitFor();
  const popupBox=await popup.boundingBox(),scrollBox=await page.locator('.ed-tl-scroll').boundingBox();
  assert(popupBox.x>=scrollBox.x+180,'Transition card clears track rail at time zero');
  await page.mouse.move(popupBox.x+popupBox.width/2,popupBox.y+popupBox.height/2,{steps:8});
  await page.waitForTimeout(400);assert(await popup.isVisible(),'Moving up into card keeps it open');
  const oldLength=saved.items.find(i=>i.id==='source').trans.len;
  await popup.locator('[data-bump="0.1"]').click();await settle();
  assert(saved.items.find(i=>i.id==='source').trans.len>oldLength);
  await page.keyboard.press('Escape');assert.equal(await popup.count(),0);
  await page.keyboard.press('Control+z');await settle();assert.equal(saved.items.find(i=>i.id==='source').trans.len,oldLength);
  await junction.locator('[role=button]').focus();await page.keyboard.press('Enter');await popup.waitFor();
  await popup.locator('[data-rm]').click();await settle();assert(!saved.items.find(i=>i.id==='source').trans);
  await page.keyboard.press('Control+z');await settle();assert(saved.items.find(i=>i.id==='source').trans);
  await page.getByRole('button',{name:'Remove effect',exact:true}).click();await settle();assert(!saved.items.find(i=>i.id==='source').trans);
  await page.getByRole('button',{name:'Export',exact:true}).click();
  assert.equal(await page.getByText('Include recorded controller inputs',{exact:true}).count(),0);
  await page.getByRole('button',{name:'Start export',exact:true}).click();await page.waitForTimeout(250);
  assert(exported.pad_inputs);assert.deepEqual(exported.pad_position,saved.controller.position);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const remembered=JSON.stringify(saved.controller);
  await page.reload();await page.getByLabel('More tools').click();await page.getByRole('button',{name:'Editor',exact:true}).click();
  await page.locator('.ed-stage .pad-replay').waitFor();await settle();
  assert.equal(JSON.stringify(saved.controller),remembered);
  assert.equal(saved.items.length,2*(sourceCount+1),'Reload must not duplicate audio');
  assert(saved.tracks.find(t=>t.id===lane).muted);
  // Automatic audio lanes must still play after seeking into the clip.
  const mid=await page.locator('#ed-ruler').boundingBox();await page.mouse.click(mid.x+12*30,mid.y+10);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(1400);
  const times=()=>page.locator('.ed-stage video:not(.ed-vhide)').evaluateAll(videos=>videos.filter(v=>!v.paused).map(v=>v.currentTime));
  const first=await times();await page.waitForTimeout(700);const second=await times();
  assert(first.length && second.some(v=>v>Math.min(...first)+.3),'Playback must advance after mid-clip seek');
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  if(process.argv[5])await page.screenshot({path:process.argv[5]});
  assert.deepEqual(errors,[]);
  console.log('PASS editor controller rendering/drag/export, automatic sources, linked cut+undo/redo, per-track mute and one-click effects; project writes/export isolated');
 }finally{await ctx.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
