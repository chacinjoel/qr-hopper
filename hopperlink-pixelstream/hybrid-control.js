(() => {
'use strict';

// Hopper Hybrid Control v1
// Audio carries only a robust READY signal. The actual NACK/COMPLETE payload
// remains on the existing grayscale HPS7 optical control frame and is read by
// the sender's front camera automatically.
const VERSION=1;
const LOW=770, HIGH=1336; // classic DTMF "5" voice-band pair
const PULSE_MS=150, GAP_MS=90, PULSES=8, LEAD_MS=450;
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,silentGain=null,listenToken=0;

const $=id=>document.getElementById(id);
function setStatus(text,kind=''){const e=$('controlChannelStatus');if(!e)return;e.textContent=text;e.className='chip '+kind;}
function setOverlay(text){const o=$('streamOverlay'),e=$('streamBottom');if(!e||!o||o.style.display==='none')return;e.textContent=text;}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:hybrid-'+name,{detail}));}catch{}}
function log(msg){const e=$('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] HYBRID · ${msg}\n`+e.textContent.slice(0,8500);}
function dbAt(data,f,sr,fft){const bin=Math.round(f*fft/sr);return data[Math.max(0,Math.min(data.length-1,bin))]??-120;}

async function unlockSpeaker(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');if(!outCtx)outCtx=new AC({latencyHint:'interactive'});if(outCtx.state==='suspended')await outCtx.resume();return outCtx;}
function micTrackLive(){const t=micStream?.getAudioTracks?.()[0];return!!t&&t.readyState==='live';}
async function ensureSenderMic(){
  if(micStream&&analyser&&micCtx&&micTrackLive()){
    if(micCtx.state!=='running')try{await micCtx.resume();}catch{}
    if(micCtx.state==='running'){setStatus('HÍBRIDO · MIC LISTO','on');return true;}
    stopMic();
  }
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Micrófono no disponible');
  setStatus('HÍBRIDO · PIDIENDO MIC…','mid');
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
  const AC=window.AudioContext||window.webkitAudioContext;micCtx=new AC({latencyHint:'interactive'});if(micCtx.state==='suspended')await micCtx.resume();
  micSource=micCtx.createMediaStreamSource(micStream);analyser=micCtx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.12;analyser.minDecibels=-100;analyser.maxDecibels=-10;
  silentGain=micCtx.createGain();silentGain.gain.value=1e-7;micSource.connect(analyser);analyser.connect(silentGain);silentGain.connect(micCtx.destination);
  setStatus('HÍBRIDO · MIC LISTO','on');log(`micrófono listo · ${micCtx.sampleRate} Hz`);emit('mic-ready',{sampleRate:micCtx.sampleRate});return true;
}
async function preflightFrontCamera(){
  if(!navigator.mediaDevices?.getUserMedia)return false;
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'user'},width:{ideal:1280},height:{ideal:720}},audio:false});
    s.getTracks().forEach(t=>t.stop());
    log('selfie autorizada para lectura automática de NACK/COMPLETE.');emit('selfie-ready');return true;
  }catch(e){log(`selfie preflight: ${e.message}`);return false;}
}
async function prepareSender(){await ensureSenderMic();await preflightFrontCamera();return true;}
function stopMic(){listenToken++;try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();}catch{}try{analyser?.disconnect?.();}catch{}try{silentGain?.disconnect?.();}catch{}micStream=null;micSource=null;analyser=null;silentGain=null;try{micCtx?.close?.();}catch{}micCtx=null;}

function makeReadyBuffer(){const ctx=outCtx,sr=ctx.sampleRate,lead=Math.round(sr*LEAD_MS/1000),pulse=Math.round(sr*PULSE_MS/1000),gap=Math.round(sr*GAP_MS/1000),tail=Math.round(sr*.15),total=lead+PULSES*(pulse+gap)+tail,buf=ctx.createBuffer(1,total,sr),d=buf.getChannelData(0),fade=Math.max(8,Math.round(sr*.003));let p=lead;for(let k=0;k<PULSES;k++){for(let n=0;n<pulse;n++){const t=n/sr,env=Math.min(1,n/fade,(pulse-1-n)/fade);d[p+n]=(.19*Math.sin(2*Math.PI*LOW*t)+.19*Math.sin(2*Math.PI*HIGH*t))*env;}p+=pulse+gap;}return buf;}
async function signalReady(label='CONTROL READY'){
  await unlockSpeaker();const src=outCtx.createBufferSource(),buf=makeReadyBuffer();src.buffer=buf;src.connect(outCtx.destination);setStatus(`HÍBRIDO · TX READY`,'mid');emit('ready-tx',{label,durationMs:buf.duration*1000});return new Promise((resolve,reject)=>{src.onended=()=>{setStatus('HÍBRIDO · CONTROL VISIBLE','on');resolve();};try{src.start();}catch(e){reject(e);}});
}
async function waitReady({timeoutMs=20000}={}){
  await ensureSenderMic();if(!analyser||!micCtx||micCtx.state!=='running')throw new Error('DSP híbrido no disponible');
  const token=++listenToken,freq=new Float32Array(analyser.frequencyBinCount),sr=micCtx.sampleRate,fft=analyser.fftSize;let hits=0,best=-120,lastUi=0;
  setStatus('HÍBRIDO · ESPERANDO READY','mid');setOverlay('AUTO HYBRID · esperando tono READY del receptor…');emit('ready-listen');
  return new Promise((resolve,reject)=>{let timer,timeout;const clean=()=>{if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);};timer=setInterval(()=>{if(token!==listenToken){clean();return;}analyser.getFloatFrequencyData(freq);const lo=dbAt(freq,LOW,sr,fft),hi=dbAt(freq,HIGH,sr,fft),l2=Math.max(dbAt(freq,697,sr,fft),dbAt(freq,852,sr,fft),dbAt(freq,941,sr,fft)),h2=Math.max(dbAt(freq,1209,sr,fft),dbAt(freq,1477,sr,fft),dbAt(freq,1633,sr,fft)),strength=Math.min(lo,hi),margin=Math.min(lo-l2,hi-h2);best=Math.max(best,strength);const active=lo>-68&&hi>-68&&margin>2.5;if(active)hits++;else hits=Math.max(0,hits-1);const now=performance.now();if(now-lastUi>160){lastUi=now;setOverlay(`AUTO HYBRID · ${active?'READY DETECTADO':'escuchando'} · hits ${hits}/4 · ${strength.toFixed(1)} dB`);}if(hits>=4){clean();setStatus('HÍBRIDO · READY OK · SELFIE','on');setOverlay('AUTO HYBRID · READY OK · abriendo selfie para leer control…');emit('ready-rx',{strength,margin});resolve({ok:true,strength,margin});}},20);timeout=setTimeout(()=>{clean();setStatus('HÍBRIDO · READY TIMEOUT','off');reject(new Error(`Timeout READY híbrido · pico ${best.toFixed(1)} dB`));},timeoutMs);});
}

document.addEventListener('click',e=>{if(e.target?.id==='cameraBtn')unlockSpeaker().catch(()=>{});},{capture:true});
document.addEventListener('change',e=>{if(e.target?.id==='controlMode')setStatus(e.target.value==='acoustic'?'AUTO HÍBRIDO · AUDIO + SELFIE':'NACK MANUAL',e.target.value==='acoustic'?'mid':'on');});
window.addEventListener('pagehide',()=>stopMic());
window.HopperHybrid={VERSION,prepareSender,ensureSenderMic,preflightFrontCamera,stopMic,unlockSpeaker,signalReady,waitReady};
window.__hopperHybrid={version:'1.0',mode:'audio-ready + visual-control + selfie',readyHz:[LOW,HIGH]};
})();
