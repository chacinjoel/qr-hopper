import { FlashDecoder, feedbackChips, FLASH_HALF_MS, FLASH_MESSAGE_MS } from './feedback.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
export function torchAvailable(track) {
  const t = track?.getCapabilities?.().torch;
  return t === true || Array.isArray(t) && t.includes(true);
}

export class TorchChannel {
  constructor(track) { this.track=track; this.busy=false; this.cancelled=false; }
  async set(on) {
    if (this.track.readyState !== 'live') throw new Error('Cámara cerrada.');
    // Preserve the capture constraints: a torch command must not reset camera
    // resolution, frame rate, or the user's focus/exposure settings.
    const base=this.track.getConstraints?.() || {};
    const advanced=(base.advanced || []).map(x=>{const y={...x};delete y.torch;return y;});
    await this.track.applyConstraints({...base, torch:on, advanced:[...advanced,{torch:on}]});
    const actual=this.track.getSettings?.().torch;
    if(typeof actual==='boolean' && actual!==on) throw new Error('El navegador no aplicó el cambio del flash.');
  }
  async send(request, onProgress=()=>{}) {
    if(this.busy) throw new Error('El flash ya está enviando una solicitud.');
    if(!torchAvailable(this.track)) throw new Error('Este navegador/cámara no expone control de flash.');
    this.busy=true;this.cancelled=false;
    try {
      await this.set(false);
      const chips=feedbackChips(request), start=performance.now();let previous=0;
      for(let i=0;i<chips.length;i++) {
        if(this.cancelled || document.hidden) throw new Error('Retorno cancelado: mantén la página visible.');
        await sleep(start+i*FLASH_HALF_MS-performance.now());
        if(chips[i]!==previous) {await this.set(!!chips[i]);previous=chips[i];}
        if(performance.now()-(start+i*FLASH_HALF_MS)>FLASH_HALF_MS*.8) throw new Error('Control de flash demasiado lento; usa el código de reparación.');
        onProgress(Math.floor((i+1)/chips.length*100));
      }
      await sleep(start+FLASH_MESSAGE_MS-performance.now());
    } finally { try{await this.set(false);}catch{} this.busy=false; }
  }
  async stop() {this.cancelled=true;try{await this.set(false);}catch{}}
}

// Front camera is only analysed in explicit feedback windows, to limit CPU use
// during payload emission. The video is local, muted, and never uploaded.
export class FlashListener {
  constructor(video, onPacket, onStatus=()=>{}) {
    this.video=video;this.onPacket=onPacket;this.onStatus=onStatus;this.media=null;
    this.listening=false;this.callback=0;this.kind='raf';this.lastTime=-1;
    this.canvas=document.createElement('canvas');this.canvas.width=160;this.canvas.height=120;
    this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.decoders=Array.from({length:24},()=>new FlashDecoder(p=>this.onPacket(p)));
  }
  async start() {
    if(this.media)return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('La cámara frontal requiere HTTPS y permiso.');
    try {
      this.media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'user'},width:{ideal:320},height:{ideal:240},frameRate:{ideal:30}}});
      this.video.srcObject=this.media;await this.video.play();this.schedule();
      this.onStatus('Cámara frontal lista. Se analiza solo durante el retorno.');
    } catch(error){this.stop();throw error;}
  }
  arm(on) {this.listening=on;this.decoders.forEach(d=>d.reset());this.lastTime=-1;}
  schedule() {
    if(!this.media)return;
    if(this.video.requestVideoFrameCallback){this.kind='video';this.callback=this.video.requestVideoFrameCallback(t=>this.loop(t));}
    else {this.kind='raf';this.callback=requestAnimationFrame(t=>this.loop(t));}
  }
  loop(t) {
    try {
      if(!this.listening||this.video.readyState<2||this.video.currentTime===this.lastTime)return;
      this.lastTime=this.video.currentTime;
      this.ctx.drawImage(this.video,0,0,160,120);
      const data=this.ctx.getImageData(0,0,160,120).data;
      const sums=new Float64Array(24),counts=new Uint16Array(24);
      for(let y=0;y<120;y+=2)for(let x=0;x<160;x+=2){const o=(y*160+x)*4,i=Math.min(5,Math.floor(x/160*6))+Math.min(3,Math.floor(y/120*4))*6;
        sums[i]+=.2126*data[o]+.7152*data[o+1]+.0722*data[o+2];counts[i]++;}
      for(let i=0;i<24;i++)this.decoders[i].feed(t,sums[i]/counts[i]);
    }catch(error){this.onStatus(`Lectura del flash: ${error.message}`);}
    finally{this.schedule();}
  }
  stop() {
    this.listening=false;
    if(this.kind==='video')this.video.cancelVideoFrameCallback?.(this.callback);else cancelAnimationFrame(this.callback);
    this.media?.getTracks().forEach(t=>t.stop());this.media=null;this.video.srcObject=null;
  }
}
