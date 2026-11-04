import {useEffect, useRef, useState} from 'react';
import {LiveReplay, type InputKind} from './LiveReplay';
import type {PadLayout} from './ControllerGlyph';
import '../styles/replay-overlay.css';
import '../styles/replay-lens.css';
import {t} from '../lib/i18n';

/** Keyboard keys mapped onto the same actions the controller buttons drive. */
const KEY_ACTIONS: Record<string, string> = {
  ' ': 'BTN_SOUTH', k: 'BTN_SOUTH', Enter: 'BTN_SOUTH',
  ArrowLeft: 'BTN_TL', ArrowRight: 'BTN_TR', j: 'BTN_TL', l: 'BTN_TR',
  ArrowUp: 'BTN_DPAD_UP', ArrowDown: 'BTN_DPAD_DOWN',
  c: 'BTN_WEST', s: 'BTN_NORTH', f: 'BTN_START', m: 'BTN_THUMBL', Home: 'BTN_SELECT',
};

/** One replay overlay for mouse, keyboard and controller. The picture fills the panel and the HUD adapts to whichever you used last. */
export function ReplayOverlay() {
  const [fullscreen,setFullscreen]=useState(false);
  const fullscreenRef=useRef(false);
  const page=useRef<HTMLElement>(null);
  const toggleFullscreen=()=>{
    const next=!fullscreenRef.current;
    fullscreenRef.current=next;
    setFullscreen(next);
    // The desktop host already covers the monitor, except on native GNOME.
    // Its bridge can resize that window without browser user-activation rules.
    const host=window as unknown as {webkit?:{messageHandlers?:{gloamingReplayFullscreen?:{postMessage:(message:string)=>void}}}};
    host.webkit?.messageHandlers?.gloamingReplayFullscreen?.postMessage(next?'enter':'exit');
  };
  const [layout,setLayout]=useState<PadLayout>('xbox');
  const [input,setInput]=useState<InputKind>(new URLSearchParams(location.search).get('controller')==='1'?'pad':'keyboard');
  const close = (reason = 'close') => {
    const host = window as unknown as {webkit?: {messageHandlers?: {gloamingOverlay?: {postMessage: (message: string) => void}}}};
    host.webkit?.messageHandlers?.gloamingOverlay?.postMessage(reason);
  };
  /** Back: leave fullscreen, then cancel trimming, then close. Same for Esc, B/○ and the on-screen chip. */
  const back=(reason:string)=>{
    if(fullscreenRef.current){toggleFullscreen();return;}
    if(document.fullscreenElement){void document.exitFullscreen();return;}
    if(window.dispatchEvent(new CustomEvent('gloaming-controller',{detail:'BTN_EAST',cancelable:true})))close(reason);
  };
  useEffect(() => {
    document.documentElement.classList.add('replay-overlay-host');
    const key = (event: KeyboardEvent) => {
      if(event.metaKey||event.ctrlKey||event.altKey)return;
      setInput('keyboard');
      if((event.target as HTMLElement)?.closest('input:not([type=range]),select') || ((event.target as HTMLElement)?.closest('button') && [' ','Enter'].includes(event.key)))return;
      if(event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        back(`${event.key} key in page`);
        return;
      }
      const button=event.shiftKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')
        ?(event.key==='ArrowLeft'?'BTN_TL2':'BTN_TR2')
        :KEY_ACTIONS[event.key.length===1?event.key.toLowerCase():event.key] ?? KEY_ACTIONS[event.code.startsWith('Key')?event.code.slice(3).toLowerCase():event.code];
      if(button){
        event.preventDefault();
        if(event.repeat&&!['BTN_TL','BTN_TR','BTN_TL2','BTN_TR2'].includes(button))return;
        window.dispatchEvent(new CustomEvent('gloaming-controller',{detail:button}));
      }
    };
    const pointer=()=>{setInput('keyboard');if(!document.activeElement||document.activeElement===document.body)page.current?.focus({preventScroll:true});};
    window.focus();
    page.current?.focus({preventScroll:true});
    window.addEventListener('keydown',key,true);
    window.addEventListener('pointerdown',pointer,true);
    return () => {window.removeEventListener('keydown',key,true);window.removeEventListener('pointerdown',pointer,true);document.documentElement.classList.remove('replay-overlay-host');};
  }, []);
  useEffect(()=>{
    let alive=true;
    let socket:WebSocket;
    let retry:ReturnType<typeof setTimeout>;
    const held=new Map<string,{since:number;last:number}>();
    const dispatch=(button:string)=>{
      if(button==='BTN_EAST')back('controller B/○ button');
      else window.dispatchEvent(new CustomEvent('gloaming-controller',{detail:button}));
    };
    const connect=()=>{
      socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/controller/events`);
      socket.onmessage=event=>{
        const data=JSON.parse(event.data) as {button?:string;down?:boolean;reset?:boolean;layout?:PadLayout};
        if(data.layout)setLayout(data.layout);
        if(data.reset){held.clear();return;}
        if(!data.button)return;
        if(data.down){setInput('pad');held.set(data.button,{since:performance.now(),last:performance.now()});dispatch(data.button);}
        else {held.delete(data.button);window.dispatchEvent(new CustomEvent('gloaming-controller-release',{detail:data.button}));}
      };
      socket.onclose=()=>{
        held.clear();
        // Keyboard and mouse keep working without the pad connection, so stay quiet unless a pad was in use.
        if(alive)retry=setTimeout(connect,1000);
      };
    };
    connect();
    const repeat=setInterval(()=>{
      const now=performance.now();
      for(const [key,value] of held){
        if(!['BTN_DPAD_LEFT','BTN_DPAD_RIGHT','BTN_TL','BTN_TR','BTN_TL2','BTN_TR2'].includes(key))continue;
        if(now-value.since>220&&now-value.last>=100){dispatch(key);value.last=now;}
      }
    },40);
    return()=>{alive=false;clearTimeout(retry);clearInterval(repeat);held.clear();socket.close();};
  },[]);
  return <main ref={page} tabIndex={-1} className="replay-overlay-page replay-lens-page" data-controller="true" data-input={input} data-fullscreen={fullscreen || undefined} onClick={event=>{if(event.target===event.currentTarget)close('click outside the panel');}}>
    <section className="overlay-floating-panel" aria-label={t('ui.replay')}>
      <LiveReplay fullscreen={fullscreen} onToggleFullscreen={toggleFullscreen} lens studio compact controllerMode layout={layout} input={input} onExit={()=>back('close button')}/>
    </section>
  </main>;
}
