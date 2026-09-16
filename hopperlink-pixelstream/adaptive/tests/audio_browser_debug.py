"""Focused browser media diagnostic. Uses real AudioWorklet with synthetic PCM input."""
import json, pathlib, threading
from functools import partial
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[3]
requests=[]
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,fmt,*args): requests.append(fmt%args)
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root)))
threading.Thread(target=server.serve_forever,daemon=True).start()
with sync_playwright() as pw:
    b=pw.chromium.launch(headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    p=b.new_page();logs=[];p.on('console',lambda m:logs.append(m.type+': '+m.text));p.on('pageerror',lambda e:logs.append('ERROR '+str(e)))
    p.goto(f'http://127.0.0.1:{server.server_port}/hopperlink-pixelstream/index.html',wait_until='networkidle')
    result=p.evaluate('''async()=>{
      const out={};try{
      const c=new AudioContext();await c.resume();out.state=c.state;
      const begin=performance.now();await Promise.race([c.audioWorklet.addModule(new URL('./adaptive/audio-worklet.js',location.href)),new Promise((_,r)=>setTimeout(()=>r(Error('addModule timeout')),8000))]);out.loaded=performance.now()-begin;
      const n=new AudioWorkletNode(c,'hopper-audio-sampler');n.connect(c.destination);let received=0;n.port.onmessage=()=>received++;
      const o=c.createOscillator();o.frequency.value=2300;o.connect(n);o.start();await new Promise(r=>setTimeout(r,400));out.samples=received;o.stop();await c.close();
      }catch(e){out.error=e.message;}return out;
    }''')
    print(json.dumps({'audio':result,'requests':requests,'logs':logs},ensure_ascii=False,indent=2));b.close()
server.shutdown()
if result.get('error') or result.get('samples',0)==0: raise SystemExit(1)
