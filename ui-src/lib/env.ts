/**
 * Facts about the window we are running in, decided once at module load.
 *
 * Every one of these was a bug report before it was a constant, so the
 * reasoning is kept with the code rather than in a commit message.
 */

/**
 * The pywebview native window. gloaming-app passes ?native=1 in the URL because
 * window.pywebview is only injected after DOMContentLoaded, which is too late
 * to identify the native host on the first paint.
 */
export const IS_NATIVE: boolean = (() => {
  try {
    if (new URLSearchParams(location.search).get('native') === '1') return true;
  } catch {
    // A malformed query string is not a reason to fail the check below.
  }
  return typeof (window as {pywebview?: unknown}).pywebview !== 'undefined';
})();

/** The native window turned its system title bar off, so the page draws one. */
export const IS_CUSTOM_CHROME: boolean = (() => {
  try {
    return IS_NATIVE && new URLSearchParams(location.search).get('chrome') === '1';
  } catch {
    return false;
  }
})();
if (IS_CUSTOM_CHROME) document.documentElement.classList.add('native-chrome');

type WindowAction = 'drag' | 'minimize' | 'toggle_maximize' | 'close';
/** Ask the native window to do something to itself. Calls made before the bridge is ready are dropped. */
export function windowAction(action: WindowAction): void {
  const api = (window as unknown as {pywebview?: PyWebView}).pywebview?.api;
  const call = {
    drag: api?.window_drag, minimize: api?.window_minimize,
    toggle_maximize: api?.window_toggle_maximize, close: api?.window_close,
  }[action];
  try { call?.(); } catch (err) { console.debug('Window action failed', action, err); }
}

export function windowResize(edge: string): void {
  try { (window as unknown as {pywebview?: PyWebView}).pywebview?.api.window_resize?.(edge); } catch (err) { console.debug('Resize failed', err); }
}

export async function windowMaximized(): Promise<boolean> {
  try { return Boolean(await (window as unknown as {pywebview?: PyWebView}).pywebview?.api.window_is_maximized?.()); } catch { return false; }
}

/** WebKitGTK can stall its UI process while starting thumbnail video players.
 * Native GTK windows use still thumbnails; explicit playback stays available.
 */
export const IS_NATIVE_WEBKIT = IS_NATIVE && /AppleWebKit/i.test(navigator.userAgent)
  && !/Chrome|Chromium|Edg\//i.test(navigator.userAgent);

/**
 * gloaming-app appends sw=1 when GPU compositing failed and the window relaunched
 * in software mode. This only covers the failure gloaming-app can see; the frame
 * probe catches the silent one.
 */
export const IS_SOFTWARE_RENDER: boolean = (() => {
  try {
    return new URLSearchParams(location.search).get('sw') === '1';
  } catch {
    return false;
  }
})();

/**
 * Whether this engine can decode H.264 at all. Every Gloaming clip is H.264, but
 * QtWebEngine builds without proprietary codecs (the PyPI PyQt6-WebEngine
 * wheels) silently render video as a blank rectangle, so the UI has to say
 * what is wrong instead of showing grey (#79).
 */
export const H264_SUPPORTED: boolean = (() => {
  try {
    return document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"') !== '';
  } catch {
    return true; // Assume capable: a false banner is worse than no banner.
  }
})();

/**
 * H.265 clips usually cannot decode in the native WebEngine. When they cannot,
 * the UI asks the daemon for an H.264 preview proxy instead of the raw file.
 */
export const HEVC_SUPPORTED: boolean = (() => {
  try {
    const v = document.createElement('video');
    return (
      v.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== '' ||
      v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== ''
    );
  } catch {
    return false;
  }
})();

interface PyWebView {
  api: {
    get_window_chrome?: () => Promise<{has_titlebar: boolean | null}>;
    keep_running: () => void;
    tray_available?: () => Promise<boolean>;
    window_drag?: () => void;
    window_resize?: (edge: string) => void;
    window_minimize?: () => void;
    window_toggle_maximize?: () => void;
    window_is_maximized?: () => Promise<boolean>;
    window_close?: () => void;
    quit_app: () => void;
    set_tray_labels?: (openLabel: string, quitLabel: string) => void;
    open_url?: (url: string) => void;
    log_debug?: (msg: string) => void;
  };
}

/**
 * Forward a diagnostic to the browser console and, in the native window, to
 * gloaming.log, so a reporter's log holds the whole timeline rather than half of
 * it. Playback failures are the case that needs this: they leave no trace on
 * the daemon side at all.
 */
export function nativeLog(msg: string): void {
  console.debug('[gloaming]', msg);
  try {
    const bridge = (window as unknown as {pywebview?: PyWebView}).pywebview;
    if (IS_NATIVE && bridge?.api?.log_debug) bridge.api.log_debug(String(msg));
  } catch (err) {
    console.debug('The native log bridge threw', err);
  }
}

/**
 * Open a link in the user's real browser. The native window has no chrome to
 * get back from, so a link followed inside it is a trap.
 */
export function openExternal(url: string | undefined): void {
  if (!url) return;
  try {
    const bridge = (window as unknown as {pywebview?: PyWebView}).pywebview;
    if (IS_NATIVE && bridge?.api?.open_url) {
      bridge.api.open_url(String(url));
      return;
    }
  } catch (err) {
    console.debug('The native open_url bridge threw', err);
  }
  window.open(url, '_blank', 'noopener');
}

/** Keep the native tray actions in the same language as the web UI. */
export function setNativeTrayLabels(openLabel: string, quitLabel: string): void {
  if (!IS_NATIVE) return;

  const apply = (): boolean => {
    try {
      const bridge = (window as unknown as {pywebview?: PyWebView}).pywebview;
      if (!bridge?.api?.set_tray_labels) return false;
      bridge.api.set_tray_labels(String(openLabel), String(quitLabel));
      return true;
    } catch (err) {
      console.debug('The native tray label bridge threw', err);
      return true;
    }
  };

  if (apply()) return;
  window.addEventListener('pywebviewready', () => { apply(); }, {once: true});
}

/** Hide the window but leave the daemon recording. Native only. */
export function keepRunning(): void {
  if (IS_NATIVE) (window as unknown as {pywebview: PyWebView}).pywebview.api.keep_running();
}

/** Whether the desktop has a system tray to hide to. Unknown (browser, older build) reads as true. */
export async function trayAvailable(): Promise<boolean> {
  const bridge = (window as unknown as {pywebview?: PyWebView}).pywebview;
  if (!IS_NATIVE || !bridge?.api?.tray_available) return true;
  try {
    return Boolean(await bridge.api.tray_available());
  } catch {
    return true;
  }
}

/** Stop the daemon and close. Falls back to HTTP outside the native window. */
export function quitGloaming(): void {
  if (IS_NATIVE) {
    (window as unknown as {pywebview: PyWebView}).pywebview.api.quit_app();
  } else {
    void fetch('/api/quit', {method: 'POST'}).catch(() => {});
  }
}

/** Unknown decoration state keeps the duplicate controls hidden. */
export async function needsWindowControls(): Promise<boolean> {
  const bridge = (window as unknown as {pywebview?: PyWebView}).pywebview;
  if (!IS_NATIVE || !bridge?.api?.get_window_chrome) return false;
  return (await bridge.api.get_window_chrome()).has_titlebar === false;
}
