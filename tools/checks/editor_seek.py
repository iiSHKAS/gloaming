"""Real WebKit editor seek check. Run with host project Python and an H.264 clip.
Builds a temporary editor bundle; serves read-only media and a disposable project.
"""
import asyncio
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
from unittest.mock import patch

from aiohttp import web
from gloaming import share
from gloaming.media import probe_media

ROOT = Path(__file__).resolve().parents[2]
CLIP = Path(sys.argv[1]).resolve()
RESULT = {}

HTML = '''<!doctype html><html><style>
#stageWrap {width:320px;height:180px} #stage {width:320px;height:180px;position:relative}
video {position:absolute;width:320px;height:180px} .ed-vhide{visibility:hidden}
</style><body><div id="stageWrap"><div id="stage"></div></div>
<div id="timelineScroll"><div id="timelineCanvas"></div></div><div id="libraryScroll"></div><div id="fadeOverlay"></div>
<script>window.process={env:{NODE_ENV:"production"}};window.onerror=(message,source,line)=>{fetch("/diagnostic",{method:"POST",body:JSON.stringify({message,source,line})});};</script><script src="/editor.js"></script><script>
const allAudio=[]; const NativeAudio=window.Audio;
// Model a decoder which only advertises its current frame while paused.
// This must still be allowed to start, without requiring future buffered data.
let currentDataOnly=false;
const readyState=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState').get;
Object.defineProperty(HTMLMediaElement.prototype,'readyState',{get(){
 const actual=readyState.call(this);return currentDataOnly&&this.paused?Math.min(actual,2):actual;
}});
window.Audio=function(){const a=new NativeAudio(); a.muted=true; allAudio.push(a); return a;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label)=>{for(let n=0;n<300;n++){if(fn())return;await delay(100);}throw Error(label);};
(async()=>{
const clip=await (await fetch('/clip-meta')).json();
const engine=EditorCheck.createEditorEngine({clips:()=>[clip],notify:msg=>console.log(msg),accent:()=> '#0099ff'});
await engine.load();
engine.mount(Object.fromEntries(['stage','stageWrap','timelineCanvas','timelineScroll','libraryScroll','fadeOverlay'].map(id=>[id,document.getElementById(id)])));
const snapshots=[];
const check=async(target,whilePlaying)=>{
 engine.setPlaying(whilePlaying); if(whilePlaying)await delay(500); engine.seek(target);
 if(!whilePlaying){await wait(()=>!engine.snapshot().preparing,'paused seek never became ready');engine.setPlaying(true);}
 await wait(()=>engine.snapshot().playhead>target+2 && !engine.snapshot().preparing && allAudio.filter(a=>!a.paused).length===clip.audio_streams,'playback did not resume with all streams after seek');
 const state=engine.snapshot();
 const times=allAudio.filter(a=>!a.paused).map(a=>a.currentTime);
 if(times.length!==clip.audio_streams)throw Error('not all audio streams playing: '+times.length);
 const drift=Math.max(...times.map(t=>Math.abs(t-state.playhead)));
 if(drift>0.2)throw Error('audio drift '+drift);
 snapshots.push({target,whilePlaying,playhead:state.playhead,drift});
 engine.setPlaying(false);
};
await check(clip.duration*0.65,false);
await check(clip.duration*0.35,true);
engine.seek(clip.duration*0.6);engine.seek(clip.duration*0.2);engine.seek(clip.duration*0.7);
await check(clip.duration*0.7,false);
currentDataOnly=true;
await check(clip.duration*0.5,false);
engine.destroy();
await fetch('/result',{method:'POST',body:JSON.stringify({ok:true,snapshots})});
})().catch(async error=>{await fetch('/result',{method:'POST',body:JSON.stringify({ok:false,error:String(error),audio:allAudio.map(a=>({time:a.currentTime,ready:a.readyState,seeking:a.seeking,paused:a.paused}))})});});
</script></body></html>'''

with tempfile.TemporaryDirectory(prefix='gloaming-editor-seek-') as work:
    work = Path(work)
    node = Path.home()/'.local/share/gloaming-dev/node/bin/node'
    code = "import {build} from 'vite'; await build({configFile:false,logLevel:'error',build:{outDir:process.argv[1],emptyOutDir:false,lib:{entry:'ui-src/engine/editor.ts',name:'EditorCheck',formats:['iife'],fileName:()=> 'editor.js'}}});"
    subprocess.run([str(node), '--input-type=module', '-e', code, str(work)], cwd=ROOT, check=True)
    ready = queue.Queue()
    async def serve():
        meta = await probe_media(CLIP)
        assert meta and meta['audio_streams']
        with patch.object(share, 'PROXY_DIR', work):
            audio = [await share._make_audio_preview(CLIP, i) for i in range(meta['audio_streams'])]
        tracks = [dict(id='T1',type='text',label='T1'),dict(id='V1',type='video',label='V1')]
        items = [dict(id='video',kind='clip',trackId='V1',clipId='test',start=0,dur=meta['duration'],offset=0,muted=True)]
        for i in range(len(audio)):
            tracks.append(dict(id=f'A{i}',type='audio',label=f'A{i}'))
            items.append(dict(id=f'audio{i}',kind='audio',trackId=f'A{i}',clipId='test',start=0,dur=meta['duration'],offset=0,audioStream=i,volume=1))
        async def project(req): return web.json_response(dict(project=dict(version=1,tracks=tracks,items=items)))
        async def index(req): return web.Response(text=HTML,content_type='text/html')
        async def script(req): return web.FileResponse(work/'editor.js')
        async def video(req): return web.FileResponse(CLIP)
        async def sound(req): return web.FileResponse(audio[int(req.match_info['index'])])
        async def clipmeta(req):
            return web.json_response(dict(slug='test',name=CLIP.name,video_url='/video?v=test',thumb_url='',size=CLIP.stat().st_size,
                duration=meta['duration'],width=meta['width'],height=meta['height'],vcodec=meta['vcodec'],audio_streams=len(audio)))
        async def diagnostic(req):
            print('WebKit:',await req.text(),flush=True)
            return web.Response(text='ok')
        async def result(req):
            RESULT.update(json.loads(await req.text()))
            GLib.idle_add(Gtk.main_quit)
            return web.Response(text='ok')
        app=web.Application()
        app.router.add_get('/',index); app.router.add_get('/editor.js',script)
        app.router.add_get('/api/editor/project',project); app.router.add_get('/video',video)
        app.router.add_get('/api/clips/test/audio/{index}',sound)
        app.router.add_post('/diagnostic',diagnostic);app.router.add_get('/clip-meta',clipmeta); app.router.add_post('/result',result)
        runner=web.AppRunner(app);await runner.setup()
        site=web.TCPSite(runner,'127.0.0.1',0);await site.start()
        ready.put(site._server.sockets[0].getsockname()[1])
        try: await asyncio.Event().wait()
        finally: await runner.cleanup()
    # Import GTK only after the temporary bundle has built.
    import gi
    gi.require_version('Gtk','3.0');gi.require_version('WebKit2','4.1')
    from gi.repository import Gtk, WebKit2, GLib
    threading.Thread(target=lambda:asyncio.run(serve()),daemon=True).start()
    port=ready.get(timeout=60)
    view=WebKit2.WebView()
    view.get_settings().set_media_playback_requires_user_gesture(False)
    window=Gtk.Window(title='Gloaming editor seek check');window.set_default_size(340,240)
    window.add(view);window.show_all()
    view.load_uri(f'http://127.0.0.1:{port}/')
    GLib.timeout_add_seconds(110,lambda:(Gtk.main_quit(),False)[1])
    Gtk.main();window.destroy()
    print(json.dumps(RESULT or {'ok':False,'error':'WebKit test timed out'},indent=2))
    sys.exit(0 if RESULT.get('ok') else 1)
