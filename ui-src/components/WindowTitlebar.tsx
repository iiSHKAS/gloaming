import {useEffect, useState} from 'react';

import {IconMark} from './Icons';
import {t} from '../lib/i18n';
import {windowAction, windowMaximized, windowResize} from '../lib/env';

const EDGES = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'] as const;

/**
 * The window's own title bar, drawn by the page because the system one is turned off. Drag it to move the window,
 * double-click to maximize; the three buttons are minimize, maximize and close. Thin strips around the window
 * start a resize.
 */
export function WindowTitlebar() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    let alive = true;
    const sync = () => void windowMaximized().then(value => {
      if (!alive) return;
      setMaximized(value);
      document.body.classList.toggle('maximized', value);
    });
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('pywebviewready', sync);
    return () => {
      alive = false;
      window.removeEventListener('resize', sync);
      window.removeEventListener('pywebviewready', sync);
    };
  }, []);

  return (
    <>
      <div className="titlebar" role="toolbar" aria-label={t('app.name')}
        onMouseDown={event => {
          if (event.button === 0 && !(event.target as HTMLElement).closest('.tb-controls')) windowAction('drag');
        }}
        onDoubleClick={event => {
          if (!(event.target as HTMLElement).closest('.tb-controls')) windowAction('toggle_maximize');
        }}>
        <div className="tb-title"><IconMark size={18} className="tb-mark" />{t('app.name')}</div>
        <div className="tb-controls">
          <button type="button" className="tb-btn" title="Minimize" aria-label="Minimize" onClick={() => windowAction('minimize')}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
          <button type="button" className="tb-btn" title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => windowAction('toggle_maximize')}>
            {maximized
              ? <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="3.5" width="6.5" height="6.5" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M4 3.5V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>}
          </button>
          <button type="button" className="tb-btn close" title="Close" aria-label="Close" onClick={() => windowAction('close')}>
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
      {maximized ? null : EDGES.map(edge => (
        <div key={edge} className={`rz ${edge}`}
          onMouseDown={event => { if (event.button === 0) { event.preventDefault(); windowResize(edge); } }} />
      ))}
    </>
  );
}
