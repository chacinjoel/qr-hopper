import os,shutil,threading,functools,http.server,time,json,base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]; OUT=Path(os.environ.get('H7_PROOF_DIR',str(ROOT/'h7-browser-proof')));OUT.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',8765),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL='http://127.0.0.1:8765/hopperlink-pixelstream/'
results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROME_BIN') or shutil.which('google-chrome') or shutil.which('chromium'),headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 for mode in os.environ.get('H7_TEST_MODES','robust2,adaptive3,turbo4').split(','):
  context=browser.new_context(viewport={'width':430,'height':932},device_scale_factor=2)
  tx=context.new_page();errors=[];tx.on('pageerror',lambda e:errors.append(str(e)))
  tx.goto(URL);tx.wait_for_function('window.__hopperLinkOne?.version === "1.4.0"')
  tx.locator('button[data-optical-mode="'+mode+'"]').click();tx.locator('label.toggle-line').click()
  data=bytes((i*31+17)%256 for i in range(2048));name='prueba_h7_ñ_'+mode+'.bin'
  tx.locator('#fileInput').set_input_files({'name':name,'mimeType':'application/octet-stream','buffer':data})
  tx.locator('#prepareBtn').click();tx.wait_for_function('!document.getElementById("launchBtn").disabled')
  # Actual full-screen action, no replacement renderer or CSS.
  tx.locator('#launchBtn').click();tx.wait_for_function('document.getElementById("transmissionStage").classList.contains("active")')
  tx.screenshot(path=str(OUT/(mode+'-hello.png')))
  geometry=tx.evaluate('''()=>{const a=document.getElementById('stageDockCanvas').getBoundingClientRect(),h=document.querySelector('.stage-hud').getBoundingClientRect(),f=document.querySelector('.stage-controls').getBoundingClientRect();return {canvas:[a.x,a.y,a.width,a.height],noOverlap:a.top>=h.bottom&&a.bottom<=f.top};}''')
  assert geometry['noOverlap'],geometry
  rx=context.new_page();rx.on('pageerror',lambda e:errors.append(str(e)))
  rx.add_init_script('''(()=>{navigator.mediaDevices.getUserMedia=async constraints=>{
    if(!constraints.video)throw new DOMException('Audio not simulated','NotAllowedError');
    const c=document.createElement('canvas');c.width=860;c.height=1864;window.__testCamera=c;
    const ctx=c.getContext('2d');ctx.fillStyle='#666';ctx.fillRect(0,0,c.width,c.height);
    const render=()=>{if(window.__testImage){ctx.imageSmoothingEnabled=false;ctx.drawImage(window.__testImage,0,0,c.width,c.height);}requestAnimationFrame(render);};render();
    return c.captureStream(30);
  };})();''')
  rx.goto(URL);rx.wait_for_function('window.__hopperLinkOne?.version === "1.4.0"')
  workers=[];rx.on('worker',lambda worker:workers.append(worker.url))
  rx.locator('#receiveTab').click();rx.locator('#cameraBtn').click()
  def deliver():
   png=tx.screenshot();uri='data:image/png;base64,'+base64.b64encode(png).decode()
   rx.evaluate('''async uri=>{const image=new Image();image.src=uri;await image.decode();window.__testImage=image;}''',uri)
  for attempt in range(45):
   deliver();rx.wait_for_timeout(190)
   if rx.evaluate('window.__hopperLinkOne.diagnostics().rx !== null'):break
  rx.wait_for_function('window.__hopperLinkOne.diagnostics().rx !== null',timeout=3000)
  found=rx.locator('#rxFileName').inner_text();detected=rx.evaluate('window.__hopperLinkOne.diagnostics().rx.mode')
  print(mode,'filename',found,'mode',detected,'workers',workers,flush=True)
  assert found==name and detected==mode
  assert any('anchor-worker.js?v=1400' in w for w in workers),'Real same-origin worker not started'
  tx.locator('#stageStartBtn').click()
  frames=0
  while frames<70:
   deliver();rx.wait_for_timeout(130);frames+=1
   if rx.evaluate('window.__hopperLinkOneInternals.getApp().rx?.complete'):break
  complete=rx.evaluate('window.__hopperLinkOneInternals.getApp().rx?.complete')
  if not complete:
   print(rx.evaluate('window.__hopperLinkOne.diagnostics()'),flush=True)
  assert complete,'Physical rendering screenshot sequence did not finish in bound'
  downloaded=bytes(rx.evaluate('''async()=>Array.from(new Uint8Array(await (await fetch(document.getElementById('downloadLink').href)).arrayBuffer()))'''))
  assert downloaded==data,'Final reconstructed file differs'
  tx.locator('#stagePauseBtn').click();rx.screenshot(path=str(OUT/(mode+'-received.png')))
  assert not errors,errors
  assert rx.evaluate('!!crypto.subtle'), 'Native Web Crypto was not tested'
  assert rx.evaluate('!!window.__hopperLinkOneInternals.getApp().rx.meta.sha256'), 'SHA-256 missing from received metadata'
  result={'mode':mode,'filename':found,'framesFed':frames,'bytesVerified':len(downloaded),'worker':workers,'layout':geometry,'errors':errors}
  results.append(result);print('PASS',result,flush=True)
  context.close()
 browser.close()
(OUT/'browser-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
server.shutdown()
