import {useRef} from 'react';
import {useStore} from '../state/store';
import {IconMark, IconSettings, IconImages, IconEditor, IconAbout, IconMore} from './Icons';
import {t} from '../lib/i18n';
export function StudioNav({onShowTutorial,onShowUpdate,onShowWhatsNew}: {onShowTutorial:()=>void;onShowUpdate:()=>void;onShowWhatsNew?:()=>void}) {
  const {state,dispatch}=useStore();
  const menu=useRef<HTMLDetailsElement>(null);
  const go=(view: typeof state.view)=>{dispatch({type:'setView',view,playlistId:null});if(menu.current)menu.current.open=false;};
  return <header className="studio-header">
    <button className="studio-brand" onClick={()=>go('home')} aria-label="GLOAMING home"><IconMark size={42}/><span className="studio-brand-name">GLOAMING</span></button>
    <nav className="studio-nav" aria-label={t('nav.main')}>
      <button aria-current={state.view==='home'?'page':undefined} onClick={()=>go('home')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>Capture</button>
      <button aria-current={['clips','images'].includes(state.view)?'page':undefined} onClick={()=>go('clips')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Library</button>
      <button aria-current={state.view==='editor'?'page':undefined} onClick={()=>go('editor')}><IconEditor/>{t('nav.editor')}</button>
    </nav>
    <div className="studio-header-right"><span className="studio-badge">CAPTURE STUDIO</span>
      <button className="studio-icon" aria-label={t('settings.title')} aria-current={state.view==='settings'?'page':undefined} onClick={()=>go('settings')}><IconSettings/></button>
      <details ref={menu} className="studio-more" onKeyDown={e=>{if(e.key==='Escape'&&menu.current){menu.current.open=false;menu.current.querySelector('summary')?.focus();}}}><summary aria-label="More tools"><IconMore/></summary><div>
        <button onClick={()=>go('images')}><IconImages/>{t('nav.images')}</button>
        <button onClick={()=>go('about')}><IconAbout/>{t('nav.about')}</button>
        <button onClick={onShowTutorial}>Getting started</button><button onClick={onShowUpdate}>Check for updates</button>
        {onShowWhatsNew&&<button onClick={onShowWhatsNew}>What's new</button>}
      </div></details>
    </div>
  </header>;
}
