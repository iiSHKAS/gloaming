import {t} from '../../lib/i18n';
import {recordingCapabilities, qualityPresetPatch, showCustomQuality} from '../../lib/recordingCapabilities';
import {useStore} from '../../state/store';

import {formatLengthLong} from '../../lib/format';
import {resolvedResolution, RESOLUTION_PRESETS, type Draft} from '../../lib/settingsDraft';
import {Row, Select, TextField} from './Fields';

type Persist = (patch: Record<string, Record<string, unknown>>, onOk: () => void, failure: string) => Promise<void>;

interface Preset {
  id: string;
  name: string;
  blurb: string;
  fps: string;
  resolution: string;
  colorDepth: string;
  quality: string;
}

/** What each choice means in plain terms. The numbers behind them are real recorder settings. */
const PRESETS: Preset[] = [
  {id: 'light', name: 'ui.light', blurb: 'ui.presetLightBlurb', fps: '30', resolution: '1920x1080', colorDepth: '8', quality: 'medium'},
  {id: 'balanced', name: 'ui.balanced', blurb: 'ui.presetBalancedBlurb', fps: '60', resolution: '1920x1080', colorDepth: '8', quality: 'high'},
  {id: 'high', name: 'ui.high', blurb: 'ui.presetHighBlurb', fps: '60', resolution: '', colorDepth: '8', quality: 'very_high'},
  {id: 'ultra', name: 'ui.ultra', blurb: 'ui.presetUltraBlurb', fps: '144', resolution: '', colorDepth: '10', quality: 'ultra'},
];

const REACH = [60, 120, 300, 600, 1200, 1800];

/** The recorder's own quality names, plainly. Higher keeps fine detail in fast motion and makes bigger clips. */
const QUALITIES: Array<[string, string]> = [['medium', 'ui.medium'], ['high', 'ui.high'], ['very_high', 'ui.veryHigh'], ['ultra', 'ui.ultra'], ['custom', 'ui.fixedBitrate']];
const BITRATES = [8, 12, 16, 20, 30, 40, 60, 80];

const matches = (draft: Draft, p: Preset) =>
  draft.fps === p.fps && draft.resolution === p.resolution && draft.colorDepth === p.colorDepth
  && draft.videoQuality === p.quality && draft.encoder === 'auto';

/** Video-encoder load, in percent, measured on one GPU (RTX 4060, 1440p, H.264) and interpolated. */
const FPS_LOAD: Array<[number, number]> = [[24, 6.6], [30, 9], [50, 14.5], [60, 17.4], [120, 35.4], [144, 43.3]];

function pixelsOf(resolution: string): number {
  const match = /^(\d+)x(\d+)$/.exec(resolution);
  return match ? Number(match[1]) * Number(match[2]) : 2560 * 1440; // "auto" is the screen, taken as 1440p
}

function loadOf(draft: Draft): number {
  const fps = Number(draft.fps) || 60;
  let base = FPS_LOAD[FPS_LOAD.length - 1][1] * (fps / 144);
  for (let i = 0; i < FPS_LOAD.length - 1; i += 1) {
    const [f0, l0] = FPS_LOAD[i];
    const [f1, l1] = FPS_LOAD[i + 1];
    if (fps >= f0 && fps <= f1) base = l0 + ((l1 - l0) * (fps - f0)) / (f1 - f0);
  }
  if (fps < FPS_LOAD[0][0]) base = (FPS_LOAD[0][1] * fps) / FPS_LOAD[0][0];
  const resolution = draft.resolution === 'custom' ? draft.customResolution : draft.resolution;
  const size = (pixelsOf(resolution) / (2560 * 1440)) ** 0.8;
  const codec = /hevc/.test(draft.encoder) ? 1.24 : /av1/.test(draft.encoder) ? 0.8 : 1;
  return base * size * codec * (draft.colorDepth === '10' ? 1.3 : 1);
}

function impact(draft: Draft): {level: 'low' | 'medium' | 'high' | 'extreme'; label: string} {
  const load = loadOf(draft);
  if (load < 12) return {level: 'low', label: t('ui.low')};
  if (load < 24) return {level: 'medium', label: t('ui.medium')};
  if (load < 38) return {level: 'high', label: t('ui.high')};
  return {level: 'extreme', label: t('ui.veryHigh')};
}

/** Size of each quality step relative to "very high", measured on a busy 1440p60 picture (24.8, 49.2, 80.9, 104 Mbit/s). */
const QUALITY_SIZE: Record<string, number> = {medium: 0.31, high: 0.61, very_high: 1, ultra: 1.29};

/** Rough size of the buffer: about 12 Mbit/s at 1080p60 in "very high", scaling with pixels, frame rate and quality. */
function bufferGb(draft: Draft): number {
  const resolution = draft.resolution === 'custom' ? draft.customResolution : draft.resolution;
  const auto = 12 * (pixelsOf(resolution) / (1920 * 1080)) * ((Number(draft.fps) || 60) / 60) * (QUALITY_SIZE[draft.videoQuality] ?? 1);
  const mbps = draft.videoQuality === 'custom' ? draft.videoBitrate / 1000 : Math.min(120, Math.max(3, auto));
  return (mbps / 8) * draft.bufferDuration / 1024;
}

/**
 * The simple way to set how Gloaming records: one choice of quality, one choice of how far back to keep, and a plain
 * statement of what that costs. Everything detailed is still in Advanced settings.
 */
export function QualityCard({
  draft, update, persistNow, failure, onAdvanced, onCustomBuffer, searching = false, wfTenBit = false,
}: {
  draft: Draft;
  update: (patch: Partial<Draft>) => void;
  persistNow: Persist;
  failure: string;
  onAdvanced: () => void;
  onCustomBuffer: () => void;
  searching?: boolean;
  wfTenBit?: boolean;
}) {
  const {state, dispatch} = useStore();
  const caps = recordingCapabilities(draft, state.status.backend, wfTenBit);
  const customOpen = state.qualityCustomOpen;
  const setCustomOpen = (open: boolean) => dispatch({type: 'setQualityCustomOpen', open});
  const effectiveDraft = {...draft, colorDepth: caps.depthLocked ? '8' : draft.colorDepth, encoder: draft.liveReplay ? 'auto' : draft.encoder};
  const matched = PRESETS.find(p => matches(effectiveDraft, draft.liveReplay ? {...p, colorDepth: '8'} : p))?.id ?? 'custom';
  const current = matched;
  const cost = impact(effectiveDraft);
  const inRam = caps.gsr && !draft.liveReplay && (draft.replayStorage === 'ram' || (draft.replayStorage === 'auto' && draft.bufferDuration <= 600));
  const size = bufferGb(draft);
  const approx = size < 0.95 ? `${Math.max(100, Math.round(size * 10) * 100)} MB` : `${size.toFixed(1)} GB`;

  const choose = (p: Preset) => {
    setCustomOpen(false);
    update(qualityPresetPatch(p, draft.liveReplay));
    void persistNow({recording: {fps: Number(p.fps), resolution: p.resolution || null, video_quality: p.quality, ...(draft.liveReplay ? {} : {color_depth: p.colorDepth, encoder: 'auto'})}},
      () => undefined, failure);
  };
  const reach = (seconds: number) => {
    const clip = Math.min(draft.clipDuration, seconds);
    update({bufferDuration: seconds, clipDuration: clip});
    void persistNow({recording: {buffer_duration: seconds, clip_duration: clip}}, () => undefined, failure);
  };

  return (
    <section className="settings-card quality-card" id="settings-quality" aria-label={t('ui.recordingQuality')}>
      <h2>{t('ui.recordingQuality')}</h2>
      <div className="recording-group quality-profile-group"><div className="quality-heading"><h3>{t('ui.captureProfile')}</h3><p>{t('ui.chooseAPresetOrSelect')}</p></div>
      {caps.qualityNote && <p className="quality-note">{caps.qualityNote.text}{!caps.gsr ? ` ${t('ui.useCustomForSupported')}` : ''}</p>}
      <div className="quality-presets" role="radiogroup" aria-label={t('ui.quality')}>
        {PRESETS.map((p, index) => (
          <button key={p.id} type="button" role="radio" aria-checked={current === p.id} data-active={current === p.id || undefined}
            disabled={!caps.gsr} onClick={() => choose(p)}>
            <span className="quality-level" aria-hidden="true">{[1, 2, 3, 4].map(level => <i key={level} data-filled={level <= index + 1 || undefined}/>)}</span>
            <strong>{t(p.name)}</strong>
            <small>{t(p.blurb, {depth: draft.liveReplay ? 8 : 10})}</small>
            {p.id === 'balanced' ? <em>{t('ui.recommended')}</em> : null}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={current === 'custom'} data-active={current === 'custom' || undefined}
          onClick={() => setCustomOpen(true)}>
          <span className="quality-level quality-level-custom" aria-hidden="true">↗</span>
          <strong>{t('ui.custom')}</strong>
          <small>{current === 'custom' && !caps.wf ? t('ui.fpsLower',{n:draft.fps}) : t('ui.yourOwnMix')}</small>
        </button>
      </div>

      {caps.manualOverrides && <p className="quality-note">{t('ui.qDefaultsNote')}</p>}
      <div className="quality-summary" aria-label={caps.manualOverrides ? t('ui.savedRecordingDefaultsExtraGsr') : t('ui.recordingSettings')}>
        <span>{caps.wf ? t('ui.frameRateControlledByWf') : <b>{t('ui.fpsLower',{n:draft.fps})}</b>}</span>
        <span><b>{caps.wf ? t('ui.sizeControlledByWfRecorder') : draft.resolution ? (draft.resolution === 'custom' ? draft.customResolution || t('ui.customSize') : draft.resolution) : t('ui.fullSize')}</b></span>
        <span><b>{t('ui.depthColor',{n:effectiveDraft.colorDepth})}</b></span>
        {caps.gsr && !caps.manualOverrides && <span className="quality-summary-cost">{t('ui.estimatedBuffer')}<b>{approx}</b> {t('ui.bufferCostTail',{where: inRam ? t('ui.inMemory') : t('ui.onDisk'), load: cost.label.toLowerCase()})}</span>}
      </div>

      </div>

      {showCustomQuality(customOpen || matched === 'custom', searching) ? (
        <div className="quality-fine recording-group" aria-label={t('ui.customRecordingSettings')}>
          <h3>{t('ui.customSettings')}</h3>
      <Row label={t('ui.pictureQuality')} note={caps.qualityNote} help={t('ui.qualityHelp')}>
        <div className="quality-reach quality-grade" role="radiogroup" aria-label={t('ui.pictureQuality')}>
          {QUALITIES.map(([value, name]) => (
            <button key={value} type="button" role="radio" aria-checked={draft.videoQuality === value}
              disabled={!caps.gsr} data-active={draft.videoQuality === value || undefined}
              onClick={() => { update({videoQuality: value}); void persistNow({recording: {video_quality: value}}, () => undefined, failure); }}>
              {t(name)}
            </button>
          ))}
        </div>
      </Row>
      {draft.videoQuality === 'custom' ? (
        <Row label={t('ui.fixedBitrate')} help={t('ui.bitrateHelp')}>
          <Select disabled={!caps.gsr} label={t('ui.fixedBitrate')} value={String(Math.round(draft.videoBitrate / 1000))}
            onChange={mbps => { const kbps = Number(mbps) * 1000; update({videoBitrate: kbps}); void persistNow({recording: {video_bitrate_kbps: kbps}}, () => undefined, failure); }}
            options={BITRATES.map(v => [String(v), t('ui.mbitUnit',{n:v})] as [string, string])} />
        </Row>
      ) : null}


          <Row label={t('settings.frameRate')} note={caps.fpsNote}>
            <Select disabled={caps.wf} label={t('settings.frameRate')} value={draft.fps}
              onChange={fps => { update({fps}); void persistNow({recording: {fps: Number(fps)}}, () => undefined, failure); }}
              options={['24', '30', '50', '60', '120', '144'].map(v => [v, t('ui.fpsLower',{n:v})] as [string, string])} />
          </Row>
          <Row label={t('ui.pictureSize')} note={caps.resolutionNote}>
            <div className="settings-resolution">
              <Select disabled={caps.wf} label={t('ui.pictureSize')} value={draft.resolution}
                onChange={resolution => {
                  update({resolution});
                  if (resolution !== 'custom') void persistNow({recording: {resolution: resolution || null}}, () => undefined, failure);
                }}
                options={[...RESOLUTION_PRESETS.map(([value, name]) => [value, value ? name : t('ui.fullSizeYourScreen')] as [string, string]),
                  ['custom', t('ui.customSize')] as [string, string]]} />
              {draft.resolution === 'custom' ? <>
                <TextField disabled={caps.wf} label={t('ui.customSize')} mono value={draft.customResolution} placeholder="1600x900"
                  onChange={customResolution => update({customResolution})} />
                {resolvedResolution(draft) === false ? <span className="settings-invalid">Use the form 1600x900.</span> : null}
              </> : null}
            </div>
          </Row>
          <Row label={t('settings.colourDepth')} note={caps.liveNote ?? caps.depthNote} help={t('ui.depthHelp')}>
            <Select disabled={caps.depthLocked} label={t('settings.colourDepth')} value={effectiveDraft.colorDepth}
              onChange={colorDepth => { update({colorDepth}); void persistNow({recording: {color_depth: colorDepth}}, () => undefined, failure); }}
              options={[['8', t('settings.colour8')], ['10', t('settings.colour10')]]} />
          </Row>
        </div>
      ) : null}

      <div className="recording-group quality-buffer-group"><h3>{t('ui.replayHistory')}</h3>
      <Row label={t('settings.bufferDuration')} note={caps.bufferNote} help={t('ui.historyHelp')}>
        <div className="quality-reach" role="radiogroup" aria-label={t('settings.bufferDuration')}>
          {REACH.map(seconds => (
            <button key={seconds} type="button" role="radio"
              aria-checked={draft.bufferDuration === seconds} data-active={draft.bufferDuration === seconds || undefined}
              onClick={() => reach(seconds)}>
              {formatLengthLong(seconds)}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={!REACH.includes(draft.bufferDuration)}
            data-active={!REACH.includes(draft.bufferDuration) || undefined}
            onClick={onCustomBuffer} title={t('ui.customizeBufferDurationInAdvanced')}>
            {t('ui.custom')}{!REACH.includes(draft.bufferDuration) ? ` · ${formatLengthLong(draft.bufferDuration)}` : ''}
          </button>
        </div>
      </Row>
      {draft.liveReplay ? <p className="quality-note">{t('ui.liveReplayUsesThisBuffer')}</p> : null}

      </div>
      <div className="quality-foot recording-link">
        <span>{t('ui.theseSettingsAreSharedWith')}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onAdvanced}>{t('ui.advancedSettingsArrow')}</button>
      </div>
    </section>
  );
}
