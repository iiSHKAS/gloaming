import {useSyncExternalStore} from 'react';

import {api} from './api';

/**
 * Dark, or a soft grey light theme. The light one is deliberately not white:
 * it is a muted, slightly dark grey that stays easy on the eyes.
 *
 * Kept in localStorage so the very first paint can read it (index.html does,
 * before the bundle parses), and applied as data-theme on the root element.
 * The replay overlay follows the theme too; the save menu drawn over a game is
 * always dark.
 */
export const THEMES = ['dark', 'light', 'system'] as const;
/** What the user chose. 'system' follows the desktop's light or dark setting. */
export type ThemePreference = (typeof THEMES)[number];
/** What is actually drawn. */
export type ThemeName = 'dark' | 'light';

const KEY = 'gloaming-appearance';

export const isOverlayWindow = (): boolean =>
  new URLSearchParams(location.search).get('replayOverlay') === '1';

/** The save menu is the one overlay window that stays dark. */
const isDarkOnlyWindow = (): boolean => isOverlayWindow() && new URLSearchParams(location.search).has('saveMenu');

const asPreference = (value: unknown): ThemePreference =>
  value === 'light' || value === 'system' ? value : 'dark';

function stored(): ThemePreference {
  try {
    return asPreference(localStorage.getItem(KEY));
  } catch {
    return 'dark';
  }
}

const systemQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const resolve = (choice: ThemePreference): ThemeName =>
  choice === 'system' ? (systemQuery?.matches ? 'light' : 'dark') : choice;

let preference: ThemePreference = isDarkOnlyWindow() ? 'dark' : stored();
let current: ThemeName = resolve(preference);
const listeners = new Set<() => void>();

// 'system' follows the desktop live, so switching it at night recolours the app.
systemQuery?.addEventListener('change', () => {
  if (preference !== 'system' || isDarkOnlyWindow()) return;
  current = resolve(preference);
  paint();
  for (const fn of listeners) fn();
});

function paint(): void {
  document.documentElement.dataset.theme = current;
}

export function initTheme(): void {
  paint();
}

export function getTheme(): ThemeName {
  return current;
}

export function getThemePreference(): ThemePreference {
  return preference;
}

export function setTheme(next: ThemePreference): void {
  if (next === preference) return;
  preference = next;
  current = resolve(next);
  try {
    localStorage.setItem(KEY, next);
  } catch (err) {
    // The choice still applies for this session.
    console.debug('Saving the theme failed', err);
  }
  paint();
  for (const fn of listeners) fn();
  // Native WebKit does not always keep localStorage, so the daemon holds it too.
  void api.setAppState({theme: next}).catch(() => undefined);
}

/** Pick up the choice the daemon kept, for builds that lost localStorage. */
export function restoreTheme(): void {
  if (isDarkOnlyWindow()) return;
  void api
    .getAppState()
    .then(saved => {
      const next = asPreference(saved.theme);
      if (next === preference) return;
      preference = next;
      current = resolve(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        // Applied for this session regardless.
      }
      paint();
      for (const fn of listeners) fn();
    })
    .catch(() => undefined);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, getTheme);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, getThemePreference);
}
