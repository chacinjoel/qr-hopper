(() => {
'use strict';

// HAC4 DualTone16 · DTMF-style acoustic control plane.
// Every 4-bit symbol is encoded as one low-group + one high-group tone.
// Designed for phone speaker -> phone microphone channels where voice-band tones
// are substantially more reliable than many simultaneous high-frequency carriers.
const VERSION=4, MAGIC=[0x48,0x41,0x43,0x34]; // HAC4
const TYPE={NACK:1,COMPLETE:2};
const LOW=[697,770,852,941];
const HIGH=[1209,1336,1477,1633];
const PROBES=[560,1080,1880,2140];
const SYMBOL_MS=72, TONE_MS=44, LEAD_MS=760, REPEAT_GAP_MS=320;
const SYNC=[0xD,0x2,0xB,0x4,0x7,0xC,0x1,0xE,0x9,0x6,0xA,0x5];
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,silentGain=null,listenToken=0;

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function u16(n){return[(n>>>8)&255,n&255];}
function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];}
function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length;}return o;}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:acoustic-'+name,{detail}));}catch{}}
function setStatus(text,kind=''){const e=document.getElementById('controlChannelStatus');if(!e)return;e.textContent=text;e.className='chip '+kind;}
function setOverlay(text){const o=document.getElementById('streamOverlay'),e=document.getElementById('streamBottom');if(!e||!o||o.style.display==='none')return;e.textContent=text;}
function mode(){return document.getElementById('controlMode')?.value||'manual';}
function alog(msg){const e=document.getElementById('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] HAC4 · ${msg}\n`+e.textContent.slice(0,8500);}

function putVar(out,n){n>>>=0;while(n>=128){out.push((n&127)|128);n>>>=7;}out.push(n);}
function getVar(a,state){let n=0,s=0;while(state.p<a.length&&s<=28){const b=a[state.p++];n|=(b&127)<<s;if(!(b&128))return n>>>0;s+=7;}throw new Error('varint');}
function encodeDelta(list){const out=[0];putVar(out,list.length);let prev=-1;for(const idx of list){putVar(out,idx-prev-1);prev=idx;}return new Uint8Array(out);}
function encodeRanges(list){const runs=[];for(let i=0;i<list.length;){let s=list[i],e=s;i++;while(i<list.length&&list[i]===e+1)e=list[i++];runs.push([s,e-s+1]);}const out=[1];putVar(out,runs.length);let prevEnd=-1;for(const [s,len]of runs){putVar(out,s-prevEnd-1);putVar(out,len);prevEnd=s+len-1;}return new Uint8Array(out);}
function compressMissing(list){const sorted=Array.from(new Set(list)).sort((a,b)=>a-b),a=encodeDelta(sorted),b=encodeRanges(sorted);return a.length<=b.length?a:b;}
function decompressMissing(payload,total){if(!payload.length)return[];const st={p:1},out=[];if(payload[0]===0){const n=getVar(payload,st);let prev=-1;for(let i=0;i<n;i++){const idx=prev+1+getVar(payload,st);if(idx>=total)throw new Error('missing index');out.push(idx);prev=idx;}}else if(payload[0]===1){const n=getVar(payload,st);let prevEnd=-1;for(let i=0;i<n;i++){const start=prevEnd+1+getVar(payload,st),len=getVar(payload,st);if(start+len>total)throw new Error('missing range');for(let j=0;j<len;j++)out.push(start+j);prevEnd=start+len-1;}}else throw new Error('missing codec');return out;}

function makePacket(type,{session,round=0,bits=3,total=0,fileCrc=0,missing=[]}){const payload=type===TYPE.NACK?compressMissing(missing):new Uint8Array(0),h=new Uint8Array(23);h.set(MAGIC,0);h[4]=VERSION;h[5]=type;h.set(u32(session>>>0),6);h.set(u16(round),10);h[12]=bits;h.set(u32(total>>>0),13);h.set(u32(fileCrc>>>0),17);h.set(u16(payload.length),21);const body=concat(h,payload);return concat(body,new Uint8Array(u32(crc32(body))));}
function parsePacket(a,off=0){if(a.length-off<27)return null;for(let i=0;i<4;i++)if(a[off+i]!==MAGIC[i])return null;if(a[off+4]!==VERSION)return null;const type=a[off+5],session=readU32(a,off+6),round=readU16(a,off+10),bits=a[off+12],total=readU32(a,off+13),fileCrc=readU32(a,off+17),len=readU16(a,off+21),need=27+len;if(type!==TYPE.NACK&&type!==TYPE.COMPLETE)return null;if(a.length-off<need)return{pending:true,need};const body=a.slice(off,off+23+len),expected=readU32(a,off+23+len);if(crc32(body)!==expected)return{bad:true,need};const payload=a.slice(off+23,off+23+len);let missing=[];try{if(type===TYPE.NACK)missing=decompressMissing(payload,total);}catch{return{bad:true,need};}return{ok:true,need,type,session,round,bits,total,fileCrc,missing,payloadBytes:len};}

async function unlockSpeaker(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');if(!outCtx)outCtx=new AC({latencyHint:'interactive'});if(outCtx.state==='suspended')await outCtx.resume();return outCtx;}
function micTrackLive(){const t=micStream?.getAudioTracks?.()[0];return!!t&&t.readyState==='live';}
async function ensureSenderMic(){
  if(micStream&&analyser&&micCtx&&micTrackLive()){
    if(micCtx.state!=='running')try{await micCtx.resume();}catch(e){alog(`resume falló: ${e.message}`);}
    if(micCtx.state==='running'){setStatus('ACÚSTICO · HAC4 DSP RUNNING','on');setOverlay('HAC4 RX · DSP RUNNING · esperando tonos…');emit('dsp-ready',{sampleRate:micCtx.sampleRate,fftSize:analyser.fftSize,state:micCtx.state,reused:true});return true;}
    stopMic();
  }
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Micrófono no disponible');
  setStatus('ACÚSTICO · PIDIENDO MIC…','mid');
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false});
  const AC=window.AudioContext||window.webkitAudioContext;micCtx=new AC({latencyHint:'interactive'});if(micCtx.state==='suspended')await micCtx.resume();
  micSource=micCtx.createMediaStreamSource(micStream);analyser=micCtx.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=-10;
  silentGain=micCtx.createGain();silentGain.gain.value=1e-7;micSource.connect(analyser);analyser.connect(silentGain);silentGain.connect(micCtx.destination);
  micCtx.onstatechange=()=>emit('dsp-state',{state:micCtx?.state||'closed'});
  setStatus('ACÚSTICO · HAC4 DSP RUNNING','on');setOverlay('HAC4 RX · DSP RUNNING · micrófono listo');alog(`DTMF DSP vivo · ${micCtx.sampleRate} Hz · FFT ${analyser.fftSize}`);emit('mic-ready',{sampleRate:micCtx.sampleRate,fftSize:analyser.fftSize,state:micCtx.state,protocol:'HAC4'});return true;
}
function stopMic(){listenToken++;try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();}catch{}try{analyser?.disconnect?.();}catch{}try{silentGain?.disconnect?.();}catch{}micStream=null;micSource=null;analyser=null;silentGain=null;try{micCtx?.close?.();}catch{}micCtx=null;}

function packetToNibbles(packet){const out=[...SYNC];for(const b of packet)out.push((b>>>4)&15,b&15);return out;}
function buildAudio(packet,repeats=1){const ctx=outCtx,sr=ctx.sampleRate,symN=Math.round(sr*SYMBOL_MS/1000),toneN=Math.round(sr*TONE_MS/1000),leadN=Math.round(sr*LEAD_MS/1000),gapN=Math.round(sr*REPEAT_GAP_MS/1000),tailN=Math.round(sr*.12),frames=[];for(let r=0;r<repeats;r++)frames.push(packetToNibbles(packet));const total=leadN+frames.reduce((s,f)=>s+f.length*symN,0)+Math.max(0,repeats-1)*gapN+tailN,buf=ctx.createBuffer(1,total,sr),d=buf.getChannelData(0),fade=Math.max(8,Math.round(sr*.0018));
  // Wake the physical audio route with a harmless single tone that cannot decode as DTMF.
  const wakeStart=Math.round(sr*.18),wakeEnd=Math.min(leadN-Math.round(sr*.22),wakeStart+Math.round(sr*.26));for(let n=wakeStart;n<wakeEnd;n++){const t=(n-wakeStart)/sr;d[n]=.10*Math.sin(2*Math.PI*1000*t);}
  let cursor=leadN;for(let r=0;r<frames.length;r++){for(const nib of frames[r]){const row=(nib>>>2)&3,col=nib&3,fl=LOW[row],fh=HIGH[col];for(let n=0;n<toneN;n++){const t=n/sr,env=Math.min(1,n/fade,(toneN-1-n)/fade);d[cursor+n]=(.18*Math.sin(2*Math.PI*fl*t)+.18*Math.sin(2*Math.PI*fh*t))*env;}cursor+=symN;}if(r<frames.length-1)cursor+=gapN;}return buf;}
async function playPacket(packet,{repeats=1,label='CONTROL'}={}){await unlockSpeaker();const buf=buildAudio(packet,Math.max(1,repeats)),src=outCtx.createBufferSource();src.buffer=buf;src.connect(outCtx.destination);setStatus(`ACÚSTICO · TX ${label}`,'mid');alog(`TX ${label} · ${packet.length} B · ${repeats}x · ${buf.duration.toFixed(1)} s`);emit('tx-start',{bytes:packet.length,repeats,durationMs:buf.duration*1000,label,protocol:'HAC4'});return new Promise((resolve,reject)=>{src.onended=()=>{setStatus('ACÚSTICO · TX OK','on');emit('tx-end',{label});resolve();};try{src.start();}catch(e){reject(e);}});}
async function sendNack(args){const p=makePacket(TYPE.NACK,args),repeats=p.length<=180?2:1;return playPacket(p,{repeats,label:`NACK ${args.missing?.length||0}`});}
async function sendComplete(args){return playPacket(makePacket(TYPE.COMPLETE,args),{repeats:3,label:'COMPLETE'});}

function dbAt(data,f,sr,fft){const bin=Math.round(f*fft/sr);return data[Math.max(0,Math.min(data.length-1,bin))]??-120;}
function median(a){const s=a.slice().sort((x,y)=>x-y);return s[Math.floor(s.length/2)]??-100;}
function top2(vals){let i1=0,i2=1;if(vals[i2]>vals[i1]){const t=i1;i1=i2;i2=t;}for(let i=2;i<vals.length;i++){if(vals[i]>vals[i1]){i2=i1;i1=i;}else if(vals[i]>vals[i2])i2=i;}return[i1,i2];}
function classifyNibble(freq,sr,fft){const lv=LOW.map(f=>dbAt(freq,f,sr,fft)),hv=HIGH.map(f=>dbAt(freq,f,sr,fft)),noise=median(PROBES.map(f=>dbAt(freq,f,sr,fft))),[li,li2]=top2(lv),[hi,hi2]=top2(hv),lm=lv[li]-lv[li2],hm=hv[hi]-hv[hi2],snr=Math.min(lv[li]-noise,hv[hi]-noise),active=lv[li]>-82&&hv[hi]>-82&&snr>5.5&&lm>2.2&&hm>2.2;return{active,nibble:(li<<2)|hi,lowDb:lv[li],highDb:hv[hi],noiseDb:noise,snr,lowMargin:lm,highMargin:hm};}
function syncDistance(window){if(window.length<SYNC.length)return 999;let d=0;const off=window.length-SYNC.length;for(let i=0;i<SYNC.length;i++)if(window[off+i]!==SYNC[i])d++;return d;}

async function listenControl({session,round=null,timeoutMs=120000}={}){
  await ensureSenderMic();if(!micCtx||micCtx.state!=='running'||!analyser)throw new Error(`DSP acústico no está RUNNING (${micCtx?.state||'sin contexto'})`);
  const token=++listenToken,fft=analyser.fftSize,sr=micCtx.sampleRate,freq=new Float32Array(analyser.frequencyBinCount),recent=[],frameNibbles=[];let armed=true,quietHits=0,nibbles=0,bytes=0,syncs=0,crcFails=0,lastDiag=0,bestSnr=-99,inFrame=false;
  setStatus('ACÚSTICO · HAC4 ESCUCHANDO','mid');setOverlay('HAC4 RX · DTMF · esperando NACK/COMPLETE…');alog(`escuchando DTMF · sesión ${Number(session>>>0).toString(16)} · ronda ${round==null?'*':round+1}`);emit('listen-start',{session,round,timeoutMs,fft,symbolMs:SYMBOL_MS,protocol:'HAC4'});
  return new Promise((resolve,reject)=>{let timer=null,timeout=null;const cleanup=()=>{if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);};
    const tryFrame=()=>{if(frameNibbles.length<54)return false;const even=frameNibbles.length-(frameNibbles.length%2),arr=new Uint8Array(even/2);for(let i=0;i<even;i+=2)arr[i/2]=(frameNibbles[i]<<4)|frameNibbles[i+1];bytes=arr.length;const r=parsePacket(arr,0);if(r?.bad){crcFails++;return false;}if(!r?.ok)return false;if(session!=null&&r.session!==(session>>>0))return false;if(round!=null&&r.round!==round)return false;cleanup();setStatus(`ACÚSTICO · RX ${r.type===TYPE.NACK?'NACK':'COMPLETE'} OK`,'on');setOverlay(`HAC4 RX · ${r.type===TYPE.NACK?'NACK':'COMPLETE'} CRC OK · SYNC ${syncs}`);alog(`RX ${r.type===TYPE.NACK?'NACK':'COMPLETE'} OK · ${nibbles} símbolos · SYNC ${syncs} · CRC fail ${crcFails}`);emit('rx-ok',{type:r.type,bytes:r.need,payloadBytes:r.payloadBytes,nibbles,syncs,crcFails,bestSnr,protocol:'HAC4'});resolve(r);return true;};
    const diagnostic=(d)=>{const now=performance.now();if(now-lastDiag<180)return;lastDiag=now;bestSnr=Math.max(bestSnr,d.snr);const label=d.active?'TONO OK':d.snr>2?'TONO DÉBIL':'SIN TONO';setStatus(`ACÚSTICO · ${label} · ${nibbles} nib · SYNC ${syncs}` ,d.active?'mid':'off');setOverlay(`HAC4 RX · ${label} · ${nibbles} símbolos / ${bytes} bytes · SYNC ${syncs} · CRC ${crcFails} · SNR ${Number.isFinite(d.snr)?d.snr.toFixed(1):'—'} dB`);emit('rx-signal',{active:d.active,nibbles,bytes,syncs,crcFails,snr:d.snr,lowMargin:d.lowMargin,highMargin:d.highMargin});};
    const decodeOne=()=>{if(token!==listenToken){cleanup();return;}analyser.getFloatFrequencyData(freq);const d=classifyNibble(freq,sr,fft);diagnostic(d);if(!d.active){quietHits++;if(quietHits>=2)armed=true;return;}quietHits=0;if(!armed)return;armed=false;setTimeout(()=>{if(token!==listenToken||!analyser)return;analyser.getFloatFrequencyData(freq);const q=classifyNibble(freq,sr,fft);if(!q.active)return;const nib=q.nibble;nibbles++;recent.push(nib);if(recent.length>SYNC.length)recent.shift();const sd=syncDistance(recent);if(sd<=2){syncs++;inFrame=true;frameNibbles.length=0;bytes=0;emit('sync',{syncs,distance:sd,nibbles});setOverlay(`HAC4 RX · SYNC ${syncs} · recibiendo paquete…`);return;}if(inFrame){frameNibbles.push(nib);bytes=Math.floor(frameNibbles.length/2);if(frameNibbles.length>5000){inFrame=false;frameNibbles.length=0;}else tryFrame();}emit('symbol',{nibbles,bytes,syncs,nibble:nib,snr:q.snr});},7);};
    timer=setInterval(decodeOne,4);timeout=setTimeout(()=>{cleanup();setStatus(`ACÚSTICO · TIMEOUT · SYNC ${syncs}`,'off');setOverlay(`HAC4 RX · TIMEOUT · ${nibbles} símbolos · SYNC ${syncs} · CRC ${crcFails}`);alog(`TIMEOUT · ${nibbles} símbolos · SYNC ${syncs} · CRC ${crcFails} · SNR pico ${bestSnr.toFixed(1)} dB`);reject(new Error(`Timeout acústico HAC4: ${nibbles} símbolos, SYNC ${syncs}, CRC ${crcFails}`));},timeoutMs);
  });
}

document.addEventListener('change',e=>{if(e.target?.id==='controlMode')setStatus(e.target.value==='acoustic'?'ACÚSTICO HAC4 · SE ACTIVARÁ AL PREPARAR':'NACK MANUAL',e.target.value==='acoustic'?'mid':'on');});
document.addEventListener('click',e=>{if(e.target?.id==='cameraBtn')unlockSpeaker().catch(()=>{});},{capture:true});
window.addEventListener('pagehide',()=>stopMic());
window.HopperAcoustic={VERSION,TYPE,mode,unlockSpeaker,ensureSenderMic,stopMic,sendNack,sendComplete,listenControl,compressMissing,decompressMissing,makePacket,parsePacket,classifyNibble,syncDistance,SYNC};
window.__hopperAcoustic={version:'0.9.5',protocol:'HAC4 DualTone16',symbolMs:SYMBOL_MS,toneMs:TONE_MS,low:LOW,high:HIGH};
})();
