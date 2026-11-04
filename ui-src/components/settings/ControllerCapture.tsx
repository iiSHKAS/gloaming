import {useEffect, useRef, useState} from 'react';
import {ButtonGlyph, type PadLayout} from '../ControllerGlyph';
import {t} from '../../lib/i18n';

type Capture = {token: string; combo: string; devices: string[]; pressed: string[]; layout?: PadLayout; error?: string};
const request = async (body: object): Promise<Capture> => {
  const response = await fetch('/api/controller/capture', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(response.status===404) throw new Error('Restart Gloaming to load controller support.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not read controller');
  return data;
};

export function ControllerCapture({value,onCapture}: {value:string;onCapture:(value:string)=>void}) {
  const [listening,setListening] = useState(false);
  const [pressed,setPressed] = useState<string[]>([]);
  const [hint,setHint] = useState('');
  const [layout,setLayout] = useState<PadLayout>('xbox');
  useEffect(()=>{
    void fetch('/api/controller',{cache:'no-store'}).then(r=>r.ok?r.json():undefined).then(d=>{if(d?.layout)setLayout(d.layout);}).catch(()=>{});
  },[]);
  const session = useRef<{cancelled:boolean;token?:string} | undefined>(undefined);
  const cancel = () => {
    const current=session.current;
    if(current) {
      current.cancelled=true;
      if(current.token) void request({token:current.token,stop:true}).catch(()=>{});
    }
    session.current=undefined;
    setListening(false);
  };
  useEffect(()=>()=>{const current=session.current;if(current){current.cancelled=true;if(current.token)void request({token:current.token,stop:true}).catch(()=>{});}},[]);
  useEffect(()=>{
    if(!listening)return;
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}};
    window.addEventListener('keydown',key);
    return ()=>window.removeEventListener('keydown',key);
  },[listening]);
  const capture = async () => {
    if(listening){cancel();return;}
    const current:{cancelled:boolean;token?:string}={cancelled:false};
    session.current=current;setListening(true);setPressed([]);setHint('Connecting to your controller…');
    const deadline=Date.now()+30000;
    try {
      while(!current.cancelled && Date.now()<deadline){
        const state=await request(current.token?{token:current.token}:{});
        current.token=state.token;
        if(current.cancelled){void request({token:state.token,stop:true}).catch(()=>{});return;}
        setPressed(state.pressed);if(state.layout)setLayout(state.layout);
        setHint(state.devices.length ? t('ui.holdButtons', {devices: state.devices.join(', ')}) : t('ui.noReadableControllerConnectA'));
        if(state.combo){
          await request({token:state.token,stop:true});
          if(current.cancelled)return;
          onCapture(state.combo);setHint('');return;
        }
        await new Promise(resolve=>setTimeout(resolve,120));
      }
      if(!current.cancelled)setHint('Assignment timed out. Click to try again.');
    } catch(error){if(!current.cancelled)setHint(String(error instanceof Error?error.message:error));}
    finally {
      if(session.current===current){cancel();}
    }
  };
  const buttons=listening?pressed:value.split('+').filter(Boolean);
  return <div className="controller-binding">
    <div className="key-pair">
      <button type="button" className="key-capture mono controller-capture" data-listening={listening&&!buttons.length||undefined} aria-label={listening?t('ui.listeningForControllerButtons'):t('ui.assignControllerShortcut')} aria-pressed={listening} onClick={()=>void capture()}>
        {buttons.length ? <span className="shortcut-keycaps">{buttons.map((name,index)=><span className="shortcut-key-part" key={name}>{index>0&&<span className="shortcut-plus">+</span>}<ButtonGlyph button={name} layout={layout}/></span>)}</span> : listening?t('ui.pressControllerButtons'):t('ui.assignControllerButtons')}
      </button>
      {listening?<button type="button" className="btn btn-quiet btn-sm" onClick={cancel}>{t('ui.cancel')}</button>:value&&<button type="button" className="btn btn-quiet btn-sm" onClick={()=>{setHint('');onCapture('');}}>{t('ui.clear')}</button>}
    </div>
    {hint&&<small role="status">{hint}</small>}
  </div>;
}

export function ControllerStatus() {
  const [devices,setDevices]=useState<string[]>([]);
  const [message,setMessage]=useState(t('ui.checkingController'));
  useEffect(()=>{
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{
        const response=await fetch('/api/controller',{cache:'no-store'});
        if(!response.ok)throw new Error(response.status===404?t('ui.restartGloamingToLoadController'):t('ui.couldNotReadControllerStatus'));
        const data=await response.json() as {devices:string[]};
        if(active){setDevices(data.devices);setMessage(data.devices.length?t('ui.connectedChooseAnActionBelow'):t('ui.noControllerDetectedConnectYour'));}
      }catch(error){if(active){setDevices([]);setMessage(error instanceof Error?error.message:String(error));}}
      if(active)timer=setTimeout(poll,2000);
    };
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[]);
  return <div className="controller-status" data-connected={devices.length>0} role="status">
    <span className="controller-connection-dot" aria-hidden="true"/>
    <div><strong>{devices.length?devices.join(' · '):t('ui.controllerConnection')}</strong><small>{message}</small></div>
  </div>;
}
