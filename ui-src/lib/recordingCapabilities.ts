import {t} from './i18n';
import type {Draft} from './settingsDraft';

/** Follow recorder selection, including wf-recorder's microphone fallback. */
export function recordingCapabilities(draft: Pick<Draft, 'backend' | 'liveReplay' | 'captureAudio' | 'captureMic' | 'wfMicStrategy' | 'gsrArgs' | 'encoder' | 'windowCapture'>, runningBackend: string, wfTenBit = false) {
  let backend = draft.backend;
  if (draft.liveReplay || backend === 'auto' || backend === 'gsr') backend = 'gpu-screen-recorder';
  else if (backend === 'wf-recorder' && draft.captureAudio && draft.captureMic && draft.wfMicStrategy === 'backend_fallback') {
    backend = runningBackend === 'ffmpeg' ? 'ffmpeg' : 'gpu-screen-recorder';
  }
  const gsr = backend === 'gpu-screen-recorder';
  const wf = backend === 'wf-recorder';
  const flags = gsr && !draft.liveReplay ? gsrArgumentFlags(draft.gsrArgs) : [];
  const note = (...names: string[]) => {
    const found = names.filter(name => flags.includes(name));
    return found.length ? {text: t('ui.gsrOverrideThis', {args: found.join(', ')})} : undefined;
  };
  const qualityOverride = note('-q', '-bm');
  const resolutionOverride = note('-s');
  const fpsOverride = note('-f');
  const codecNote = note('-k');
  const bufferNote = note('-r');
  const storageNote = note('-replay-storage');
  const containerNote = note('-c');
  const manualOverrides = Boolean(qualityOverride || resolutionOverride || fpsOverride || codecNote || bufferNote || storageNote || containerNote);
  const overrideNote = manualOverrides ? {text: t('ui.gsrOverrideSome')} : undefined;
  const wfEncoder = WF_ENCODERS.includes(draft.encoder) ? draft.encoder : 'libx264';
  const depthLocked = draft.liveReplay || (wf && (wfEncoder !== 'hevc_nvenc' || !wfTenBit));
  const depthNote = wf ? {text: wfEncoder === 'hevc_nvenc' && wfTenBit
    ? t('ui.depth10Supported')
    : t('ui.depth8Only')} : codecNote;
  return {
    windowCaptureActive: gsr && draft.windowCapture,
    windowToggleDisabled: !gsr && !draft.windowCapture,
    wfEncoder, depthLocked, depthNote, codecNote, bufferNote, storageNote, containerNote,
    manualOverrides,
    overrideNote,
    gsr,
    wf,
    qualityNote: gsr ? qualityOverride : {text: t('ui.qualityNeedsGsr')},
    resolutionNote: wf ? {text: t('ui.wfUsesCaptureSize')} : resolutionOverride,
    fpsNote: wf ? {text: t('ui.wfOwnFrameRate')} : fpsOverride,
    liveNote: draft.liveReplay ? {text: t('ui.liveReplayLocks')} : undefined,
  };
}

/** Live replay presets only change fields that the live recorder actually uses. */
export function qualityPresetPatch(preset: {fps: string; resolution: string; colorDepth: string; quality: string}, liveReplay: boolean): Partial<Draft> {
  return {
    fps: preset.fps, resolution: preset.resolution, customResolution: '', videoQuality: preset.quality,
    ...(liveReplay ? {} : {colorDepth: preset.colorDepth, encoder: 'auto'}),
  };
}

/** Search must include custom fields even when their disclosure is closed. */
export const showCustomQuality = (opened: boolean, searching: boolean) => opened || searching;

// These are the only explicit codecs accepted by SegmentRecorder._wf_recorder_cmd.
export const WF_ENCODERS = ['auto', 'h264_nvenc', 'hevc_nvenc', 'h264_vaapi', 'libx264'];

/** Tokenize shell quotes/escapes without executing anything. Mirrors shlex flag
 * matching; malformed quoting is ignored by the recorder too. Runtime variable
 * expansion stays the backend's responsibility. */
export function gsrArgumentFlags(raw: string): string[] {
  const tokens: string[] = [];
  let token = '', quote = '', escaped = false;
  for (const char of raw) {
    if (escaped) {
      if (quote === '"' && char !== '"' && char !== '\\') token += '\\';
      token += char; escaped = false;
    } else if (char === '\\' && quote !== "'") escaped = true;
    else if (quote) {
      if (char === quote) quote = ''; else token += char;
    } else if (char === "'" || char === '"') quote = char;
    else if (/\s/.test(char)) { if (token) tokens.push(token); token = ''; }
    else token += char;
  }
  if (quote || escaped) return [];
  if (token) tokens.push(token);
  return tokens.filter(token => token.startsWith('-')).map(token => token.split('=')[0]);
}
