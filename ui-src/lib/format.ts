import {t, dateLocale} from './i18n';
/** Formatting shared across screens. */

/**
 * 95 becomes "1:35". With `withUnit`, anything under a minute reads as "20s".
 *
 * Under a minute a fraction is kept, because these are the readouts where it
 * carries the meaning: a half-second trim selection rendered as "0s" says the
 * selection is empty when it is not.
 */
export function formatDuration(seconds: number, withUnit = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return withUnit ? '0s' : '0:00';
  const whole = Math.floor(seconds);
  if (withUnit && seconds < 60) return `${seconds.toFixed(seconds % 1 ? 1 : 0)}s`;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The spelled-out form the settings sliders use: "20 s", "10 min", "2:30 min".
 *
 * A buffer length is a quantity being chosen, not a position being read, and
 * "10:00" beside a slider reads like a timestamp. This is the wording the old
 * form used and it was right.
 */
export function formatLengthLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return t('ui.lenSec', {n: 0});
  if (seconds < 60) return t('ui.lenSec', {n: Math.round(seconds)});
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds % 60);
  return r === 0 ? t('ui.lenMin', {n: m}) : t('ui.lenMinSec', {m, s: String(r).padStart(2, '0')});
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Format every key in an evdev combination, including modifier names. */
export function hotkeyLabel(key: string | undefined | null): string {
  if (!key) return t('ui.theClipKey');
  const labels: Record<string, string> = {
    LEFTCTRL: 'Ctrl', RIGHTCTRL: 'Ctrl', LEFTALT: 'Alt', RIGHTALT: 'Alt',
    LEFTSHIFT: 'Shift', RIGHTSHIFT: 'Shift', LEFTMETA: 'Super', RIGHTMETA: 'Super',
    PAGEUP: 'Page Up', PAGEDOWN: 'Page Down', SYSRQ: 'Print Screen',
  };
  return key.split('+').map(part => {
    const name = part.trim().replace(/^KEY_/, '');
    return labels[name] ?? name.toLowerCase().replace(/^left/, 'left ')
      .replace(/^right/, 'right ').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }).join(' + ');
}

/** Takes the daemon's ISO timestamps, which carry no timezone suffix. */
export function relativeTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return '';
  const then = new Date(isoTimestamp).getTime();
  if (Number.isNaN(then)) return '';
  const diff = (Date.now() - then) / 1000;
  if (diff < 60) return t('ui.justNow');
  if (diff < 3600) return t('ui.minAgo', {n: Math.floor(diff / 60)});
  if (diff < 86400) return t('ui.hoursAgo', {n: Math.floor(diff / 3600)});
  if (diff < 604800) return t('ui.daysAgo', {n: Math.floor(diff / 86400)});
  return new Date(then).toLocaleDateString(dateLocale());
}
