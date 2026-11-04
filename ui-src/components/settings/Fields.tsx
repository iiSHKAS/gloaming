import {useEffect, useId, useRef, useState, type ReactNode, type PointerEvent} from 'react';
import {api} from '../../lib/api';
import {t} from '../../lib/i18n';
import {IconFolder} from '../Icons';

/**
 * One setting: what it is on the left, the control on the right.
 *
 * `stack` puts the control underneath instead, for the ones that need the
 * whole width (track builder, textareas, the sound grid).
 */
/**
 * A note's tone is what makes it readable at a glance: `plain` reads as help
 * text, so a note that is only restating what the setting does does not shout
 * for attention the way an actual warning has to.
 */
export interface RowNote {
  text: string;
  tone?: 'plain' | 'accent' | 'warning';
}

export function Row({
  label,
  help,
  note,
  stack,
  children,
}: {
  label: string;
  help?: ReactNode;
  note?: RowNote | null;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="srow" data-stack={stack || undefined}>
      <div className="srow-label">
        <strong>{label}</strong>
        {help ? <span>{help}</span> : null}
        {note?.text ? (
          <span className="srow-note" data-tone={note.tone ?? 'plain'}>
            {note.text}
          </span>
        ) : null}
      </div>
      <div className="srow-control">{children}</div>
    </div>
  );
}

export {Toggle} from '../controls/Toggle';
import {Select as DropdownSelect, type SelectProps} from '../controls/Select';
import {Segmented} from '../controls/Segmented';

/** Few, short choices are shown side by side; longer lists stay a dropdown. */
const SEGMENT_MAX_OPTIONS = 3;
const SEGMENT_MAX_CHARACTERS = 34;

/**
 * The settings select. With up to three short options a dropdown only hides
 * what could simply be shown, so those render as a segmented control. Pass
 * `segmented={false}` for lists that are really data, such as audio devices.
 */
export function Select({segmented, ...props}: SelectProps & {segmented?: boolean}) {
  const flat = props.options.length > 0 && Array.isArray(props.options[0]);
  const options = props.options as [string, string][];
  const fits =
    flat &&
    options.length >= 2 &&
    options.length <= SEGMENT_MAX_OPTIONS &&
    options.reduce((sum, [, text]) => sum + text.length, 0) <= SEGMENT_MAX_CHARACTERS;
  if (segmented ?? fits) {
    return <Segmented value={props.value} onChange={props.onChange} options={options}
      disabled={props.disabled} label={props.label} />;
  }
  return <DropdownSelect {...props} />;
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  format,
  label,
  exact,
  id,
  fineStep,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  format: (value: number) => string;
  label: string;
  /** Lets the readout be clicked to type a value in whole units, for ranges
   * too long to land on an exact number by dragging: clip length steps 5 s
   * across half an hour, so 60 s sat between two pixels (#240). */
  exact?: boolean;
  id?: string;
  /** Shift-drag adjusts by this many units per pixel, relative to the current value. */
  fineStep?: number;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const drag = useRef<{x: number; value: number; fine: boolean} | null>(null);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const pointerValue = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return clamp(min + Math.round((rtl ? 1 - fraction : fraction) * (max - min) / step) * step);
  };
  // The filled portion is painted from a custom property so the track can be
  // one element rather than a stack of them.
  const filled = ((value - min) / (max - min)) * 100;
  const commit = () => {
    const next = Math.round(Number(typing));
    if (typing !== null && typing.trim() !== '' && Number.isFinite(next)) {
      onChange(Math.min(max, Math.max(min, next)));
    }
    setTyping(null);
  };
  return (
    <div className="slider">
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={fineStep ?? step}
        aria-label={label}
        style={{['--filled' as string]: `${Math.min(100, Math.max(0, filled))}%`}}
        onChange={e => onChange(Number(e.target.value))}
        onPointerDown={e => {
          if (fineStep === undefined || e.button !== 0 || !e.isPrimary) return;
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.setPointerCapture(e.pointerId);
          const next = e.shiftKey ? value : pointerValue(e);
          drag.current = {x: e.clientX, value: next, fine: e.shiftKey};
          if (next !== value) onChange(next);
        }}
        onPointerMove={e => {
          const previous = drag.current;
          if (!previous || fineStep === undefined) return;
          e.preventDefault();
          // Re-anchor when Shift changes, so switching precision never jumps.
          if (previous.fine !== e.shiftKey) {
            drag.current = {x: e.clientX, value: previous.value, fine: e.shiftKey};
            return;
          }
          const direction = getComputedStyle(e.currentTarget).direction === 'rtl' ? -1 : 1;
          const next = e.shiftKey
            ? clamp(previous.value + Math.round((e.clientX - previous.x) * direction) * fineStep)
            : pointerValue(e);
          if (next !== previous.value) {
            drag.current = {x: e.clientX, value: next, fine: e.shiftKey};
            onChange(next);
          }
        }}
        onPointerUp={e => {
          drag.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {drag.current = null;}}
        onLostPointerCapture={() => {drag.current = null;}}
        onKeyDown={e => {
          if (fineStep === undefined || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
          e.preventDefault();
          let direction = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1;
          if (['ArrowLeft', 'ArrowRight'].includes(e.key) && getComputedStyle(e.currentTarget).direction === 'rtl') direction *= -1;
          onChange(clamp(value + direction * (e.shiftKey ? fineStep : step)));
        }}
      />
      {!exact ? (
        <span className="slider-value mono">{format(value)}</span>
      ) : typing === null ? (
        <button
          type="button"
          className="slider-value slider-value-button mono"
          aria-label={t('settings.typeExact', {label})}
          title={t('settings.typeExact', {label})}
          onClick={() => setTyping(String(value))}>
          {format(value)}
        </button>
      ) : (
        <input
          type="number"
          className="slider-value slider-exact mono"
          aria-label={t('settings.typeExact', {label})}
          value={typing}
          min={min}
          max={max}
          step={1}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onChange={e => setTyping(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setTyping(null);
            }
          }}
        />
      )}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  label,
  mono,
  wide,
  type = 'text',
  disabled,
  min,
  max,
  step,
}: {
  value: string | number;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  mono?: boolean;
  wide?: boolean;
  disabled?: boolean;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  step?: number;
}) {
  const input = (
    <input
      className="text-input"
      data-mono={mono || undefined}
      data-wide={wide || undefined}
      type={type}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={e => onChange(e.target.value)}
    />
  );
  if (type !== 'number') return input;

  const nudge = (dir: 1 | -1) => {
    const amount = step ?? 1;
    const next = Math.round(((Number(value) || 0) + dir * amount) * 1000) / 1000;
    onChange(String(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next))));
  };
  return (
    <div className="num-field" data-disabled={disabled || undefined}>
      {input}
      <div className="num-steps">
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (max !== undefined && Number(value) >= max)}
          aria-label={`${label} +`}
          onClick={() => nudge(1)}>
          <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 5l4-4 4 4" /></svg>
        </button>
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled || (min !== undefined && Number(value) <= min)}
          aria-label={`${label} −`}
          onClick={() => nudge(-1)}>
          <svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
        </button>
      </div>
    </div>
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  label,
  rows = 3,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
  rows?: number;
}) {
  return (
    <textarea
      className="text-area mono"
      rows={rows}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      onChange={e => onChange(e.target.value)}
    />
  );
}

/** The five custom notification sounds, as a labelled grid. */
export function SoundGrid({
  fields,
  values,
  onChange,
}: {
  fields: ReadonlyArray<readonly [string, string, string]>;
  values: Record<string, string>;
  onChange: (key: string, next: string) => void;
}) {
  const id = useId();
  return (
    <div className="sound-grid">
      {fields.map(([key, labelKey, placeholder]) => (
        <label key={key} htmlFor={`${id}-${key}`}>
          <span>{t(labelKey)}</span>
          <input
            id={`${id}-${key}`}
            className="text-input"
            data-mono
            value={values[key] ?? ''}
            placeholder={placeholder}
            spellCheck={false}
            onChange={e => onChange(key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}


// One answer per page load: the desktop does not gain a portal while we run.
let folderPickerSupport: Promise<boolean> | null = null;
const folderPickerAvailable = () =>
  (folderPickerSupport ??= api.folderPickerAvailable().then(r => r.available, () => false));

/**
 * A path field that can also be filled from the desktop's folder chooser.
 * The Browse button only exists where the desktop can actually show one, so
 * nobody is offered a button that does nothing.
 */
export function FolderField({value, onChange, placeholder, label}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  label: string;
}) {
  const [canBrowse, setCanBrowse] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void folderPickerAvailable().then(ok => alive && setCanBrowse(ok));
    return () => {alive = false;};
  }, []);
  const browse = async () => {
    setBusy(true);
    try {
      const result = await api.pickFolder(label, value);
      if (result.path) onChange(result.path);
    } catch {
      // The chooser failing leaves the typed path alone.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="folder-field">
      <TextField label={label} wide value={value} placeholder={placeholder} onChange={onChange} />
      {canBrowse ? (
        <button type="button" className="btn btn-quiet folder-browse" disabled={busy} onClick={() => void browse()}
          title={t('settings.browseFolder')}>
          <IconFolder size={15} /> {busy ? t('settings.browsing') : t('settings.browse')}
        </button>
      ) : null}
    </div>
  );
}
