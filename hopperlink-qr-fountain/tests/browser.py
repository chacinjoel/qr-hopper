"""WASM QR binary roundtrip and app boot. Synthetic images, not a phone-camera benchmark."""
import json, pathlib, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
class Q(SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=ThreadingHTTPServer(('127.0.0.1',0),partial(Q,directory=str(ROOT)))
threading.Thread(target=srv.serve_forever,daemon=True).start()
url=f'http://127.0.0.1:{srv.server_port}/hopperlink-qr-fountain/'
out={"hardware":False,"tests":[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={"width":390,"height":844},device_scale_factor=1)
    errors=[];page.on('pageerror',lambda e: errors.append(str(e)))
    r=page.goto(url,wait_until='networkidle');assert r.status==200
    page.wait_for_function('window.__hopperBootOK===true')
    assert not errors,errors
    out['tests'].append('app boot and responsive DOM')
    result=page.evaluate('''async()=>{
      const {FountainEncoder}=await import('./fountain.js');
      const {parsePacket}=await import('./protocol.js');
      const writer=await import('./vendor/zxing/es/writer/index.js');
      const reader=await import('./vendor/zxing/es/reader/index.js');
      writer.prepareZXingModule({overrides:{locateFile:p=>new URL('./vendor/zxing/writer/'+p,location.href).href}});
      reader.prepareZXingModule({overrides:{locateFile:p=>new URL('./vendor/zxing/reader/'+p,location.href).href}});
      const stream=Uint8Array.from({length:120000},(_,i)=>(i*73+(i>>5))&255),enc=new FountainEncoder(stream,2860,0x1234abcd);
      const samples=[];let encodeMs=0,decodeMs=0;
      for(let seq=0;seq<8;seq++){
        const packet=enc.frame(seq,seq&1),t0=performance.now();
        const w=await writer.writeBarcode(packet,{format:'QRCode',scale:1,addQuietZones:true,options:'version=40,ecLevel=L,dataMask=0'});encodeMs+=performance.now()-t0;
        if(w.error)throw Error(w.error);const s=w.symbol,rgba=new Uint8ClampedArray(s.width*s.height*4),u32=new Uint32Array(rgba.buffer),edge=s.data[0];for(let i=0;i<s.data.length;i++)u32[i]=s.data[i]===edge?0xffffffff:0xff000000;
        const t1=performance.now(),rs=await reader.readBarcodes(new ImageData(rgba,s.width,s.height),{formats:['QRCode'],maxNumberOfSymbols:1,tryHarder:false,tryRotate:true});decodeMs+=performance.now()-t1;
        if(!rs.length)throw Error('ZXing no decodificó el QR');const p=parsePacket(rs[0].bytes);if(!p||p.seq!==seq||p.session!==0x1234abcd)throw Error('Binario QR no coincide');samples.push({w:s.width,h:s.height,bytes:rs[0].bytes.length});
      }
      return {samples,encodeMs:encodeMs/8,decodeMs:decodeMs/8};
    }''')
    assert all(x['bytes']==2900 for x in result['samples']),result
    out['tests'].append('QR v40 binary packet: writer WASM -> pixels -> reader WASM -> protocol CRC')
    out['encode_ms_per_qr']=round(result['encodeMs'],2);out['decode_ms_per_qr']=round(result['decodeMs'],2)
    worker=page.evaluate('''async()=>new Promise(async(resolve,reject)=>{
      const sw=new Worker('./sender-worker.js?v=test',{type:'module'});const timer=setTimeout(()=>reject(Error('worker timeout')),20000);
      sw.onmessage=ev=>{const m=ev.data;if(m.type==='ready')sw.postMessage({type:'render',seq:7,codeIndex:0});else if(m.type==='frame'){clearTimeout(timer);sw.terminate();resolve({width:m.width,height:m.height,bytes:m.data.byteLength});}else if(m.type==='error')reject(Error(m.message));};
      sw.postMessage({type:'init',stream:new Uint8Array(6000).buffer,blockLen:2860,session:99,qrVersion:40});
    })''')
    assert worker['width']>170 and worker['bytes']>30000,worker
    out['tests'].append('sender worker loads local writer WASM')
    browser.close()
srv.shutdown();print(json.dumps(out,indent=2))
