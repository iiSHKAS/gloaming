export type SettingsPatch = Record<string, Record<string, unknown>>;

/** Serializes writes and coalesces typing without dropping edits made during a request. */
export class SettingsAutosave {
  private saved: SettingsPatch;
  private desired: SettingsPatch;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | null = null;

  constructor(initial: SettingsPatch, private write: (patch: SettingsPatch) => Promise<void>) {
    this.saved = initial;
    this.desired = initial;
  }

  submit(next: SettingsPatch) {
    this.desired = next;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 300);
  }

  /** Accept live changes (e.g. overlay hotkeys) without overwriting local edits. */
  acceptExternal(patch: SettingsPatch): SettingsPatch {
    const accepted: SettingsPatch = {};
    for (const [group, values] of Object.entries(patch)) {
      for (const [key, value] of Object.entries(values)) {
        if (JSON.stringify(this.desired[group]?.[key]) !== JSON.stringify(this.saved[group]?.[key])) continue;
        (accepted[group] ??= {})[key] = value;
        this.saved = {...this.saved, [group]: {...this.saved[group], [key]: value}};
        this.desired = {...this.desired, [group]: {...this.desired[group], [key]: value}};
      }
    }
    return accepted;
  }

  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain(): Promise<boolean> {
    while (true) {
      const patch: SettingsPatch = {};
      for (const [group, values] of Object.entries(this.desired)) {
        for (const [key, value] of Object.entries(values)) {
          if (JSON.stringify(value) !== JSON.stringify(this.saved[group]?.[key])) {
            (patch[group] ??= {})[key] = value;
          }
        }
      }
      if (!Object.keys(patch).length) return true;
      try {
        await this.write(patch);
      } catch {
        // Keep the previous baseline. Retry explicitly or with the next edit.
        return false;
      }
      for (const [group, values] of Object.entries(patch)) {
        this.saved = {...this.saved, [group]: {...this.saved[group], ...values}};
      }
    }
  }
}
