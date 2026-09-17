"""WASM QR binary correctness + throughput instrumentation. Synthetic images, not a phone-camera benchmark."""
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
      const {FountainEncoder}=await import('./fountain.js');const {parsePacket}=await import('./protocol.js');
      const writer=await import('./vendor/zxing/es/writer/index.js');const reader=await import('./vendor/zxing/es/reader/index.js');
      writer.prepareZXingModule({overrides:{locateFile:p=>new URL('./vendor/zxing/writer/'+p,location.href).href}});reader.prepareZXingModule({overrides:{locateFile:p=>new URL('./vendor/zxing/reader/'+p,location.href).href}});
      const stream=Uint8Array.from({length:120000},(_,i)=>(i*73+(i>>5))&255),enc=new FountainEncoder(stream,2860,0x1234abcd),samples=[],encodeSamples=[],decodeSamples=[];
      for(let seq=0;seq<10;seq++){const packet=enc.frame(seq,seq&1),t0=performance.now(),w=await writer.writeBarcode(packet,{format:'QRCode',scale:1,addQuietZones:true,options:'version=40,ecLevel=L,dataMask=0'});encodeSamples.push(performance.now()-t0);if(w.error)throw Error(w.error);const s=w.symbol,rgba=new Uint8ClampedArray(s.width*s.height*4),u32=new Uint32Array(rgba.buffer),edge=s.data[0];for(let i=0;i<s.data.length;i++)u32[i]=s.data[i]===edge?0xffffffff:0xff000000;const t1=performance.now(),rs=await reader.readBarcodes(new ImageData(rgba,s.width,s.height),{formats:['QRCode'],maxNumberOfSymbols:1,tryHarder:false,tryRotate:true});decodeSamples.push(performance.now()-t1);if(!rs.length)throw Error('ZXing no decodificó el QR');const p=parsePacket(rs[0].bytes);if(!p||p.seq!==seq||p.session!==0x1234abcd)throw Error('Binario QR no coincide');samples.push({w:s.width,h:s.height,bytes:rs[0].bytes.length});}
      return {samples,encodeSamples,decodeSamples};
    }''')
    assert all(x['bytes']==2900 for x in result['samples']),result
    enc=result['encodeSamples'];dec=result['decodeSamples']
    out['tests'].append('QR v40 binary packet: writer WASM -> pixels -> reader WASM -> protocol CRC')
    out['encode_ms_first']=round(enc[0],2);out['encode_ms_steady_median']=round(sorted(enc[2:])[len(enc[2:])//2],2)
    out['decode_ms_first']=round(dec[0],2);out['decode_ms_steady_median']=round(sorted(dec[2:])[len(dec[2:])//2],2)

    pair=page.evaluate('''async()=>{
      const {FountainEncoder}=await import('./fountain.js');const writer=await import('./vendor/zxing/es/writer/index.js');
      const stream=Uint8Array.from({length:180000},(_,i)=>(i*29+(i>>4))&255),enc=new FountainEncoder(stream,2860,0xdecafbad),syms=[];
      for(let seq=101;seq<=102;seq++){const packet=enc.frame(seq,seq&1),w=await writer.writeBarcode(packet,{format:'QRCode',scale:1,addQuietZones:true,options:'version=40,ecLevel=L,dataMask=0'});if(w.error)throw Error(w.error);syms.push(w.symbol);}
      const moduleScale=4,margin=32,gap=40,qrW=syms[0].width*moduleScale,qrH=syms[0].height*moduleScale,W=margin*2+qrW*2+gap,H=margin*2+qrH,rgba=new Uint8ClampedArray(W*H*4),u32=new Uint32Array(rgba.buffer);u32.fill(0xffffffff);
      function paint(s,ox,oy){const edge=s.data[0];for(let y=0;y<s.height;y++)for(let x=0;x<s.width;x++){const color=s.data[y*s.width+x]===edge?0xffffffff:0xff000000;for(let yy=0;yy<moduleScale;yy++)for(let xx=0;xx<moduleScale;xx++)u32[(oy+y*moduleScale+yy)*W+ox+x*moduleScale+xx]=color;}}
      paint(syms[0],margin,margin);paint(syms[1],margin+qrW+gap,margin);
      return new Promise((resolve,reject)=>{const worker=new Worker('./decoder-worker.js?v=pair',{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('decoder worker timeout'));},20000);let started=0;worker.onmessage=ev=>{const m=ev.data;if(m.type==='ready'){started=performance.now();worker.postMessage({type:'decode',id:1,width:W,height:H,rgba:rgba.buffer},[rgba.buffer]);}else if(m.type==='decoded'){clearTimeout(timer);worker.terminate();const seqs=m.packets.map(p=>p.header.seq).sort((a,b)=>a-b);resolve({seqs,ms:performance.now()-started,W,H,moduleScale,packets:m.packets.length});}else if(m.type==='error'){clearTimeout(timer);worker.terminate();reject(Error(m.message));}};worker.postMessage({type:'init'});});
    }''')
    assert pair['seqs']==[101,102],pair
    out['tests'].append('production decoder worker recovers two simultaneous QR v40 symbols by region fallback')
    out['two_qr_module_scale']=pair['moduleScale'];out['decode_two_qr_worker_ms']=round(pair['ms'],2);out['decode_two_qr_equivalent_qr_per_s']=round(2000/max(pair['ms'],0.001),1)

    pool=page.evaluate('''async()=>new Promise((resolve,reject)=>{
      const N=4,TOTAL=64,WARM=8,workers=[],ready=new Set(),startTimes=new Map(),durations=[],completed=[];let next=0,t0=0,done=false;const timer=setTimeout(()=>{if(!done){done=true;workers.forEach(w=>w.terminate());reject(Error('parallel writer timeout'));}},45000);
      function feed(w){if(next>=TOTAL)return;const seq=next++;startTimes.set(seq,performance.now());w.postMessage({type:'render',seq,codeIndex:seq&1});}function maybeStart(){if(ready.size!==N||t0)return;t0=performance.now();for(const w of workers)feed(w);}
      for(let i=0;i<N;i++){const w=new Worker('./sender-worker.js?v=pool',{type:'module'});workers.push(w);w.onmessage=ev=>{const m=ev.data;if(m.type==='ready'){ready.add(w);maybeStart();return;}if(m.type==='error'){clearTimeout(timer);done=true;workers.forEach(x=>x.terminate());reject(Error(m.message));return;}if(m.type==='frame'){const now=performance.now(),dt=now-startTimes.get(m.seq);durations.push({seq:m.seq,ms:dt});completed.push({seq:m.seq,width:m.width,height:m.height});if(completed.length>=TOTAL){clearTimeout(timer);done=true;const elapsed=now-t0,postWarm=durations.filter(x=>x.seq>=WARM).map(x=>x.ms).sort((a,b)=>a-b);workers.forEach(x=>x.terminate());resolve({elapsed,total:TOTAL,qrps:TOTAL/(elapsed/1000),median:postWarm[Math.floor(postWarm.length/2)],p90:postWarm[Math.floor(postWarm.length*.9)],width:m.width,height:m.height});}else feed(w);}};w.postMessage({type:'init',stream:Uint8Array.from({length:200000},(_,j)=>(j*31+(j>>7))&255).buffer,blockLen:2860,session:0x13572468,qrVersion:40});}
    })''')
    assert pool['width']>170 and pool['total']==64,pool
    out['tests'].append('four sender workers generate independent local QR v40 frames continuously')
    out['parallel_writer_qr_per_s']=round(pool['qrps'],1);out['parallel_writer_ms_per_qr_effective']=round(1000/pool['qrps'],2);out['parallel_worker_job_median_ms']=round(pool['median'],2);out['parallel_worker_job_p90_ms']=round(pool['p90'],2)
    assert not errors,errors
    browser.close()
srv.shutdown();print(json.dumps(out,indent=2))
