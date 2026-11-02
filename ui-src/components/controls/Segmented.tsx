import {useRef, type CSSProperties, type KeyboardEvent} from 'react';

type Option = [string, string];

/**
 * A few choices side by side, one highlight sliding between them.
 *
 * For settings with two or three short options, where a dropdown only hides
 * what could simply be shown. Arrow keys move the selection, as in any radio
 * group.
 */
export function Segmented({value, onChange, options, disabled, label}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  disabled?: boolean;
  label: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const known = options.some(([v]) => v === value);
  const index = Math.max(0, options.findIndex(([v]) => v === value));
  const move = (event: KeyboardEvent, step: number) => {
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next][0]);
    requestAnimationFrame(() => group.current?.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus());
  };
  return (
    <div ref={group} className="segmented" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}
      data-none={known ? undefined : true}
      style={{'--seg-count': options.length, '--seg-index': index} as CSSProperties}
      onKeyDown={event => {
        const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
        if (event.key === 'ArrowRight') move(event, rtl ? -1 : 1);
        else if (event.key === 'ArrowLeft') move(event, rtl ? 1 : -1);
        else if (event.key === 'ArrowDown') move(event, 1);
        else if (event.key === 'ArrowUp') move(event, -1);
      }}>
      {options.map(([optionValue, text], i) => (
        <button key={optionValue} type="button" role="radio" aria-checked={known && i === index}
          tabIndex={i === index ? 0 : -1} disabled={disabled} onClick={() => onChange(optionValue)}>
          {text}
        </button>
      ))}
    </div>
  );
}
