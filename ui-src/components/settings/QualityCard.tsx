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
  {id: 'light', name: 'Light', blurb: '30 fps · 1080p · compact clips', fps: '30', resolution: '1920x1080', colorDepth: '8', quality: 'medium'},
  {id: 'balanced', name: 'Balanced', blurb: '60 fps · 1080p · sharp', fps: '60', resolution: '1920x1080', colorDepth: '8', quality: 'high'},
  {id: 'high', name: 'High', blurb: '60 fps · full size · very sharp', fps: '60', resolution: '', colorDepth: '8', quality: 'very_high'},
  {id: 'ultra', name: 'Ultra', blurb: '144 fps · full size · 10-bit · best', fps: '144', resolution: '', colorDepth: '10', quality: 'ultra'},
];

const REACH = [60, 120, 300, 600, 1200, 1800];

/** The recorder's own quality names, plainly. Higher keeps fine detail in fast motion and makes bigger clips. */
const QUALITIES: Array<[string, string]> = [['medium', 'Medium'], ['high', 'High'], ['very_high', 'Very high'], ['ultra', 'Ultra'], ['custom', 'Fixed bitrate']];
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
  if (load < 12) return {level: 'low', label: 'Low'};
  if (load < 24) return {level: 'medium', label: 'Medium'};
  if (load < 38) return {level: 'high', label: 'High'};
  return {level: 'extreme', label: 'Very high'};
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
    <section className="settings-card quality-card" id="settings-quality" aria-label="Recording quality">
      <h2>Recording quality</h2>
      <div className="recording-group quality-profile-group"><div className="quality-heading"><h3>Capture profile</h3><p>Choose a preset, or select Custom to tune the details.</p></div>
      {caps.qualityNote && <p className="quality-note">{caps.qualityNote.text}{!caps.gsr ? ' Use Custom for supported settings.' : ''}</p>}
      <div className="quality-presets" role="radiogroup" aria-label="Quality">
        {PRESETS.map((p, index) => (
          <button key={p.id} type="button" role="radio" aria-checked={current === p.id} data-active={current === p.id || undefined}
            disabled={!caps.gsr} onClick={() => choose(p)}>
            <span className="quality-level" aria-hidden="true">{[1, 2, 3, 4].map(level => <i key={level} data-filled={level <= index + 1 || undefined}/>)}</span>
            <strong>{p.name}</strong>
            <small>{draft.liveReplay ? p.blurb.replace('10-bit', '8-bit') : p.blurb}</small>
            {p.id === 'balanced' ? <em>Recommended</em> : null}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={current === 'custom'} data-active={current === 'custom' || undefined}
          onClick={() => setCustomOpen(true)}>
          <span className="quality-level quality-level-custom" aria-hidden="true">↗</span>
          <strong>Custom</strong>
          <small>{current === 'custom' && !caps.wf ? `${draft.fps} fps` : 'Your own mix'}</small>
        </button>
      </div>

      {caps.manualOverrides && <p className="quality-note">Saved defaults below; extra GSR arguments may change the actual recording.</p>}
      <div className="quality-summary" aria-label={caps.manualOverrides ? 'Saved recording defaults; extra GSR arguments take priority' : 'Recording settings'}>
        <span>{caps.wf ? 'Frame rate: controlled by wf-recorder' : <><b>{draft.fps}</b> fps</>}</span>
        <span><b>{caps.wf ? 'Size: controlled by wf-recorder' : draft.resolution ? (draft.resolution === 'custom' ? draft.customResolution || 'Custom size' : draft.resolution) : 'Full size'}</b></span>
        <span><b>{effectiveDraft.colorDepth}-bit</b> color</span>
        {caps.gsr && !caps.manualOverrides && <span className="quality-summary-cost">Estimated buffer <b>{approx}</b> {inRam ? 'in memory' : 'on disk'} · {cost.label.toLowerCase()} load</span>}
      </div>

      </div>

      {showCustomQuality(customOpen || matched === 'custom', searching) ? (
        <div className="quality-fine recording-group" aria-label="Custom recording settings">
          <h3>Custom settings</h3>
      <Row label="Picture quality" note={caps.qualityNote} help="How much detail is kept, especially in fast motion. Higher looks sharper and makes bigger clips and a bigger buffer.">
        <div className="quality-reach quality-grade" role="radiogroup" aria-label="Picture quality">
          {QUALITIES.map(([value, name]) => (
            <button key={value} type="button" role="radio" aria-checked={draft.videoQuality === value}
              disabled={!caps.gsr} data-active={draft.videoQuality === value || undefined}
              onClick={() => { update({videoQuality: value}); void persistNow({recording: {video_quality: value}}, () => undefined, failure); }}>
              {name}
            </button>
          ))}
        </div>
      </Row>
      {draft.videoQuality === 'custom' ? (
        <Row label="Fixed bitrate" help="The recording always uses this much data per second, whatever is on screen.">
          <Select disabled={!caps.gsr} label="Fixed bitrate" value={String(Math.round(draft.videoBitrate / 1000))}
            onChange={mbps => { const kbps = Number(mbps) * 1000; update({videoBitrate: kbps}); void persistNow({recording: {video_bitrate_kbps: kbps}}, () => undefined, failure); }}
            options={BITRATES.map(v => [String(v), `${v} Mbit/s`] as [string, string])} />
        </Row>
      ) : null}


          <Row label={t('settings.frameRate')} note={caps.fpsNote}>
            <Select disabled={caps.wf} label={t('settings.frameRate')} value={draft.fps}
              onChange={fps => { update({fps}); void persistNow({recording: {fps: Number(fps)}}, () => undefined, failure); }}
              options={['24', '30', '50', '60', '120', '144'].map(v => [v, `${v} fps`] as [string, string])} />
          </Row>
          <Row label="Picture size" note={caps.resolutionNote}>
            <div className="settings-resolution">
              <Select disabled={caps.wf} label="Picture size" value={draft.resolution}
                onChange={resolution => {
                  update({resolution});
                  if (resolution !== 'custom') void persistNow({recording: {resolution: resolution || null}}, () => undefined, failure);
                }}
                options={[...RESOLUTION_PRESETS.map(([value, name]) => [value, value ? name : 'Full size (your screen)'] as [string, string]),
                  ['custom', 'Custom size'] as [string, string]]} />
              {draft.resolution === 'custom' ? <>
                <TextField disabled={caps.wf} label="Custom size" mono value={draft.customResolution} placeholder="1600x900"
                  onChange={customResolution => update({customResolution})} />
                {resolvedResolution(draft) === false ? <span className="settings-invalid">Use the form 1600x900.</span> : null}
              </> : null}
            </div>
          </Row>
          <Row label={t('settings.colourDepth')} note={caps.liveNote ?? caps.depthNote} help="10-bit looks smoother in gradients and is heavier. It needs a recent GPU.">
            <Select disabled={caps.depthLocked} label={t('settings.colourDepth')} value={effectiveDraft.colorDepth}
              onChange={colorDepth => { update({colorDepth}); void persistNow({recording: {color_depth: colorDepth}}, () => undefined, failure); }}
              options={[['8', t('settings.colour8')], ['10', t('settings.colour10')]]} />
          </Row>
        </div>
      ) : null}

      <div className="recording-group quality-buffer-group"><h3>Replay history</h3>
      <Row label={t('settings.bufferDuration')} note={caps.bufferNote} help="How much of the past Gloaming keeps, ready to save. Longer history uses more memory or disk space.">
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
            onClick={onCustomBuffer} title="Customize buffer duration in Advanced settings">
            Custom{!REACH.includes(draft.bufferDuration) ? ` · ${formatLengthLong(draft.bufferDuration)}` : ''}
          </button>
        </div>
      </Row>
      {draft.liveReplay ? <p className="quality-note">Live replay uses this buffer too. Changing it restarts recording and clears the current replay history.</p> : null}

      </div>
      <div className="quality-foot recording-link">
        <span>These settings are shared with Advanced recording. Choose an encoder, file format or storage location there.</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onAdvanced}>Advanced settings →</button>
      </div>
    </section>
  );
}
