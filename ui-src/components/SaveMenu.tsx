import {useEffect, useState} from 'react';
import {ControllerGlyph, type PadLayout} from './ControllerGlyph';
import '../styles/replay-overlay.css';

const label = (seconds: number) => seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Hold-menu: pick how much of the replay buffer to save, driven entirely by the controller. */
export function SaveMenu() {
  const max = Math.max(1, Number(new URLSearchParams(location.search).get('saveMenu')) || 60);
  const clips = [...[60, 120, 300, 600].filter(n => n < max), max];
  // 0 stands for "open the replay overlay".
  const options = [0, ...clips];
  const [index, setIndex] = useState(0);
  const [layout, setLayout] = useState<PadLayout>('xbox');
  const [done, setDone] = useState(false);
  const close = () => {
    const host = window as unknown as {webkit?: {messageHandlers?: {gloamingOverlay?: {postMessage: (message: string) => void}}}};
    host.webkit?.messageHandlers?.gloamingOverlay?.postMessage('close');
  };
  const choose = (seconds: number) => {
    if (done) return;
    setDone(true);
    if (seconds === 0) {
      // The host swaps this menu for the controller replay overlay.
      void fetch('/api/controller/open-replay', {method: 'POST'});
      return;
    }
    void fetch('/api/trigger', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({duration: seconds})})
      .finally(() => setTimeout(close, 250));
  };
  const act = (button: string) => {
    if (['BTN_DPAD_LEFT', 'BTN_DPAD_UP', 'STICK_UP', 'BTN_TL'].includes(button)) setIndex(i => (i + options.length - 1) % options.length);
    else if (['BTN_DPAD_RIGHT', 'BTN_DPAD_DOWN', 'STICK_DOWN', 'BTN_TR'].includes(button)) setIndex(i => (i + 1) % options.length);
    else if (button === 'BTN_SOUTH') choose(options[index]);
    else if (button === 'BTN_EAST') close();
  };
  useEffect(() => {
    document.documentElement.classList.add('replay-overlay-host');
    return () => document.documentElement.classList.remove('replay-overlay-host');
  }, []);
  useEffect(() => {
    let alive = true;
    let socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    let repeat: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval> | undefined;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/controller/events`);
      socket.onmessage = event => {
        const data = JSON.parse(event.data) as {button?: string; down?: boolean; layout?: PadLayout};
        if (data.layout) setLayout(data.layout);
        if (!data.button) return;
        if (data.down) {
          window.dispatchEvent(new CustomEvent('gloaming-save-menu', {detail: data.button}));
          if (/UP|DOWN|LEFT|RIGHT|BTN_TL$|BTN_TR$/.test(data.button)) {
            // Holding a direction keeps scrolling.
            clearTimeout(repeat); clearInterval(repeat);
            const button = data.button;
            repeat = setTimeout(() => {repeat = setInterval(() => window.dispatchEvent(new CustomEvent('gloaming-save-menu', {detail: button})), 140);}, 380);
          }
        } else {clearTimeout(repeat); clearInterval(repeat);}
      };
      socket.onclose = () => {if (alive) retry = setTimeout(connect, 500);};
    };
    connect();
    return () => {alive = false; clearTimeout(retry); clearTimeout(repeat); clearInterval(repeat); socket.close();};
  }, []);
  // The listener always sees the latest selection.
  useEffect(() => {
    const handle = (event: Event) => act((event as CustomEvent<string>).detail);
    const key = (event: KeyboardEvent) => {
      const map: Record<string, string> = {ArrowLeft: 'BTN_DPAD_LEFT', ArrowRight: 'BTN_DPAD_RIGHT', ArrowUp: 'BTN_DPAD_UP', ArrowDown: 'BTN_DPAD_DOWN', Enter: 'BTN_SOUTH', Escape: 'BTN_EAST'};
      if (map[event.key]) {event.preventDefault(); act(map[event.key]);}
    };
    window.addEventListener('gloaming-save-menu', handle);
    window.addEventListener('keydown', key);
    return () => {window.removeEventListener('gloaming-save-menu', handle); window.removeEventListener('keydown', key);};
  });
  const focused = options[index];
  const title = focused === 0 ? 'Open replay' : focused === max && clips.length > 1 ? `Save everything · ${label(max)}` : `Save the last ${label(focused)}`;
  const R = 36, C = 2 * Math.PI * R;
  return <main className="replay-overlay-page save-menu-page" onClick={event => {if (event.target === event.currentTarget) close();}}>
    <section className="save-menu" aria-label="Gloaming quick actions" data-done={done || undefined}>
      <p className="save-menu-eyebrow">GLOAMING</p>
      <div className="save-menu-row" role="listbox">
        {options.map((seconds, i) => {
          const isReplay = seconds === 0;
          const isMax = !isReplay && seconds === max && clips.length > 1;
          const amount = seconds >= 60 ? [String(Math.round(seconds / 60 * 10) / 10).replace(/\.0$/, ''), 'MIN'] : [String(seconds), 'SEC'];
          return <div key={seconds} className="save-menu-slot" style={{'--i': i} as React.CSSProperties}>
            {i === 1 && <span className="save-menu-divider" aria-hidden="true"/>}
            <button role="option" aria-selected={i === index} data-selected={i === index || undefined} data-kind={isReplay ? 'replay' : 'clip'}
              onMouseEnter={() => setIndex(i)} onClick={() => choose(seconds)}>
              {isReplay
                ? <svg viewBox="0 0 96 96" aria-hidden="true">
                    <rect x="14" y="22" width="68" height="46" rx="9" fill="none" stroke="currentColor" strokeWidth="4.5"/>
                    <path d="M42 36l16 9-16 9z" fill="currentColor"/>
                    <path d="M30 78h36" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"/>
                  </svg>
                : <svg viewBox="0 0 96 96" aria-hidden="true">
                    <circle cx="48" cy="48" r={R} fill="none" stroke="currentColor" strokeOpacity=".22" strokeWidth="6"/>
                    <circle cx="48" cy="48" r={R} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${C * Math.min(1, seconds / max)} ${C}`} transform="rotate(-90 48 48)"/>
                    <text x="48" y={isMax ? 54 : 52} textAnchor="middle" fontSize={isMax ? 21 : 30} fontWeight="800" fill="currentColor">{isMax ? 'MAX' : amount[0]}</text>
                    {!isMax && <text x="48" y="68" textAnchor="middle" fontSize="12" fontWeight="700" letterSpacing="1.5" fill="currentColor" fillOpacity=".85">{amount[1]}</text>}
                  </svg>}
            </button>
          </div>;
        })}
      </div>
      <h2 key={index} className="save-menu-title">{done ? 'Working on it…' : title}</h2>
      <footer>
        <span><ControllerGlyph name="dpad-h" layout={layout}/>Browse</span>
        <span><ControllerGlyph name="south" layout={layout}/>Select</span>
        <span><ControllerGlyph name="east" layout={layout}/>Back</span>
      </footer>
    </section>
  </main>;
}
