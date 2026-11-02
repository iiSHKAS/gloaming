import {outputSlots, outputTracks, slotsForPrimary} from '../lib/audioOutputs';
import {ClipShortcut} from '../components/ClipShortcut';
import {useEffect,useState} from 'react';
import {useStore} from '../state/store';
import {useClipActions} from '../state/clipActions';
import {api} from '../lib/api';
import {ClipCard} from '../components/ClipCard';
import {formatBytes} from '../lib/format';
import {LiveReplay} from '../components/LiveReplay';
import {Toggle, Select} from '../components/settings/Fields';
import type {AudioSource} from '../components/settings/AudioTracks';
import {IconSettings, IconClips} from '../components/Icons';
import {Modal} from '../components/Modal';
import {t} from '../lib/i18n';

export function Home() {
  const {state,dispatch,hotkey,saveConfig,notify}=useStore();
  const {config,status,clips,recentNew}=state;
  const {actions,overlays}=useClipActions();
  const [busy,setBusy]=useState(false);
  const [previewVisible,setPreviewVisible]=useState(()=>localStorage.getItem('gloaming-home-preview')!=='hidden');
  const showPreview=(visible:boolean)=>{setPreviewVisible(visible);localStorage.setItem('gloaming-home-preview',visible?'visible':'hidden');};
  const [micChoice,setMicChoice]=useState(false);
  const [sources,setSources]=useState<AudioSource[]>([]);
  const [displays,setDisplays]=useState<Array<{id:string;label?:string}>>([]);
  const [deviceError,setDeviceError]=useState('');
  const r: Record<string,unknown> = config?.recording??{};
  useEffect(()=>{let alive=true;
    void Promise.all([api.audioSources(),api.displays(String(r.backend||'auto'))]).then(([a,d])=>{
      if(alive){setSources(a.sources as AudioSource[]);setDisplays(d.displays as Array<{id:string;label?:string}>);}
    }).catch(()=>{if(alive)setDeviceError('Some devices could not be loaded. Your saved selections are still available.');});
    return()=>{alive=false;};
  },[r.backend]);
  const settings=()=>dispatch({type:'setView',view:'settings'});
  const apply=async(patch:Record<string,unknown>)=>{setBusy(true);try{
    const result=await saveConfig({recording:{...patch, audio_tracks_mix_first:true}});
    if(result.applied===false)throw new Error(result.warning||'Settings will apply after the current session.');
  }catch(e){notify({kind:'error',title:'Could not apply recording settings',detail:String(e),tone:'error',holdMs:6000});}finally{setBusy(false);}};
  const audio=r.capture_audio!==false, mic=Boolean(r.capture_microphone);
  const micToggle=(enabled:boolean)=>{
    if(enabled&&audio&&(r.wf_microphone_strategy??'prompt')==='prompt'&&(r.backend==='wf-recorder'||status.backend==='wf-recorder'))setMicChoice(true);
    else void apply({capture_microphone:enabled});
  };
  const deviceSelect=(input:boolean)=>{
    const key=input?'microphone_source':'gsr_audio_source';
    const fallback=input?'default_input':'default_output';
    const selected=String(r[key]||fallback);
    const list=sources.filter(s=>input?(s.kind==='input'||s.id==='default_input'||(s.id.startsWith('device:')&&!s.id.endsWith('.monitor'))):s.kind!=='input'&&s.id!=='default_input');
    const options=[{id:fallback,label:input?'System default microphone':'System default output'},...list.filter(s=>s.id!==fallback)];
    if(!options.some(s=>s.id===selected))options.push({id:selected,label:selected});
    return <Select className="studio-device" label={input?'Microphone device':'Desktop audio device'} disabled={busy} value={selected} onChange={value=>void apply(input ? {[key]:value} : {[key]:value, audio_output_slots:slotsForPrimary(value,outputSlots(r)), audio_tracks:outputTracks(value,slotsForPrimary(value,outputSlots(r)))})} options={options.map<[string,string]>(s=>[s.id,s.label||s.id])}/>;
  };
  const target=String(r.display||'');
  const options=[{id:'',label:'Auto (primary display)'},...displays];
  if(target&&!options.some(d=>d.id===target))options.push({id:target,label:target});
  const bufferDuration=Number(r.buffer_duration??120);
  const liveEnabled=Boolean(r.live_replay);
  const preview=liveEnabled&&previewVisible;
  const disk=status.disk;
  const durationLabel=(n:number)=>n<60?`${n} sec`:`${n/60} min`;
  return <div className="capture-studio capture-home" data-preview={preview}>
    <header className="capture-topbar">
      <span className="capture-wordmark">GLOAMING<span>.</span></span>
      <div className="capture-heading"><h1>Capture studio</h1><p>Your moments, ready to keep.</p></div>
      <span className="studio-status"><i data-running={status.running}/>{status.running?'Buffer running':'Buffer stopped'}</span>
      {liveEnabled?<div className="capture-preview-toggle"><span id="home-preview-label">Live preview</span><Toggle label="Live preview" checked={preview} onChange={showPreview}/></div>:<button className="capture-button" onClick={settings}><IconClips size={16}/>Set up Live Replay</button>}
    </header>
    <div className="capture-dashboard">
      <div className="capture-main">
        {preview&&<div className="capture-live"><LiveReplay studio bufferSeconds={bufferDuration}/></div>}
        <section aria-label="Recent captures"><div className="studio-section-title"><h2>Recent moments <span>{clips.length}</span></h2><button onClick={()=>dispatch({type:'setView',view:'clips',playlistId:null})}>Open library ↗</button></div>
          {clips.length?<div className="studio-recent">{clips.slice(0,3).map(clip=><ClipCard key={clip.slug} clip={clip} actions={actions} isNew={recentNew.includes(clip.slug)}/>)}</div>:<div className="studio-empty">Your saved moments will appear here. Press <kbd>{hotkey}</kbd> to keep one.</div>}
          <p className="capture-library-note">Saved on your device. Yours to keep.</p>
        </section>
      </div>
      <aside className="capture-controls" aria-label="Recording setup">
        <div className="capture-settings-head"><h2>Recording setup</h2><IconSettings size={17}/></div>
        <section><div className="capture-eyebrow">Capture source</div>
          <Select label="Capture display" value={target} disabled={busy||Boolean(r.follow_mouse_display)||Boolean(r.window_capture)} onChange={value=>void apply({display:value||null})} options={options.map<[string,string]>(d=>[d.id,d.label||d.id])}/>
          <p className="capture-source-note">{r.window_capture?'Following the active game window':r.follow_mouse_display?'Following the display under your pointer':'Your screen, captured in the background'}</p>
        </section>
        <section className="capture-settings-section"><div className="capture-eyebrow">Audio sources</div>
          <div className="studio-audio-row"><span>Desktop audio</span><Toggle label="Desktop audio" checked={audio} disabled={busy} onChange={capture_audio=>void apply({capture_audio})}/></div>{deviceSelect(false)}
          <div className="studio-audio-row"><span>Microphone</span><Toggle label="Microphone" checked={mic} disabled={busy} onChange={micToggle}/></div>{deviceSelect(true)}
          {deviceError&&<p role="status" className="studio-description">{deviceError}</p>}
        </section>
        <section className="capture-settings-section"><div className="capture-eyebrow">Recording quality</div><div className="capture-quality"><span>{String(r.resolution||'Native resolution')}</span><span>{Number(r.fps??60)} FPS</span><span>{String(r.live_replay?'H.264':r.encoder||'Auto')}</span></div></section>
        <section className="capture-settings-section"><ClipShortcut/></section>
        <section className="capture-settings-section"><div className="capture-storage-heading"><strong>Room for more</strong><span>{disk?`${formatBytes(disk.free)} free`:'Storage unavailable'}</span></div>
          {disk&&disk.total>0&&<meter className="capture-storage-meter" min={0} max={disk.total} value={Math.max(0,disk.total-disk.free)} aria-label="Used storage"/>}
          <p className="capture-source-note">Your replay buffer keeps the last {durationLabel(bufferDuration)}.</p>
        </section>
        <button className="capture-button capture-all-settings" onClick={settings}><IconSettings size={16}/>All capture settings</button>
      </aside>
    </div>
    <footer className="studio-footer"><span>Saved locally. Ready when you need it.</span><span>{clips.length} saved captures · {status.backend||'Recorder offline'}</span></footer>
    {overlays}
    <Modal open={micChoice} onClose={()=>setMicChoice(false)} title={t('home.wfMicTitle')}><p>{t('home.wfMicBody')}</p><div className="choice-list">{['backend_fallback','mic_only'].map(strategy=><button key={strategy} className="choice" onClick={()=>{setMicChoice(false);void apply({capture_microphone:true,wf_microphone_strategy:strategy});}}>{strategy==='backend_fallback'?t('home.wfMicBothLabel'):t('home.wfMicOnlyLabel')}</button>)}</div></Modal>
  </div>;
}
