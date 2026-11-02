import {slotsForPrimary} from '../lib/audioOutputs';
import {recordingCapabilities, WF_ENCODERS} from '../lib/recordingCapabilities';
import {useCallback, useEffect, useRef, useState} from 'react';

import {api} from '../lib/api';
import {boundedDuration, constrainRecordingDurations} from '../lib/recordingLimits';
import {SettingsAutosave} from '../lib/settingsAutosave';
import {IS_NATIVE, trayAvailable} from '../lib/env';
import type {KeyOverlayState} from '../lib/types';
import {formatLengthLong} from '../lib/format';
import {availableLocales, currentLocale, setLocale, t, tNode} from '../lib/i18n';
import {LOCALE_LABELS, type LocaleName} from '../locales';
import {
  EFFECTS_MODES,
  applyEffects,
  effectsNote,
  isEffectsMode,
  subscribeEffects,
  type EffectsMode,
} from '../lib/effects';
import {
  SOUND_FIELDS,
  bufferNote,
  draftFromConfig,
  newClipPreset,
  patchFromDraft,
  renderClipName,
  resolvedResolution,
  type ClipPreset,
  type Draft,
} from '../lib/settingsDraft';
import {ACCENTS, ACCENT_NAMES} from '../theme/accents';
import {useStore} from '../state/store';
import {Modal} from '../components/Modal';
import {IconCheck, IconClose, IconFolder, IconFolderOpen, IconPlus, IconTrash} from '../components/Icons';
import {AccentPicker} from '../components/AccentPicker';
import {useAccentChoice} from '../lib/accentChoice';
import {customAccent as deriveCustom} from '../theme/gloamingTheme';
import {AudioTracks, type AudioSource} from '../components/settings/AudioTracks';
import {ControllerCapture, ControllerStatus} from '../components/settings/ControllerCapture';
import {QualityCard} from '../components/settings/QualityCard';
import {KeyCapture} from '../components/settings/KeyCapture';
import {
  FolderField,
  Row,
  Select,
  Slider,
  SoundGrid,
  TextArea,
  TextField,
  Toggle,
  type RowNote,
} from '../components/settings/Fields';

const SECTIONS = [
  ['recording', 'settings.secRecording'],
  ['audio', 'settings.secAudio'],
  ['storage', 'settings.secStorage'],
  ['sharing', 'settings.secSharing'],
  ['discord', 'settings.secDiscord'],
  ['overlay', 'settings.secOverlay'],
  ['advanced', 'settings.secSystem'],
] as const;

const BASIC_SECTIONS = [
  ['quality', 'Recording quality', 'Picture quality & replay buffer', 'recording'],
  ['capture', 'Capture', 'Display & clip duration', 'recording'],
  ['sound', 'Audio', 'Desktop sound & microphone', 'audio'],
  ['shortcuts', 'Shortcuts', 'Every key and controller button, in one place', 'hotkeys'],
  ['general', 'General', 'Language, colors, startup & window', 'advanced'],
] as const;
type BasicSectionId = (typeof BASIC_SECTIONS)[number][0];

type SectionId = (typeof SECTIONS)[number][0];
type IconId = SectionId | 'hotkeys' | 'appearance' | 'controller';

interface DisplayInfo {
  displays: Array<{id: string; label?: string}>;
  warning?: string | null;
  follow_mouse_supported?: boolean;
  wf_10bit_supported?: boolean;
}

export function Settings() {
  const {state, saveConfig, notify} = useStore();
  const {choose, chooseCustom, seed} = useAccentChoice();
  const [picking, setPicking] = useState(false);
  const customBase = seed ? deriveCustom(seed).ramp.base : null;
  const {config, accent, status} = state;

  const [draft, setDraft] = useState<Draft | null>(null);
  const autosave = useRef<SettingsAutosave | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [displays, setDisplays] = useState<DisplayInfo>({displays: [], warning: null});
  const [sources, setSources] = useState<{sources: AudioSource[]; warning?: string | null}>({
    sources: [],
  });
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  // The sidebar groups work like folders: Basic starts open, Advanced closed.
  const [groupOpen, setGroupOpen] = useState({basic: true, advanced: false});
  const [basicSection, setBasicSection] = useState<BasicSectionId>('quality');
  const [resultCount, setResultCount] = useState(0);
  const [query, setQuery] = useState('');
  const searching = query.trim().length > 0;
  const [section, setSection] = useState<SectionId>('recording');
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [wfMicPrompt, setWfMicPrompt] = useState(false);
  const [effects, setEffects] = useState<EffectsMode>('auto');
  const [, forceEffectsNote] = useState(0);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const update = useCallback((patch: Partial<Draft>) => {
    const previous = draftRef.current;
    if (!previous) return;
    const next = constrainRecordingDurations({...previous, ...patch});
    if (patch.desktopSource !== undefined) next.audioOutputSlots = slotsForPrimary(next.desktopSource, next.audioOutputSlots);
    draftRef.current = next;
    setDraft(next);
    const payload = patchFromDraft(next);
    // An unfinished custom size is not "Auto". Save other edits independently.
    if (resolvedResolution(next) === false || (next.resolution === 'custom' && !next.customResolution.trim())) {
      delete payload.recording.resolution;
    }
    autosave.current?.submit(payload);
  }, []);

  useEffect(() => {
    if (!config) return;
    if (draftRef.current) {
      const accepted = autosave.current?.acceptExternal({overlay: {
        keys: Boolean(config.overlay?.keys), pad: Boolean(config.overlay?.pad),
      }}).overlay;
      if (accepted) {
        const next = {...draftRef.current,
          ...('keys' in accepted ? {keyOverlay: Boolean(accepted.keys)} : {}),
          ...('pad' in accepted ? {padOverlay: Boolean(accepted.pad)} : {}),
        };
        draftRef.current = next;
        setDraft(next);
      }
      return;
    }
    const next = constrainRecordingDurations(draftFromConfig(config));
    draftRef.current = next;
    setDraft(next);
    autosave.current = new SettingsAutosave(patchFromDraft(next), async patch => {
      try {
        const result = await saveConfig(patch);
        setSaveError(false);
        if (result.applied === false && result.warning) {
          notify({kind: 'error', title: t('settings.savedNotApplied'), detail: result.warning, tone: 'error', holdMs: 8000});
        }
        if (result.restart_required) setRestartNeeded(true);
      } catch (err) {
        setSaveError(true);
        notify({kind: 'error', title: t('settings.errSave'), detail: (err as Error)?.message, tone: 'error', holdMs: 7000});
        throw err;
      }
    });
  }, [config, saveConfig, notify]);

  // Finish the last keystroke even when navigating away before the debounce fires.
  useEffect(() => () => { void autosave.current?.flush(); }, []);

  useEffect(() => {
    void api
      .getAppState()
      .then(s => {
        const mode = isEffectsMode(s.effects_mode) ? s.effects_mode : 'auto';
        setEffects(mode);
        applyEffects(mode);
      })
      .catch(() => applyEffects('auto'));
    return subscribeEffects(() => forceEffectsNote(n => n + 1));
  }, []);

  const loadDisplays = useCallback(async (backend: string) => {
    try {
      const info = await api.displays(backend || 'auto');
      setDisplays(info as unknown as DisplayInfo);
    } catch {
      setDisplays({displays: [], warning: t('settings.displayLoadFailed')});
    }
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const info = await api.audioSources();
      setSources(info as unknown as {sources: AudioSource[]; warning?: string | null});
    } catch {
      setSources({
        sources: [{id: 'default_output', label: t('settings.defaultOutput')}],
        warning: t('settings.sourceLoadFailed'),
      });
    }
  }, []);

  useEffect(() => {
    if (!draft) return;
    void loadDisplays(draft.liveReplay ? 'gsr' : draft.backend);
    // Only the backend changes what is enumerable, so this does not rerun on
    // every keystroke elsewhere in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.backend, draft?.liveReplay, loadDisplays]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    bodyRef.current?.scrollTo({top: 0});
    if (pendingFocus.current) {
      document.getElementById(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [mode, section, basicSection, searching]);
  // The window can only hide to a tray the desktop actually has.
  const [trayOk, setTrayOk] = useState(true);
  useEffect(() => { void trayAvailable().then(setTrayOk); }, []);

  // Search: while there is a query every section is on the page, and rows that do not match are hidden.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (text: string) => words.every(word => text.toLowerCase().includes(word));
    let shown = 0;
    for (const card of Array.from(body.querySelectorAll<HTMLElement>('.settings-card'))) {
      const categoryMatches = words.length > 0 && matches(card.getAttribute('aria-label') ?? '');
      const rows = Array.from(card.querySelectorAll<HTMLElement>('.srow'));
      let visibleRows = 0;
      for (const row of rows) {
        const visible = !words.length || categoryMatches || matches(row.textContent ?? '');
        row.hidden = !visible;
        if (visible) visibleRows += 1;
      }
      // Quality presets and controller status also contain searchable controls outside rows.
      const extras = Array.from(card.children).filter(child => !child.matches('.srow, h2, .adv-group, .quality-fine'));
      let visibleExtras = 0;
      for (const extra of extras) {
        const visible = !words.length || categoryMatches || matches(extra.textContent ?? '');
        (extra as HTMLElement).hidden = !visible;
        if (visible) visibleExtras += 1;
      }
      card.hidden = words.length > 0 && !categoryMatches && visibleRows + visibleExtras === 0;
      if (!card.hidden) shown += 1;
    }
    for (const title of Array.from(body.querySelectorAll<HTMLElement>('.adv-group'))) title.hidden = words.length > 0;
    body.dataset.results = words.length ? String(shown) : '';
    setResultCount(shown);
  });

  const goTo = (id: SectionId, focusId?: string) => {
    pendingFocus.current = focusId ?? null;
    setSection(id);
    setQuery('');
    setMode('advanced');
    setGroupOpen(open => ({...open, advanced: true}));
    bodyRef.current?.scrollTo({top: 0});
  };

  if (!draft) {
    return (
      <div className="settings settings-studio">
        <p className="home-empty">{t('settings.loading')}</p>
      </div>
    );
  }

  const fail = (title: string, err: unknown) =>
    notify({
      kind: 'error',
      title,
      detail: (err as Error)?.message,
      tone: 'error',
      holdMs: 7000,
    });

  const say = (title: string, detail?: string) =>
    notify({kind: 'info', title, detail, tone: 'accent', holdMs: 3500});

  // Immediate controls share the same queue as typed edits, preventing duplicate writes.
  const persistNow = async (
    _patch: Record<string, Record<string, unknown>>,
    onOk: () => void,
    _failure: string,
  ) => {
    if (await autosave.current?.flush()) onOk();
  };

  const micNeedsWfChoice =
    !draft.captureMic &&
    draft.captureAudio &&
    draft.wfMicStrategy === 'prompt' &&
    (draft.backend === 'wf-recorder' || status.backend === 'wf-recorder');

  const setMic = async (enabled: boolean, strategy?: string) => {
    update({captureMic: enabled, ...(strategy ? {wfMicStrategy: strategy} : {})});
    await persistNow(
      {recording: {capture_microphone: enabled, ...(strategy ? {wf_microphone_strategy: strategy} : {})}},
      () =>
        say(
          enabled ? t('settings.micOn') : t('settings.micOff'),
          enabled ? t('settings.micOnDetail') : t('settings.micOffDetail'),
        ),
      t('settings.errMic'),
    );
  };

  const setEffectsMode = (mode: EffectsMode) => {
    setEffects(mode);
    applyEffects(mode);
    void api
      .setAppState({effects_mode: mode})
      .catch(err => fail(t('settings.errSave'), err));
  };

  const caps = recordingCapabilities(draft, status.backend, displays.wf_10bit_supported);
  const buffer = bufferNote(caps.gsr ? draft : {...draft, replayStorage: 'disk'});
  const followSupported = displays.follow_mouse_supported !== false;
  // Follow the selected backend, so a stale running status cannot lock
  // display selection after switching away from GSR.
  const windowCaptureSupported = caps.gsr;

  // One keyboard shortcut. Every row reads and writes the same draft field the
  // other sections use, so a key changed in Overlay shows up here and back.
  const keyRow = ({label, help, field, api, saved, note}: {
    label: string;
    help: string;
    field: 'clipKey' | 'replayOverlayKey' | 'screenshotKey' | 'keyOverlayKey' | 'padOverlayKey' | 'menuKey';
    api: string;
    saved: (key: string) => string;
    note?: RowNote | null;
  }) => (
    <Row label={label} help={help} note={note}>
      <div className="key-pair">
        <KeyCapture
          value={draft[field]}
          label={label}
          onUnsupported={() => notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})}
          onCapture={key => {
            update({[field]: key});
            void persistNow({hotkeys: {[api]: key}}, () => say(saved(key)), t('settings.errSaveKey'));
          }}
        />
        {draft[field] ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              update({[field]: ''});
              void persistNow({hotkeys: {[api]: ''}}, () => undefined, t('settings.errSaveKey'));
            }}>
            {t('settings.clearKey')}
          </button>
        ) : null}
      </div>
    </Row>
  );

  return (
    <div className="settings settings-studio">
      <div className="settings-workspace" data-mode={mode} data-searching={searching || undefined}>
        <nav className="settings-categories" aria-label={t('settings.sections')}>
          <div className="settings-nav-heading"><span className="settings-section-icon" aria-hidden="true"><CategoryIcon section="advanced"/></span><div><strong>Preferences<span>.</span></strong><small>GLOAMING / YOUR WORKSPACE</small></div></div>
          <div className="settings-search" role="search" aria-label="Search preferences">
            <span className="settings-search-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg></span>
            <input type="search" value={query} placeholder="Find a setting…" aria-label="Search settings"
              onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.stopPropagation(); } }} />
            {query && <button type="button" className="settings-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><IconClose size={13}/></button>}
          </div>
          <div className="settings-nav-groups">
            <div className="settings-nav-group" role="group" aria-labelledby="basic-settings-label">
              <NavGroupToggle id="basic-settings-label" label="Basic Settings" count={BASIC_SECTIONS.length}
                open={groupOpen.basic} onToggle={() => setGroupOpen(open => ({...open, basic: !open.basic}))}/>
              <div className="settings-nav-items" id="basic-settings-items" data-open={groupOpen.basic || undefined} inert={!groupOpen.basic}>
              <div className="settings-nav-items-inner">
              {BASIC_SECTIONS.map(([id, label, hint, icon], index) => <button key={id} type="button" style={{'--i': index} as React.CSSProperties}
                aria-current={!searching && mode === 'basic' && basicSection === id ? 'page' : undefined}
                onClick={() => { setQuery(''); setMode('basic'); setBasicSection(id); }}>
                <span className="settings-category-icon" aria-hidden="true"><CategoryIcon section={icon}/></span>
                <span className="settings-category-copy"><strong>{label}</strong><small>{hint}</small></span>
                <span className="settings-category-arrow" aria-hidden="true">›</span>
              </button>)}
              </div>
              </div>
            </div>
            <div className="settings-nav-group" role="group" aria-labelledby="advanced-settings-label">
              <NavGroupToggle id="advanced-settings-label" label="Advanced Settings" count={SECTIONS.length}
                open={groupOpen.advanced} onToggle={() => setGroupOpen(open => ({...open, advanced: !open.advanced}))}/>
              <div className="settings-nav-items" id="advanced-settings-items" data-open={groupOpen.advanced || undefined} inert={!groupOpen.advanced}>
              <div className="settings-nav-items-inner">
              {SECTIONS.map(([id, labelKey], index) => <button key={id} type="button" style={{'--i': index} as React.CSSProperties}
                aria-current={!searching && mode === 'advanced' && section === id ? 'page' : undefined}
                onClick={() => goTo(id)}>
                <span className="settings-category-icon" aria-hidden="true"><CategoryIcon section={id}/></span>
                <span className="settings-category-copy"><strong>{t(labelKey)}</strong><small>{t(`settings.navHint_${id}`)}</small></span>
                <span className="settings-category-arrow" aria-hidden="true">›</span>
              </button>)}
              </div>
              </div>
            </div>
          </div>
        </nav>
        <div className="settings-body" ref={bodyRef} role="region" aria-labelledby="settings-content-title" tabIndex={0}>
          {saveError && <div className="settings-save-error" role="alert">
            <span>Changes could not be saved. Your edits are still here.</span>
            <button type="button" className="btn btn-sm" onClick={() => void autosave.current?.flush()}>Retry</button>
          </div>}
          <header className="settings-section-intro">
            <h2 id="settings-content-title">{searching ? 'Search results' : mode === 'basic' ? BASIC_SECTIONS.find(([id]) => id === basicSection)![1] : t(SECTIONS.find(([id]) => id === section)![1])}</h2>
            <p>{searching ? `${resultCount} matching ${resultCount === 1 ? 'category' : 'categories'} for “${query.trim()}”` : mode === 'basic' ? BASIC_SECTIONS.find(([id]) => id === basicSection)![2] : t(`settings.sectionHint_${section}`)}</p>
          </header>
        {searching ? <p className="adv-empty" data-when-empty>No setting matches your search.</p> : null}
        {(mode === 'basic' || searching) && <div className="settings-basic-grid">
        {(basicSection === 'quality' || searching) && <QualityCard draft={draft} update={update} persistNow={persistNow} failure={t('settings.errSave')}
          onAdvanced={() => goTo('recording')} onCustomBuffer={() => goTo('recording', 'settings-buffer-duration')} searching={searching} wfTenBit={displays.wf_10bit_supported} />}
        {(basicSection === 'capture' || searching) && <Card id="capture" title={t('settings.basicCapture')}>
          <Row label={t('settings.clipDuration')} help={t('settings.clipDurationHelp')} note={{text: `Maximum: ${formatLengthLong(draft.bufferDuration)} — your current buffer.`}}>
            <Slider
              label={t('settings.clipDuration')}
              exact
              value={draft.clipDuration}
              min={5}
              max={draft.bufferDuration}
              step={5}
              onChange={clipDuration => update({clipDuration})}
              format={formatLengthLong}
            />
          </Row>
          <Row label={t('settings.display')} note={displayNote(draft, displays)}>
            <Select
              label={t('settings.display')}
              value={draft.display}
              disabled={(draft.followMouse && followSupported) || caps.windowCaptureActive}
              onChange={display => update({display})}
              options={displayOptions(draft, displays)}
            />
          </Row>
          <Row label={t('settings.liveReplay')} help={t('settings.liveReplayHelp')}>
            <Toggle label={t('settings.liveReplay')} checked={draft.liveReplay} onChange={liveReplay => update({liveReplay})} />
          </Row>
        </Card>}
        {(basicSection === 'sound' || searching) && <Card id="sound" title={t('settings.basicSound')}>
          <AudioTracks basic draft={draft} sources={sources.sources} onChange={update}
            onAdvanced={() => goTo('audio', 'settings-extra-outputs')} warning={sources.warning}
            onMicToggle={next => {
              if (next && micNeedsWfChoice) setWfMicPrompt(true);
              else void setMic(next);
            }}
            refreshing={refreshing} onRefresh={() => {
              setRefreshing(true);
              void loadSources().finally(() => setRefreshing(false));
            }} />
        </Card>}
        {(basicSection === 'shortcuts' || searching) && <Card id="shortcuts" title={t('settings.basicShortcuts')}>
          <h3 className="adv-group">Clips</h3>
          {keyRow({label: t('settings.clipKey'), help: t('settings.clipKeyHelp'), field: 'clipKey', api: 'clip', saved: key => t('settings.clipKeyNow', {key}),
            note: status.hotkeys_available === false ? {text: t('settings.hotkeysUnavailable'), tone: 'warning' as const} : null})}
          <Row
            label={t('settings.clipPresets')}
            stack
            help={t('settings.clipPresetsHelp')}>
            <ClipPresets
              presets={draft.clipPresets}
              maxDuration={draft.bufferDuration}
              onChange={clipPresets => update({clipPresets})}
              onUnsupported={() =>
                notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})
              }
            />
          </Row>
          <h3 className="adv-group">Screenshot &amp; overlays</h3>
          {keyRow({label: t('settings.screenshotKey'), help: t('settings.screenshotKeyHelp'), field: 'screenshotKey', api: 'screenshot', saved: key => t('settings.screenshotKeyNow', {key})})}
          {keyRow({label: t('settings.replayShortcut'), help: t('settings.replayShortcutHelp'), field: 'replayOverlayKey', api: 'replay_overlay', saved: () => t('settings.replayShortcutUpdated')})}
          {keyRow({label: 'Quick save menu', help: 'Open the save-length menu: pick the last 1, 2, 5 or 10 minutes, the whole buffer, or open the replay. Press again to close. Arrow keys and Enter pick; Escape cancels.', field: 'menuKey', api: 'menu', saved: key => `Quick save menu is now ${key}`})}
          {keyRow({label: t('settings.keyOverlayKey'), help: t('settings.keyOverlayKeyHelp'), field: 'keyOverlayKey', api: 'key_overlay', saved: key => t('settings.keyOverlayKeyNow', {key})})}
          {keyRow({label: t('settings.padOverlayKey'), help: t('settings.padOverlayKeyHelp'), field: 'padOverlayKey', api: 'pad_overlay', saved: key => t('settings.padOverlayKeyNow', {key})})}
          <h3 className="adv-group">Controller</h3>
          <ControllerStatus/>
          <Row label="Smart button" help="One button, two gestures. Tap saves the last Clip duration instantly. Hold opens a menu to open the replay overlay or save the last 1, 2, 5, 10 minutes or the whole buffer. Pick with the D-pad, left stick or bumpers; you can let go once it appears. Tap again to close.">
            <ControllerCapture value={draft.controllerSmart} onCapture={controllerSmart=>{
              update({controllerSmart});
              void persistNow({hotkeys:{controller_smart:controllerSmart}},()=>say('Smart button saved'),t('settings.errSaveKey'));
            }}/>
          </Row>
          <Row label="Quick save menu" help="Opens the save-length menu on its own button, without the smart button's tap and hold: pick the last 1, 2, 5 or 10 minutes, the whole buffer, or open the replay. Browse with the D-pad, left stick or bumpers. Press again to close.">
            <ControllerCapture value={draft.controllerMenu} onCapture={controllerMenu=>{
              update({controllerMenu});
              void persistNow({hotkeys:{controller_menu:controllerMenu}},()=>say('Quick save menu button saved'),t('settings.errSaveKey'));
            }}/>
          </Row>
          <Row label="Save last moments" help="Saves the last Clip duration selected in Capture & replay — seconds or minutes. This saves a video, without starting a recording session.">
            <ControllerCapture value={draft.controllerClip} onCapture={controllerClip=>{
              update({controllerClip});
              void persistNow({hotkeys:{controller_clip:controllerClip}},()=>say('Controller clip shortcut saved'),t('settings.errSaveKey'));
            }}/>
          </Row>
          <Row label="Screenshot" help="Take a still image with a controller button or combination. Triggers and the D-pad are supported. Executes when you release the buttons.">
            <ControllerCapture value={draft.controllerScreenshot} onCapture={controllerScreenshot=>{
              update({controllerScreenshot});
              void persistNow({hotkeys:{controller_screenshot:controllerScreenshot}},()=>say('Controller shortcut saved'),t('settings.errSaveKey'));
            }}/>
          </Row>
          <Row label="Replay overlay" help="Open or close the replay overlay from your game. Assign a different button combination for each action. Button names show Xbox / PlayStation labels; face buttons follow physical positions.">
            <ControllerCapture value={draft.controllerReplayOverlay} onCapture={controllerReplayOverlay=>{
              update({controllerReplayOverlay});
              void persistNow({hotkeys:{controller_replay_overlay:controllerReplayOverlay}},()=>say('Controller shortcut saved'),t('settings.errSaveKey'));
            }}/>
          </Row>
          <h3 className="adv-group">Game compatibility</h3>
          <Row
            label={t('settings.blocklist')}
            stack
            help={t('settings.blocklistHelp')}>
            <TextArea
              label={t('settings.blocklist')}
              value={draft.hotkeyBlocklist}
              placeholder="ggst.exe"
              onChange={hotkeyBlocklist => update({hotkeyBlocklist})}
            />
          </Row>
        </Card>}

        {(basicSection === 'general' || searching) && <Card id="general" title="General">
          <h3 className="adv-group">Appearance</h3>
          <Row label={t('settings.language')} help={t('settings.languageHelp')}>
            <Select
              label={t('settings.language')}
              value={currentLocale()}
              onChange={name => setLocale(name as LocaleName)}
              options={availableLocales().map(name => [name, LOCALE_LABELS[name]] as [string, string])}
            />
          </Row>

          <Row
            label={t('settings.accent')}
            help={t('settings.accentHelp')}>
            <div className="swatches">
              {ACCENT_NAMES.map(name => (
                <button
                  key={name}
                  type="button"
                  className="swatch"
                  data-active={accent === name || undefined}
                  style={{background: ACCENTS[name].base}}
                  title={t(`accents.${name}`)}
                  aria-label={t('settings.accentAria', {name: t(`accents.${name}`)})}
                  aria-pressed={accent === name}
                  onClick={() => choose(name)}>
                  {accent === name ? <IconCheck size={13} /> : null}
                </button>
              ))}
              <button
                type="button"
                className="swatch swatch-custom"
                data-active={accent === 'custom' || undefined}
                // The seed's own derived accent once one is saved, so the
                // swatch shows the colour it would apply rather than a
                // permanent rainbow that says nothing about the choice.
                style={customBase ? {background: customBase} : undefined}
                title={t('accents.customTitle')}
                aria-label={t('accents.customTitle')}
                aria-pressed={accent === 'custom'}
                onClick={() => setPicking(true)}>
                {accent === 'custom' ? <IconCheck size={13} /> : <IconPlus size={13} />}
              </button>
            </div>
          </Row>

          <Row
            label={t('settings.effects')}
            note={effectsNote(effects) ? {text: effectsNote(effects)} : null}
            help={t('settings.effectsHelp')}>
            <Select
              label={t('settings.effects')}
              value={effects}
              onChange={mode => setEffectsMode(mode as EffectsMode)}
              options={EFFECTS_MODES.map(m => [m, t(`settings.effects${m[0].toUpperCase()}${m.slice(1)}`)] as [string, string])}
            />
          </Row>
          <h3 className="adv-group">Startup &amp; window</h3>
          <Row label="Start with the system" help="Open Gloaming automatically when you log in, so clipping is ready before the game starts.">
            <Toggle
              label="Start with the system"
              checked={draft.startWithSystem}
              onChange={startWithSystem => {
                update({startWithSystem});
                void persistNow({ui: {start_with_system: startWithSystem}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>
          <Row label="Start minimized" help="When it opens at login, start hidden in the tray.">
            <Toggle
              label="Start minimized"
              checked={draft.startMinimized}
              disabled={!draft.startWithSystem}
              onChange={startMinimized => {
                update({startMinimized});
                void persistNow({ui: {start_minimized: startMinimized}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>
          <Row
            label="Minimize to tray"
            help="Minimizing the window hides it to the tray instead of the taskbar."
            note={IS_NATIVE && !trayOk ? {text: 'No system tray detected on this desktop, so minimizing uses the taskbar.', tone: 'warning'} : null}>
            <Toggle
              label="Minimize to tray"
              checked={draft.minimizeToTray}
              onChange={minimizeToTray => {
                update({minimizeToTray});
                void persistNow({ui: {minimize_to_tray: minimizeToTray}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>
          <Row
            label="Close to tray"
            help="Closing the window hides it to the tray and keeps recording. Use Quit in the tray menu to exit."
            note={IS_NATIVE && !trayOk ? {text: 'No system tray detected on this desktop, so closing the window quits Gloaming.', tone: 'warning'} : null}>
            <Toggle
              label="Close to tray"
              checked={draft.closeToTray}
              onChange={closeToTray => {
                update({closeToTray});
                void persistNow({ui: {close_to_tray: closeToTray}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>
        </Card>}

        </div>}
        {(mode === 'advanced' || searching) && <>
        {/* ── Recording ─────────────────────────────────────────── */}
        {(section === 'recording' || searching) ? <Card id="recording" title={t('settings.secRecording')}>
          <div className="recording-group"><h3>Replay history</h3><p className="recording-group-help">Set how far back you can save, and where that history is kept.</p><div className="recording-fields">
          <Row label={t('settings.bufferDuration')} note={caps.bufferNote ?? buffer} help="Hold Shift while dragging for one-second adjustments. You can also click the duration to type an exact value.">
            <Slider
              label={t('settings.bufferDuration')}
              id="settings-buffer-duration"
              fineStep={1}
              exact
              value={draft.bufferDuration}
              min={30}
              max={1800}
              step={30}
              onChange={bufferDuration => update({bufferDuration})}
              format={formatLengthLong}
            />
          </Row>

          <Row
            label={t('settings.replayStorage')}
            note={caps.liveNote ?? caps.storageNote ?? (!caps.gsr ? {text: 'This recorder keeps its replay buffer on disk.'} : undefined)} help={t('settings.replayStorageHelp')}>
            <Select
              label={t('settings.replayStorage')}
              disabled={draft.liveReplay || !caps.gsr}
              value={draft.liveReplay || !caps.gsr ? 'disk' : draft.replayStorage}
              onChange={replayStorage => update({replayStorage})}
              options={[
                ['auto', t('settings.optAutoRecommended')],
                ['ram', t('settings.replayRam')],
                ['disk', t('settings.replayDisk')],
              ]}
            />
          </Row>

          </div></div><div className="recording-group"><h3>Video & encoding</h3><p className="recording-group-help">Choose frame rate, colour depth, encoder and the saved file format.</p><div className="recording-fields">
          <Row label={t('settings.frameRate')} note={caps.fpsNote} help={t('settings.frameRateHelp')}>
            <Select
              label={t('settings.frameRate')}
              disabled={caps.wf}
              value={draft.fps}
              onChange={fps => update({fps})}
              options={['24', '30', '50', '60', '120', '144'].map(v => [v, t('settings.fpsOption', {fps: v})] as [string, string])}
            />
          </Row>

          <Row
            label={t('settings.container')}
            note={caps.liveNote ?? caps.containerNote ?? (!caps.gsr ? {text: 'This recorder saves MP4 clips.'} : undefined)} help={t('settings.containerHelp')}>
            <Select
              label={t('settings.container')}
              disabled={draft.liveReplay || !caps.gsr}
              value={draft.liveReplay || !caps.gsr ? 'mp4' : draft.container}
              onChange={container => update({container})}
              options={[
                ['mp4', t('settings.containerMp4')],
                ['mkv', t('settings.containerMkv')],
              ]}
            />
          </Row>

          <Row label={t('settings.encoder')} note={caps.liveNote ?? (caps.wf ? {text: 'wf-recorder supports Auto, H.264 NVENC, HEVC NVENC, H.264 VAAPI and software H.264. Other saved codecs use software H.264.'} : caps.codecNote)} help={t('settings.encoderHelp')}>
            <Select
              label={t('settings.encoder')}
              disabled={draft.liveReplay}
              value={draft.liveReplay ? 'h264' : caps.wf ? caps.wfEncoder : draft.encoder}
              onChange={encoder => update({encoder})}
              options={[
                ['auto', t('settings.optAutoRecommended')],
                ...(draft.liveReplay ? [['h264', 'H.264 (Live replay)'] as [string, string]] : []),
                ['h264_nvenc', t('settings.encoderH264Nvenc')],
                ['hevc_nvenc', t('settings.encoderHevcNvenc')],
                ['h264_vaapi', t('settings.encoderH264Vaapi')],
                ['hevc_vaapi', t('settings.encoderHevcVaapi')],
                ['av1_nvenc', t('settings.encoderAv1Nvenc')],
                ['av1_vaapi', t('settings.encoderAv1Vaapi')],
                ['h264_vulkan', t('settings.encoderH264Vulkan')],
                ['hevc_vulkan', t('settings.encoderHevcVulkan')],
                ['av1_vulkan', t('settings.encoderAv1Vulkan')],
                ['libx264', t('settings.encoderX264')],
                ['libx265', t('settings.encoderX265')],
              ].filter(([value]) => !caps.wf || WF_ENCODERS.includes(value)) as Array<[string, string]>}
            />
          </Row>

          <Row
            label={t('settings.colourDepth')}
            note={caps.liveNote ?? caps.depthNote}
            help={t('settings.colourDepthHelp')}>
            <Select
              label={t('settings.colourDepth')}
              disabled={caps.depthLocked}
              value={caps.depthLocked ? '8' : draft.colorDepth}
              onChange={colorDepth => update({colorDepth})}
              options={[
                ['8', t('settings.colour8')],
                ['10', t('settings.colour10')],
              ]}
            />
          </Row>

          </div></div><div className="recording-group"><h3>Capture method</h3><p className="recording-group-help">Choose the recorder and how it follows your screen or window.</p><div className="recording-fields">
          <Row label={t('settings.backend')} note={caps.liveNote} help={t('settings.backendHelp')}>
            <Select
              label={t('settings.backend')}
              disabled={draft.liveReplay}
              value={draft.liveReplay ? 'gsr' : draft.backend}
              onChange={backend => update({backend})}
              options={[
                ['auto', t('settings.optAutoRecommended')],
                ['gsr', 'gpu-screen-recorder'],
                ['wf-recorder', t('settings.backendWf')],
                ['ffmpeg', t('settings.backendFfmpeg')],
              ]}
            />
          </Row>

          {/* Only offered once the Flatpak build is installed, or already chosen. */}
          {status.gsr?.flatpak || draft.gsrSource !== 'auto' ? (
            <Row label={t('settings.gsrSource')} help={t('settings.gsrSourceHelp')}>
              <Select
                label={t('settings.gsrSource')}
                value={draft.gsrSource}
                onChange={gsrSource => update({gsrSource})}
                options={[
                  ['auto', t('settings.gsrSourceAuto')],
                  ['native', t('settings.gsrSourceNative')],
                  ['flatpak', t('settings.gsrSourceFlatpak')],
                ]}
              />
            </Row>
          ) : null}

          <Row
            label={t('settings.followMouse')}
            note={
              followSupported
                ? null
                : {
                    text: t('settings.followMouseUnsupported'),
                    tone: 'warning' as const,
                  }
            }
            help={t('settings.followMouseHelp')}>
            <Toggle
              label={t('settings.followMouse')}
              checked={followSupported && draft.followMouse}
              disabled={!followSupported || caps.windowCaptureActive}
              onChange={followMouse => update({followMouse})}
            />
          </Row>

          <Row
            label={t('settings.windowCapture')}
            note={
              windowCaptureSupported
                ? null
                : {text: t('settings.windowCaptureUnsupported'), tone: 'warning' as const}
            }
            help={t('settings.windowCaptureHelp')}>
            <Toggle
              label={t('settings.windowCapture')}
              checked={draft.windowCapture}
              disabled={caps.windowToggleDisabled}
              onChange={windowCapture => update({windowCapture, followMouse: windowCapture ? false : draft.followMouse})}
            />
          </Row>

</div></div><div className="recording-group recording-playback"><h3>Playback</h3><p className="recording-group-help">Controls video playback in the app, independently of recording quality.</p>          <Row
            label={t('settings.hardwareDecode')}
            help={t('settings.hardwareDecodeHelp')}>
            <Toggle
              label={t('settings.hardwareDecode')}
              checked={draft.hardwareDecode}
              onChange={hardwareDecode => update({hardwareDecode})}
            />
          </Row>

</div>
        </Card> : null}

        {/* ── Audio ─────────────────────────────────────────────── */}
        {(section === 'audio' || searching) ? <Card id="audio" title={t('settings.secAudio')}>

          <AudioTracks draft={draft} sources={sources.sources} onChange={update} warning={sources.warning}
            onMicToggle={next => {
              if (next && micNeedsWfChoice) setWfMicPrompt(true);
              else void setMic(next);
            }}
            refreshing={refreshing} onRefresh={() => {
              setRefreshing(true);
              void loadSources().finally(() => setRefreshing(false));
            }} />

          <h3 className="adv-group">Notification sounds</h3>
          <Row
            label={t('settings.notifyVolume')}
            help={t('settings.notifyVolumeHelp')}>
            <Slider
              label={t('settings.notifyVolume')}
              value={draft.notifyVolume}
              min={0}
              max={100}
              step={5}
              onChange={notifyVolume => update({notifyVolume})}
              format={v => (v > 0 ? `${v}%` : t('settings.volumeOff'))}
            />
          </Row>

          <Row
            label={t('settings.customSounds')}
            stack
            help={t('settings.customSoundsHelp')}>
            <SoundGrid
              fields={SOUND_FIELDS}
              values={draft.sounds}
              onChange={(key, value) => update({sounds: {...draft.sounds, [key]: value}})}
            />
          </Row>
          <Row
            label={t('settings.wfMicMode')}
            help={t('settings.wfMicModeHelp')}>
            <Select
              label={t('settings.wfMicMode')}
              value={draft.wfMicStrategy}
              onChange={wfMicStrategy => update({wfMicStrategy})}
              options={[
                ['prompt', t('settings.wfMicPrompt')],
                ['backend_fallback', t('settings.wfMicFallback')],
                ['mic_only', t('settings.wfMicOnly')],
              ]}
            />
          </Row>
        </Card> : null}

        {/* ── Storage ───────────────────────────────────────────── */}
        {(section === 'storage' || searching) ? <Card id="storage" title={t('settings.secStorage')}>
          <h3 className="adv-group">Folders</h3>
          <Row label={t('settings.directory')} help={t('settings.directoryHelp')}>
            <FolderField
              label={t('settings.directory')}
              value={draft.directory}
              placeholder="~/Videos/Gloaming"
              onChange={directory => update({directory})}
            />
          </Row>

          <Row label={t('settings.imageDirectory')} help={t('settings.imageDirectoryHelp')}>
            <FolderField
              label={t('settings.imageDirectory')}
              value={draft.imageDirectory}
              placeholder="~/Pictures/Gloaming"
              onChange={imageDirectory => update({imageDirectory})}
            />
          </Row>
          <h3 className="adv-group">Names and organisation</h3>
          <Row
            label={t('settings.tagWithGame')}
            help={t('settings.tagWithGameHelp')}>
            <Toggle
              label={t('settings.tagWithGame')}
              checked={draft.tagWithGame}
              onChange={tagWithGame => update({tagWithGame})}
            />
          </Row>

          <Row
            label={t('settings.autoPlaylist')}
            help={t('settings.autoPlaylistHelp')}>
            <Toggle
              label={t('settings.autoPlaylist')}
              checked={draft.autoPlaylist}
              onChange={autoPlaylist => update({autoPlaylist})}
            />
          </Row>

          <Row
            label={t('settings.clipFilename')}
            note={clipNameNote(draft)}
            help={
              <>
                {tNode('settings.clipFilenameHelp', {
                  n: <code>$n</code>,
                  date: <code>$date</code>,
                  time: <code>$time</code>,
                  game: <code>$game</code>,
                })}
              </>
            }>
            <TextField
              label={t('settings.clipFilename')}
              wide
              mono
              value={draft.clipNameTemplate}
              placeholder="clip_$date_$time"
              onChange={clipNameTemplate => update({clipNameTemplate})}
            />
          </Row>
        </Card> : null}

        {/* ── Sharing ───────────────────────────────────────────── */}
        {(section === 'sharing' || searching) ? <Card id="sharing" title={t('settings.secSharing')}>
          <h3 className="adv-group">Local server</h3>
          <Row label={t('settings.port')} help={t('settings.portHelp')}>
            <TextField
              label={t('settings.port')}
              mono
              type="number"
              min={1024}
              max={65535}
              value={draft.port}
              onChange={port => update({port: Number(port) || 0})}
            />
          </Row>
          <h3 className="adv-group">Links</h3>
          <Row
            label={t('settings.publicLink')}
            help={t('settings.publicLinkHelp')}>
            <Toggle
              label={t('settings.publicLink')}
              checked={draft.cloudflareTunnel}
              onChange={cloudflareTunnel => update({cloudflareTunnel})}
            />
          </Row>

          <Row
            label={t('settings.shareDiscordFile')}
            help={t('settings.shareDiscordFileHelp')}>
            <Toggle
              label={t('settings.shareDiscordFile')}
              checked={draft.shareDiscordFile}
              onChange={shareDiscordFile => update({shareDiscordFile})}
            />
          </Row>
        </Card> : null}

        {/* ── Discord ───────────────────────────────────────────── */}
        {(section === 'discord' || searching) ? <Card id="discord" title={t('settings.cardDiscord')}>
          <h3 className="adv-group">Presence</h3>
          <Row
            label={t('settings.discordEnabled')}
            help={t('settings.discordEnabledHelp')}>
            <Toggle
              label={t('settings.discordEnabled')}
              checked={draft.discordEnabled}
              onChange={discordEnabled => update({discordEnabled})}
            />
          </Row>

          <Row
            label={t('settings.discordGameIcons')}
            help={t('settings.discordGameIconsHelp')}>
            <Toggle
              label={t('settings.discordGameIcons')}
              checked={draft.discordGameIcons}
              onChange={discordGameIcons => update({discordGameIcons})}
            />
          </Row>
          <h3 className="adv-group">Games and branding</h3>
          <Row
            label={t('settings.discordCustomGames')}
            stack
            help={
              <>
                {tNode('settings.discordCustomGamesHelp', {
                  format: <code>Display Name | match1, match2</code>,
                })}
              </>
            }>
            <TextArea
              label={t('settings.discordCustomGames')}
              rows={4}
              value={draft.discordCustomGames}
              placeholder={t('settings.discordCustomGamesPlaceholder')}
              onChange={discordCustomGames => update({discordCustomGames})}
            />
          </Row>

          <Row
            label={t('settings.discordClientId')}
            help={t('settings.discordClientIdHelp')}>
            <TextField
              label={t('settings.discordClientId')}
              wide
              mono
              value={draft.discordClientId}
              placeholder={t('settings.discordClientIdPlaceholder')}
              onChange={discordClientId => update({discordClientId})}
            />
          </Row>
        </Card> : null}

        {/* ── Overlay ───────────────────────────────────────────── */}
        {(section === 'overlay' || searching) ? <Card id="overlay" title={t('settings.secOverlay')}>
          <h3 className="adv-group">Keyboard overlay</h3>
          <Row
            label={t('settings.keyOverlay')}
            help={t('settings.keyOverlayHelp')}
            note={keyOverlayNote(status.key_overlay ?? null, draft.keyOverlay && !draft.keyRecordingOnly)}>
            <Toggle
              label={t('settings.keyOverlay')}
              checked={draft.keyOverlay}
              onChange={keyOverlay => {
                update({keyOverlay});
                void persistNow({overlay: {keys: keyOverlay}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>

          <Row label={t('settings.keyOverlayPosition')} help={t('settings.keyOverlayPositionHelp')}>
            <div className="key-pair">
              <Select
                label={t('settings.keyOverlayPosition')}
                value={draft.keyOverlayPosition}
                onChange={keyOverlayPosition => {
                  update({keyOverlayPosition});
                  void persistNow(
                    {overlay: {keys_position: keyOverlayPosition}},
                    () => undefined,
                    t('settings.errSaveOverlay'),
                  );
                }}
                options={[
                  ['bottom-left', t('settings.overlayBottomLeft')],
                  ['bottom-center', t('settings.overlayBottomCenter')],
                  ['bottom-right', t('settings.overlayBottomRight')],
                  ['top-left', t('settings.overlayTopLeft')],
                  ['top-right', t('settings.overlayTopRight')],
                  ['custom', t('settings.overlayCustom')],
                ]}
              />
              <button
                type="button"
                className={status.key_overlay?.moving ? 'btn btn-sm' : 'btn btn-quiet btn-sm'}
                disabled={!status.key_overlay?.running}
                onClick={() => {
                  const moving = Boolean(status.key_overlay?.moving);
                  void api
                    .moveKeyOverlay(!moving)
                    .then(async () => {
                      if (!moving) return;
                      // The daemon saved where it was dropped. Take that into
                      // the draft so subsequent edits use its current position.
                      const fresh = await api.getConfig();
                      const position = String(fresh.overlay?.keys_position ?? draft.keyOverlayPosition);
                      update({keyOverlayPosition: position});
                    })
                    .catch(err => fail(t('settings.errSaveOverlay'), err));
                }}>
                {status.key_overlay?.moving ? t('settings.overlayDoneMoving') : t('settings.overlayMove')}
              </button>
            </div>
          </Row>

          <Row label={t('settings.keyOverlaySize')}>
            <Slider
              label={t('settings.keyOverlaySize')}
              value={draft.keyOverlayScale}
              min={50}
              max={200}
              step={10}
              onChange={keyOverlayScale => update({keyOverlayScale})}
              format={v => `${v}%`}
            />
          </Row>

          <Row label={t('settings.keyOverlayKey')} help={t('settings.keyOverlayKeyHelp')}>
            <div className="key-pair">
              <KeyCapture
                value={draft.keyOverlayKey}
                onUnsupported={() =>
                  notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})
                }
                onCapture={keyOverlayKey => {
                  update({keyOverlayKey});
                  void persistNow(
                    {hotkeys: {key_overlay: keyOverlayKey}},
                    () => say(t('settings.keyOverlayKeyNow', {key: keyOverlayKey})),
                    t('settings.errSaveKey'),
                  );
                }}
              />
              {draft.keyOverlayKey ? (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    update({keyOverlayKey: ''});
                    void persistNow({hotkeys: {key_overlay: ''}}, () => undefined, t('settings.errSaveKey'));
                  }}>
                  {t('settings.clearKey')}
                </button>
              ) : null}
            </div>
          </Row>

          <Row label={t('settings.recordingOnly')} help={t('settings.recordingOnlyHelp')} note={draft.keyRecordingOnly ? recordingOverlayNote(status.recording_overlays?.keys) : undefined}>
            <Toggle label={t('settings.recordingOnly')} checked={draft.keyRecordingOnly}
              onChange={keyRecordingOnly => update({keyRecordingOnly})} />
          </Row>
          <Row label={t('settings.keyOverlayInClips')} help={t('settings.keyOverlayInClipsHelp')}>
            <Toggle
              label={t('settings.keyOverlayInClips')}
              checked={draft.keyOverlayInClips}
              onChange={keyOverlayInClips => update({keyOverlayInClips})}
            />
          </Row>
          <h3 className="adv-group">Controller overlay</h3>
          <Row label="Controller overlay" note={keyOverlayNote(status.pad_overlay ?? null, draft.padOverlay && !draft.padRecordingOnly)} help="Shows a gamepad over your game that lights up the buttons you press and follows the sticks and triggers, so recordings and streams show your inputs. It draws an Xbox or a PlayStation pad to match the controller you use.">
            <Toggle
              label="Controller overlay"
              checked={draft.padOverlay}
              onChange={padOverlay => {
                update({padOverlay});
                void persistNow({overlay: {pad: padOverlay}}, () => undefined, t('settings.errSaveOverlay'));
              }}
            />
          </Row>
          <Row label="Controller overlay style" help="Auto follows the controller you are pressing. Pick one to always show that drawing.">
            <Select
              label="Controller overlay style"
              value={draft.padStyle}
              onChange={padStyle => {
                update({padStyle});
                void persistNow({overlay: {pad_style: padStyle}}, () => undefined, t('settings.errSaveOverlay'));
              }}
              options={[['auto', 'Auto'], ['xbox', 'Xbox'], ['playstation', 'PlayStation']]}
            />
          </Row>
          <Row label="Controller overlay position" help="Pick a corner, or press Move and drag the pad anywhere on its screen. Press Done when it is where you want it.">
            <div className="key-pair">
              <Select
                label="Controller overlay position"
                value={draft.padPosition}
                onChange={padPosition => {
                  update({padPosition});
                  void persistNow({overlay: {pad_position: padPosition}}, () => undefined, t('settings.errSaveOverlay'));
                }}
                options={[
                  ['bottom-left', t('settings.overlayBottomLeft')],
                  ['bottom-center', t('settings.overlayBottomCenter')],
                  ['bottom-right', t('settings.overlayBottomRight')],
                  ['top-left', t('settings.overlayTopLeft')],
                  ['top-right', t('settings.overlayTopRight')],
                  ['custom', t('settings.overlayCustom')],
                ]}
              />
              <button
                type="button"
                className={status.pad_overlay?.moving ? 'btn btn-sm' : 'btn btn-quiet btn-sm'}
                disabled={!status.pad_overlay?.running}
                onClick={() => {
                  const moving = Boolean(status.pad_overlay?.moving);
                  void api
                    .movePadOverlay(!moving)
                    .then(async () => {
                      if (!moving) return;
                      // The daemon saved where it was dropped; take that into the draft.
                      const fresh = await api.getConfig();
                      const position = String(fresh.overlay?.pad_position ?? draft.padPosition);
                      update({padPosition: position});
                    })
                    .catch(err => fail(t('settings.errSaveOverlay'), err));
                }}>
                {status.pad_overlay?.moving ? t('settings.overlayDoneMoving') : t('settings.overlayMove')}
              </button>
            </div>
          </Row>
          <Row label="Controller overlay size">
            <Slider
              label="Controller overlay size"
              value={draft.padScale}
              min={50}
              max={200}
              step={10}
              onChange={padScale => update({padScale})}
              format={v => `${v}%`}
            />
          </Row>
          <Row label={t('settings.padOverlayKey')} help={t('settings.padOverlayKeyHelp')}>
            <div className="key-pair">
              <KeyCapture
                value={draft.padOverlayKey}
                onUnsupported={() =>
                  notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})
                }
                onCapture={padOverlayKey => {
                  update({padOverlayKey});
                  void persistNow(
                    {hotkeys: {pad_overlay: padOverlayKey}},
                    () => say(t('settings.padOverlayKeyNow', {key: padOverlayKey})),
                    t('settings.errSaveKey'),
                  );
                }}
              />
              {draft.padOverlayKey ? (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => {
                    update({padOverlayKey: ''});
                    void persistNow({hotkeys: {pad_overlay: ''}}, () => undefined, t('settings.errSaveKey'));
                  }}>
                  {t('settings.clearKey')}
                </button>
              ) : null}
            </div>
          </Row>

          <Row label={t('settings.recordingOnly')} help={t('settings.recordingOnlyHelp')} note={draft.padRecordingOnly ? recordingOverlayNote(status.recording_overlays?.pad) : undefined}>
            <Toggle label={t('settings.recordingOnly')} checked={draft.padRecordingOnly}
              onChange={padRecordingOnly => update({padRecordingOnly})} />
          </Row>
          <Row label={t('settings.padOverlayInClips')} help={t('settings.padOverlayInClipsHelp')}>
            <Toggle
              label={t('settings.padOverlayInClips')}
              checked={draft.padOverlayInClips}
              onChange={padOverlayInClips => update({padOverlayInClips})}
            />
          </Row>
        </Card> : null}

        {/* ── Advanced ──────────────────────────────────────────── */}
        {(section === 'advanced' || searching) ? <Card id="advanced" title={t('settings.secSystem')}>
          <h3 className="adv-group">Recorder</h3>
          <Row
            label={t('settings.gsrArgs')}
            note={caps.liveNote ?? caps.overrideNote ?? (!caps.gsr ? {text: 'Extra GSR arguments require GPU Screen Recorder.'} : undefined)}
            stack
            help={
              <>
                {tNode('settings.gsrArgsHelp', {
                  example: <code>-k hevc -bm cbr -q 20000 -fm cfr</code>,
                })}
              </>
            }>
            <TextField
              label={t('settings.gsrArgs')}
              wide
              mono
              disabled={draft.liveReplay || !caps.gsr}
              value={draft.liveReplay ? '' : draft.gsrArgs}
              placeholder="-k hevc -bm cbr -q 20000 -fm cfr"
              onChange={gsrArgs => update({gsrArgs})}
            />
          </Row>
          <h3 className="adv-group">Updates</h3>
          <Row
            label={t('settings.checkForUpdates')}
            help={t('settings.checkForUpdatesHelp')}>
            <Toggle
              label={t('settings.checkForUpdates')}
              checked={draft.checkForUpdates}
              onChange={checkForUpdates => update({checkForUpdates})}
            />
          </Row>

          <Row label={t('settings.checkNow')} help={t('settings.checkNowHelp')}>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={checkingUpdate}
              onClick={() => {
                setCheckingUpdate(true);
                void api
                  .checkUpdate()
                  .then(result => {
                    const info = result as {update?: {version?: string} | null};
                    say(
                      info?.update?.version
                        ? t('settings.updateAvailable', {version: info.update.version})
                        : t('settings.upToDate'),
                    );
                  })
                  .catch(err => fail(t('settings.errCheckUpdate'), err))
                  .finally(() => setCheckingUpdate(false));
              }}>
              {checkingUpdate ? t('settings.checking') : t('settings.checkNow')}
            </button>
          </Row>
        </Card> : null}
              </>}
        </div>
      </div>

      <Modal
        open={wfMicPrompt}
        title={t('settings.wfMicTitle')}
        onClose={() => setWfMicPrompt(false)}>
        <p>{t('settings.wfMicBody')}</p>
        <div className="choice-list">
          <button
            type="button"
            className="choice"
            onClick={() => {
              setWfMicPrompt(false);
              void setMic(true, 'backend_fallback');
            }}>
            <b>{t('settings.wfMicChoiceBoth')}</b>
            <span>{t('settings.wfMicChoiceBothBody')}</span>
          </button>
          <button
            type="button"
            className="choice"
            onClick={() => {
              setWfMicPrompt(false);
              void setMic(true, 'mic_only');
            }}>
            <b>{t('settings.wfMicChoiceMic')}</b>
            <span>{t('settings.wfMicChoiceMicBody')}</span>
          </button>
        </div>
      </Modal>

      <Modal
        open={restartNeeded}
        title={t('settings.restartTitle')}
        onClose={() => setRestartNeeded(false)}
        footer={
          <button type="button" className="btn" onClick={() => setRestartNeeded(false)}>
            {t('common.gotIt')}
          </button>
        }>
        <p>{t('home.restartBody')}</p>
      </Modal>

      <AccentPicker
        open={picking}
        initial={seed}
        onCancel={() => setPicking(false)}
        onConfirm={next => {
          chooseCustom(next);
          setPicking(false);
        }}
      />
    </div>
  );
}

/** A sidebar group header that opens and closes its list, like a folder. */
function NavGroupToggle({id, label, count, open, onToggle}: {
  id: string;
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <h2 id={id}>
      <button type="button" className="settings-nav-toggle" aria-expanded={open}
        aria-controls={id.replace('-label', '-items')} onClick={onToggle}>
        <span className="settings-nav-toggle-icon" aria-hidden="true">{open ? <IconFolderOpen size={16}/> : <IconFolder size={16}/>}</span>
        <span className="settings-nav-toggle-label">{label}</span>
        <span className="settings-nav-count">{count}</span>
        <span className="settings-nav-chevron" aria-hidden="true">›</span>
      </button>
    </h2>
  );
}

function CategoryIcon({section}: {section: IconId}) {
  const paths: Record<IconId, string> = {
    controller: 'M6 7h12l3 10a2 2 0 0 1-3 2l-4-3h-4l-4 3a2 2 0 0 1-3-2zM6 11h4m-2-2v4m7-3h1m2 3h1',
    recording: 'M4 5h16v12H4zM8 21h8M12 17v4',
    audio: 'M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4',
    hotkeys: 'M3 6h18v12H3zM6 9h1m3 0h1m3 0h1m3 0h1M7 15h10',
    storage: 'M4 4h16v16H4zM4 14h16M16 17h1',
    sharing: 'M8 8l8-4M8 16l8 4M5 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M16 2h4v4h-4zM16 18h4v4h-4z',
    discord: 'M3 4h18v13H9l-6 4zM7 10h2m6 0h2',
    overlay: 'M3 3h13v13H3zM8 8h13v13H8z',
    appearance: 'M12 3a9 9 0 1 0 9 9h-9zM12 3v9h9',
    advanced: 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[section]}/></svg>;
}

function Card({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="settings-card" id={`settings-${id}`} aria-label={title}>
      <h2><span className="settings-section-icon" aria-hidden="true"><CategoryIcon section={id === 'capture' || id === 'quality' ? 'recording' : id === 'sound' ? 'audio' : id === 'shortcuts' ? 'hotkeys' : id === 'general' ? 'advanced' : id as IconId}/></span>{title}</h2>
      {children}
    </section>
  );
}

function ClipPresets({
  presets,
  maxDuration,
  onChange,
  onUnsupported,
}: {
  presets: ClipPreset[];
  maxDuration: number;
  onChange: (next: ClipPreset[]) => void;
  onUnsupported: () => void;
}) {
  const patch = (uid: string, values: Partial<ClipPreset>) =>
    onChange(presets.map(p => (p.uid === uid ? {...p, ...values} : p)));

  return (
    <div className="presets">
      {presets.map(preset => (
        <div className="preset-row" key={preset.uid}>
          <div className="preset-key">
            <KeyCapture
              compact
              value={preset.key}
              label={t('settings.presetKey')}
              onUnsupported={onUnsupported}
              onCapture={key => patch(preset.uid, {key})}
            />
            {preset.key ? (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => patch(preset.uid, {key: ''})}>
                {t('settings.clearKey')}
              </button>
            ) : null}
          </div>
          <PresetDuration value={preset.duration} max={maxDuration}
            onCommit={duration => patch(preset.uid, {duration})}/>
          <button
            type="button"
            className="preset-remove"
            title={t('settings.presetRemove')}
            aria-label={t('settings.presetRemove')}
            onClick={() => onChange(presets.filter(p => p.uid !== preset.uid))}>
            <IconTrash size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        onClick={() => onChange([...presets, {...newClipPreset(), duration: Math.min(60, maxDuration)}])}>
        <IconPlus size={13} /> {t('settings.presetAdd')}
      </button>
    </div>
  );
}

const QUICK_DURATIONS = [30, 60, 120, 300, 600];

/** "90", "1:30", "2m", "1m30s" or "1.5m" → seconds; null when it is not a time. */
function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const clock = value.match(/^(\d+):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  let matched = '';
  for (const [part, amount, unit] of value.matchAll(/(\d+(?:\.\d+)?)\s*(h|m|min|s|sec)?/g)) {
    const n = Number(amount);
    total += unit === 'h' ? n * 3600 : unit === 'm' || unit === 'min' ? n * 60 : n;
    matched += part;
  }
  return matched.replace(/\s/g, '') === value.replace(/\s/g, '') ? Math.round(total) : null;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function PresetDuration({value, max, onCommit}: {value: number; max: number; onCommit: (value: number) => void}) {
  const [text, setText] = useState(formatDuration(value));
  useEffect(() => setText(formatDuration(value)), [value]);
  const commit = () => {
    const parsed = parseDuration(text);
    const next = parsed === null ? value : boundedDuration(parsed, max, value);
    setText(formatDuration(next));
    if (next !== value) onCommit(next);
  };
  return (
    <div className="preset-duration-group">
      <div className="preset-quick" role="group" aria-label={t('settings.presetDuration')}>
        {QUICK_DURATIONS.filter(seconds => seconds <= max).map(seconds => (
          <button key={seconds} type="button" data-active={seconds === value || undefined}
            aria-pressed={seconds === value} onClick={() => onCommit(seconds)}>
            {formatDuration(seconds)}
          </button>
        ))}
      </div>
      <input className="text-input preset-duration mono" type="text" inputMode="text" value={text}
        placeholder="1:30" title={t('settings.presetDurationHint')} aria-label={t('settings.presetDuration')}
        onChange={e => setText(e.target.value)} onBlur={commit}
        onFocus={e => e.currentTarget.select()}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}/>
    </div>
  );
}

/**
 * A saved value the backend is not listing right now is still a saved value.
 * Dropping it to Auto here wrote display=null on the next save and destroyed a
 * monitor set by hand, which is the only way to reach one gpu-screen-recorder
 * will not enumerate (#160). The audio pickers below do the same.
 */

function displayOptions(draft: Draft, info: DisplayInfo): Array<[string, string]> {
  const listed = usableDisplays(info);
  const options: Array<[string, string]> = [
    ['', t('settings.displayAuto')],
    ...listed.map(d => [d.id, d.label || d.id] as [string, string]),
  ];
  if (draft.display && !listed.some(d => d.id === draft.display)) {
    options.push([draft.display, t('settings.savedOption', {id: draft.display})]);
  }
  return options;
}

function displayNote(draft: Draft, info: DisplayInfo): RowNote {
  const listed = usableDisplays(info);
  if (draft.display && !listed.some(d => d.id === draft.display)) {
    return {
      text: t('settings.displayMissing', {id: draft.display}),
      tone: 'warning',
    };
  }
  if (info.warning) return {text: t('settings.displayWarning', {warning: info.warning}), tone: 'warning'};
  if (!listed.length) {
    return {text: t('settings.displayNone'), tone: 'warning'};
  }
  return {text: t('settings.displayHelp')};
}

/**
 * Defence in depth: drop anything whose id or label reads like a recorder
 * diagnostic. The backend filters these already, but a new error format
 * slipping through should show "no displays" rather than an option that
 * breaks recording when picked.
 */
function usableDisplays(info: DisplayInfo) {
  const looksLikeError = (value: string | undefined) => {
    const v = String(value || '').toLowerCase();
    return (
      v.startsWith('gsr error') ||
      v.startsWith('error:') ||
      v.includes('for_each_active_monitor') ||
      v.includes('failed to open')
    );
  };
  return (info.displays ?? []).filter(d => !(looksLikeError(d.id) || looksLikeError(d.label)));
}

function clipNameNote(draft: Draft): RowNote | null {
  const template = draft.clipNameTemplate.trim();
  if (!template) return null;
  const name = renderClipName(template, 4, 'Overwatch-2', new Date());
  return name
    ? {text: t('settings.clipFilenameNext', {name}), tone: 'accent'}
    : {text: t('settings.clipFilenameEmpty'), tone: 'warning'};
}

/** Why the overlay is not on screen, when it should be. */
function keyOverlayNote(state: KeyOverlayState | null, wanted: boolean): RowNote | undefined {
  if (!wanted || !state?.error) return undefined;
  const text = {
    'no-layer-shell': t('settings.overlayNoLayerShell'),
    'no-gtk': t('settings.overlayNoGtk'),
    'no-display': t('settings.overlayNoDisplay'),
    crashed: t('settings.overlayCrashed'),
  }[state.error];
  return {text, tone: 'warning'};
}

function recordingOverlayNote(mode: 'live' | 'after-save' | 'off' | undefined): RowNote | undefined {
  if (mode === 'live') return {text: t('settings.recordingOverlayLive'), tone: 'accent'};
  if (mode === 'after-save') return {text: t('settings.recordingOverlayFallback'), tone: 'warning'};
  return undefined;
}
