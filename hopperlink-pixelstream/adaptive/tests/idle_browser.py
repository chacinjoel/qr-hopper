"""Idle acquisition and video-frame identity regressions (synthetic input, real APIs)."""
import json, pathlib, threading, os
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path('idle-proof');OUT.mkdir(exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
proof={'hardware':False,'tests':[]}
with sync_playwright() as pw:
    opts={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('CHROMIUM_PATH'):opts['executable_path']=os.environ['CHROMIUM_PATH']
    b=pw.chromium.launch(**opts);p=b.new_page(viewport={'width':390,'height':844});errors=[]
    p.on('pageerror',lambda e:errors.append(str(e)))
    try:
        p.goto(f'http://127.0.0.1:{server.server_port}/hopperlink-pixelstream/');p.wait_for_function('window.__hopperBootOK')
        p.evaluate('''async()=>{
          const {render}=await import('./adaptive/optics.js?v=rxfix2');
          const {bootstrap,controlBytes}=await import('./adaptive/protocol.js?v=rxfix2');
          const source=document.createElement('canvas'),scene=document.createElement('canvas');scene.width=600;scene.height=1000;
          const ctx=scene.getContext('2d');let packet=null,blank=false;
          const draw=()=>{ctx.fillStyle='#19212c';ctx.fillRect(0,0,600,1000);if(!blank){render(source,packet,bootstrap,341);ctx.save();ctx.translate(300,500);ctx.rotate(-.035);ctx.drawImage(source,-232,-348,464,696);ctx.restore();}};
          draw();const stream=scene.captureStream(20);window.clock=setInterval(draw,55);
          window.blank=flag=>{blank=flag;draw();};
          window.hello=()=>{packet={kind:2,payload:controlBytes({op:'hello',sid:341,epoch:1,serial:1,audio:-1,mode:'quick'})};draw();};
          Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>stream,configurable:true});
        }''')
        p.locator('[data-tab="receive"]').click();p.locator('#rxSound').uncheck();p.locator('#cameraBtn').click()
        p.wait_for_function("document.querySelector('#captureState').textContent.includes('Área detectada')",timeout=10000)
        assert p.evaluate('hopperAdaptive.tracker.stats.valid')==0
        assert p.evaluate('hopperAdaptive.receiver.sid')==0
        proof['tests'].append('Idle large beacons show area without inventing headers, session or file progress')
        p.evaluate('''()=>{const t=hopperAdaptive.tracker,v=document.querySelector('#rxVideo'),original=v.requestVideoFrameCallback.bind(v);t.stop();Object.defineProperty(v,'requestVideoFrameCallback',{value:cb=>original((now,m)=>cb(now,{...m,mediaTime:0})),configurable:true});t.start();}''')
        count=p.evaluate('hopperAdaptive.tracker.stats.capture');p.wait_for_function(f'hopperAdaptive.tracker.stats.capture>{count+5}',timeout=5000)
        proof['tests'].append('New presentedFrames are processed with constant mediaTime')
        p.evaluate('blank(true)');p.wait_for_function("document.querySelector('#lockState').textContent==='Área: 0%'",timeout=5000)
        p.evaluate('blank(false);hello()');p.wait_for_function('hopperAdaptive.receiver.sid===341 && hopperAdaptive.tracker.stats.valid>0',timeout=10000)
        proof['tests'].append('Occlusion loses area; returning control pattern joins session with valid CRC')
        assert not errors,errors
        p.locator('#captureState').scroll_into_view_if_needed();p.screenshot(path=str(OUT/'receiver.png'))
        proof['stats']=p.evaluate('hopperAdaptive.tracker.stats');proof['errors']=errors
    except Exception as e:
        proof['failure']=str(e);p.screenshot(path=str(OUT/'failure.png'));raise
    finally:
        (OUT/'result.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2));b.close();server.shutdown()
