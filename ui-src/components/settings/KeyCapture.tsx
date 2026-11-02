import {useEffect, useState} from 'react';

import {MOD_CODES, codeToEvdev, comboFromEvent} from '../../lib/hotkeyCapture';
import {t} from '../../lib/i18n';
import {hotkeyLabel} from '../../lib/format';

/**
 * Click, then press the combo you want. A lone modifier only arms it, so
 * Alt+F9 is reachable; Escape leaves the binding alone.
 */
export function KeyCapture({
  value,
  onCapture,
  onUnsupported,
  compact,
  disabled,
  label,
}: {
  value: string;
  onCapture: (evdev: string) => void;
  onUnsupported: () => void;
  compact?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const [listening, setListening] = useState(false);
  const display = value ? hotkeyLabel(value) : t('keyCapture.setKey');

  useEffect(() => {
    if (!listening || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (MOD_CODES.has(e.code)) return;
      if (e.code === 'Escape') {
        setListening(false);
        return;
      }
      const main = codeToEvdev(e.code);
      if (!main) {
        onUnsupported();
        return;
      }
      setListening(false);
      onCapture(comboFromEvent(e, main));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [listening, disabled, onCapture, onUnsupported]);

  return (
    <button
      type="button"
      className="key-capture mono"
      data-listening={listening || undefined}
      data-compact={compact || undefined}
      disabled={disabled}
      aria-label={`${label ? `${label}: ` : ''}${listening ? t('keyCapture.pressKey') : display}`}
      aria-pressed={listening}
      title={listening ? 'Escape to cancel' : label}
      onBlur={() => setListening(false)}
      onClick={() => setListening(current => !current)}>
      {listening ? <span role="status">{t('keyCapture.pressKey')}</span> : value ?
        <span className="shortcut-keycaps" aria-hidden="true">
          {display.split(' + ').map((key, index) => <span className="shortcut-key-part" key={`${index}-${key}`}>
            {index > 0 && <span className="shortcut-plus">+</span>}
            <kbd className="shortcut-key">{key}</kbd>
          </span>)}
        </span> : t('keyCapture.setKey')}
    </button>
  );
}
