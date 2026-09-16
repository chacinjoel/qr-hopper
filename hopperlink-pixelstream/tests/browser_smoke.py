"""Browser smoke + optical loopback. Synthetic camera; not a physical phone test."""
import json, os, pathlib, shutil, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

root = pathlib.Path(__file__).resolve().parents[2]
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/hopperlink-pixelstream/'
result = {'hardware_test': False, 'tests': []}
with sync_playwright() as pw:
    exe = os.environ.get('CHROMIUM_EXECUTABLE')
    browser = pw.chromium.launch(headless=True, **({'executable_path': exe} if exe else {}), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    errors, failed = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('requestfailed', lambda r: failed.append(r.url))
    response = page.goto(url, wait_until='networkidle')
    assert response.status == 200
    page.wait_for_function('window.__hopperBootOK === true')
    assert not errors, errors
    assert page.locator('#downloadName').count() == 1
    assert page.locator('#bootError').is_hidden()
    result['tests'].append('HTML/modules/importmap boot, 390px layout, no JS errors')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    for tab in ['receive','bench','send']:
        page.locator(f'.tab[data-tab={tab}]').click()
        assert page.locator('#'+tab).is_visible()
    page.locator('#fileInput').set_input_files({'name':'informe <literal> 🪐.txt','mimeType':'text/plain','buffer':('Datos de prueba '*100).encode()})
    page.locator('#prepareBtn').click()
    page.wait_for_function("!document.querySelector('#startTxBtn').disabled")
    assert 'literal' in page.locator('#sendName').inner_text()
    assert page.locator('#sendFirstEta').inner_text() != '—'
    assert page.locator('#sendPlanEta').inner_text() != '—'
    page.locator('#startTxBtn').click()
    page.wait_for_function("document.body.classList.contains('tx-active')")
    page.wait_for_timeout(2200)
    assert not errors, errors
    page.locator('#txExitBtn').click()
    assert not page.evaluate("document.body.classList.contains('tx-active')")
    result['tests'].append('file preparation + estimates + transmission + viewport exit')
    page.reload(wait_until='networkidle')
    page.wait_for_function('window.__hopperBootOK')
    # Synthetic camera uses the actual unchanged HDP renderer, tracked by the
    # actual CameraTracker in the app. FEC loss cases are covered in core tests.
    page.evaluate('''async () => {
      const {prepareTransfer} = await import('./src/transfer-metrics.js');
      const {buildTransport} = await import('./src/superstream.js');
      const {resolveProfile,renderDiscoveryFrame,renderOpticalFrame} = await import('./src/optical2.js');
      const p=resolveProfile('robust','64x96');
      const bytes=Uint8Array.from({length:10000},(_,i)=>(i*37+(i>>6))&255);
      const packed=await prepareTransfer(new File([bytes],'prueba <literal> 🪐.png'));
      const transport=buildTransport(packed.stream,p);
      const canvas=document.createElement('canvas');renderDiscoveryFrame(canvas,p);
      const stream=canvas.captureStream(30);
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>stream, configurable:true});
      window.testSource={canvas,stream,packed,transport,p,renderDiscoveryFrame,renderOpticalFrame};
      let i=0;
      window.testInterval=setInterval(()=>{
        const f=transport.frames[i];renderOpticalFrame(canvas,f,transport,p,i,transport.frames.length);i=(i+1)%transport.frames.length;
      },180);
    }''')
    page.locator('.tab[data-tab=receive]').click()
    page.locator('#cameraBtn').click()
    page.wait_for_function("document.querySelector('#downloadName').textContent.includes('prueba')",timeout=20000)
    page.wait_for_function("document.querySelector('#downloadPercent').textContent === '100.0%'",timeout=30000)
    assert 'SHA-256 OK' in page.locator('#receivedFile').inner_text()
    assert 'literal' in page.locator('#downloadName').inner_text()
    assert page.locator('#receivedFile literal').count() == 0
    assert not errors, errors
    result['tests'].append('synthetic optical camera loopback: actual renderer -> tracker -> FEC -> SHA-256 -> download UI')
    page.locator('#downloadName').scroll_into_view_if_needed()
    page.screenshot(path=str(root/'browser-receiver.png'), full_page=False)
    page.locator('#cameraBtn').click()
    page.evaluate('clearInterval(window.testInterval)')
    assert not errors and not failed, (errors,failed)
    result['javascript_errors'] = errors
    result['failed_requests'] = failed
    result['download_elapsed'] = page.locator('#downloadElapsed').inner_text()
    result['download_average'] = page.locator('#downloadAverage').inner_text()
    browser.close()
server.shutdown()
print(json.dumps(result,ensure_ascii=False,indent=2))
