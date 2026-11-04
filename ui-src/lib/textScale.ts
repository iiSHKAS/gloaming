/**
 * Interface text size, applied as a CSS zoom on the app shell (styles/textscale.css).
 *
 * One number for every language. Arabic starts a little larger because its
 * letters read small at the interface's 12-13px sizes; a value the user picks
 * wins over that default in any language.
 */
const STORAGE_KEY = 'gloaming-text-scale';

export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.5;
export const TEXT_SCALE_STEP = 0.05;

function saved(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value >= TEXT_SCALE_MIN && value <= TEXT_SCALE_MAX ? value : null;
  } catch {
    return null;
  }
}

export function defaultTextScale(locale: string): number {
  return locale.split('-')[0] === 'ar' ? 1.15 : 1;
}

export function effectiveTextScale(locale: string): number {
  return saved() ?? defaultTextScale(locale);
}

/** Sets the scale for the active page. Pass null to go back to the language default. */
export function applyTextScale(locale: string): void {
  document.documentElement.style.setProperty('--ui-zoom', String(effectiveTextScale(locale)));
}

export function setTextScale(value: number | null, locale: string): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage can be refused; the choice then lasts until the window closes.
  }
  if (value !== null) document.documentElement.style.setProperty('--ui-zoom', String(value));
  else applyTextScale(locale);
}
