import {useState} from 'react';
import {useStore} from '../state/store';
import {t} from '../lib/i18n';
import {KeyCapture} from './settings/KeyCapture';

/** The same live binding editor beside every quick-save action. */
export function ClipShortcut() {
  const {hotkey, saveConfig, notify} = useStore();
  const [saving, setSaving] = useState(false);
  const save = async (clip: string) => {
    setSaving(true);
    try {
      const result = await saveConfig({hotkeys: {clip}});
      if (result.applied === false) {
        notify({kind: 'info', title: 'Shortcut saved', detail: result.warning || 'The shortcut is pending application.', tone: 'neutral', holdMs: 5000});
      } else {
        notify({kind: 'info', title: 'Clip shortcut updated', tone: 'accent', holdMs: 2500});
      }
    } catch (error) {
      notify({kind: 'error', title: t('settings.errSaveKey'), detail: String(error), tone: 'error', holdMs: 5000});
    } finally { setSaving(false); }
  };
  return <div className="clip-shortcut">
    <span className="clip-shortcut-label">{saving ? 'Saving…' : 'Save shortcut'}<span aria-hidden="true">↗</span></span>
    <KeyCapture value={hotkey} label="Change save clip shortcut" disabled={saving}
      onCapture={key => void save(key)}
      onUnsupported={() => notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})}/>
  </div>;
}
