from pathlib import Path
root=Path('hopperlink-pixelstream')
# AudioWorklet module must have no transitive page-module/importmap dependency.
codec=(root/'adaptive-v1/audio-codec.js').read_text()
codec=codec.replace("import {crc16} from '../src/feedback.js';",'').replace('export ','')
crc=(root/'src/feedback.js').read_text().split('export function crc16',1)[1].split('export function encodeFeedback',1)[0]
worklet=(root/'adaptive-v1/audio-worklet.js').read_text().replace("import {PCMDecoder} from './audio-codec.js';",'')
(root/'adaptive-v1/audio-worklet.js').write_text('// Generated standalone acoustic worklet; same codec as unit tests.\nfunction crc16'+crc+codec+'\n'+worklet)
p=root/'adaptive-v1/audio.js';s=p.read_text()
s=s.replace("await this.ctx.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url));", "this.status('Cargando analizador acústico local…');let timer;try{await Promise.race([this.ctx.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('El analizador acústico no inició; utiliza el QR de respaldo.')),6000);})]);}finally{clearTimeout(timer);}")
p.write_text(s)
p=root/'tests/adaptive-browser.py';s=p.read_text()
s=s.replace("errors=[];page.on('pageerror',lambda e:errors.append(str(e)))", "errors=[];page.on('pageerror',lambda e:errors.append(str(e)))\n  page.on('console',lambda m: print('BROWSER',m.type,m.text,flush=True))")
s=s.replace("window.framesAB={A,B,sink};", """window.framesAB={A,B,sink};
    window.gumCalls=[];
    for(const [label,w] of [['A',A],['B',B]]){const fn=w.navigator.mediaDevices.getUserMedia;Object.defineProperty(w.navigator.mediaDevices,'getUserMedia',{configurable:true,value:async c=>{gumCalls.push([label,c]);return fn(c);}});}
    window.cameraPump=setInterval(()=>{for(const c of [A.hopperTest.canvas,B.document.getElementById('reportCanvas')])if(c.width&&c.height)c.getContext('2d').drawImage(c,0,0);},80);
    window.startupState=()=>({calls:gumCalls,AState:A.hopperTest.sender?.state,Actx:A.hopperTest.audio.ctx?.state,Atime:A.hopperTest.audio.ctx?.currentTime,Astream:A.hopperTest.audio.stream?.getTracks().map(t=>[t.kind,t.readyState,t.muted]),Bctx:B.hopperTest.audio.ctx?.state,Btime:B.hopperTest.audio.ctx?.currentTime,Bvideo:[B.document.getElementById('rxVideo').readyState,B.document.getElementById('rxVideo').videoWidth,B.document.getElementById('rxVideo').paused],Bnotice:B.document.getElementById('notice').textContent,Amsg:A.document.getElementById('audioState').textContent});""")
s=s.replace("  try:\n   if not use_audio:","  try:\n   page.wait_for_timeout(10000)\n   print('STARTUP',json.dumps(page.evaluate('startupState()'),ensure_ascii=False),flush=True)\n   assert page.evaluate(\"framesAB.A.hopperTest.sender?.state !== 'starting'\"), 'Sender media initialization did not finish'\n   if use_audio: assert page.evaluate('framesAB.A.hopperTest.sender.microphone'), 'AudioWorklet microphone initialization failed'\n   if not use_audio:")
s=s.replace("page.evaluate('framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')", "page.evaluate('clearInterval(window.cameraPump);framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')")
p.write_text(s)
