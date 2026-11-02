import {useEffect, useRef, useState, type RefObject} from 'react';
import {t} from '../lib/i18n';
export interface PadState {buttons: Record<string, boolean>; axes: Record<string, [number, number]>; layout: string}
export interface PadRecording {version: number; duration: number; initial: PadState; events: [number, string, string, number | boolean, number][]}
export function readPadPosition(): [number, number] {
  try {
    const p = JSON.parse(localStorage.getItem('gloaming-viewer-pad-position') ?? 'null');
    if(Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v)))
      return p.map(v => Math.max(0, Math.min(1,v))) as [number,number];
  } catch { /* Use the default corner. */ }
  return [.98,.98];
}
export function PadReplay({video, data, container, clock, savedPosition, onPositionChange}: {
  video?: RefObject<HTMLVideoElement | null>; data: PadRecording;
  container?: RefObject<HTMLElement | null>; clock?: () => number;
  savedPosition?: [number,number]; onPositionChange?: (position:[number,number])=>void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState(()=>savedPosition ?? readPadPosition());
  const positionRef=useRef(position);
  useEffect(()=>{if(savedPosition){setPosition(savedPosition);positionRef.current=savedPosition;}},[savedPosition]);
  const [bounds, setBounds] = useState({left:0,top:0,width:0,height:0});
  const [failed, setFailed] = useState(false);
  const drag = useRef<{x:number;y:number;position:[number,number]} | null>(null);
  useEffect(() => {
    const el=video?.current ?? container?.current, parent=container?.current ?? el?.parentElement;
    if(!el || !parent) return;
    const resize=()=>{
      const box=el.getBoundingClientRect(), outer=parent.getBoundingClientRect();
      const ratio=container ? box.width/Math.max(1,box.height) : ((el as HTMLVideoElement).videoWidth || 16)/((el as HTMLVideoElement).videoHeight || 9);
      const width=Math.min(box.width,box.height*ratio),height=width/ratio;
      setBounds({left:box.left-outer.left+(box.width-width)/2,top:box.top-outer.top+(box.height-height)/2,width,height});
    };
    const observer=new ResizeObserver(resize); observer.observe(el);observer.observe(parent);
    el.addEventListener('loadedmetadata',resize); resize();
    return ()=>{observer.disconnect();el.removeEventListener('loadedmetadata',resize);};
  },[video,container]);
  useEffect(() => {
    let frame=0,cursor=0,previous=-1,last='',busy=false,disposed=false,next=0;
    let state:PadState=structuredClone(data.initial);
    const abort=new AbortController();setFailed(false);
    const tick=(now:number)=>{
      if(disposed)return;
      const at=clock ? clock() : video?.current?.currentTime ?? 0;
      if(at<previous){cursor=0;state=structuredClone(data.initial);}
      while(cursor<data.events.length && data.events[cursor][0]<=at){
        const [,kind,name,a,b]=data.events[cursor++];
        if(kind==='button')state.buttons[name]=Boolean(a);
        if(kind==='axis')state.axes[name]=[Number(a),b];
        if(kind==='layout')state.layout=name;
      }
      previous=at;
      if(!busy && now>=next){
        const accent=getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
        const body=JSON.stringify({...state,accent});
        if(body!==last){
          busy=true;next=now+33;
          void fetch('/api/controller-preview',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:abort.signal})
            .then(async response=>{
              if(!response.ok)throw new Error('Controller preview unavailable');
              const bitmap=await createImageBitmap(await response.blob());
              // Discard stale frames after a seek; the next tick requests the new state.
              if(!disposed && Math.abs((clock ? clock() : video?.current?.currentTime ?? 0)-at)<.25){
                const ctx=canvas.current?.getContext('2d');
                ctx?.clearRect(0,0,400,328);ctx?.drawImage(bitmap,0,0);last=body;setFailed(false);
              }
              bitmap.close();
            }).catch(()=>{if(!disposed){setFailed(true);next=performance.now()+1000;}})
            .finally(()=>{busy=false;});
        }
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);};
  },[video,data,clock]);
  const width=Math.min(bounds.width,bounds.height*300/1080),height=width*.82;
  const move=(p:[number,number])=>{
    const clamped=p.map(v=>Math.max(0,Math.min(1,v))) as [number,number];
    setPosition(clamped);positionRef.current=clamped;
    if(onPositionChange)return;
    try{localStorage.setItem('gloaming-viewer-pad-position',JSON.stringify(clamped));}catch{/* Storage may be disabled. */}
  };
  return <div className="pad-replay-area" style={bounds}>
    <div className="pad-replay" role="button" tabIndex={0} aria-label={t('viewer.moveController')}
      title={t('viewer.moveController')} style={{width,height,left:position[0]*Math.max(0,bounds.width-width),top:position[1]*Math.max(0,bounds.height-height)}}
      onClick={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
      onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,position};}}
      onPointerMove={e=>{const d=drag.current;if(!d)return;e.stopPropagation();move([d.position[0]+(e.clientX-d.x)/Math.max(1,bounds.width-width),d.position[1]+(e.clientY-d.y)/Math.max(1,bounds.height-height)]);}}
      onPointerUp={e=>{if(drag.current)onPositionChange?.(positionRef.current);drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
      onPointerCancel={()=>{if(drag.current)onPositionChange?.(positionRef.current);drag.current=null;}}
      onLostPointerCapture={()=>{drag.current=null;}}
      onKeyDown={e=>{const delta:Record<string,[number,number]>={ArrowLeft:[-.02,0],ArrowRight:[.02,0],ArrowUp:[0,-.02],ArrowDown:[0,.02]};if(delta[e.key]){e.preventDefault();e.stopPropagation();move([position[0]+delta[e.key][0],position[1]+delta[e.key][1]]);onPositionChange?.(positionRef.current);}}}>
      <canvas ref={canvas} width={400} height={328} />
      {failed ? <span role="status">{t('viewer.controllerPreviewFailed')}</span> : null}
    </div>
  </div>;
}
