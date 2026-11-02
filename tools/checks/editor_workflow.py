"""Export parity for source lane mute and project-owned controller settings."""
import array
from pathlib import Path
import subprocess
import tempfile
import unittest
from gloaming.editor import Source, validate_project, build_export_cmd

class EditorWorkflowTests(unittest.TestCase):
    def test_project_autosave_preserves_input_settings(self):
        import asyncio
        from unittest.mock import AsyncMock
        from gloaming.share import ShareServer
        from gloaming.editor import EditorProjectStore
        with tempfile.TemporaryDirectory() as tmp:
            server=ShareServer.__new__(ShareServer)
            server.editor_project=EditorProjectStore(Path(tmp)/'project.json')
            raw={'version':1,'tracks':[],'items':[],'keyboard':False,'controller':{'enabled':True,'position':[.3,.2]}}
            response=asyncio.run(server._api_editor_save_project(AsyncMock(json=AsyncMock(return_value=raw))))
            self.assertEqual(response.status,200)
            self.assertEqual(server.editor_project.load(),raw)

    def test_track_mute_reaches_real_export_and_controller_survives_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);source=root/'source.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=black:s=320x240:r=20:d=1',
                '-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',str(source)],check=True)
            sources={'s':Source(source,1,320,240,True,1)}
            raw={'version':1,'tracks':[{'id':'t','type':'text','label':'Text'},{'id':'v','type':'video','label':'Video'},
                {'id':'a','type':'audio','label':'Microphone source','muted':False}],
                'controller':{'enabled':False,'position':[.2,.3]},'keyboard':True,
                'items':[{'id':'v1','kind':'clip','trackId':'v','clipId':'s','start':0,'dur':1,'offset':0,'muted':True},
                         {'id':'a1','kind':'audio','trackId':'a','clipId':'s','start':0,'dur':1,'offset':0,'audioStream':0}]}
            energy=[]
            for mute in (False,True):
                raw['tracks'][2]['muted']=mute
                project,errors=validate_project(raw,sources);self.assertEqual(errors,[])
                self.assertEqual(project['controller'],raw['controller'])
                self.assertTrue(project['keyboard'])
                self.assertEqual(project['tracks'][2]['label'],'Microphone source')
                out=root/f'{mute}.mp4';subprocess.run(build_export_cmd(project,sources,out),check=True,capture_output=True)
                pcm=subprocess.check_output(['ffmpeg','-v','error','-i',str(out),'-vn','-f','s16le','-'])
                samples=array.array('h');samples.frombytes(pcm);energy.append(sum(abs(s) for s in samples)/len(samples))
            self.assertGreater(energy[0],100);self.assertLess(energy[1],1)

if __name__=='__main__':unittest.main()
