import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {readPadPosition} from '../components/PadReplay';
import {EditorController, EditorKeyboard} from '../components/EditorController';

import {api} from '../lib/api';
import {onWsMessage} from '../lib/ws';
import {resolveAccent} from '../theme/gloamingTheme';
import {useStore} from '../state/store';
import {createEditorEngine, type EditorEngine} from '../engine/editor';
import {ED_FONTS, ED_SWATCHES, edFmt, fxName} from '../engine/editorConstants';
import type {EdSnapshot, EdTab} from '../engine/editorTypes';
import {Modal} from '../components/Modal';
import {IconClose, IconExpand} from '../components/Icons';
import {Select, TextField, Toggle} from '../components/settings/Fields';
import {t} from '../lib/i18n';

const EDITOR_LIB_HINT: Record<EdTab, string> = {
  library: 'editor.libHintLibrary',
  effects: 'editor.libHintEffects',
  text: 'editor.libHintText',
};

const TABS: Array<[EdTab, () => string]> = [
  ['library', () => t('editor.tabLibrary')],
  ['effects', () => t('editor.tabEffects')],
  ['text', () => t('editor.tabText')],
];

export function Editor() {
  const {state, notify, dispatch} = useStore();
  const {clips, accent, customAccent, editorProjectRevision, config} = state;
  // The editor paints its own timeline, so it needs the resolved accent
  // rather than a name it can look up in the generated table.
  const accentBase = resolveAccent(accent, customAccent).ramp.base;

  const stageRef = useRef<HTMLDivElement>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const fadeRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const libraryRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // The engine reads clips and the accent through getters, so it always sees
  // current values without being rebuilt when either changes.
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const accentRef = useRef(accentBase);
  accentRef.current = accentBase;

  const engineRef = useRef<EditorEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = createEditorEngine({
      clips: () => clipsRef.current,
      notify: (title, tone = 'accent') =>
        notify({
          kind: tone === 'error' ? 'error' : 'info',
          title,
          tone,
          holdMs: tone === 'error' ? 6000 : 3000,
        }),
      accent: () => accentRef.current,
    });
  }
  const engine = engineRef.current;

  const [snap, setSnap] = useState<EdSnapshot>(() => engine.snapshot());
  const [resetOpen, setResetOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => engine.subscribe(setSnap), [engine]);

  useEffect(() => {
    let cancelled = false;
    void engine.load().then(() => {
      if (cancelled || !stageRef.current) return;
      engine.mount({
        stage: stageRef.current,
        stageWrap: stageWrapRef.current!,
        fadeOverlay: fadeRef.current!,
        timelineCanvas: canvasRef.current!,
        timelineScroll: scrollRef.current!,
        libraryScroll: libraryRef.current!,
      });
    });
    return () => {
      cancelled = true;
      engine.destroy();
    };
  }, [engine]);

  // The library and the missing-clip styling follow the clip list, or an
  // editor opened before the first /api/clips response stays empty forever.
  useEffect(() => {
    engine.setClips(clips);
  }, [engine, clips]);

  useEffect(() => {
    if (editorProjectRevision > 0) void engine.onProjectChanged();
  }, [engine, editorProjectRevision]);

  const [mode,setMode]=useState<'easy'|'advanced'>(()=>{try{return localStorage.getItem('gloaming-editor-mode')==='advanced'?'advanced':'easy';}catch{return 'easy';}});
  const [drawer,setDrawer]=useState(false);
  const [focus,setFocus]=useState(false);
  const [timelineHeight,setTimelineHeight]=useState(220);
  useEffect(()=>{engine.setEasy(mode==='easy');try{localStorage.setItem('gloaming-editor-mode',mode);}catch{}},[mode,engine]);
  const resizeTimeline=(e:React.PointerEvent<HTMLDivElement>)=>{
    e.preventDefault();const target=e.currentTarget,origin=e.clientY,base=timelineHeight;target.setPointerCapture(e.pointerId);
    const move=(ev:PointerEvent)=>setTimelineHeight(Math.max(140,Math.min(window.innerHeight*.5,base+origin-ev.clientY)));
    const stop=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',stop);target.removeEventListener('pointercancel',stop);};
    target.addEventListener('pointermove',move);target.addEventListener('pointerup',stop);target.addEventListener('pointercancel',stop);
  };
  const selected=snap.selected,isText=selected?.kind==='text';
  const project=engine.project();
  const defaultController=useRef({enabled:true,position:readPadPosition()});
  const controller=project?.controller ?? defaultController.current;
  const projectHasPad=Boolean(project?.items.some(i=>i.kind==='clip' && clips.some(c=>c.slug===i.clipId && c.pad_inputs)));
  const projectHasKeys=Boolean(project?.items.some(i=>i.kind==='clip' && clips.some(c=>c.slug===i.clipId && c.keys)));
  const audioTracks=project?.tracks.filter(tr=>tr.type==='audio' && project.items.some(i=>i.trackId===tr.id)) ?? [];
  const chooseTool=(tab:EdTab)=>{engine.setTab(tab);setDrawer(!(drawer && snap.tab===tab));};
  const displaySource=(label:string)=>label.replace(/^device:/,'').replace(/\.monitor$/,'').replace(/^sink[_-]/,'').replace(/[_-]/g,' ');
  return <div className="editor cut-editor" data-mode={mode} data-focus={focus} ref={frameRef} style={{['--ed-tl-h' as string]:`${mode==='easy'?158:timelineHeight}px`}}>
    <header className="cut-header">
      <div className="cut-title"><span>{t('editor.workspace')}</span><small>{t(mode==='easy'?'editor.easyDescription':'editor.advancedDescription')}</small></div>
      <div className="cut-modes" role="group" aria-label={t('editor.editingMode')}>
        <button type="button" aria-pressed={mode==='easy'} onClick={()=>{setMode('easy');setDrawer(false);}}>{t('editor.easyMode')}</button>
        <button type="button" aria-pressed={mode==='advanced'} onClick={()=>setMode('advanced')}>{t('editor.advancedMode')}</button>
      </div>
      <div className="cut-header-actions">
        <button type="button" className="cut-history" disabled={!snap.canUndo} onClick={()=>engine.undo()} aria-label={t('editor.undo')} title="Ctrl+Z">↶ <span>{t('editor.undo')}</span></button>
        <button type="button" className="cut-history" disabled={!snap.canRedo} onClick={()=>engine.redo()} aria-label={t('editor.redo')} title="Ctrl+Shift+Z">↷ <span>{t('editor.redo')}</span></button>
        <button type="button" className="btn btn-primary" disabled={!snap.duration} onClick={()=>setExportOpen(true)}>{t('editor.exportBtn')}</button>
      </div>
    </header>
    <div className="cut-workspace">
      <main className="cut-screen">
        <div className="cut-toolstrip">
          <div className="cut-edit-tools" role="group" aria-label={t('editor.clipTools')}>
          {TABS.filter(([id])=>mode==='advanced'||id==='library').map(([id,label])=><button type="button" key={id} aria-pressed={drawer && snap.tab===id} onClick={()=>chooseTool(id)}>{label()}</button>)}
          </div>
          <span className="cut-tool-hint">{t(mode==='easy'?'editor.easyHint':'editor.advancedHint')}</span>
          <button type="button" className="cut-clear" onClick={()=>setResetOpen(true)}>{t('editor.reset')}</button>
        </div>
        <div className="cut-monitor">
          <div className="ed-stage-wrap" ref={stageWrapRef}><div className="ed-stage" ref={stageRef}>
            {snap.empty ? <div className="ed-stage-empty"><b>{t('editor.nothingAtPlayhead')}</b><button type="button" className="btn btn-primary" onClick={()=>{engine.setTab('library');setDrawer(true);}}>{t('editor.chooseClip')}</button></div> : null}
            {snap.preparing ? <div className="ed-stage-preparing">{t('editor.preparingMedia')}</div> : null}
            <div className="ed-fade-overlay" ref={fadeRef}/>
            {projectHasPad && controller.enabled ? <EditorController engine={engine} container={stageRef} position={controller.position} onPositionChange={position=>engine.setController({...controller,position})}/> : null}
            {projectHasKeys && project?.keyboard ? <EditorKeyboard engine={engine}/> : null}
          </div></div>
          <aside className="cut-drawer" hidden={!drawer}>
            <div className="cut-drawer-head"><b>{TABS.find(([id])=>id===snap.tab)?.[1]()}</b><button type="button" className="ed-iconbtn" onClick={()=>setDrawer(false)} aria-label={t('common.close')}><IconClose/></button></div>
            {snap.tab==='library' ? <input className="cut-search" value={snap.query} onChange={e=>engine.search(e.target.value)} placeholder={t('editor.searchClips')} aria-label={t('editor.searchClips')}/> : null}
            <div className="ed-lib-scroll" ref={libraryRef}/><p className="ed-lib-hint">{t(EDITOR_LIB_HINT[snap.tab])}</p>
          </aside>
        </div>
        <div className="cut-transport">
          <span className="mono">{edFmt(snap.playhead)} <span className="dim">/ {edFmt(snap.duration)}</span></span>
          <div><button type="button" className="ed-iconbtn" onClick={()=>engine.seek(0)} aria-label={t('editor.backToStart')}><StartGlyph/></button><button type="button" className="ed-play" onClick={()=>engine.setPlaying(!snap.playing)} aria-label={snap.playing?t('editor.pause'):t('editor.play')}>{snap.playing?<PauseGlyph/>:<PlayGlyph/>}</button></div>
          <button type="button" className="cut-clear" onClick={()=>setFocus(!focus)} aria-label={t(focus?'editor.exitFocus':'editor.focusPreview')} title={t(focus?'editor.exitFocus':'editor.focusPreview')}><IconExpand collapse={focus}/></button>
        </div>
      </main>
      <aside className="cut-properties">
        <section><h3>{t('editor.soundSection')}</h3><p>{t('editor.soundHelp')}</p>
          {audioTracks.length ? audioTracks.map(track=><div className="cut-source" key={track.id}>
            <span title={track.label}>{displaySource(track.label)}</span>
            <button type="button" className="ed-track-mute" aria-pressed={Boolean(track.muted)} aria-label={`${t(track.muted?'editor.unmuteTrack':'editor.muteTrack')}: ${track.label}`} onClick={()=>engine.muteTrack(track.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/>{track.muted?<path d="m16 9 5 6m0-6-5 6"/>:<path d="M15 8q5 4 0 8m3-11q8 7 0 14"/>}</svg>
            </button></div>):<p className="dim">{t('editor.noAudioSources')}</p>}
        </section>
        <section><h3>{t('editor.recordedInputs')}</h3>
          {projectHasPad ? <><label className="cut-input-toggle"><span>{t('viewer.controllerInputs')}</span><Toggle label={t('viewer.controllerInputs')} checked={controller.enabled} onChange={enabled=>engine.setController({...controller,enabled})}/></label>{controller.enabled?<p>{t('editor.dragControllerHint')}</p>:null}</>:null}
          {projectHasKeys ? <label className="cut-input-toggle"><span>{t('editor.keyboardInputs')}</span><Toggle label={t('editor.keyboardInputs')} checked={Boolean(project?.keyboard)} onChange={value=>engine.setKeyboard(value)}/></label>:null}
          {!projectHasKeys && !projectHasPad ? <p>{t('editor.noRecordedInputs')}</p>:<p>{t('editor.inputsExportHint')}</p>}
        </section>
        {mode==='advanced' && selected ? <section className="cut-selection"><h3>{t('editor.selectionSection')}</h3>
          {selected?.kind==='clip' && !selected.trans ? <p>{clips.find(c=>c.slug===selected.clipId)?.name || selected.clipId}<br/>{edFmt(selected.dur)} · {t(selected.groupId?'editor.linkedStatus':'editor.independentStatus')}</p>:null}
          {selected?.kind === 'clip' && selected.trans ? <div className="ed-inspector">
            <b>{fxName(selected.trans.fx)}</b>
            <label className="ed-insp-field"><span>{t('editor.transitionDuration')} {selected.trans.len.toFixed(1)}s</span>
              <input type="range" min=".2" max={Math.min(3,selected.dur*.8)} step=".1" value={selected.trans.len}
                onChange={e=>engine.inspectorChange('transitionLen',Number(e.target.value))}/></label>
            <button type="button" className="btn btn-quiet btn-sm" onClick={()=>engine.inspectorChange('removeTransition',true)}>{t('editor.removeEffect')}</button>
          </div> : null}
          {selected?.kind === 'audio' ? (
            <div className="ed-inspector ed-audio-inspector">
              <span className="eyebrow">{t('editor.audioTrack')}</span>
              <div className="ed-insp-field">
              <span>{t('editor.audioSource')}</span>
              <Select
                label={t('editor.audioSource')}
                value={String(selected.audioStream ?? 0)}
                onChange={v => engine.inspectorChange('audioStream', Number(v))}
                options={(clips.find(c => c.slug === selected.clipId)?.audio_tracks ?? []).map((track): [string, string] => [
                  String(track.index), track.title || t('editor.recordedTrack', {number: track.index + 1}),
                ])}
              />
              </div>
              <label className="ed-audio-volume">
                <span>{t('editor.audioVolume')} {Math.round((selected.volume ?? 1) * 100)}%</span>
                <input type="range" min="0" max="100" step="1"
                  value={Math.round((selected.volume ?? 1) * 100)}
                  onChange={e => engine.inspectorChange('volume', Number(e.target.value) / 100)} />
              </label>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => engine.remove()}>
                {t('editor.removeAudioSource')}
              </button>
              <label className="ed-audio-mute">
                <span>{t('editor.audioMuted')}</span>
                <Toggle label={t('editor.audioMuted')} checked={Boolean(selected.muted)}
                  onChange={v => engine.inspectorChange('muted', v)} />
              </label>
              <p className="dim">{t('editor.detachedTracksHelp')}</p>
            </div>
          ) : null}

          {isText ? (
            <div className="ed-inspector">
              <div className="ed-insp-head">
                <span className="eyebrow">{t('editor.titleSection')}</span>
                <button
                  type="button"
                  className="ed-iconbtn"
                  onClick={() => engine.select(null)}
                  aria-label={t('editor.closeInspector')}>
                  <IconClose size={12} />
                </button>
              </div>

              <TextField
                label={t('editor.titleText')}
                value={selected.text ?? ''}
                placeholder={t('editor.titleText')}
                onChange={v => engine.inspectorChange('text', v)}
              />

              <label className="ed-insp-field">
                <span>{t('editor.font')}</span>
                <Select
                  label={t('editor.font')}
                  value={selected.font ?? 'display'}
                  onChange={v => engine.inspectorChange('font', v)}
                  options={Object.entries(ED_FONTS).map(([k, f]) => [k, f.label] as [string, string])}
                />
              </label>

              <label className="ed-insp-field">
                <span>
                  {t('editor.size')} <b className="mono">{selected.size}px</b>
                </span>
                <input
                  type="range"
                  className="ed-insp-range"
                  min={16}
                  max={400}
                  step={2}
                  value={selected.size ?? 64}
                  aria-label={t('editor.titleSize')}
                  onChange={e => engine.inspectorChange('size', e.target.value)}
                />
              </label>

              <label className="ed-insp-field">
                <span>{t('editor.colour')}</span>
                <div className="ed-swatches">
                  {ED_SWATCHES.map(color => (
                    <button
                      key={color}
                      type="button"
                      className="ed-swatch"
                      data-active={selected.color === color || undefined}
                      style={{background: color}}
                      title={color}
                      aria-label={t('editor.useColour', {color})}
                      onClick={() => engine.inspectorChange('color', color)}
                    />
                  ))}
                </div>
              </label>

              <p className="ed-insp-pos">
                x {Math.round(selected.x ?? 0)}% · y {Math.round(selected.y ?? 0)}%, drag it on the
                preview
              </p>

              <button type="button" className="btn btn-quiet btn-danger btn-sm" onClick={() => engine.remove()}>
                {t('editor.removeTitle')}
              </button>
            </div>
          ) : null}
          {!selected ? <p>{t('editor.selectItemHint')}</p>:null}
        </section>:null}
      </aside>
    </div>
    {mode==='advanced'?<div className="ed-resize ed-resize-y" onPointerDown={resizeTimeline}><span/></div>:null}
    <section className="cut-timeline ed-timeline">
      <div className="ed-tl-toolbar">
        <button type="button" className="btn btn-quiet btn-sm" disabled={!snap.canSplit} onClick={()=>engine.split()}>{t('editor.split')}</button>
        <button type="button" className="btn btn-quiet btn-sm" disabled={!snap.canDelete} onClick={()=>engine.remove()}>{t('common.delete')}</button>
        {mode==='advanced'?<>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!selected?.groupId && !snap.canRelink} onClick={()=>selected?.groupId?engine.unlinkAudio():engine.relinkAudio()}>{t(selected?.groupId?'editor.unlinkAudio':'editor.relinkAudio')}</button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={!snap.canDuplicate} onClick={()=>engine.duplicate()}>{t('editor.duplicate')}</button>
        </>:<span className="cut-trim-hint">{t('editor.trimHint')}</span>}
        <div className="ed-spacer"/>
        <button type="button" className="ed-iconbtn" onClick={()=>engine.zoom(1/1.3)} aria-label={t('editor.zoomOut')}><MinusGlyph/></button>
        <button type="button" className="ed-iconbtn" onClick={()=>engine.zoom(1.3)} aria-label={t('editor.zoomIn')}><PlusGlyph/></button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={()=>engine.fit()}>{t('editor.fit')}</button>
        {mode==='advanced'?<AddTrackButton onAdd={type=>engine.addTrack(type)}/>:null}
      </div>
      <div className="ed-tl-scroll" ref={scrollRef}><div className="ed-tl-canvas" ref={canvasRef}/></div>
    </section>
      <Modal
        open={resetOpen}
        title={t('editor.clearTitle')}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-quiet" onClick={() => setResetOpen(false)}>
              {t('common.keepIt')}
            </button>
            <button
              type="button"
              className="btn btn-danger-solid"
              onClick={() => {
                setResetOpen(false);
                engine.reset();
              }}>
              {t('editor.clear')}
            </button>
          </>
        }>
        <p>{t('editor.clearBody')}</p>
      </Modal>

      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        engine={engine}
        duration={snap.duration}
        libraryDir={(config?.output?.directory as string) ?? '~/Videos/Gloaming'}
        accent={accentBase}
        recording={state.status.recording || state.status.session_active}
        clipsWithKeys={state.clips.filter(c => c.keys).map(c => c.slug)}
        clipsWithPad={state.clips.filter(c => c.pad_inputs).map(c => c.slug)}
        notify={notify}
        onExported={() => dispatch({type: 'setView', view: 'editor'})}
      />
  </div>;
}
/** Export runs on the daemon, and its progress arrives over the WebSocket. */
function ExportModal({
  open,
  onClose,
  engine,
  duration,
  libraryDir,
  accent,
  recording,
  clipsWithKeys,
  clipsWithPad,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  engine: EditorEngine;
  duration: number;
  libraryDir: string;
  accent: string;
  recording: boolean;
  notify: ReturnType<typeof useStore>['notify'];
  /** Slugs of clips with keys kept beside them (#209). */
  clipsWithKeys: string[];
  clipsWithPad: string[];
  onExported: () => void;
}) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('library');
  const [custom, setCustom] = useState('');
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [discordOptimized, setDiscordOptimized] = useState(false);


  const [preparingExport, setPreparingExport] = useState(false);
  const projectHasPad = open && Boolean(engine.project()?.items.some(item => item.clipId && clipsWithPad.includes(item.clipId)));
  const projectHasKeys =
    open &&
    Boolean(engine.project()?.items.some(item => item.clipId && clipsWithKeys.includes(item.clipId)));
  const [phase, setPhase] = useState<'form' | 'busy' | 'done'>('form');
  const [progress, setProgress] = useState(0);
  const [donePath, setDonePath] = useState('');
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPhase('form');
    setProgress(0);
  }, [open]);

  // Export progress belongs to whoever started the render, so it is taken
  // straight off the socket rather than through the store.
  useEffect(() => {
    if (!open) return;
    return onWsMessage(raw => {
      const msg = raw as {
        type?: string;
        job_id?: string;
        progress?: number;
        path?: string;
        error?: string;
        canceled?: boolean;
      };
      if (!msg.type?.startsWith('export_') || msg.job_id !== jobRef.current) return;
      if (msg.type === 'export_progress') {
        setProgress(Math.min(100, Math.round((msg.progress ?? 0) * 100)));
      } else if (msg.type === 'export_done') {
        jobRef.current = null;
        setDonePath(msg.path ?? '');
        setPhase('done');
      } else if (msg.type === 'export_error') {
        jobRef.current = null;
        setPhase('form');
        notify({
          kind: msg.canceled ? 'info' : 'error',
          title: msg.canceled ? t('editor.exportCanceled') : t('editor.exportFailed'),
          detail: msg.canceled ? undefined : msg.error,
          tone: msg.canceled ? 'neutral' : 'error',
          holdMs: 7000,
        });
      }
    });
  }, [open, notify]);

  const dir =
    location === 'library' ? libraryDir : location === 'videos' ? '~/Videos' : custom.trim() || '';
  const summary = t('editor.exportSummary', {
    seconds: Math.round(duration),
    format: discordOptimized ? t('editor.exportFormatDiscord') : t('editor.exportFormatDefault'),
    path: `${dir || t('editor.exportFolderUnpicked')}/${(name.trim() || 'Gloaming_Edit_N').replace(/\.mp4$/i, '')}.mp4`,
  });

  const start = async () => {
    if (preparingExport) return;
    if (location === 'custom' && !custom.trim()) {
      notify({kind: 'error', title: t('editor.pickFolder'), tone: 'error', holdMs: 4000});
      return;
    }
    if (engine.isDirty()) await engine.saveNow();
    const body: Record<string, unknown> = {
      project: engine.project(),
      location,
      add_to_library: addToLibrary,
      accent,
      discord_optimized: discordOptimized,
      keys: projectHasKeys && Boolean(engine.project()?.keyboard),
      pad_inputs: projectHasPad && (engine.project()?.controller?.enabled ?? true),
      pad_position: engine.project()?.controller?.position ?? readPadPosition(),
    };
    if (name.trim()) body.filename = name.trim();
    if (location === 'custom') body.path = custom.trim();
    try {
      setPreparingExport(true);
      const result = (await api.startExport(body)) as {
        ok?: boolean;
        job_id?: string;
        path?: string;
        error?: string;
        errors?: string[];
      };
      if (result.ok === false || !result.job_id) {
        throw new Error(result.error || result.errors?.[0] || t('editor.exportRefused'));
      }
      jobRef.current = result.job_id;
      setDonePath(result.path ?? '');
      setProgress(0);
      setPhase('busy');
    } catch (err) {
      notify({
        kind: 'error',
        title: t('editor.errStartExport'),
        detail: (err as Error).message,
        tone: 'error',
        holdMs: 8000,
      });
    } finally {
      setPreparingExport(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t('editor.exportVideo')}
      wide
      onClose={() => {
        // A render in flight is the daemon's job now; closing would orphan it.
        if (phase !== 'busy') onClose();
      }}
      footer={
        phase === 'form' ? (
          <>
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn" disabled={preparingExport} onClick={() => void start()}>
              {t('editor.startExport')}
            </button>
          </>
        ) : phase === 'busy' ? (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              if (jobRef.current) void api.cancelExport(jobRef.current).catch(() => {});
            }}>
            {t('editor.cancelExport')}
          </button>
        ) : (
          <button type="button" className="btn" onClick={onClose}>
            {t('editor.done')}
          </button>
        )
      }>
      {phase === 'form' ? (
        <>
          <label className="ed-export-field">
            <span>{t('editor.saveAs')}</span>
            <TextField
              label={t('editor.exportFilename')}
              wide
              value={name}
              placeholder={t('editor.exportFilenamePlaceholder')}
              onChange={setName}
            />
          </label>
          <label className="ed-export-field">
            <span>{t('editor.location')}</span>
            <Select
              label={t('editor.exportLocation')}
              value={location}
              onChange={setLocation}
              options={[
                ['library', t('editor.gloamingLibrary')],
                ['videos', '~/Videos'],
                ['custom', t('editor.customPath')],
              ]}
            />
          </label>
          {location === 'custom' ? (
            <label className="ed-export-field">
              <span>{t('editor.folder')}</span>
              <TextField
                label={t('editor.exportFolder')}
                wide
                mono
                value={custom}
                placeholder="/home/you/Videos/edits"
                onChange={setCustom}
              />
            </label>
          ) : null}
          {location !== 'library' ? (
            <label className="ed-export-field">
              <span>{t('editor.alsoAddToLibrary')}</span>
              <Toggle
                label={t('editor.alsoAddToLibrary')}
                checked={addToLibrary}
                onChange={setAddToLibrary}
              />
            </label>
          ) : null}
          {preparingExport ? <p role="status">{t("editor.preparingMedia")}</p> : null}

          <label className="ed-export-field">
            <span>{t('editor.discordOptimize')}</span>
            <Toggle
              label={t('editor.discordOptimize')}
              checked={discordOptimized}
              onChange={setDiscordOptimized}
            />
          </label>
          <p className="ed-export-summary mono">{summary}</p>
          {recording ? (
            <p className="ed-export-warn">
              Gloaming is recording right now. Exporting will compete with the encoder for the GPU, so
              expect the game to stutter.
            </p>
          ) : null}
        </>
      ) : phase === 'busy' ? (
        <>
          <p>{t('editor.encoding')}</p>
          <div className="ed-progress">
            <div className="ed-progress-fill" style={{width: `${progress}%`}} />
          </div>
          <p className="mono ed-progress-label">{t('editor.encodingProgress', {percent: progress})}</p>
        </>
      ) : (
        <>
          <p>{t('editor.exported')}</p>
          <p className="mono ed-export-path">{donePath}</p>
        </>
      )}
    </Modal>
  );
}

function AddTrackButton({onAdd}: {onAdd: (type: 'video' | 'audio') => void}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState({x: 0, y: 0});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu opens upward out of a panel with overflow: hidden, so it was
  // being clipped rather than stacked underneath. Fixed positioning takes it
  // out of that box entirely.
  useLayoutEffect(() => {
    const node = menuRef.current;
    const button = ref.current?.querySelector('button');
    if (!open || !node || !button) return;
    const r = button.getBoundingClientRect();
    // offsetWidth/offsetHeight, not a client rect: the menu plays a scale()
    // entry animation and a live rect reports the transformed box.
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    setAt({
      x: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)),
      y: Math.max(8, r.top - h - 6),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const id = window.setTimeout(() => document.addEventListener('pointerdown', dismiss, true), 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [open]);

  return (
    <div className="ed-addtrack" ref={ref}>
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(v => !v)}>
        {t('editor.addTrack')}
      </button>
      {open ? (
        <div className="ed-addtrack-menu" role="menu" ref={menuRef} style={{left: at.x, top: at.y}}>
          <button
            type="button"
            onClick={() => {
              onAdd('video');
              setOpen(false);
            }}>
            {t('editor.videoTrack')}
          </button>
          <button
            type="button"
            onClick={() => {
              onAdd('audio');
              setOpen(false);
            }}>
            {t('editor.audioTrack')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const StartGlyph = () => (
  <svg {...stroke} width={13} height={13}>
    <polygon points="19 20 9 12 19 4 19 20" />
    <line x1="5" x2="5" y1="19" y2="5" />
  </svg>
);
const PlayGlyph = () => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden="true">
    <path d="M7 4l13 8-13 8z" />
  </svg>
);
const PauseGlyph = () => (
  <svg viewBox="0 0 24 24" width={14} height={14} fill="currentColor" aria-hidden="true">
    <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />
  </svg>
);
const MinusGlyph = () => (
  <svg {...stroke} width={12} height={12}>
    <path d="M5 12h14" />
  </svg>
);
const PlusGlyph = () => (
  <svg {...stroke} width={12} height={12}>
    <path d="M5 12h14M12 5v14" />
  </svg>
);
