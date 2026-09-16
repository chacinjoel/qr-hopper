"""Reproducible, hash-guarded receiver hotfix. Only the feature-branch CI applies it."""
from pathlib import Path
import hashlib
import re
root=Path('hopperlink-pixelstream')
if "BUILD='adaptive-2.0.1-rxfix1'" in (root/'adaptive/protocol.js').read_text():
    print('RX FIX 1 already applied; running regression tests against committed files.')
    raise SystemExit(0)
expected={
 'adaptive/optics.js':'822d3415bc33e3ba864074e23a3a52788ba70d34232b73ffeeadb7e607c98bcd',
 'adaptive/calibration.js':'9e06b36a0032a2a8bb22682c4cf277c11ada1ed563f6dbf1326a9d3b0c043ab6',
 'adaptive/app.js':'248ee0dfef0f693d2ae534cba759b227cd83b544b03c705b49730d15ed9fb8f4',
 'adaptive/protocol.js':'622d363677a15b970b04f3bae6c1a50635a8db7b7654fc4eba0cba017a13b57e',
 'adaptive/audio.js':'a75923e3de065b8a8df15cd65a4e48fdfc22cfae22c2f8896ea85c71a8234534',
 'adaptive/qr.js':'c498b9539fc64a470976680236d30af9248275e6bc2f94b403eb7f3526056a5c',
 'index.html':'debfe11f01d3fe23cae5de479cdf5b4c5614d5866e6b69fdd967877d411255a9'
}
for name,digest in expected.items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest, 'Unexpected base: '+name
p=root/'adaptive/optics.js';s=p.read_text()
s=s.replace('this.partial=new Map();this.stats=', 'this.partial=new Map();this.headerMisses=0;this.lastHeaderAt=-Infinity;this.lastCallbackAt=0;this.watchdog=0;this.stats=')
s=s.replace('sectorAssemblies:0}', 'sectorAssemblies:0,headerMisses:0,coarseFallbacks:0,profileReacquires:0,callbackFallbacks:0}')
a=s.index(' start(){');b=s.index(' tick(now,mediaTime)',a)
s=s[:a]+''' start(){
  if(this.running)return;this.running=true;this.lastMedia=-1;this.lastCallbackAt=performance.now();this.schedule();
  // Some video pipelines can stop delivering callbacks while currentTime advances.
  // Never process a duplicate timestamp or fake camera input to hide that failure.
  this.watchdog=setInterval(()=>{if(this.running&&!document.hidden&&performance.now()-this.lastCallbackAt>750){
   this.stats.callbackFallbacks++;this.tick(performance.now(),this.video.currentTime);
  }},250);
 }
 stop(){this.running=false;clearInterval(this.watchdog);this.watchdog=0;cancelAnimationFrame(this.raf);if(this.video.cancelVideoFrameCallback&&this.vfc)this.video.cancelVideoFrameCallback(this.vfc);this.vfc=0;}
 schedule(){
  if(!this.running)return;
  const next=(now,meta)=>{this.lastCallbackAt=now;try{this.tick(now,Number.isFinite(meta?.mediaTime)?meta.mediaTime:this.video.currentTime);}finally{this.schedule();}};
  if(this.video.requestVideoFrameCallback)this.vfc=this.video.requestVideoFrameCallback(next);
  else this.raf=requestAnimationFrame(now=>next(now));
 }
 resetAcquisition(){this.rawQuad=null;this.visibleQuad=null;this.lastSeen=0;this.expectedProfile=null;this.lastProfile=0;this.lastHeaderAt=-Infinity;this.headerMisses=0;this.partial.clear();}
''' + s[b:]
s=s.replace('mediaTime===this.lastMedia||document.hidden','!Number.isFinite(mediaTime)||mediaTime===this.lastMedia||document.hidden')
s=s.replace('this.counter++;let current=null;', 'this.counter++;let current=null,coarse=null;')
s=s.replace('this.counter%8!==0)', 'this.counter%8!==0&&now-this.lastHeaderAt<400)')
s=s.replace('Math.min(480,W)', 'Math.min(720,W)')
s=s.replace('expected=now-this.lastSeen<500?', 'expected=now-this.lastHeaderAt<400?')
s=s.replace('const coarse=found.quad.map(q=>({x:q.x*W/dw,y:q.y*H/dh}));current=this.refine(img.data,W,H,coarse);', '''coarse=found.quad.map(q=>({x:q.x*W/dw,y:q.y*H/dh}));current=this.refine(img.data,W,H,coarse);
    // A fine-search failure must not erase the globally validated Lighthouse.
    if(!current){current=coarse;this.stats.coarseFallbacks++;}''')
s=s.replace('if(current){const decoded=this.decodeAdaptive(img.data,W,H,current);if(decoded)this.onFrame?.(decoded);}', '''if(current){let decoded=this.decodeAdaptive(img.data,W,H,current);
    // Refinement can be biased by payload colours or a profile transition. Try
    // the stable acquisition centres too; CRC still gates every returned packet.
    if(!decoded&&coarse&&current!==coarse)decoded=this.decodeAdaptive(img.data,W,H,coarse);
    if(decoded){this.lastHeaderAt=now;this.onFrame?.(decoded);}
   }''')
s=s.replace('if(s>90){const w=s-75;', 'if(s>72&&Math.max(r,g,b)>115){const w=s-71;')
old='''const locked=Number.isInteger(this.expectedProfile)&&!!PROFILES[this.expectedProfile],preferred=locked?this.expectedProfile:this.lastProfile,order=(locked?[preferred,0,this.lastProfile]:[preferred,0,...PROFILES.map(p=>p.id)]).filter((id,i,a)=>a.indexOf(id)===i&&PROFILES[id]);'''
new='''const locked=Number.isInteger(this.expectedProfile)&&!!PROFILES[this.expectedProfile],preferred=locked?this.expectedProfile:(this.lastProfile||0);
  // A hint is not a permanent lock. Missing one TRIAL announcement used to
  // exclude all subsequent profiles forever, even after the screen was found.
  this.headerMisses=(this.headerMisses||0)+1;
  const searchAll=!locked||this.headerMisses>=3;
  const order=[preferred,0,this.lastProfile,...(searchAll?PROFILES.map(p=>p.id):[])].filter((id,i,a)=>a.indexOf(id)===i&&PROFILES[id]);'''
assert old in s;s=s.replace(old,new)
s=s.replace('this.stats.headers++;this.lastProfile=id;', '''this.stats.headers++;this.headerMisses=0;this.stats.headerMisses=0;
   if(locked&&id!==preferred&&id!==0){this.expectedProfile=id;this.stats.profileReacquires=(this.stats.profileReacquires||0)+1;}
   this.lastProfile=id;''')
s=s.replace('return decoded;}return null;', 'return decoded;}this.stats.headerMisses=this.headerMisses;return null;')
p.write_text(s)
p=root/'adaptive/calibration.js';s=p.read_text()
old="control(c,now){if(c.op==='hello'&&c.sid!==this.sid){this.reset();this.sid=c.sid;}"
new="""control(c,now){
  // The application calls this only for a CRC-valid, matching-catalogue control.
  // Joining after HELLO (permissions/focus/reacquisition) must not strand sid=0.
  const joinable=['hello','audio','trial'].includes(c.op);
  if(c.sid!==this.sid&&joinable&&(c.op==='hello'||!this.sid||c.round===0)){
   this.reset();this.sid=c.sid;
   this.onEvent({type:'session-acquired',sid:c.sid,late:c.op!=='hello'});
  }"""
assert old in s;s=s.replace(old,new);p.write_text(s)
p=root/'adaptive/app.js';s=p.read_text()
s=s.replace("async function receiverEvent(e){try{", "async function receiverEvent(e){try{\n if(e.type==='session-acquired')note(e.late?'Sesión recuperada después del anuncio inicial.':'Anuncio de sesión recibido.');")
s=s.replace("if(d.header.kind===KIND.CONTROL){const c=readControl(d);if(!c)return;", """if(d.header.kind===KIND.CONTROL){const c=readControl(d);if(!c){
  try{const raw=JSON.parse(new TextDecoder().decode(d.payload));if(d.crcOK&&raw.catalog!==CATALOG_HASH){
   text('rxCalState','Versiones diferentes: recarga HopperLink en AMBOS teléfonos. Área detectada, pero el protocolo no coincide.');
   text('captureState','Control recibido de otra versión. No se mezclan los archivos.');
  }}catch{}return;
 }""")
s=s.replace("if(q.error)note('Cámara: '+q.error);", """if(q.error){text('captureState','Error de procesamiento: '+q.error);if(failures.at(-1)!==q.error){failures.push(q.error);note('Cámara: '+q.error);}}
 else text('captureState','Capturas '+(stats.capture||0)+' · cabeceras '+(stats.headers||0)+' · CRC válidos '+(stats.valid||0)+' · '+(q.lock>0?'área localizada':'buscando las 4 balizas'));
""")
s=s.replace("download.reset();receiver.reset();rxSid=0;", "download.reset();receiver.reset();tracker?.resetAcquisition();rxSid=0;")
s=s.replace("text('rxCalState','Nueva recepción. Esperando calibración.');", "text('rxCalState','Nueva recepción. Esperando calibración.');text('captureState','Detector reiniciado; los permisos se conservan.');")
s=s.replace("get tx(){return tx;},sound", "get tx(){return tx;},get tracker(){return tracker;},sound");p.write_text(s)
p=root/'index.html';s=p.read_text().replace('ADAPTIVE 2 · THROUGHPUT','ADAPTIVE 2 · RX FIX 1')
s=s.replace('<button id="showReportBtn"', '<p id="captureState" class="mini" role="status">Cámara sin iniciar · receptor RX FIX 1.</p><button id="showReportBtn"')
s=s.replace('./adaptive/app.js"', './adaptive/app.js?v=rxfix1"').replace('./adaptive.css?v=adaptive2','./adaptive.css?v=rxfix1');p.write_text(s)
p=root/'adaptive/protocol.js';s=p.read_text().replace("BUILD='adaptive-2.0.0-throughput'", "BUILD='adaptive-2.0.1-rxfix1'");p.write_text(s)
for p in (root/'adaptive').glob('*.js'):
 s=p.read_text();s=re.sub(r"(['\"])(\.{1,2}/[^'\"\n]+\.js)(\1)",lambda m:m[1]+m[2]+'?v=rxfix1'+m[3],s);p.write_text(s)
print('Receiver hotfix applied. Optical format, catalogue, FEC and schedules unchanged.')
