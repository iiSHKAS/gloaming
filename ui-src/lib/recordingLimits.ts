/** The selected replay buffer is the ceiling for every clip, including hotkey presets. */
export function boundedDuration(value: number, max: number, fallback = 5): number {
  return Math.max(5, Math.min(max, Number.isFinite(value) ? Math.round(value) : fallback));
}

export function constrainRecordingDurations<T extends {
  bufferDuration: number;
  clipDuration: number;
  clipPresets: Array<{duration: number}>;
}>(draft: T): T {
  const bufferDuration = boundedDuration(draft.bufferDuration, 1800, 120);
  return {
    ...draft,
    bufferDuration,
    clipDuration: boundedDuration(draft.clipDuration, bufferDuration),
    clipPresets: draft.clipPresets.map(p => ({...p, duration: boundedDuration(p.duration, bufferDuration)})),
  };
}
