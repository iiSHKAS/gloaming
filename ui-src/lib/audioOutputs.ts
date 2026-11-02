/** Output 1 is shared by Home, Basic and Advanced. Slots retain disabled choices. */
export interface OutputSlot { source: string; enabled: boolean }
export function outputSlots(recording: Record<string, unknown>): OutputSlot[] {
  const saved = recording.audio_output_slots;
  if (Array.isArray(saved) && saved.length) {
    return [0, 1].map(i => {
      const slot = saved[i] as Partial<OutputSlot> | undefined;
      return {source: typeof slot?.source === 'string' ? slot.source : '', enabled: slot?.enabled === true};
    });
  }
  const primary = String(recording.gsr_audio_source || 'default_output');
  const extras = (Array.isArray(recording.audio_tracks) ? recording.audio_tracks : []).filter(
    (id): id is string => typeof id === 'string' && id !== primary && id !== 'default_input'
      && id !== recording.microphone_source && !id.includes('|')
      && !(id.startsWith('device:') && !id.endsWith('.monitor')));
  return [0, 1].map(i => ({source: extras[i] || '', enabled: Boolean(extras[i])}));
}
export function outputTracks(primary: string, slots: OutputSlot[]): string[] {
  return [...new Set([primary || 'default_output', ...slots.filter(s => s.enabled && s.source).map(s => s.source)])];
}

export function slotsForPrimary(primary: string, slots: OutputSlot[]): OutputSlot[] {
  return slots.map(slot => slot.source === primary ? {...slot, enabled: false} : slot);
}
