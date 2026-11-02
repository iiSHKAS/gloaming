import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const code=stripTypeScriptTypes(readFileSync(new URL('../../ui-src/engine/editorAudio.ts',import.meta.url),'utf8'),{mode:'transform'});
const {expandAudio,migrateAudio,splitLinked,linkedItems,relinkCandidates}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
let id=0;const uid=()=>`i${++id}`;
const source={slug:'source',audio_tracks:[{index:0,title:'Combined mix'},{index:1,title:'Game'},{index:2,title:'Microphone'}]};
const project={tracks:[{id:'v',type:'video',label:'V1'},{id:'a',type:'audio',label:'A1'}],items:[{id:'clip',kind:'clip',clipId:'source',trackId:'v',start:0,dur:20,offset:3}]};
assert(migrateAudio(project,[source],uid));assert.equal(project.items.length,3);
assert(!migrateAudio(project,[source],uid));assert.equal(project.items.length,3);
assert.equal(project.tracks.find(t=>t.label==='Combined mix'),undefined);
assert.equal(project.tracks.find(t=>t.label==='Microphone').muted,false);
const group=linkedItems(project,project.items[0]);assert.equal(group.length,3);
group.find(i=>i.audioStream===2).volume=.4;
splitLinked(project,group[2],8,uid);
assert.equal(project.items.length,6);
for(const i of project.items){assert.equal(i.dur,i.start===0?8:12);assert.equal(i.offset,i.start===0?3:11);}
assert.equal(new Set(project.items.filter(i=>i.start===8).map(i=>i.groupId)).size,1);
assert.notEqual(project.items[0].groupId,project.items[3].groupId);
assert.equal(project.items.find(i=>i.start===8 && i.audioStream===2).volume,.4);
const next={id:uid(),kind:'clip',clipId:'source',trackId:'v',start:20,dur:10};project.items.push(next);expandAudio(project,next,source,uid);
assert.equal(project.tracks.length,3,'Sequential clips reuse named source lanes');
const legacy={tracks:[],items:[{id:'v',kind:'clip',clipId:'s',start:0,dur:5,muted:true},{id:'a',kind:'audio',clipId:'s',start:0,dur:5}]};
assert(migrateAudio(legacy,[],uid));assert.equal(legacy.items[0].groupId,legacy.items[1].groupId);
for(const i of legacy.items){delete i.groupId;i.audioUnlinked=true;}
assert(!migrateAudio(legacy,[],uid),'Explicit unlink must survive reload');
assert.equal(relinkCandidates(legacy,legacy.items[0]).length,2);
legacy.items[1].start=1;assert.equal(relinkCandidates(legacy,legacy.items[0]).length,0,'Relink must not move edited audio');
console.log('PASS automatic audio lanes, mix mute, idempotent migration, linked split/offsets/volume, lane reuse and legacy/unlinked projects');
const old={tracks:[{id:'v',type:'video',label:'V1'},{id:'mix',type:'audio',label:'Combined mix',muted:true},{id:'g',type:'audio',label:'Game',muted:true},{id:'m',type:'audio',label:'Microphone',muted:false}],items:[
{id:'v1',kind:'clip',clipId:'source',trackId:'v',start:0,dur:5,muted:true,audioUnlinked:true},
{id:'m0',kind:'audio',clipId:'source',trackId:'mix',start:0,dur:5,audioStream:0},
{id:'m1',kind:'audio',clipId:'source',trackId:'g',start:0,dur:5,audioStream:1},
{id:'m2',kind:'audio',clipId:'source',trackId:'m',start:0,dur:5,audioStream:2}]};
assert(migrateAudio(old,[source],uid));assert.equal(old.items.length,3);assert(!old.tracks.some(t=>t.id==='mix'));
assert(old.tracks.find(t=>t.id==='g').muted,'Original mute choices survive migration');
assert.equal(relinkCandidates(old,old.items[0]).length,3);
assert(!migrateAudio(old,[source],uid));
console.log('PASS redundant legacy mix removed, original source mute choices preserved and relink available');
