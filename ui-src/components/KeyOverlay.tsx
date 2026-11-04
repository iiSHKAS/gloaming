import {useEffect, useRef, useState, type RefObject} from 'react';

import {t} from '../lib/i18n';
import {KEY_LAYOUT, keysAt, type KeyInterval} from '../lib/keyLayout';

/**
 * The keys kept beside a clip, drawn over the video in time with it (#209).
 *
 * Imperative on purpose, like the editor engine: it follows the video's own
 * clock every frame, and a React render per frame would cost more than the
 * twenty attributes it changes.
 */
export function KeyOverlay({
  video,
  intervals,
  clock,
  container,
  position,
  onPositionChange,
}: {
  video?: RefObject<HTMLVideoElement | null>;
  clock?: () => number;
  intervals: KeyInterval[];
  /** With these, the panel can be dragged inside `container`, the way the controller can. */
  container?: RefObject<HTMLElement | null>;
  position?: [number, number];
  onPositionChange?: (position: [number, number]) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const movable = Boolean(container && onPositionChange);
  const [place, setPlace] = useState<[number, number] | null>(position ?? null);
  const placeRef = useRef(place);
  const [room, setRoom] = useState({x: 1, y: 1});
  const drag = useRef<{x: number; y: number; at: [number, number]} | null>(null);
  useEffect(() => {if (position) {setPlace(position); placeRef.current = position;}}, [position]);
  // Free space around the panel: how far it can travel inside the picture.
  useEffect(() => {
    const panel = root.current, area = container?.current;
    if (!movable || !panel || !area) return;
    const measure = () => setRoom({x: Math.max(1, area.clientWidth - panel.offsetWidth), y: Math.max(1, area.clientHeight - panel.offsetHeight)});
    const observer = new ResizeObserver(measure);
    observer.observe(area); observer.observe(panel); measure();
    return () => observer.disconnect();
  }, [movable, container]);
  const move = (next: [number, number]) => {
    const clamped = next.map(v => Math.max(0, Math.min(1, v))) as [number, number];
    placeRef.current = clamped; setPlace(clamped);
  };
  const drop = () => {
    if (drag.current && placeRef.current) onPositionChange?.(placeRef.current);
    drag.current = null;
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const el = video?.current;
      const panel = root.current;
      if ((el || clock) && panel) {
        const held = keysAt(intervals, clock ? clock() : el!.currentTime);
        for (const cap of panel.querySelectorAll<HTMLElement>('[data-key]')) {
          const down = held.has(cap.dataset.key ?? '');
          if (down !== cap.hasAttribute('data-down')) cap.toggleAttribute('data-down', down);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [video, intervals, clock]);

  return (
    <div className="key-overlay" ref={root} aria-label={movable ? t('ui.moveKeyboard') : t('viewer.keysAria')} role={movable ? 'button' : 'img'}
      data-movable={movable || undefined} tabIndex={movable ? 0 : undefined} title={movable ? t('ui.moveKeyboard') : undefined}
      style={movable && place ? {left: place[0] * room.x, top: place[1] * room.y, bottom: 'auto'} : undefined}
      onPointerDown={movable ? e => {
        if (e.button !== 0) return;
        e.stopPropagation(); e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const start: [number, number] = placeRef.current ?? [
          (root.current!.offsetLeft) / room.x, (root.current!.offsetTop) / room.y];
        placeRef.current = start; setPlace(start);
        drag.current = {x: e.clientX, y: e.clientY, at: start};
      } : undefined}
      onPointerMove={movable ? e => {
        const d = drag.current; if (!d) return;
        move([d.at[0] + (e.clientX - d.x) / room.x, d.at[1] + (e.clientY - d.y) / room.y]);
      } : undefined}
      onPointerUp={movable ? e => {drop(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);} : undefined}
      onPointerCancel={movable ? drop : undefined}
      onKeyDown={movable ? e => {
        const step: Record<string, [number, number]> = {ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02]};
        const delta = step[e.key]; if (!delta) return;
        e.preventDefault(); e.stopPropagation();
        const at = placeRef.current ?? [root.current!.offsetLeft / room.x, root.current!.offsetTop / room.y];
        move([at[0] + delta[0], at[1] + delta[1]]);
        onPositionChange?.(placeRef.current!);
      } : undefined}>
      {KEY_LAYOUT.map((row, r) => (
        <div className="key-overlay-row" key={r}>
          {row.map(([id, label, span], k) =>
            id === null ? (
              <span key={k} style={{gridColumn: `span ${span * 2}`}} />
            ) : (
              <span key={k} className="key-cap" data-key={id} style={{gridColumn: `span ${span * 2}`}}>
                {label}
              </span>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
