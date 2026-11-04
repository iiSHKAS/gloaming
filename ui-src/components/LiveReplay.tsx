import {useId, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent} from 'react';
import Hls from 'hls.js';
import {api} from '../lib/api';
import {ButtonGlyph, ControllerGlyph, type PadGlyphName, type PadLayout} from './ControllerGlyph';
import '../styles/live-replay.css';
import {t, dateLocale} from '../lib/i18n';
import {isOverlayWindow} from '../lib/theme';

type LiveStatus = {enabled: boolean; running?: boolean; session?: string; start?: number; end?: number; playlist?: string; error?: string};
type Range = {start: number; end: number};
const clock = (n?: number) => n ? new Date(n * 1000).toLocaleTimeString(dateLocale(), {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
const duration = (n: number) => `${Math.floor(Math.max(0,n) / 60)}:${String(Math.floor(Math.max(0,n) % 60)).padStart(2, '0')}`;

const REPLAY_PATHS = {play:'M9 5l11 7-11 7z',pause:'M8 5v14M16 5v14',back:'M4 8V3m0 5h5M4 8a9 9 0 1 1-1 8',forward:'M20 8V3m0 5h-5M20 8a9 9 0 1 0 1 8',sound:'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14',mute:'M4 9h4l5-4v14l-5-4H4zM17 9l5 6m0-6-5 6',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5',cut:'M8 8l12 12M8 16 20 4M5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6',save:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',clip:'M4 11h16v9H4zM4 11 3 6l16-3 1 5M8 5.3l2 3.5M13 4.3l2 3.5',zoom:'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5M8 11h6M11 8v6'};

export function ReplayIcon({name}: {name: 'play'|'pause'|'back'|'forward'|'sound'|'mute'|'expand'|'cut'|'save'|'clip'|'zoom'}) {
  const paths = REPLAY_PATHS;
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>;
}

/**
 * The 10-second skip arrows. The number is drawn inside the icon, at the centre
 * of the arrow's circle, so it lines up whatever the surrounding CSS does.
 * (The circle's centre is (11.5, 13) for the back arrow and mirrored for forward.)
 */
export function SkipIcon({direction, seconds = 10}: {direction: 'back' | 'forward'; seconds?: number}) {
  const forward = direction === 'forward';
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={forward ? REPLAY_PATHS.forward : REPLAY_PATHS.back}/>
      <text x={forward ? 12.5 : 11.5} y="15.9" textAnchor="middle" fontSize="8.4" fontWeight="700" fill="currentColor" stroke="none">{seconds}</text>
    </svg>
  );
}

export type InputKind = 'pad' | 'keyboard';

/** One action in the HUD: a button for the mouse, with the key or pad glyph that triggers it. */
function Hint({input, layout, pad, keys, label, onClick, tone, disabled}: {input: InputKind; layout: PadLayout; pad: PadGlyphName; keys: string; label: string; onClick?: () => void; tone?: 'primary' | 'save' | 'quiet'; disabled?: boolean}) {
  const face = input === 'pad' ? <ControllerGlyph name={pad} layout={layout}/> : <kbd className="hud-key">{keys}</kbd>;
  return onClick
    ? <button type="button" className="hud-action" data-tone={tone} disabled={disabled} onMouseDown={e => e.preventDefault()} onClick={onClick}>{face}<span>{label}</span></button>
    : <span className="hud-hint">{face}<span>{label}</span></span>;
}

export function LiveReplay({fullscreen = false, onToggleFullscreen, lens = false, bufferSeconds, showClipBuilder = true, compact = false, studio = false, controllerMode = false, layout = 'xbox', input = 'pad', onExit, onSaved}: {fullscreen?: boolean; onToggleFullscreen?: () => void; lens?: boolean; bufferSeconds?: number; layout?: PadLayout; input?: InputKind; onExit?: () => void; showClipBuilder?: boolean; compact?: boolean; studio?: boolean; controllerMode?: boolean; onSaved?: () => void} = {}) {
  const [clipping, setClipping] = useState(false);
  const [durationOpen,setDurationOpen]=useState(false);
  useEffect(()=>{
    if(!durationOpen)return;
    const dismiss=(event:PointerEvent)=>{if(!(event.target as HTMLElement).closest('.lab-duration'))setDurationOpen(false);};
    document.addEventListener('pointerdown',dismiss);
    return()=>document.removeEventListener('pointerdown',dismiss);
  },[durationOpen]);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draggingControl = useRef(false);
  const revealControls = () => {
    if (!studio) return;
    setControlsVisible(true);
    clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (!draggingControl.current) setControlsVisible(false);
    }, 2200);
  };
  useEffect(() => {
    if (!studio) return;
    revealControls();
    const release = () => {
      if (draggingControl.current) { draggingControl.current = false; revealControls(); }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      clearTimeout(hideControlsTimer.current);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, [studio]);
  const clipBuilderId = useId();
  const builderVisible = showClipBuilder && (!studio || clipping);
  const video = useRef<HTMLVideoElement>(null);
  const controllerSeek = useRef<{target:number;at:number} | null>(null);
  const controllerSeekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [buffering,setBuffering]=useState(false);
  const pendingSeek = useRef<{target:number;keep:boolean} | null>(null);
  const seekStreak = useRef(0);
  const [flash,setFlash]=useState<{text:string;id:number}>();
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashNow=(text:string)=>{
    setFlash({text,id:performance.now()});
    clearTimeout(flashTimer.current);
    flashTimer.current=setTimeout(()=>setFlash(undefined),900);
  };
  useEffect(()=>()=>clearTimeout(flashTimer.current),[]);
  useEffect(()=>()=>clearTimeout(controllerSeekTimer.current),[]);
  const stage = useRef<HTMLDivElement>(null);
  const hls = useRef<Hls | null>(null);
  const previewEnd = useRef<number | null>(null);
  const [status, setStatus] = useState<LiveStatus>({enabled: false});
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!message || busy) return;
    const timer = setTimeout(() => setMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [message, busy]);
  const [selection, setSelection] = useState<Range>();
  const [trimWindow, setTrimWindow] = useState<Range>();
  const [preset, setPreset] = useState(30);
  const [position, setPosition] = useState<number>();
  const [following, setFollowing] = useState(true);
  const [paused, setPaused] = useState(true);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(.7);
  const positionExpired = position != null && status.start != null && position < status.start;
  const ready = Boolean(status.start != null && status.end != null && status.playlist);
  const beginning = status.start ?? 0;
  const edge = status.end ?? beginning;
  const available = Math.max(0, edge-beginning);
  const playhead = Math.max(beginning, Math.min(position ?? edge, edge));
  const anchor = following && !compact ? edge : playhead;
  const range = selection ?? {start:Math.max(beginning,anchor-preset),end:anchor};
  const expired = range.start < beginning;
  const validRange = ready && !expired && range.end > range.start && range.end <= edge;
  const timelineStart = (compact || studio) && builderVisible && trimWindow ? Math.max(beginning,trimWindow.start) : beginning;
  const timelineEnd = (compact || studio) && builderVisible && trimWindow ? Math.max(timelineStart,Math.min(edge,trimWindow.end)) : edge;
  const timelineDuration = timelineEnd-timelineStart;
  const percentage = (n: number) => Math.max(0,Math.min(100,(n-timelineStart)/Math.max(timelineDuration,1)*100));

  useEffect(() => {
    if (!compact) return;
    if (builderVisible && ready) {
      setSelection({...range});
      setTrimWindow({start:Math.max(beginning,range.start-15),end:Math.min(edge,range.end+15)});
      video.current?.pause();
    } else if (!builderVisible) {
      setSelection(undefined);
      setTrimWindow(undefined);
      previewEnd.current = null;
    }
  }, [compact, builderVisible, ready]);

  useEffect(() => {if(video.current) video.current.volume=volume;}, [volume]);
  useEffect(() => {if (positionExpired) video.current?.pause();}, [positionExpired]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch('/api/live', {cache: 'no-store'});
        if (!response.ok) throw new Error(t('ui.lrStatusFail'));
        if (alive) setStatus(await response.json());
      } catch (err) {if (alive) setMessage(String(err));}
      finally {if (alive) {setLoaded(true); timer=setTimeout(poll,2000);}}
    };
    void poll();
    return () => {alive=false; clearTimeout(timer);};
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!ready || !element || !status.playlist) return;
    setSelection(undefined); setPosition(undefined); setMessage(''); setFollowing(true); previewEnd.current=null;
    if (!Hls.isSupported()) {setMessage(t('ui.noLivePlayback')); return;}
    const player = new Hls({liveDurationInfinity:false,liveSyncDurationCount:3,
      liveMaxLatencyDurationCount:Infinity,maxBufferLength:20,backBufferLength:20,
      maxMaxBufferLength:40,enableWorker:false});
    hls.current=player;
    player.on(Hls.Events.MANIFEST_PARSED, () => {void element.play().catch(() => {});});
    player.on(Hls.Events.ERROR, (_, data) => {if(data.fatal) setMessage(t('ui.playbackInterrupted'));});
    player.loadSource(status.playlist); player.attachMedia(element);
    return () => {player.destroy(); hls.current=null; element.removeAttribute('src'); element.load();};
  }, [status.session,ready,status.playlist]);

  const currentDate = () => {const date=hls.current?.playingDate; return date ? date.getTime()/1000 : undefined;};
  const jump = (date: number, play = true) => {
    const element=video.current;
    const fragment=hls.current?.latestLevelDetails?.fragments.find(f=>f.programDateTime!=null && date>=f.programDateTime/1000 && date<f.programDateTime/1000+f.duration);
    if(element && fragment?.programDateTime!=null) {
      element.currentTime=fragment.start+date-fragment.programDateTime/1000;
      setPosition(date); setFollowing(false); if(play)void element.play().catch(()=>{});else element.pause();
    } else setMessage(t('ui.momentGone'));
  };
  const goLive=()=>{
    clearTimeout(controllerSeekTimer.current);controllerSeekTimer.current=undefined;controllerSeek.current=null;
    const element=video.current, player=hls.current;
    if(!element || !player) return;
    previewEnd.current=null;pendingSeek.current=null;
    if(player.liveSyncPosition!=null) element.currentTime=player.liveSyncPosition;
    setPosition(Math.max(beginning,edge-6)); player.startLoad(-1);
    void element.play().catch(()=>{}); setFollowing(true); setMessage('');
  };
  const enable=async()=>{
    setBusy(true); setMessage(t('ui.startingBuffer'));
    try {
      const result=await api.saveConfig({recording:{live_replay:true,window_capture:false,follow_mouse_display:false}});
      if(result.applied===false) throw new Error(t('ui.lrFinishSession'));
      setMessage(t('ui.waitingFirstSeconds'));
    } catch(err) {setMessage(String(err));} finally {setBusy(false);}
  };
  const save=async()=>{
    if(!validRange || busy) return;
    const chosen={...range};
    setBusy(true); setSelection(chosen); setMessage(t('ui.savingYourClip'));
    try {
      const response=await fetch('/api/live/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:status.session,...chosen})});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error || t('ui.lrSaveFailed'));
      setMessage(t('ui.savedToLibrary', {name: result.name})); setSelection(undefined); if(controllerMode)setClipping(false); onSaved?.();
    } catch(err) {setMessage(String(err));} finally {setBusy(false);}
  };
  const preview=()=>{if(validRange) {setSelection({...range}); previewEnd.current=range.end; jump(range.start);}};
  const shiftHeld = useRef(false);
  useEffect(() => {
    const track = (e: KeyboardEvent) => { shiftHeld.current = e.shiftKey; };
    const release = () => { shiftHeld.current = false; };
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', track); window.removeEventListener('keyup', track); window.removeEventListener('blur', release); };
  }, []);
  /** Shift moves a trim handle in whole seconds instead of quarter seconds. */
  const handleKeys = (side:'start'|'end', current:number) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!e.shiftKey) return;
    const dir = e.key==='ArrowRight'||e.key==='ArrowUp' ? 1 : e.key==='ArrowLeft'||e.key==='ArrowDown' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setBoundary(side, Math.round(current)+dir);
  };
  const setBoundary=(side:'start'|'end',raw:number)=>{
    const value = shiftHeld.current ? Math.round(raw) : raw;
    previewEnd.current=null;
    setSelection(side==='start' ? {start:Math.min(value,range.end-.25),end:range.end} : {start:range.start,end:Math.max(value,range.start+.25)});
  };
  const seekController=(seconds:number)=>{
    const element=video.current;
    if(!element)return;
    previewEnd.current=null;
    const now=performance.now();
    const previous=controllerSeek.current;
    const recent=previous&&now-previous.at<800;
    // Holding a direction accelerates so a 20 minute buffer is still quick to cross.
    seekStreak.current=previous&&now-previous.at<350?seekStreak.current+1:0;
    const speed=seekStreak.current>16?4:seekStreak.current>7?2:1;
    const base=recent?previous.target:playhead;
    const target=Math.max(beginning,Math.min(edge,base+seconds*speed));
    if(!clipping&&seconds>0&&target>=edge-3){goLive();controllerSeek.current=null;flashNow(t('ui.lrLive'));return;}
    controllerSeek.current={target,at:now};
    setPosition(target);setFollowing(false);
    flashNow(`${seconds<0?'−':'+'}${t('ui.secondsShort',{n:Math.abs(seconds*speed)})}`);
    const keep=!clipping&&!element.paused;
    if(element.seeking)pendingSeek.current={target,keep};
    else jump(target,keep);
  };

  const toggleControllerClip=()=>{
    setDurationOpen(false);
    if(!ready||busy)return;
    if(!clipping){setSelection({start:Math.max(beginning,playhead-preset),end:playhead});video.current?.pause();}
    previewEnd.current=null;setClipping(!clipping);
  };
  const cycleControllerDuration=()=>{
    if(!ready||busy)return;
    const durations=[15,30,60,120];
    const next=durations[(durations.indexOf(preset)+1)%durations.length];
    setPreset(next);setSelection(clipping?{start:Math.max(beginning,playhead-next),end:playhead}:undefined);
    setTrimWindow(undefined);previewEnd.current=null;
  };
  const controllerPlay=()=>{
    const element=video.current;
    if(!ready||busy||positionExpired||!element)return;
    if(!element.paused){element.pause();flashNow(t('ui.lrPaused'));}
    else if(clipping){preview();flashNow(t('ui.preview'));}
    else{void element.play().catch(()=>{});flashNow(t('ui.play'));}
  };
  const markControllerBoundary=(side:'start'|'end')=>{
    if(!ready||busy||!clipping)return;
    video.current?.pause();
    setBoundary(side,side==='start'?Math.max(beginning,Math.min(playhead,range.end-.25)):Math.min(edge,Math.max(playhead,range.start+.25)));
  };
  const toggleMute=()=>{
    const element=video.current;
    const next=!(element?.muted ?? muted);
    // Apply during the input event, including in embedded WebKit, rather than
    // waiting for React to commit the media property after user activation.
    if(element){element.muted=next;if(!next&&element.volume===0){element.volume=.7;setVolume(.7);}}
    setMuted(next);
    flashNow(next?t('ui.muted'):t('ui.soundOn'));
  };
  const controllerFullscreen=()=>{
    if(onToggleFullscreen){onToggleFullscreen();return;}
    if(document.fullscreenElement)void document.exitFullscreen();
    else void stage.current?.requestFullscreen().catch(()=>setMessage(t('ui.noFullscreen')));
  };
  const controllerHandler=useRef<(event:Event)=>void>(()=>{});
  useEffect(()=>{
    if(!controllerMode)return;
    const forward=(event:Event)=>controllerHandler.current(event);
    window.addEventListener('gloaming-controller',forward);
    return()=>window.removeEventListener('gloaming-controller',forward);
  },[controllerMode]);
  {
    // Reassigned every render so a quick second press never sees stale state.
    controllerHandler.current=(event:Event)=>{
      const key=(event as CustomEvent<string>).detail;
      if(lens&&key==='BTN_EAST'&&durationOpen){event.preventDefault();setDurationOpen(false);return;}
      if(key==='BTN_EAST'&&clipping){event.preventDefault();if(!busy){setClipping(false);previewEnd.current=null;flashNow(t('ui.trimCancelled'));}return;}
      if(key==='BTN_START'||key==='BTN_THUMBR'){controllerFullscreen();return;}
      if(key==='BTN_THUMBL'){toggleMute();return;}
      if(busy)return;
      if(!ready){if(key==='BTN_SOUTH'&&loaded&&!status.enabled)void enable();return;}
      // Bumpers cover ground, the D-pad (and stick) fine-tune.
      const step=clipping?1:(lens?10:5), fine=clipping?.25:1;
      if(key==='BTN_SOUTH')controllerPlay();
      if(key==='BTN_TL')seekController(-step);
      if(key==='BTN_TR')seekController(step);
      if(key==='BTN_DPAD_LEFT')seekController(-fine);
      if(key==='BTN_DPAD_RIGHT')seekController(fine);
      if(key==='BTN_TL2')seekController(clipping?-10:-30);
      if(key==='BTN_TR2')seekController(clipping?10:30);
      if(key==='BTN_DPAD_UP'){if(clipping){markControllerBoundary('start');flashNow(t('ui.lrInSet'));}else cycleControllerDuration();}
      if(key==='BTN_DPAD_DOWN'){if(clipping){markControllerBoundary('end');flashNow(t('ui.lrOutSet'));}else{controllerSeek.current=null;setSelection(undefined);goLive();flashNow(t('ui.lrLive'));}}
      if(key==='BTN_WEST')toggleControllerClip();
      if(key==='BTN_NORTH')void save();
      if(key==='BTN_SELECT'){controllerSeek.current=null;setClipping(false);setSelection(undefined);goLive();flashNow(t('ui.lrLive'));}
    };
  }
  const tickStep=[10,30,60,120,300,600].find(n=>available/n<=7)??600;
  const ticks:number[]=[];
  for(let k=1;k*tickStep<available;k++)ticks.push(k*tickStep);
  const ribbonPercent=(t:number)=>Math.max(0,Math.min(100,100*(t-beginning)/Math.max(1,available)));
  const cursorPercent=following&&!clipping?100:ribbonPercent(playhead);
  const press=(button:string)=>controllerHandler.current(new CustomEvent('gloaming-controller',{detail:button}));
  const dragging=useRef<'seek'|'in'|'out'|null>(null);
  const [hover,setHover]=useState<{pct:number;text:string}>();
  const railTime=(event:{clientX:number;currentTarget:HTMLElement})=>{
    const rect=event.currentTarget.getBoundingClientRect();
    const fraction=Math.max(0,Math.min(1,(event.clientX-rect.left)/Math.max(1,rect.width)));
    return {fraction,rect,time:beginning+fraction*available};
  };
  const scrubTo=(target:number)=>{
    const element=video.current;
    if(!element||!ready)return;
    previewEnd.current=null;
    controllerSeek.current={target,at:performance.now()};
    setPosition(target);setFollowing(false);
    if(!clipping&&target>=edge-2){goLive();controllerSeek.current=null;return;}
    const keep=!clipping&&!element.paused;
    if(element.seeking)pendingSeek.current={target,keep};else jump(target,keep);
  };
  const railDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(!ready||busy||event.button!==0)return;
    const {time,rect}=railTime(event);
    dragging.current='seek';
    if(clipping){
      const gap=(value:number)=>Math.abs(event.clientX-(rect.left+rect.width*ribbonPercent(value)/100));
      if(Math.min(gap(range.start),gap(range.end))<18)dragging.current=gap(range.start)<=gap(range.end)?'in':'out';
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if(dragging.current==='seek')scrubTo(time);
  };
  const railMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    const {fraction,time}=railTime(event);
    setHover({pct:fraction*100,text:fraction>.985?'LIVE':`−${duration(Math.max(0,edge-time))}`});
    if(!dragging.current)return;
    if(dragging.current==='seek')scrubTo(time);
    else if(dragging.current==='in')setBoundary('start',Math.max(beginning,Math.min(time,range.end-.25)));
    else setBoundary('end',Math.min(edge,Math.max(time,range.start+.25)));
  };
  const railUp=()=>{dragging.current=null;};
  const fine=clipping?'±0.25s':'±1s';
  const labKey=(pad:PadGlyphName,keys:string)=>input==='pad'?<ControllerGlyph name={pad} layout={layout}/>:<kbd>{keys}</kbd>;
  const labDock = <div className="lab-dock" aria-label={t('ui.replayControls')}>
    <button className="lab-play" aria-label={!ready?t('ui.enableReplay'):paused?t('ui.play'):t('ui.pause')} disabled={busy||positionExpired} onClick={()=>press('BTN_SOUTH')}><ReplayIcon name={paused?'play':'pause'}/>{labKey('south','Space')}</button>
    <span className="lab-divider"/>
    {clipping ? <div className="lab-boundaries"><button disabled={!ready||busy} onClick={()=>press('BTN_DPAD_UP')}><span>{t('ui.start')}<b>−{duration(Math.max(0,edge-range.start))}</b></span>{labKey('dpad-up','↑')}</button><span className="lab-range-arrow">→</span><button disabled={!ready||busy} onClick={()=>press('BTN_DPAD_DOWN')}><span>{t('ui.end')}<b>{range.end>=edge-.5?t('ui.live'):`−${duration(Math.max(0,edge-range.end))}`}</b></span>{labKey('dpad-down','↓')}</button></div>
      : <button className="lab-trim" disabled={!ready||busy} onClick={()=>{setDurationOpen(false);press('BTN_WEST');}}><ReplayIcon name="cut"/><span>{t('ui.trimClip')}</span>{labKey('west','C')}</button>}
    <div className="lab-save-group"><button className="lab-save" disabled={!validRange||busy} onClick={()=>{setDurationOpen(false);press('BTN_NORTH');}}><ReplayIcon name="save"/><span>{busy?t('ui.saving'):t('ui.saveClip')}</span>{labKey('north','S')}</button>
      {!clipping&&<div className="lab-duration"><button className="lab-duration-toggle" disabled={!ready||busy} aria-label={t('ui.chooseClipDuration')} aria-expanded={durationOpen} onClick={()=>setDurationOpen(!durationOpen)}>{duration(preset)} <span>⌃</span></button>
        {durationOpen&&<div className="lab-duration-menu" role="group" aria-label={t('ui.clipDuration')}><span>{t('ui.keepTheLast')}</span>{[15,30,60,120].map(n=><button key={n} aria-pressed={preset===n} onClick={()=>{setPreset(n);setSelection(undefined);setDurationOpen(false);}}>{n<60?t('ui.nSeconds',{count:n}):t('ui.nMinutes',{count:n/60})}<span>{preset===n?'✓':''}</span></button>)}</div>}
      </div>}
      {clipping&&<span className="lab-selected-duration">{duration(Math.max(0,range.end-range.start))}</span>}
    </div>
    {clipping&&<button className="lab-cancel" disabled={busy} onClick={()=>press('BTN_EAST')} aria-label={t('ui.cancelTrim')}>{labKey('east','Esc')}<span>{t('ui.cancel')}</span></button>}
  </div>;
  const controllerPanel = controllerMode && <div className="controller-hud" data-clipping={clipping||undefined} data-busy={busy||undefined} data-input={input}>
    <div className="controller-top">
      {!lens&&clipping&&ready&&<div className="controller-clip-readout"><span>{t('ui.in')}{' '}<b>−{duration(Math.max(0,edge-range.start))}</b></span><span className="controller-clip-length">{duration(Math.max(0,range.end-range.start))}</span><span>{t('ui.out')}<b>{range.end>=edge-.5?'LIVE':`−${duration(Math.max(0,edge-range.end))}`}</b></span></div>}
      {(buffering||busy)&&<div className="controller-spinner">{busy?t('ui.savingClip'):t('ui.loading')}</div>}
      <div className="controller-tools">
        <button type="button" className="replay-tool-shortcut" onMouseDown={e=>e.preventDefault()} aria-label={muted?t('ui.unmute'):t('ui.mute')} aria-pressed={muted} aria-keyshortcuts="M" title={`${muted?t('ui.unmute'):t('ui.mute')} (${input==='pad'?t('ui.lrL3'):'M'})`} onClick={()=>press('BTN_THUMBL')}><ReplayIcon name={muted?'mute':'sound'}/><span className="replay-tool-key" aria-hidden="true">{input==='pad'?<ButtonGlyph button="BTN_THUMBL" layout={layout}/>:<kbd>M</kbd>}</span></button>
        <button type="button" className="replay-tool-shortcut" aria-label={fullscreen?t('ui.exitFullscreen'):t('ui.fullscreen')} aria-pressed={fullscreen} aria-keyshortcuts="F" title={t('ui.lrToggleFullscreen',{key:input==='pad'?(layout==='playstation'?t('ui.options'):t('ui.menu')):'F'})} onClick={()=>press('BTN_START')}><ReplayIcon name="expand"/><span className="replay-tool-key" aria-hidden="true">{input==='pad'?<ButtonGlyph button="BTN_START" layout={layout}/>:<kbd>F</kbd>}</span></button>
        {onExit&&<button type="button" aria-label={t('ui.close')} title={t('ui.closeEsc')} onClick={onExit}><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>}
      </div>
    </div>
    {flash&&<div key={flash.id} className="controller-flash">{flash.text}</div>}
    <div className="controller-bottom">
      {lens&&<div className="lab-context"><span>{clipping?t('ui.lrTrimSelection'):following?t('ui.lrWatchingLive'):t('ui.lrReplayAt',{time:duration(Math.max(0,edge-playhead))})}</span><button disabled={!ready||busy} onClick={()=>press('BTN_SELECT')}><i/>{following&&!clipping?t('ui.live'):t('ui.goLive')}</button></div>}
      <div className="controller-timeline" data-clipping={clipping||undefined} style={{'--clip-left':`${ribbonPercent(range.start)}%`,'--clip-right':`${100-ribbonPercent(range.end)}%`,'--cursor':`${cursorPercent}%`} as CSSProperties}
        onPointerDown={railDown} onPointerMove={railMove} onPointerUp={railUp} onPointerCancel={railUp} onPointerLeave={()=>setHover(undefined)}>
        {hover&&ready&&<div className="controller-hover" style={{left:`${hover.pct}%`}}>{hover.text}</div>}
        <div className="controller-rail">
          {ready&&clipping&&<div className="controller-selection"><i className="in"/><i className="out"/></div>}
          {ready&&ticks.map(t=><span key={t} className="controller-tick" style={{left:`${ribbonPercent(edge-t)}%`}}><em>−{duration(t)}</em></span>)}
          {ready&&<div className="controller-thumb"/>}
        </div>
        <div className="controller-rail-ends" data-live={(following&&!clipping)||undefined}><i/>{t('ui.live2')}</div>
      </div>
      {lens ? labDock : <div className="controller-keys">
        <Hint input={input} layout={layout} pad="south" keys="Space" tone="primary" disabled={ready&&(busy||positionExpired)} onClick={()=>press('BTN_SOUTH')}
          label={!ready?(status.enabled?t('ui.buffering'):t('ui.enableReplay')):paused?(clipping?t('ui.preview'):t('ui.play')):t('ui.pause')}/>
        <Hint input={input} layout={layout} pad="west" keys="C" label={clipping?t('ui.exitTrim'):t('ui.trim')} disabled={!ready||busy} onClick={()=>press('BTN_WEST')}/>
        {clipping
          ? <><Hint input={input} layout={layout} pad="dpad-up" keys="↑" label={t('ui.setIn')} disabled={busy} onClick={()=>press('BTN_DPAD_UP')}/><Hint input={input} layout={layout} pad="dpad-down" keys="↓" label={t('ui.setOut')} disabled={busy} onClick={()=>press('BTN_DPAD_DOWN')}/></>
          : <><Hint input={input} layout={layout} pad="dpad-up" keys="↑" label={t('ui.lrDurationClip',{time:duration(preset)})} disabled={!ready||busy} onClick={()=>press('BTN_DPAD_UP')}/><Hint input={input} layout={layout} pad="dpad-down" keys="↓" label={t('ui.live')} disabled={!ready||busy} onClick={()=>press('BTN_DPAD_DOWN')}/></>}
        <Hint input={input} layout={layout} pad="north" keys="S" tone="save" label={t('ui.lrSaveTime',{time:duration(Math.max(0,range.end-range.start))})} disabled={!validRange||busy} onClick={()=>press('BTN_NORTH')}/>
        <span className="controller-key-sep"/>
        <Hint input={input} layout={layout} pad="shoulders" keys="← →" label={clipping?'±1s':'±5s'}/>
        {input==='pad'
          ? <><Hint input={input} layout={layout} pad="dpad-h" keys="" label={fine}/><Hint input={input} layout={layout} pad="triggers" keys="" label={clipping?'±10s':'±30s'}/></>
          : <Hint input={input} layout={layout} pad="triggers" keys="Shift ← →" label={clipping?'±10s':'±30s'}/>}
        <span className="controller-back-key"><Hint input={input} layout={layout} pad="east" keys="Esc" tone="quiet" label={clipping?t('ui.cancelTrim'):t('ui.backToGame')} onClick={()=>{if(clipping)press('BTN_EAST');else onExit?.();}}/></span>
      </div>}
      {lens&&<div className="lab-footnote">{input==='pad'?<><span className="lab-shortcut"><ControllerGlyph name="shoulders" layout={layout}/><span>{clipping?'±1s':'±10s'}</span></span><span className="lab-shortcut"><ControllerGlyph name="triggers" layout={layout}/><span>{clipping?'±10s':'±30s'}</span></span><span className="lab-shortcut"><ControllerGlyph name="dpad-h" layout={layout}/><span>{clipping?'±0.25s':'±1s'}</span></span><span className="lab-shortcut"><ControllerGlyph name="east" layout={layout}/><span>{clipping?t('ui.cancelTrim'):t('ui.back')}</span></span></>:<>
        <span className="lab-seek-hints" aria-label={t('ui.seekShortcuts')}>
          <span className="lab-seek-hint"><kbd aria-label={t('ui.leftArrow')}>←</kbd><span>{t('ui.back')}<strong>{clipping?'1':'10'}s</strong></span></span>
          <span className="lab-seek-hint"><kbd aria-label={t('ui.rightArrow')}>→</kbd><span>{t('ui.forward')}<strong>{clipping?'1':'10'}s</strong></span></span>
        </span>
        <span className="lab-shortcut"><kbd>Shift</kbd><span>+ ← →</span><span>{clipping?'±10s':'±30s'}</span></span>
        <span className="lab-shortcut"><kbd>{clipping?'↑ ↓':'↑'}</kbd><span>{clipping?t('ui.setBoundaries'):t('ui.duration')}</span></span>
        <span className="lab-shortcut"><kbd>Esc</kbd><span>{clipping?t('ui.cancel'):t('ui.back')}</span></span>
      </>}</div>}
    </div>
  </div>;
  // On the home screen the clip tools sit under the picture so they never cover it;
  // over a game (the replay overlay window, fullscreen) they stay on the video.
  const belowVideo = studio && !isOverlayWindow();
  const clipBuilder = builderVisible && (compact || studio) && <aside id={clipBuilderId} className="overlay-cutbar" aria-label={t('ui.createAClip')}>
        <div className="overlay-cut-presets"><span>{t('ui.quickSelect')}</span>{[15,30,60].map(n=><button key={n} disabled={!ready||busy} onClick={()=>{setPreset(n);setSelection({start:Math.max(beginning,playhead-n),end:playhead});setTrimWindow({start:Math.max(beginning,playhead-n-15),end:Math.min(edge,playhead+15)});previewEnd.current=null;}}>{n<60?t('ui.secondsShort',{n}):t('ui.minutesShort',{n:1})}</button>)}<button className="overlay-history-toggle" disabled={!ready||busy} onClick={()=>setTrimWindow(trimWindow?undefined:{start:Math.max(beginning,range.start-15),end:Math.min(edge,range.end+15)})}>{trimWindow?t('ui.fullHistory'):t('ui.zoomToClip')}</button><span className="overlay-cut-tip">{t('ui.dragTheHandlesToTrim')}</span></div>
        <div className="overlay-cut-actions">
          {studio ? <div className="studio-time-fields">
            <label>{t('ui.in')}{' '}<input type="number" aria-label={t('ui.clipStartSeconds')} step="0.25" min="0" max={Math.max(0,range.end-beginning-.25)} disabled={!ready||busy} value={Math.max(0,Math.round((range.start-beginning)*100)/100)} onChange={e=>setBoundary('start',Math.max(beginning,beginning+Number(e.target.value)))}/></label>
            <label>{t('ui.out')}<input type="number" aria-label={t('ui.clipEndSeconds')} step="0.25" min={Math.max(0,range.start-beginning+.25)} max={available} disabled={!ready||busy} value={Math.max(0,Math.round((range.end-beginning)*100)/100)} onChange={e=>setBoundary('end',Math.min(edge,beginning+Number(e.target.value)))}/></label>
            <span>{duration(range.end-range.start)} selected · seconds</span>
          </div> : <>
          <button className="overlay-mark" disabled={!ready||busy||playhead>=edge} onClick={()=>{video.current?.pause();setSelection({start:playhead,end:Math.max(range.end,Math.min(edge,playhead+.25))});}}>{t('ui.setStartHere')}<b>{clock(range.start)}</b></button>
          <button className="overlay-mark" disabled={!ready||busy||playhead<=beginning} onClick={()=>{video.current?.pause();setSelection({start:Math.min(range.start,Math.max(beginning,playhead-.25)),end:playhead});}}>{t('ui.setEndHere')}<b>{clock(range.end)}</b></button>
          </>}
          <button className="overlay-cut-preview" disabled={!validRange||busy} onClick={preview} aria-label={t('ui.previewSelection')}><ReplayIcon name="play"/></button>
          <button className="overlay-cut-save" disabled={!validRange||busy} onClick={()=>void save()}><ReplayIcon name="save"/>{busy?t('ui.saving'):t('ui.lrSaveClipTime',{time:duration(range.end-range.start)})}</button>
        </div>
      </aside>;
  const transport = <div className="replay-transport">
            <div className="rt-group">
            <button aria-label={t('ui.back10Seconds')} disabled={!ready} onClick={()=>{previewEnd.current=null;jump(Math.max(beginning,playhead-10));}}><SkipIcon direction="back"/></button>
            <button className="replay-play" aria-label={paused?t('ui.playReplay'):t('ui.pauseReplay')} disabled={!ready||positionExpired} onClick={()=>{if(paused) void video.current?.play().catch(()=>{});else video.current?.pause();}}><ReplayIcon name={paused?'play':'pause'}/></button>
            <button className="replay-skip-forward" aria-label={t('ui.forward10Seconds')} disabled={!ready||positionExpired||playhead>=edge-1} onClick={()=>{previewEnd.current=null;jump(Math.min(edge,playhead+10));}}><SkipIcon direction="forward"/></button>
            <span className="replay-playtime">{clock(position)}</span>
            </div>
            <div className="rt-group">
            <button aria-label={muted?t('ui.unmuteReplay'):t('ui.muteReplay')} disabled={!ready} onClick={()=>setMuted(!muted)}><ReplayIcon name={muted?'mute':'sound'}/></button>
            <input className="replay-volume" aria-label={t('ui.replayVolume')} type="range" min="0" max="1" step="0.05" value={muted?0:volume} onChange={e=>{const v=Number(e.target.value);setVolume(v);setMuted(v===0);if(video.current)video.current.volume=v;}}/>
            <button className="replay-live-button" disabled={!ready} onClick={goLive}><i/>{t('ui.goLive')}</button>
            {studio && showClipBuilder && <button className="replay-cut-toggle"
              aria-label={clipping ? t('ui.hideClipTools') : t('ui.createAClip')} title={clipping ? t('ui.hideClipTools') : t('ui.createAClip')}
              aria-expanded={clipping} aria-controls={clipping ? clipBuilderId : undefined} disabled={busy}
              onClick={()=>{if (!clipping && ready && (!selection || expired)) setSelection({...range,start:Math.max(beginning,range.start)});previewEnd.current=null;setClipping(!clipping);}}>
              <ReplayIcon name="cut"/>
            </button>}
            <button aria-label={t('ui.fullscreenReplay')} disabled={!ready} onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void stage.current?.requestFullscreen().catch(()=>setMessage(t('ui.noFullscreen')));}}><ReplayIcon name="expand"/></button>
            </div>
          </div>;
  const scrubber = <div className="replay-scrubber" data-clipping={builderVisible || undefined}>
          <div className="replay-timeline-labels"><span>{(compact||studio)&&builderVisible&&trimWindow?t('ui.lrTrimTimeline'):t('ui.lrReplayTimeline')}</span><span>{clock(timelineStart)} — {clock(timelineEnd)}</span></div>
          <div className="replay-track" style={{'--range-left':`${percentage(range.start)}%`,'--range-width':`${percentage(range.end)-percentage(range.start)}%`} as CSSProperties}>
            {validRange&&builderVisible&&<div className="replay-selection-band"/>}
            <input className="replay-seek" aria-label={t('ui.replayPosition')} type="range" disabled={!ready} min={timelineStart} max={timelineEnd} step=".25" value={following&&!builderVisible?timelineEnd:Math.max(timelineStart,Math.min(playhead,timelineEnd))} onChange={e=>{previewEnd.current=null;const value=Number(e.currentTarget.value);if(!builderVisible&&value>=timelineEnd-2)goLive();else jump(value);}}/>
            {(compact || studio) && builderVisible && <>
              <input className="overlay-trim-handle" aria-label={t('ui.clipStart')} type="range" min={timelineStart} max={timelineEnd} step=".25" disabled={!ready||busy} value={Math.max(beginning,range.start)} onKeyDown={handleKeys('start',range.start)} onChange={e=>setBoundary('start',Number(e.currentTarget.value))}/>
              <input className="overlay-trim-handle overlay-trim-end" aria-label={t('ui.clipEnd')} type="range" min={timelineStart} max={timelineEnd} step=".25" disabled={!ready||busy} value={range.end} onKeyDown={handleKeys('end',range.end)} onChange={e=>setBoundary('end',Number(e.currentTarget.value))}/>
            </>}
          </div>
          <div className="replay-timeline-ticks">{[0,.25,.5,.75,1].map(n=><span key={n}>{n===1&&timelineEnd===edge?t('ui.lrNow'):`−${duration(edge-(timelineStart+timelineDuration*n))}`}</span>)}</div>
          {studio && !belowVideo && clipBuilder}

        </div>;
  const quickSelect = (n: number) => {setPreset(n);setSelection({start:Math.max(beginning,playhead-n),end:playhead});setTrimWindow({start:Math.max(beginning,playhead-n-15),end:Math.min(edge,playhead+15)});previewEnd.current=null;};
  const studioPanel = <section id={clipBuilderId} ref={el=>{if(el&&!el.dataset.seen){el.dataset.seen='1';requestAnimationFrame(()=>el.scrollIntoView({block:'nearest',behavior:'smooth'}));}}} className="studio-clip-panel ui-panel" aria-label={t('ui.createAClip')}>
    <header className="ui-panel-head">
      <div><h3>{t('ui.createAClip')}</h3><p className="ui-hint">{t('ui.dragTheHandlesToTrim')}</p></div>
      <span className="ui-badge" data-tone="accent">{t('ui.selectedLength',{time:duration(Math.max(0,range.end-range.start))})}</span>
    </header>
    {scrubber}
    <div className="ui-toolbar">
      <div className="ui-group">
        <div className="ui-chip-row" role="group" aria-label={t('ui.quickSelect')}>
          {[15,30,60].map(n=><button type="button" className="ui-chip" key={n} disabled={!ready||busy} onClick={()=>quickSelect(n)}>{n<60?t('ui.secondsShort',{n}):t('ui.minutesShort',{n:1})}</button>)}
          <button type="button" className="ui-chip ui-icon-chip" aria-pressed={Boolean(trimWindow)} aria-label={trimWindow?t('ui.fullHistory'):t('ui.zoomToClip')} title={trimWindow?t('ui.fullHistory'):t('ui.zoomToClip')} disabled={!ready||busy} onClick={()=>setTrimWindow(trimWindow?undefined:{start:Math.max(beginning,range.start-15),end:Math.min(edge,range.end+15)})}><ReplayIcon name="zoom"/></button>
        </div>
      </div>
      <p className="ui-shift-hint"><kbd>Shift</kbd><span>{t('ui.shiftSnapHint')}</span></p>
      <div className="ui-actions">
        <button type="button" className="btn btn-quiet ui-icon-btn" disabled={!validRange||busy} onClick={preview} aria-label={t('ui.previewSelection')} title={t('ui.previewSelection')}><ReplayIcon name="play"/></button>
        <button type="button" className="btn" disabled={!validRange||busy} onClick={()=>void save()}><ReplayIcon name="clip"/>{busy?t('ui.saving'):t('ui.lrSaveClipTime',{time:duration(range.end-range.start)})}</button>
      </div>
    </div>
  </section>;
  return <section className={`replay-studio ${studio ? 'studio-player' : ''} ${lens ? 'replay-lens' : ''}`} aria-label={t('ui.liveReplayStudio')}>
    <header className="replay-header"><div className="replay-header-title"><span className="replay-indicator" data-running={status.running}/><h2>{t('ui.liveReplay')}</h2><span className="replay-chip">{bufferSeconds ? t('ui.lrMinBuffer',{n:Math.round(bufferSeconds/60)}) : t('ui.lrReplayBuffer')}</span></div><span className="replay-capacity">{t('ui.lrAvailable',{time:duration(available)})}</span></header>
    <div className="replay-workspace">
      <div className="replay-monitor">
        <div ref={stage} className="replay-stage" data-controller={controllerMode || undefined}
          onPointerMove={revealControls} onPointerEnter={revealControls}
          onPointerLeave={()=>{if(studio && !draggingControl.current) setControlsVisible(false);}}
          onFocusCapture={revealControls} onBlurCapture={revealControls}>
          <video ref={video} className="live-replay-video" playsInline muted={muted} preload="metadata" hidden={!ready || positionExpired}
            onClick={()=>{if(video.current?.paused) void video.current.play().catch(()=>{}); else video.current?.pause();}}
            onWaiting={()=>setBuffering(true)} onCanPlay={()=>setBuffering(false)} onSeeked={()=>{setBuffering(false);const next=pendingSeek.current;pendingSeek.current=null;if(next)jump(next.target,next.keep);}}
            onPlay={()=>setPaused(false)} onPause={()=>{setPaused(true);setFollowing(false);}}
            onTimeUpdate={()=>{if(controllerMode&&(video.current?.seeking||(controllerSeek.current&&performance.now()-controllerSeek.current.at<250)))return;const value=currentDate();if(value!=null){setPosition(value);if(!following&&!video.current?.paused&&!(controllerSeek.current&&performance.now()-controllerSeek.current.at<1500)&&edge-value<10)setFollowing(true);if(previewEnd.current!=null && value>=previewEnd.current){video.current?.pause();previewEnd.current=null;}}}}/>
          {(!ready || positionExpired) && <div className="replay-placeholder"><span className="replay-placeholder-icon"><ReplayIcon name="play"/></span><h3>{positionExpired?t('ui.thisMomentHasExpired'):!loaded?t('ui.connectingToYourScreen'):status.enabled?t('ui.yourReplayIsWarmingUp'):t('ui.neverMissTheMoment')}</h3><p>{positionExpired?t('ui.jumpBackToLiveTo'):status.enabled?t('ui.yourReplayHistoryWillAppear'):t('ui.revisitYourScreenFindThe')}</p>{!status.enabled&&loaded&&<button className="btn" disabled={busy} onClick={()=>void enable()}>{t('ui.startLiveReplay')}</button>}{positionExpired&&<button className="btn" onClick={goLive}>{t('ui.goLive')}</button>}</div>}
          {ready && !positionExpired && <div className="replay-video-badge"><i/>{following?t('ui.lrLive'):t('ui.lrAgo',{time:duration(edge-playhead)})}</div>}
          {controllerMode ? controllerPanel : studio ? <div className="studio-video-controls" data-clipping={builderVisible || undefined}
            data-visible={controlsVisible || busy} onPointerDown={()=>{draggingControl.current=true;revealControls();}}>
            {!(belowVideo && builderVisible) && scrubber}
            {transport}
          </div> : transport}
        </div>
        {belowVideo && builderVisible && studioPanel}
        {!studio && scrubber}
      </div>
      {!studio && clipBuilder}
      {builderVisible && !compact && !studio && <aside className="replay-clip-builder" aria-label={t('ui.createAClip')}>
        <div className="replay-builder-icon"><ReplayIcon name="cut"/></div><h3>{t('ui.keepThisMoment')}</h3><p>{t('ui.pickALengthSaveA')}</p>
        <label className="replay-field-label">{t('ui.quickLength')}</label>
        <div className="replay-presets">{[15,30,60,120].map(n=><button key={n} aria-pressed={!selection&&preset===n} disabled={!ready||busy} onClick={()=>{setPreset(n);setSelection(undefined);previewEnd.current=null;}}>{n<60?`${n}s`:`${n/60}m`}</button>)}</div>
        <div className="replay-selection-heading"><span>{t('ui.fineTuneYourClip')}</span>{selection&&<button disabled={busy} onClick={()=>setSelection(undefined)}>{t('ui.reset')}</button>}</div>
        <label className="replay-boundary"><span>{t('ui.start2')}<b>{ready?clock(range.start):'—'}</b></span><input aria-label={t('ui.clipStart')} type="range" disabled={!ready||busy} min={beginning} max={Math.max(beginning,range.end-.25)} step=".25" value={Math.max(beginning,range.start)} onChange={e=>setBoundary('start',Number(e.currentTarget.value))}/></label>
        <label className="replay-boundary"><span>{t('ui.end2')}<b>{ready?clock(range.end):'—'}</b></span><input aria-label={t('ui.clipEnd')} type="range" disabled={!ready||busy} min={Math.min(edge,Math.max(beginning,range.start+.25))} max={edge} step=".25" value={range.end} onChange={e=>setBoundary('end',Number(e.currentTarget.value))}/></label>
        <div className="replay-export-summary"><span>{t('ui.clipDuration')}</span><strong>{duration(ready?range.end-range.start:0)}</strong></div>
        <button className="replay-save" disabled={!validRange||busy} onClick={()=>void save()}><ReplayIcon name="save"/>{busy?t('ui.saving'):t('ui.lrSaveTimeClip',{time:duration(ready?range.end-range.start:0)})}</button>
        <button className="replay-preview" disabled={!validRange||busy} onClick={preview}><ReplayIcon name="play"/>{t('ui.previewSelection')}</button>
        <p className="replay-footnote">{t('ui.onlySavedClipsStayIn')}</p>
      </aside>}
    </div>
    {(message||status.error||expired)&&<div className="replay-message" role="status">{expired?t('ui.yourSelectionExpiredResetIt'):message||status.error}</div>}
  </section>;
}
