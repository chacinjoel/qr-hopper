"""Real DOM/canvas/video/WebAudio/AudioWorklet loopback; NOT physical phone proof."""
import json, os, pathlib, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('HOPPER_PROOF_DIR','adaptive-proof'));OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}/hopperlink-pixelstream'
proof={'hardware':False,'tests':[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,**({'executable_path':os.environ['CHROMIUM_EXECUTABLE']} if os.environ.get('CHROMIUM_EXECUTABLE') else {}),args=['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding'])
    ctx=browser.new_context(viewport={'width':1000,'height':980},device_scale_factor=1)
    page=ctx.new_page();errors=[];bad=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda r:bad.append((r.url,r.status)) if r.status>=400 and 'favicon' not in r.url else None)
    try:
        page.goto(BASE+'/adaptive/tests/harness.html',wait_until='networkidle')
        a=page.frame(name='sender');b=page.frame(name='receiver')
        a.wait_for_function('window.__hopperBootOK');b.wait_for_function('window.__hopperBootOK')
        assert not errors,errors
        proof['tests'].append('both production HTML/module trees boot without JavaScript errors')
        assert a.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert b.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        page.evaluate('''() => {
          const a=frames.sender,b=frames.receiver;
          const canvas=a.document.getElementById('txCanvas'),video=canvas.captureStream(30);
          window.captureClock=setInterval(()=>{canvas.getContext('2d').drawImage(canvas,0,0);video.getVideoTracks()[0].requestFrame?.();},33);
          Object.defineProperty(b.navigator.mediaDevices,'getUserMedia',{value:async c=>{if(c.video)return video;throw Error('Receiver should not request microphone');}, configurable:true});
        }''')
        b.locator('[data-tab=receive]').click();b.locator('#cameraBtn').click()
        b.wait_for_function("document.querySelector('#cameraBtn').textContent==='Apagar cámara'")
        page.evaluate('''() => {
          const a=frames.sender,b=frames.receiver,ac=b.hopperAdaptive.sound.context;
          const dest=ac.createMediaStreamDestination(),make=ac.createBufferSource.bind(ac);
          ac.createBufferSource=()=>{const s=make(),connect=s.connect.bind(s);s.connect=(node,...args)=>connect(node===ac.destination?dest:node,...args);return s;};
          Object.defineProperty(a.navigator.mediaDevices,'getUserMedia',{value:async c=>{if(c.audio)return dest.stream;throw Error('Unexpected video request in acoustic test');},configurable:true});
          window.audioEvents=[];window.features=[];
          const snd=b.hopperAdaptive.sound,listen=a.hopperAdaptive.sound,send=snd.send.bind(snd),got=listen.onPacket,push=listen.decoder.push.bind(listen.decoder);
          snd.send=async (...args)=>{window.audioEvents.push({kind:'send',t:performance.now(),packet:args[0],busy:snd.busy});const ok=await send(...args);window.audioEvents.push({kind:'sent',t:performance.now(),ok});return ok;};
          listen.onPacket=p=>{window.audioEvents.push({kind:'got',t:performance.now(),packet:p});return got(p);};
          listen.decoder.push=(t,f)=>{window.features.push({t,f});if(window.features.length>24000)window.features.shift();push(t,f);};
        }''')
        a.locator('#fileInput').set_input_files({'name':'prueba <literal> 🪐.png','mimeType':'image/png','buffer':bytes((i*37+i//5)%256 for i in range(18000))})
        a.locator('#prepareBtn').click();a.wait_for_function("!document.querySelector('#calibrateBtn').disabled")
        a.locator('#calibrateBtn').click()
        a.wait_for_function("window.hopperAdaptive.sender?.state==='ready'",timeout=150000)
        proof['negotiated']=a.evaluate('({profile:hopperAdaptive.sender.selected,band:hopperAdaptive.sender.audioBand,round:hopperAdaptive.sender.round})')
        assert proof['negotiated']['band']>=0,proof['negotiated']
        assert proof['negotiated']['round']==2
        assert not errors,errors
        proof['tests'].append('calibration through captured sender canvas -> receiver video -> decoder -> real generated PCM -> AudioWorklet -> profile REPORT and READY')
        a.locator('#startTxBtn').click()
        b.wait_for_function("document.querySelector('#downloadPercent').textContent==='100.0%'",timeout=80000)
        a.wait_for_function("window.hopperAdaptive.tx?.confirmed===true",timeout=30000)
        assert 'SHA-256 OK' in b.locator('#receivedFile').inner_text()
        assert b.locator('#receivedFile literal').count()==0
        assert not a.evaluate('hopperAdaptive.tx.running')
        proof['tests'].append('file bytes -> FEC -> SHA-256 -> acoustic COMPLETE bound to same session -> sender queue stops')
        proof['download']=b.evaluate('hopperAdaptive.download.metrics()')
        proof['tx']=a.evaluate('({sent:hopperAdaptive.tx.position,total:hopperAdaptive.tx.queue.length,confirmed:hopperAdaptive.tx.confirmed})')
        qr=b.evaluate('''async()=>{
          const {reportQR}=await import('./adaptive/qr.js');
          const c=document.createElement('canvas'),r=hopperAdaptive.receiver.report,s=reportQR(c,r),im=c.getContext('2d').getImageData(0,0,c.width,c.height);
          return {same:jsQR(im.data,im.width,im.height)?.data===s,length:s.length};
        }''')
        assert qr['same'],qr
        proof['tests'].append('static report QR generated and decoded locally, with session and CRC')
        b.locator('#downloadName').scroll_into_view_if_needed();page.screenshot(path=str(OUT/'paired-success.png'))
        proof['errors']=errors;proof['http_failures']=bad;assert not errors and not bad,(errors,bad)
    except Exception as e:
        proof['failure']=str(e)
        try:
            proof['audioEvents']=page.evaluate('window.audioEvents')
            (OUT/'features.json').write_text(json.dumps(page.evaluate('window.features')))
            proof['sender_state']=a.evaluate('({state:hopperAdaptive.sender?.state,round:hopperAdaptive.sender?.round,band:hopperAdaptive.sender?.audioBand,log:document.querySelector("#diagnostics").textContent})')
            proof['receiver_state']=b.evaluate('({sid:hopperAdaptive.receiver.sid,report:hopperAdaptive.receiver.report,log:document.querySelector("#diagnostics").textContent,state:document.querySelector("#rxCalState").textContent})')
            page.screenshot(path=str(OUT/'failure.png'))
        except Exception: pass
        raise
    finally:
        (OUT/'result.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf8')
        print(json.dumps(proof,ensure_ascii=False,indent=2));browser.close();server.shutdown()
