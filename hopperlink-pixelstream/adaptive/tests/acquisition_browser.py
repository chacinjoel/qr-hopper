"""Acquisition regressions through real video/canvas APIs; not a physical-camera test."""
import json, os, pathlib, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[3]
OUT=pathlib.Path(os.environ.get('HOPPER_PROOF_DIR','acquisition-proof'));OUT.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE=f'http://127.0.0.1:{server.server_port}/hopperlink-pixelstream/'
proof={'hardware':False,'tests':[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    errors=[];bad=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('response',lambda r:bad.append([r.url,r.status]) if r.status>=400 else None)
    try:
        page.goto(BASE,wait_until='networkidle');page.wait_for_function('window.__hopperBootOK')
        page.evaluate('''async()=>{
          const {render}=await import('./adaptive/optics.js?v=rxfix1');
          const {bootstrap,controlBytes,profile}=await import('./adaptive/protocol.js?v=rxfix1');
          const {createTrial}=await import('./adaptive/calibration.js?v=rxfix1');
          const src=document.createElement('canvas'),scene=document.createElement('canvas');scene.width=720;scene.height=1280;
          const ctx=scene.getContext('2d',{willReadFrequently:true});let video=scene.captureStream(20);
          let image={kind:2,payload:controlBytes({op:'trial',sid:141,epoch:1,serial:2,pid:1,round:0,audio:-1})},p=bootstrap,seq=0,total=1,length=1;
          let state={angle:0,x:0,y:0,gain:1,offset:0,blank:false};
          window.paintTest=changes=>{
            Object.assign(state,changes);ctx.fillStyle='#13161b';ctx.fillRect(0,0,720,1280);
            if(!state.blank){render(src,image,p,141,seq,total,length);ctx.save();ctx.translate(360+state.x,640+state.y);ctx.rotate(state.angle*Math.PI/180);ctx.drawImage(src,-224,-336,448,672);ctx.restore();}
            if(state.gain!==1||state.offset){const im=ctx.getImageData(0,0,720,1280);for(let i=0;i<im.data.length;i+=4)for(let k=0;k<3;k++)im.data[i+k]=Math.round(im.data[i+k]*state.gain+state.offset);ctx.putImageData(im,0,0);}
            video.getVideoTracks()[0].requestFrame?.();
          };
          window.testProfile=pid=>{const t=createTrial(141,pid,0);p=t.p;image={...t.transport.frames[0],kind:3,round:0};total=t.transport.frames.length;length=t.transport.streamLength;paintTest({gain:1,offset:0,angle:0,blank:false});};
          window.foreignVersion=()=>{p=bootstrap;image={kind:2,payload:new TextEncoder().encode(JSON.stringify({op:'hello',sid:141,catalog:123}))};total=1;length=1;paintTest({gain:1,offset:0,angle:0,blank:false});};
          window.sceneClock=setInterval(()=>paintTest({}),70);paintTest({});
          Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async c=>{if(c.video){if(video.getVideoTracks()[0].readyState==='ended')video=scene.captureStream(20);return video;}throw Error('No microphone expected');},configurable:true});
        }''')
        page.locator('[data-tab=receive]').click();page.locator('#rxSound').uncheck();page.locator('#cameraBtn').click()
        page.wait_for_function('hopperAdaptive.receiver.sid===141 && hopperAdaptive.tracker.stats.valid>0',timeout=12000)
        proof['tests'].append('portrait boot + scaled screen in camera scene + late join after HELLO')
        before=page.evaluate('hopperAdaptive.tracker.stats.valid')
        page.evaluate('paintTest({gain:.35,offset:60,angle:-7,x:-25,y:30})')
        page.wait_for_function(f'hopperAdaptive.tracker.stats.valid>{before+2}',timeout=12000)
        proof['tests'].append('low-chroma screen, resize/rotation and translated acquisition decode valid CRC controls')
        page.evaluate('paintTest({blank:true,gain:1,offset:0})')
        page.wait_for_function("document.querySelector('#lockState').textContent==='Área: 0%'",timeout=5000)
        page.wait_for_timeout(700)
        before=page.evaluate('hopperAdaptive.tracker.stats.valid')
        page.evaluate('paintTest({blank:false,angle:6,x:30,y:-30})')
        page.wait_for_function(f'hopperAdaptive.tracker.stats.valid>{before}',timeout=12000)
        proof['tests'].append('complete occlusion loses lock, then shifted screen reacquires without resetting session')
        page.evaluate('hopperAdaptive.tracker.setExpectedProfile(1);testProfile(2)')
        page.wait_for_function('hopperAdaptive.tracker.lastProfile===2 && hopperAdaptive.tracker.stats.profileReacquires>0',timeout=12000)
        proof['tests'].append('missed TRIAL announcement does not trap receiver in a stale profile')
        page.evaluate('foreignVersion()')
        page.wait_for_function("document.querySelector('#rxCalState').textContent.includes('Versiones diferentes')",timeout=12000)
        proof['tests'].append('incompatible catalogue is visible instead of silently appearing as no detection')
        page.locator('#cameraBtn').click()
        page.evaluate("Object.defineProperty(document.querySelector('#rxVideo'),'requestVideoFrameCallback',{value:()=>999,configurable:true})")
        page.locator('#cameraBtn').click()
        page.wait_for_function('hopperAdaptive.tracker.stats.callbackFallbacks>0 && hopperAdaptive.tracker.stats.valid>0',timeout=12000)
        proof['tests'].append('capture watchdog falls back to new video timestamps when callback delivery stalls')
        assert not errors and not bad,(errors,bad)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        proof['stats']=page.evaluate('hopperAdaptive.tracker.stats')
        proof['errors']=errors;proof['http_failures']=bad
        page.locator('#captureState').scroll_into_view_if_needed();page.screenshot(path=str(OUT/'receiver-acquisition.png'))
    except Exception as e:
        proof['failure']=str(e)
        try:
            proof['state']=page.evaluate('({log:document.querySelector("#diagnostics").textContent,rx:document.querySelector("#rxCalState").textContent,stats:hopperAdaptive.tracker?.stats,sid:hopperAdaptive.receiver.sid})')
            page.screenshot(path=str(OUT/'receiver-failure.png'))
        except Exception: pass
        raise
    finally:
        (OUT/'result.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2));print(json.dumps(proof,ensure_ascii=False,indent=2));browser.close();server.shutdown()
