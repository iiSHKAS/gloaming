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
        notify({kind: 'info', title: t('ui.shortcutSaved'), detail: result.warning || t('ui.shortcutPending'), tone: 'neutral', holdMs: 5000});
      } else {
        notify({kind: 'info', title: t('ui.clipShortcutUpdated'), tone: 'accent', holdMs: 2500});
      }
    } catch (error) {
      notify({kind: 'error', title: t('settings.errSaveKey'), detail: String(error), tone: 'error', holdMs: 5000});
    } finally { setSaving(false); }
  };
  return <div className="clip-shortcut">
    <span className="clip-shortcut-label">{saving ? t('ui.saving') : t('ui.saveShortcut')}<span aria-hidden="true">↗</span></span>
    <KeyCapture value={hotkey} label={t('ui.changeSaveClipShortcut')} disabled={saving}
      onCapture={key => void save(key)}
      onUnsupported={() => notify({kind: 'error', title: t('settings.keyUnsupported'), tone: 'error', holdMs: 4000})}/>
  </div>;
}
