import type {Clip} from '../lib/types';
import type {EdItem, EdProject} from './editorTypes';

/** Linked sources keep their own mute/volume, but share edit boundaries. */
export function linkedItems(project: EdProject, item: EdItem): EdItem[] {
  return item.groupId ? project.items.filter(i => i.groupId === item.groupId) : [item];
}
export function expandAudio(project: EdProject, clip: EdItem, source: Clip | undefined, uid: () => string): boolean {
  if(clip.kind !== 'clip' || clip.muted || !source?.audio_tracks?.length) return false;
  clip.groupId ??= uid(); clip.muted=true;
  const streams=source.audio_tracks.filter(s=>source.audio_tracks!.length===1 || s.title!=='Combined mix');
  // Work with original sources only; their combined mix would duplicate them.
  for(const stream of streams){
    const name=stream.title || `Audio ${stream.index+1}`;
    const free=(id:string)=>!project.items.some(i=>i.trackId===id && i.start<clip.start+clip.dur && i.start+i.dur>clip.start);
    let lane=project.tracks.find(t=>t.type==='audio' && t.label===name && free(t.id))
      ?? project.tracks.find(t=>t.type==='audio' && !project.items.some(i=>i.trackId===t.id));
    if(!lane){lane={id:uid(),type:'audio',label:name};project.tracks.push(lane);}
    if(!project.items.some(i=>i.trackId===lane!.id)) lane.muted=false;
    lane.label=name;
    project.items.push({id:uid(),kind:'audio',groupId:clip.groupId,trackId:lane.id,clipId:clip.clipId,
      start:clip.start,dur:clip.dur,offset:clip.offset || 0,audioStream:stream.index,volume:1,
      muted:false});
  }
  return true;
}
export function migrateAudio(project:EdProject, clips:Clip[],uid:()=>string):boolean {
  let changed=false;
  const removed=new Set<string>();
  project.items=project.items.filter(i=>{
    if(i.kind!=='audio')return true;
    const source=clips.find(c=>c.slug===i.clipId);
    const stream=source?.audio_tracks?.find(s=>s.index===(i.audioStream||0));
    if(stream?.title!=='Combined mix' || (source?.audio_tracks?.length||0)<2)return true;
    // Leave an intentionally standalone mix untouched when no sources replace it.
    const originals=source!.audio_tracks!.filter(s=>s.title!=='Combined mix');
    const covered=originals.every(s=>project.items.some(a=>a.kind==='audio' && a.clipId===i.clipId && a.audioStream===s.index && sameSpan(a,i)));
    if(!covered)return true;
    changed=true;removed.add(i.trackId);return false;
  });
  project.tracks=project.tracks.filter(t=>!removed.has(t.id) || project.items.some(i=>i.trackId===t.id));
  for(const clip of project.items.filter(i=>i.kind==='clip')){
    if(expandAudio(project,clip,clips.find(c=>c.slug===clip.clipId),uid)){changed=true;continue;}
    if(clip.groupId || !clip.muted || clip.audioUnlinked)continue;
    // Link legacy detached sources only when there is one unambiguous owner.
    const same=(i:EdItem)=>i.clipId===clip.clipId && Math.abs(i.start-clip.start)<.002 && Math.abs(i.dur-clip.dur)<.002 && Math.abs((i.offset||0)-(clip.offset||0))<.002;
    if(project.items.filter(i=>i.kind==='clip' && same(i)).length!==1)continue;
    const audio=project.items.filter(i=>i.kind==='audio' && !i.groupId && same(i));
    if(audio.length){clip.groupId=uid();for(const a of audio)a.groupId=clip.groupId;changed=true;}
  }
  return changed;
}
export function splitLinked(project:EdProject,item:EdItem,at:number,uid:()=>string):void {
  const group=linkedItems(project,item), rightGroup=item.groupId ? uid() : undefined;
  for(const part of group){
    if(at<=part.start || at>=part.start+part.dur)continue;
    const right={...part,id:uid(),groupId:rightGroup,start:at,dur:Math.round((part.start+part.dur-at)*1000)/1000,
      offset:Math.round(((part.offset||0)+at-part.start)*1000)/1000};
    delete right.trans;
    part.dur=Math.round((at-part.start)*1000)/1000;project.items.push(right);
  }
}

function sameSpan(a:EdItem,b:EdItem):boolean {
  return a.clipId===b.clipId && Math.abs(a.start-b.start)<.002 && Math.abs(a.dur-b.dur)<.002 && Math.abs((a.offset||0)-(b.offset||0))<.002;
}
/** Only relink unambiguous aligned sources; never change a user's timing. */
export function relinkCandidates(project:EdProject,item:EdItem):EdItem[] {
  if(item.kind==='text' || item.groupId)return [];
  const videos=project.items.filter(i=>i.kind==='clip' && sameSpan(i,item));
  if(videos.length!==1)return [];
  const video=videos[0];
  const audio=project.items.filter(i=>i.kind==='audio' && sameSpan(i,video) && (!i.groupId || i.groupId===video.groupId));
  return audio.length ? [video,...audio] : [];
}
