import {AudioDecoder,synthesize} from './audio-codec.js';
function bounded(promise,ms,message){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));}
export class SoundChannel{
 constructor(onPacket,onState=()=>{}){this.onPacket=onPacket;this.onState=onState;this.context=null;this.stream=null;this.source=null;this.busy=false;this.decoder=new AudioDecoder(p=>this.onPacket(p));this.cancelled=0;}
 async enable({microphone=false}={}){
  const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)throw Error('Web Audio no está disponible. Usa QR.');
  this.onState('Activando audio local…');this.context??=new Context();await bounded(this.context.resume(),5000,'El audio no se activó. Toca de nuevo el botón o utiliza QR.');if(this.context.state!=='running')throw Error('Toca Activar sonido para desbloquear el audio.');
  if(microphone&&!this.stream){
   if(!this.context.audioWorklet)throw Error('AudioWorklet no disponible; se conserva el intercambio por QR.');
   const requested={echoCancellation:false,noiseSuppression:false,autoGainControl:false},generation=this.cancelled;
   try{this.onState('Esperando permiso del micrófono…');let expired=false;
    const request=navigator.mediaDevices.getUserMedia({audio:requested,video:false}).then(s=>{if(expired||generation!==this.cancelled){s.getTracks().forEach(t=>t.stop());throw Error('Solicitud de micrófono cancelada.');}return s;});
    try{this.stream=await bounded(request,20000,'No llegó el permiso de micrófono. Se puede continuar por QR.');}catch(e){expired=true;throw e;}
    this.onState('Cargando analizador de tonos…');await bounded(this.context.audioWorklet.addModule(new URL('./audio-worklet.js',import.meta.url)),10000,'No se pudo iniciar el analizador de audio. Usa QR.');
    this.input=this.context.createMediaStreamSource(this.stream);this.node=new AudioWorkletNode(this.context,'hopper-audio-sampler');this.node.port.onmessage=e=>this.decoder.push(e.data.t,e.data.features);this.input.connect(this.node);this.node.connect(this.context.destination);
   }catch(e){this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;throw e;}
  }
  this.onState(microphone?'Micrófono local activo; no se graba ni se sube audio.':'Sonido listo. Volumen moderado, sin auriculares.');return true;
 }
 async send(packet,{gain=.12}={}){
  if(this.busy||!this.context||this.context.state!=='running')return false;this.busy=true;const generation=this.cancelled;
  try{const samples=synthesize(packet,this.context.sampleRate,gain),buffer=this.context.createBuffer(1,samples.length,this.context.sampleRate);buffer.copyToChannel(samples,0);const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);this.source=source;
   await new Promise(resolve=>{source.onended=resolve;source.start(this.context.currentTime+.025);});return generation===this.cancelled;
  }finally{this.source=null;this.busy=false;}
 }
 cancel(){this.cancelled++;try{this.source?.stop();}catch{}this.decoder.reset();}
 close(){this.cancel();this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.input?.disconnect();this.node?.disconnect();this.context?.close().catch(()=>{});this.context=null;}
}
