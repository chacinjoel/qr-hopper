from pathlib import Path
root=Path('hopperlink-pixelstream')
codec=(root/'adaptive-v1/audio-codec.js').read_text().replace("import {crc16} from '../src/feedback.js';",'').replace('export ','')
crc=(root/'src/feedback.js').read_text().split('export function crc16',1)[1].split('export function encodeFeedback',1)[0]
worklet=(root/'adaptive-v1/audio-worklet.js').read_text().replace("import {PCMDecoder} from './audio-codec.js';",'')
(root/'adaptive-v1/audio-worklet.js').write_text('// Generated standalone acoustic worklet; same codec as unit tests.\nfunction crc16'+crc+codec+'\n'+worklet)
p=root/'adaptive-v1/audio.js';s=p.read_text().replace('synthesize,messageSeconds','synthesize,messageSeconds,PCMDecoder')
a=s.index("      await this.ctx.audioWorklet.addModule(")
b=s.index("      this.status('Micrófono local activo.",a)
s=s[:a]+'''      this.status('Cargando analizador acústico local…');
      let timer, objectURL;
      try {
        const loading=(async()=>{const response=await fetch(new URL('./audio-worklet.js',import.meta.url));if(!response.ok)throw new Error('No se pudo cargar el procesador acústico.');objectURL=URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'}));await this.ctx.audioWorklet.addModule(objectURL);})();
        await Promise.race([loading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('AudioWorklet no respondió')),4000);})]);
        this.node=new AudioWorkletNode(this.ctx,'hopper-fsk-return');
        this.node.port.onmessage=e=>this.onPacket(e.data);this.mode='AudioWorklet';
      } catch (workletError) {
        // Compatibility only: exact same PCM decoder, no fabricated messages.
        if(typeof this.ctx.createScriptProcessor!=='function')throw workletError;
        const decoder=new PCMDecoder(this.ctx.sampleRate,m=>this.onPacket(m));
        this.node=this.ctx.createScriptProcessor(2048,1,1);this.mode='PCM compatible';
        this.node.onaudioprocess=e=>{decoder.push(e.inputBuffer.getChannelData(0));e.outputBuffer.getChannelData(0).fill(0);};
        this.status('Procesador PCM compatible activo; el perfil se evaluará por sus resultados.');
      } finally {clearTimeout(timer);if(objectURL)URL.revokeObjectURL(objectURL);}
      this.source=this.ctx.createMediaStreamSource(this.stream);this.source.connect(this.node);this.node.connect(this.ctx.destination);
''' +s[b:]
s=s.replace("if(!this.ctx.audioWorklet)throw new Error('AudioWorklet no disponible en este navegador. Usa QR.');",'')
s=s.replace("this.node?.disconnect();this.stream", "this.node?.disconnect();if(this.node&&'onaudioprocess' in this.node)this.node.onaudioprocess=null;this.stream")
p.write_text(s)
p=root/'tests/adaptive-browser.py';s=p.read_text()
s=s.replace("errors=[];page.on('pageerror',lambda e:errors.append(str(e)))", "errors=[];page.on('pageerror',lambda e:errors.append(str(e)))\n  page.on('console',lambda m: print('BROWSER',m.type,m.text,flush=True))")
s=s.replace("window.framesAB={A,B,sink};", """window.framesAB={A,B,sink};
    window.gumCalls=[];
    for(const [label,w] of [['A',A],['B',B]]){const fn=w.navigator.mediaDevices.getUserMedia;Object.defineProperty(w.navigator.mediaDevices,'getUserMedia',{configurable:true,value:async c=>{gumCalls.push([label,c]);return fn(c);}});}
    window.cameraPump=setInterval(()=>{for(const c of [A.hopperTest.canvas,B.document.getElementById('reportCanvas')])if(c.width&&c.height)c.getContext('2d').drawImage(c,0,0);},80);
    window.startupState=()=>({calls:gumCalls,AState:A.hopperTest.sender?.state,Actx:A.hopperTest.audio.ctx?.state,mode:A.hopperTest.audio.mode,Atime:A.hopperTest.audio.ctx?.currentTime,Astream:A.hopperTest.audio.stream?.getTracks().map(t=>[t.kind,t.readyState,t.muted]),Bctx:B.hopperTest.audio.ctx?.state,Btime:B.hopperTest.audio.ctx?.currentTime,Bvideo:[B.document.getElementById('rxVideo').readyState,B.document.getElementById('rxVideo').videoWidth,B.document.getElementById('rxVideo').paused],Bnotice:B.document.getElementById('notice').textContent,Amsg:A.document.getElementById('audioState').textContent});""")
s=s.replace("  try:\n   if not use_audio:","  try:\n   page.wait_for_timeout(10000)\n   print('STARTUP',json.dumps(page.evaluate('startupState()'),ensure_ascii=False),flush=True)\n   assert page.evaluate(\"framesAB.A.hopperTest.sender?.state !== 'starting'\"), 'Sender media initialization did not finish'\n   if use_audio: assert page.evaluate('framesAB.A.hopperTest.sender.microphone'), 'Microphone PCM initialization failed'\n   if not use_audio:")
s=s.replace("page.evaluate('framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')", "page.evaluate('clearInterval(window.cameraPump);framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')")
p.write_text(s)
