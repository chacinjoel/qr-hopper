from pathlib import Path
root=Path('hopperlink-pixelstream')
codec=(root/'adaptive-v1/audio-codec.js').read_text().replace("import {crc16} from '../src/feedback.js';",'').replace('export ','')
crc=(root/'src/feedback.js').read_text().split('export function crc16',1)[1].split('export function encodeFeedback',1)[0]
worklet=(root/'adaptive-v1/audio-worklet.js').read_text().replace("import {PCMDecoder} from './audio-codec.js';",'')
(root/'adaptive-v1/audio-worklet.js').write_text('// Standalone acoustic worklet: same PCM codec as the regression suite.\nfunction crc16'+crc+codec+'\n'+worklet)
(root/'adaptive-v1/audio.js').write_text('''import {synthesize, PCMDecoder} from './audio-codec.js';
export class AudioReturn {
  constructor(onPacket,onStatus=()=>{}){this.onPacket=onPacket;this.status=onStatus;this.ctx=null;this.stream=null;this.node=null;this.source=null;this.playing=null;this.enabled=false;this.epoch=0;this.mode=null;}
  async unlock(){
    if(!this.ctx){const C=window.AudioContext||window.webkitAudioContext;if(!C)throw new Error('Web Audio no disponible; utiliza el QR de respaldo.');this.ctx=new C();this.output=this.ctx.createGain();this.output.gain.value=1;this.output.connect(this.ctx.destination);}
    await this.ctx.resume();if(this.ctx.state!=='running')throw new Error('Toca Activar sonido para permitir reproducción.');this.enabled=true;
  }
  async listen(){
    await this.unlock();if(this.node)return;const token=this.epoch;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(token!==this.epoch){stream.getTracks().forEach(t=>t.stop());throw new Error('Captura cancelada.');}this.stream=stream;
      this.status('Cargando analizador acústico local…');
      let timer,objectURL;
      try{
        if(!this.ctx.audioWorklet)throw new Error('AudioWorklet no disponible.');
        const loading=(async()=>{const response=await fetch(new URL('./audio-worklet.js',import.meta.url));if(!response.ok)throw new Error('No se pudo cargar el procesador acústico.');const source=await response.text();objectURL=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));await this.ctx.audioWorklet.addModule(objectURL);})();
        await Promise.race([loading,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('AudioWorklet no respondió.')),4000);})]);
        this.node=new AudioWorkletNode(this.ctx,'hopper-fsk-return');this.node.port.onmessage=e=>this.onPacket(e.data);this.mode='AudioWorklet';
      }catch(error){
        if(token!==this.epoch||typeof this.ctx.createScriptProcessor!=='function')throw error;
        const decoder=new PCMDecoder(this.ctx.sampleRate,m=>this.onPacket(m));this.node=this.ctx.createScriptProcessor(2048,1,1);this.mode='PCM compatible';
        this.node.onaudioprocess=e=>{decoder.push(e.inputBuffer.getChannelData(0));e.outputBuffer.getChannelData(0).fill(0);};
      }finally{clearTimeout(timer);if(objectURL)URL.revokeObjectURL(objectURL);}
      if(token!==this.epoch)throw new Error('Captura cancelada.');
      this.source=this.ctx.createMediaStreamSource(this.stream);this.source.connect(this.node);this.node.connect(this.ctx.destination);
      this.status('Micrófono local activo ('+this.mode+'). No se graba ni se envía a un servidor.');
    }catch(error){this.source?.disconnect();this.node?.disconnect();this.stream?.getTracks().forEach(t=>t.stop());this.source=null;this.node=null;this.stream=null;throw error;}
  }
  async send(message,band=0,volume=.12){if(!this.enabled)throw new Error('Sonido desactivado. Informe QR disponible.');await this.unlock();if(this.playing)return false;
    const token=this.epoch,pcm=synthesize(message,band,this.ctx.sampleRate,Math.min(.3,Math.max(.02,volume))),buffer=this.ctx.createBuffer(1,pcm.length,this.ctx.sampleRate);buffer.copyToChannel(pcm,0);const s=this.ctx.createBufferSource();s.buffer=buffer;s.connect(this.output);this.playing=s;
    return new Promise(resolve=>{s.onended=()=>{s.disconnect();if(this.playing===s)this.playing=null;resolve(token===this.epoch);};s.start(this.ctx.currentTime+.06);});}
  cancel(){this.epoch++;try{this.playing?.stop();}catch{}this.playing=null;}
  stop(){this.cancel();this.source?.disconnect();this.node?.disconnect();if(this.node&&'onaudioprocess' in this.node)this.node.onaudioprocess=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.source=null;this.node=null;this.enabled=false;try{this.ctx?.suspend()?.catch(()=>{});}catch{}}
}
''')
p=root/'tests/adaptive-browser.py';s=p.read_text()
s=s.replace("errors=[];page.on('pageerror',lambda e:errors.append(str(e)))", "errors=[];page.on('pageerror',lambda e:errors.append(str(e)))\n  page.on('console',lambda m: print('BROWSER',m.type,m.text,flush=True))")
s=s.replace("window.framesAB={A,B,sink};", """window.framesAB={A,B,sink};
    window.cameraPump=setInterval(()=>{for(const c of [A.hopperTest.canvas,B.document.getElementById('reportCanvas')])if(c.width&&c.height)c.getContext('2d').drawImage(c,0,0);},80);
    window.startupState=()=>({AState:A.hopperTest.sender?.state,Actx:A.hopperTest.audio.ctx?.state,mode:A.hopperTest.audio.mode,Atime:A.hopperTest.audio.ctx?.currentTime,Astream:A.hopperTest.audio.stream?.getTracks().map(t=>[t.kind,t.readyState,t.muted]),Bctx:B.hopperTest.audio.ctx?.state,Btime:B.hopperTest.audio.ctx?.currentTime,Bvideo:[B.document.getElementById('rxVideo').readyState,B.document.getElementById('rxVideo').videoWidth,B.document.getElementById('rxVideo').paused],Bnotice:B.document.getElementById('notice').textContent,Amsg:A.document.getElementById('audioState').textContent});""")
s=s.replace("  try:\n   if not use_audio:","  try:\n   page.wait_for_timeout(10000)\n   print('STARTUP',json.dumps(page.evaluate('startupState()'),ensure_ascii=False),flush=True)\n   assert page.evaluate(\"framesAB.A.hopperTest.sender?.state !== 'starting'\"), 'Sender media initialization did not finish'\n   if use_audio: assert page.evaluate('framesAB.A.hopperTest.sender.microphone'), 'Microphone PCM initialization failed'\n   if not use_audio:")
s=s.replace("'actual AudioWorklet PCM loopback'", "'actual acoustic PCM loopback'")
s=s.replace("audio:framesAB.A.hopperTest.sender.band,", "audio:framesAB.A.hopperTest.sender.band,audioEngine:framesAB.A.hopperTest.audio.mode,")
s=s.replace("page.evaluate('framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')", "page.evaluate('clearInterval(window.cameraPump);framesAB.A.hopperTest.stop();framesAB.B.hopperTest.stop()')")
p.write_text(s)
