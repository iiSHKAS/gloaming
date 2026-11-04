import {useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent} from 'react';
import {OverlayPortal} from '../OverlayPortal';
import {zoomOf} from '../../lib/zoom';

type Option = [string, string];
type Group = {group: string; options: Option[]};
export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[] | Group[];
  disabled?: boolean;
  label: string;
  className?: string;
}

/** Shared select: the popup lives outside scrolling cards and keeps focus on its trigger. */
export function Select({value, onChange, options, disabled, label, className = ''}: SelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const revealActive = useRef(true);
  const search = useRef({text: '', time: 0});
  const groups: Group[] = options.length && !Array.isArray(options[0])
    ? options as Group[] : [{group: '', options: options as Option[]}];
  const items = groups.flatMap(g => g.options);
  const selected = items.findIndex(([v]) => v === value);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [position, setPosition] = useState({left: 0, top: 0, width: 0, maxHeight: 190});
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const show = () => {
    if (disabled || !items.length) return;
    trigger.current?.focus({preventScroll: true});
    window.dispatchEvent(new CustomEvent('gloaming-select-open', {detail: id}));
    revealActive.current = true;
    setActive(Math.max(0, selected)); setMounted(true); setOpen(true);
  };
  useEffect(() => {
    if (open || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), 140);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!mounted) return;
    const place = () => {
      const screenRect = trigger.current?.getBoundingClientRect();
      if (!screenRect) return;
      const popup = menu.current;
      if (!popup) return;
      // Work in the menu's own (zoomed) pixels: the anchor and the viewport are
      // measured on screen, the box is placed in zoomed units.
      const zoom = zoomOf(popup);
      const rect = {left: screenRect.left / zoom, top: screenRect.top / zoom, bottom: screenRect.bottom / zoom, width: screenRect.width / zoom};
      const viewWidth = window.innerWidth / zoom, viewHeight = window.innerHeight / zoom;
      const style = getComputedStyle(popup);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const rowHeight = popup.querySelector<HTMLElement>('[role=option]')?.offsetHeight || 36;
      // Group headings count towards the available space; never expose more
      // than five option rows, even after scrolling past a heading.
      const desired = Math.min(popup.scrollHeight + border, rowHeight * 5 + padding + border);
      const below = Math.max(0, viewHeight - rect.bottom - 14);
      const above = Math.max(0, rect.top - 14);
      const upwards = below < desired && above > below;
      const maxHeight = Math.min(desired, upwards ? above : below);
      const width = Math.max(0, Math.min(rect.width, viewWidth - 16));
      const next = {left: Math.max(8, Math.min(rect.left, viewWidth - width - 8)),
        top: Math.max(8, Math.min(upwards ? rect.top - 6 - maxHeight : rect.bottom + 6, viewHeight - maxHeight - 8)),
        width, maxHeight};
      setPlacement(upwards ? 'top' : 'bottom');
      setPosition(previous => Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
    };
    place();
    const scroll = (e: Event) => { if (!menu.current?.contains(e.target as Node)) place(); };
    window.addEventListener('resize', place);
    document.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', scroll, true); };
  }, [mounted, open, options]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const other = (e: Event) => { if ((e as CustomEvent).detail !== id) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('gloaming-select-open', other);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('gloaming-select-open', other); window.removeEventListener('blur', blur); };
  }, [open, id]);
  useLayoutEffect(() => {
    if (!open || !revealActive.current) return;
    const row = menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    const parent = menu.current;
    if (row && parent) {
      if (row.offsetTop < parent.scrollTop) parent.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > parent.scrollTop + parent.clientHeight)
        parent.scrollTop = row.offsetTop + row.offsetHeight - parent.clientHeight;
    }
  }, [active, open, position.maxHeight, navigationVersion]);
  const choose = (index: number) => {
    if (!items[index]) return;
    onChange(items[index][0]); setOpen(false); trigger.current?.focus();
  };
  const keyDown = (e: KeyboardEvent) => {
    revealActive.current = true;
    if (e.key === 'Tab') { setOpen(false); return; }
    if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      setNavigationVersion(version => version + 1);
      if (!open) { show(); return; }
      if (e.key === 'Enter' || e.key === ' ') choose(active);
      else setActive(n => e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, n + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setNavigationVersion(version => version + 1);
      if (!open) show();
      const now = Date.now();
      search.current = {text: (now - search.current.time < 650 ? search.current.text : '') + e.key.toLowerCase(), time: now};
      const index = items.findIndex(([, text]) => text.toLowerCase().startsWith(search.current.text));
      if (index >= 0) setActive(index);
    }
  };
  let offset = 0;
  return <>
    <button ref={trigger} type="button" className={`ui-select ${className}`} role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={mounted ? id : undefined}
      aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled || !items.length}
      onKeyDown={keyDown} onBlur={() => setOpen(false)} onClick={() => open ? setOpen(false) : show()}>
      <span>{items[selected]?.[1] ?? value}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {mounted && <OverlayPortal><div ref={menu} id={id} role="listbox" aria-label={label}
      className="ui-select-menu" data-placement={placement} data-open={open} aria-hidden={!open} style={position}
      onMouseDown={e => e.preventDefault()}>
      {groups.map(g => <div key={g.group} role={g.group ? 'group' : undefined} aria-label={g.group || undefined}>
        {g.group && <div className="ui-select-group">{g.group}</div>}
        {g.options.map(([v, text]) => { const index = offset++; return <div key={v} id={`${id}-${index}`}
          role="option" aria-selected={v === value} data-index={index} data-active={active === index}
          className="ui-select-option" onPointerMove={() => {revealActive.current = false; setActive(index);}} onClick={() => choose(index)} title={text}>
          <span>{text}</span><span aria-hidden="true">{v === value ? '✓' : ''}</span>
        </div>; })}
      </div>)}
    </div></OverlayPortal>}
  </>;
}
