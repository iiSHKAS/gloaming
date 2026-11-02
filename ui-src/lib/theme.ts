import {useSyncExternalStore} from 'react';

import {api} from './api';

/**
 * Dark, or a soft grey light theme. The light one is deliberately not white:
 * it is a muted, slightly dark grey that stays easy on the eyes.
 *
 * Kept in localStorage so the very first paint can read it (index.html does,
 * before the bundle parses), and applied as data-theme on the root element.
 * Windows drawn over a game, the replay overlay and its save menu, are always
 * dark.
 */
export const THEMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

const KEY = 'gloaming-appearance';

export const isOverlayWindow = (): boolean =>
  new URLSearchParams(location.search).get('replayOverlay') === '1';

function stored(): ThemeName {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let current: ThemeName = isOverlayWindow() ? 'dark' : stored();
const listeners = new Set<() => void>();

function paint(): void {
  document.documentElement.dataset.theme = current;
}

export function initTheme(): void {
  paint();
}

export function getTheme(): ThemeName {
  return current;
}

export function setTheme(next: ThemeName): void {
  if (next === current) return;
  current = next;
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
  if (isOverlayWindow()) return;
  void api
    .getAppState()
    .then(saved => {
      const next: ThemeName = saved.theme === 'light' ? 'light' : 'dark';
      if (next === current) return;
      current = next;
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
