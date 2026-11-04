import {KeyOverlay} from './KeyOverlay';
import type {KeyInterval} from '../lib/keyLayout';
import {useCallback, useEffect, useState, type RefObject} from 'react';
import {PadReplay, type PadRecording} from './PadReplay';
import type {EditorEngine} from '../engine/editor';

/** Follow the main program's source time, including trims, cuts and gaps. */
export function EditorController({engine,container,position,onPositionChange}: {
  engine:EditorEngine; container:RefObject<HTMLDivElement|null>; position:[number,number];
  onPositionChange:(p:[number,number])=>void;
}){
  const [slug,setSlug]=useState<string|null>(null);
  const [data,setData]=useState<{slug:string;pad:PadRecording}|null>(null);
  useEffect(()=>{
    let raf=0;const tick=()=>{setSlug(engine.controllerFrame()?.clipId ?? null);raf=requestAnimationFrame(tick);};tick();
    return ()=>cancelAnimationFrame(raf);
  },[engine]);
  useEffect(()=>{
    setData(null);if(!slug)return;
    const controller=new AbortController();
    void fetch(`/api/clips/${encodeURIComponent(slug)}/pad-inputs`,{signal:controller.signal})
      .then(r=>r.ok?r.json():null).then(body=>{if(body?.pad && !controller.signal.aborted)setData({slug,pad:body.pad});}).catch(()=>{});
    return ()=>controller.abort();
  },[slug]);
  const clock=useCallback(()=>engine.controllerFrame()?.time ?? 0,[engine]);
  return data && data.slug===slug ? <PadReplay key={slug} data={data.pad} container={container} clock={clock}
    savedPosition={position} onPositionChange={onPositionChange}/> : null;
}

export function EditorKeyboard({engine,container,position,onPositionChange}:{engine:EditorEngine;container:RefObject<HTMLDivElement|null>;position?:[number,number];onPositionChange:(p:[number,number])=>void}){
  const [slug,setSlug]=useState<string|null>(null);
  const [data,setData]=useState<{slug:string;keys:KeyInterval[]}|null>(null);
  useEffect(()=>{let raf=0;const tick=()=>{setSlug(engine.controllerFrame()?.clipId ?? null);raf=requestAnimationFrame(tick);};tick();return ()=>cancelAnimationFrame(raf);},[engine]);
  useEffect(()=>{
    setData(null);if(!slug)return;const abort=new AbortController();
    void fetch(`/api/clips/${encodeURIComponent(slug)}/keys`,{signal:abort.signal}).then(r=>r.ok?r.json():null)
      .then(body=>{if(Array.isArray(body?.keys) && !abort.signal.aborted)setData({slug,keys:body.keys});}).catch(()=>{});
    return ()=>abort.abort();
  },[slug]);
  const clock=useCallback(()=>engine.controllerFrame()?.time ?? 0,[engine]);
  return data && data.slug===slug ? <KeyOverlay intervals={data.keys} clock={clock} container={container} position={position} onPositionChange={onPositionChange}/> : null;
}
