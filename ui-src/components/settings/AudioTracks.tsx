import {Slider, Select, Toggle} from './Fields';
import type {Draft} from '../../lib/settingsDraft';
import {t} from '../../lib/i18n';

export interface AudioSource { id: string; label?: string; kind?: string }

export function AudioTracks({draft, sources, onChange, onMicToggle, onRefresh, refreshing, basic = false, onAdvanced, warning}: {
  draft: Draft;
  sources: AudioSource[];
  onChange: (patch: Partial<Draft>) => void;
  onMicToggle: (enabled: boolean) => void;
  onRefresh: () => void;
  refreshing: boolean;
  basic?: boolean;
  onAdvanced?: () => void;
  warning?: string | null;
}) {
  const outputs = sources.filter(s => s.kind !== 'input' && s.id !== 'default_input'
    && !(s.id.startsWith('device:') && !s.id.endsWith('.monitor')));
  const inputs = sources.filter(s => s.kind === 'input' || s.id === 'default_input'
    || (!s.kind && s.id.startsWith('device:') && !s.id.endsWith('.monitor')));
  const choices = (list: AudioSource[], selected: string, fallback: string): [string, string][] => {
    const all = [...list];
    if (!all.some(s => s.id === fallback)) all.unshift({id: fallback, label: fallback === 'default_input' ? t('settings.defaultInput') : t('settings.defaultOutput')});
    if (selected && !all.some(s => s.id === selected)) all.push({id: selected, label: t('settings.savedOption', {id: selected})});
    return all.map(s => [s.id, s.label || s.id]);
  };
  const selectedOutput = sources.find(source => source.id === draft.desktopSource);
  const sourceWarning = selectedOutput && !outputs.includes(selectedOutput)
    ? t('settings.desktopSourceIsMic')
    : sources.length && !selectedOutput ? t('settings.desktopSourceMissing') : null;
  const setSlot = (index: number, patch: Partial<Draft['audioOutputSlots'][number]>) => {
    onChange({audioOutputSlots: draft.audioOutputSlots.map((slot, i) => i === index ? {...slot, ...patch} : slot)});
  };
  return <div className="audio-workspace" data-basic={basic || undefined}>
    <div className="audio-device-grid">
    <section className="audio-device-card" data-disabled={!draft.captureAudio}>
      <div className="audio-device-heading"><strong>{t('audioTracks.outputNumber', {number: 1})}</strong>
        <Toggle label={t('audioTracks.outputNumber', {number: 1})} checked={draft.captureAudio} onChange={captureAudio => onChange({captureAudio})} />
      </div>
      <p className="audio-device-description">{t('audioTracks.mainDescription')}</p>
      <div className="audio-device-source"><span>{t('audioTracks.sourceLabel')}</span>
      <Select label={t('audioTracks.outputSource', {number: 1})} value={draft.desktopSource} disabled={!draft.captureAudio}
        options={choices(outputs, draft.desktopSource, 'default_output')}
        onChange={desktopSource => onChange({desktopSource})} /></div>
      {!basic && <fieldset className="audio-device-volume" disabled={!draft.captureAudio}><legend>{t('audioTracks.volumeLabel')}</legend><Slider label={t('settings.desktopVolume')} value={draft.desktopVolume} min={0} max={200} step={5}
        onChange={desktopVolume => onChange({desktopVolume})} format={v => `${v}%`} /></fieldset>}
    </section>
    {!basic && draft.audioOutputSlots.map((slot, index) => {
      const title = t('audioTracks.outputNumber', {number: index + 2});
      const used = new Set([draft.desktopSource, ...draft.audioOutputSlots.filter((s, i) => i !== index && s.enabled).map(s => s.source)]);
      const available = choices(outputs, slot.source, 'default_output').filter(([id]) => !used.has(id));
      const enabled = slot.enabled && !used.has(slot.source);
      return <section className="audio-device-card" key={index} id={index === 0 ? 'settings-extra-outputs' : undefined} tabIndex={-1} data-disabled={!enabled || !draft.captureAudio}>
        <div className="audio-device-heading"><strong>{title}</strong>
          <Toggle label={title} checked={enabled} disabled={!draft.captureAudio || !available.length}
            onChange={enabled => setSlot(index, {enabled, source: available.some(([id]) => id === slot.source) ? slot.source : available[0]?.[0] || ''})} />
        </div>
        <p className="audio-device-description">{t('audioTracks.extraDescription')}</p>
        <div className="audio-device-source"><span>{t('audioTracks.sourceLabel')}</span>
        <Select label={t('audioTracks.outputSource', {number: index + 2})} value={enabled ? slot.source : ''} disabled={!enabled || !draft.captureAudio}
          options={[['', t('audioTracks.disabledOutput')], ...available]}
          onChange={source => setSlot(index, {source, enabled: Boolean(source)})} /></div>
        <fieldset className="audio-device-volume" disabled={!enabled || !draft.captureAudio}><legend>{t('audioTracks.volumeLabel')}</legend><Slider label={title} value={draft.audioTrackVolumes[slot.source] ?? 100} min={0} max={200} step={5}
          onChange={value => onChange({audioTrackVolumes: {...draft.audioTrackVolumes, [slot.source]: value}})} format={v => `${v}%`} /></fieldset>
      </section>;
    })}
    <section className="audio-device-card audio-device-mic" data-disabled={!draft.captureMic}>
      <div className="audio-device-heading"><strong>{t('audioTracks.micTrack')}</strong>
        <Toggle label={t('audioTracks.micTrack')} checked={draft.captureMic} onChange={onMicToggle} />
      </div>
      <p className="audio-device-description">{t('audioTracks.micDescription')}</p>
      <div className="audio-device-source"><span>{t('audioTracks.sourceLabel')}</span>
      <Select label={t('settings.micSource')} value={draft.micSource} disabled={!draft.captureMic}
        options={choices(inputs, draft.micSource, 'default_input')} onChange={micSource => onChange({micSource})} /></div>
      {!basic && <fieldset className="audio-device-volume" disabled={!draft.captureMic}><legend>{t('audioTracks.volumeLabel')}</legend><Slider label={t('settings.micVolume')} value={draft.micVolume} min={0} max={200} step={5}
        onChange={micVolume => onChange({micVolume})} format={v => `${v}%`} /></fieldset>}
      {!basic && <div className="audio-device-heading"><span>{t('settings.micMono')}</span>
        <Toggle label={t('settings.micMono')} disabled={!draft.captureMic} checked={draft.micMono} onChange={micMono => onChange({micMono})} />
      </div>}
    </section>
    </div>
    {basic && <div className="audio-advanced-link">
      <div><strong>{t('audioTracks.moreOutputsTitle')}</strong><p>{t('audioTracks.moreOutputsHelp')}</p></div>
      <button type="button" className="btn btn-quiet" onClick={onAdvanced}>{t('audioTracks.manageOutputs')} <span aria-hidden="true">→</span></button>
    </div>}
    <div className="audio-workspace-footer">
      <p>{warning || sourceWarning || (basic ? t('audioTracks.sharedSettings') : t('audioTracks.playbackMixHelp'))}</p>
      <button type="button" className="btn btn-quiet btn-sm audio-device-refresh" disabled={refreshing} onClick={onRefresh}>{t('audioTracks.refresh')}</button>
    </div>
  </div>;
}
