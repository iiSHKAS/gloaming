import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';

import {api} from '../lib/api';
import {needsWindowControls, keepRunning, quitGloaming, IS_CUSTOM_CHROME} from '../lib/env';
import {WindowTitlebar} from './WindowTitlebar';
import {Tutorial} from './Tutorial';
import {WhatsNew} from './WhatsNew';
import {latestNotedVersion, notesFor} from '../lib/whatsNew';
import {UpdateNotice} from './UpdateNotice';
import {IconMinimize, IconPower} from './Icons';
import {useStore} from '../state/store';
import {StudioNav} from './StudioNav';
import {StatusIsland} from './StatusIsland';
import {Banners} from './Banners';
import {t} from '../lib/i18n';


/** Top navigation and shared desktop chrome for the capture studio. */
export type HomeLayout = 'narrow' | 'wide' | 'rail';
const HomeLayoutContext = createContext<HomeLayout>('narrow');
export const useHomeLayout = () => useContext(HomeLayoutContext);

export function AppFrame({children}: {children: ReactNode}) {
  const {state, dispatch} = useStore();
  const settingsOrigin = useRef({view: state.view, playlistId: state.currentPlaylistId});
  useEffect(() => {
    if (state.view !== 'settings') settingsOrigin.current = {view: state.view, playlistId: state.currentPlaylistId};
  }, [state.view, state.currentPlaylistId]);
  const [windowControls, setWindowControls] = useState(false);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void needsWindowControls().then(value => { if(alive) setWindowControls(value); }).catch(()=>{}); };
    refresh();
    const timer = setInterval(refresh, 1500);
    window.addEventListener('pywebviewready', refresh);
    return () => {alive=false;clearInterval(timer);window.removeEventListener('pywebviewready',refresh);};
  }, []);
  // Both of these screens have their own controls in the bottom right.
  const quitHidden = state.view === 'editor' || state.view === 'settings';
  const [tutorial, setTutorial] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [whatsNew, setWhatsNew] = useState<string | null>(null);
  const version = state.status.version;
  // First run only. The flag is kept on the daemon as well as locally,
  // because the native window's localStorage does not survive a restart on
  // every QtWebEngine build, which made the tutorial reappear every launch.
  useEffect(() => {
    if (localStorage.getItem('gloaming_tutorial_shown')) return;
    let cancelled = false;
    void api
      .getAppState()
      .then(s => {
        if (cancelled) return;
        if (s.tutorial_seen) localStorage.setItem('gloaming_tutorial_shown', '1');
        else setTutorial(true);
      })
      .catch(() => !cancelled && setTutorial(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // The first launch after an update shows that release's notes, once. A new
  // install skips them: the tutorial covers the same ground, and finishing it
  // records this version as seen. Kept on the daemon as well as locally for
  // the same reason as the tutorial flag.
  useEffect(() => {
    if (!version || !notesFor(version)) return;
    if (localStorage.getItem('gloaming_whats_new_seen') === version) return;
    let cancelled = false;
    void api
      .getAppState()
      .then(s => {
        if (cancelled) return;
        if (s.whats_new_seen === version) {
          localStorage.setItem('gloaming_whats_new_seen', version);
          return;
        }
        const returning = Boolean(s.tutorial_seen) || Boolean(localStorage.getItem('gloaming_tutorial_shown'));
        if (returning) setWhatsNew(version);
      })
      .catch(err => console.debug('Could not read whether these notes were seen', err));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const closeWhatsNew = () => {
    if (whatsNew === version && version) {
      localStorage.setItem('gloaming_whats_new_seen', version);
      void api.setAppState({whats_new_seen: version}).catch(err => {
        console.debug('Recording that the notes were seen failed', err);
      });
    }
    setWhatsNew(null);
  };

  const notedVersion = notesFor(version) ? version : latestNotedVersion();

  // The page draws its own window controls when the system title bar is off, so the bottom-right row is not needed.
  const bottomRow = windowControls && !IS_CUSTOM_CHROME;
  const frame = (
    <div className="frame studio-frame" data-capture-home={state.view==='home' || undefined} data-sidebar={state.view!=='settings' || undefined}>
      {state.view==='settings' ? <header className="settings-return-bar"><button type="button" onClick={()=>dispatch({type:'setView', ...settingsOrigin.current})} aria-label={t('ui.backToPreviousSection')}><span className="settings-return-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m10 6-6 6 6 6M4 12h16"/></svg></span><span>{t('ui.back')}</span></button></header> : (
      <StudioNav
        onShowTutorial={() => setTutorial(true)}
        onShowUpdate={() => setUpdateOpen(true)}
        onShowWhatsNew={notedVersion ? () => setWhatsNew(notedVersion) : undefined}
      />)}

      <div className="frame-content" data-view={state.view}
        data-native={bottomRow || undefined}>
        <Banners />
        <HomeLayoutContext.Provider value="narrow">{children}</HomeLayoutContext.Provider>
      </div>
      {state.event ? <StatusIsland /> : null}
      {bottomRow ? <QuitRow hidden={quitHidden} /> : null}
      <Tutorial open={tutorial} onClose={() => setTutorial(false)} />
      <UpdateNotice forceOpen={updateOpen} onClose={() => setUpdateOpen(false)} />
      <WhatsNew version={whatsNew} open={whatsNew !== null} onClose={closeWhatsNew} />
    </div>
  );
  if (!IS_CUSTOM_CHROME) return frame;
  return (
    <div className="window-chrome">
      <WindowTitlebar />
      {frame}
    </div>
  );
}

/**
 * Native only. Closing the window leaves the daemon recording, which is the
 * point, so the two outcomes are named rather than left to a close button.
 */
function QuitRow({hidden}: {hidden: boolean}) {
  return (
    <div className="quit-row" data-hidden={hidden || undefined} aria-hidden={hidden}>
      <button type="button" className="quit-btn" onClick={keepRunning}>
        <IconMinimize size={14} />
        <span>{t('frame.minimize')}</span>
      </button>
      <button
        type="button"
        className="quit-btn quit-btn-danger"
        onClick={() => {
          if (window.confirm(t('frame.quitConfirm'))) {
            quitGloaming();
          }
        }}>
        <IconPower size={14} />
        <span>{t('frame.quit')}</span>
      </button>
    </div>
  );
}
