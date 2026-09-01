(() => {
'use strict';

// v0.9.0c: one-shot syntax guard for the dynamically patched HPS7 core.
// The acoustic PASS_END patch in v0.9.0 accidentally left one extra closing brace
// before controlPayloadNack(). Because this module loads before hps7-runtime.js,
// intercept the single HPS7 core compilation, repair the exact sequence, then
// immediately restore the native Function constructor.
const NativeFunction = window.Function;
let syntaxGuardArmed = true;
function GuardedFunction(...args){
  const last = args.length - 1;
  if(syntaxGuardArmed && last >= 0 && typeof args[last] === 'string' && args[last].includes('hps7-core-v090.js')){
    const bad = "else showNack(p.round,suggest);}}}\nfunction controlPayloadNack";
    const good = "else showNack(p.round,suggest);}}\nfunction controlPayloadNack";
    if(args[last].includes(bad)){
      args[last] = args[last].replace(bad, good);
      syntaxGuardArmed = false;
      try{ window.dispatchEvent(new CustomEvent('hopper:runtime-syntax-fixed',{detail:{version:'0.9.0c'}})); }catch{}
    }
    window.Function = NativeFunction;
  }
  return NativeFunction(...args);
}
try{
  Object.setPrototypeOf(GuardedFunction, NativeFunction);
  GuardedFunction.prototype = NativeFunction.prototype;
  window.Function = GuardedFunction;
}catch{}

const VERSION=1, MAGIC=[0x48,0x41,0x43,0x31]; // HAC1
const TYPE={NACK:1,COMPLETE:2};
const CARRIERS=Array.from({length:24},(_,i)=>1700+i*210);
const PILOTS=[7000,7500];
const SYMBOL_MS=32, TONE_MS=26;
const PREAMBLE=[0xAA,0x55,0xCC,0x33,0xF0,0x0F,0x96,0x69,0x5A,0xA5,0x3C,0xC3];
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,listenToken=0;

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function u16(n){return[(n>>>8)&255,n&255];} function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];} function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length;}return o;}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:acoustic-'+name,{detail}));}catch{}}
function setStatus(text,kind=''){const e=document.getElementById('controlChannelStatus');if(!e)return;e.textContent=text;e.className='chip '+kind;}
function mode(){return document.getElementById('controlMode')?.value||'manual';}

function putVar(out,n){n>>>=0;while(n>=128){out.push((n&127)|128);n>>>=7;}out.push(n);}
function getVar(a,state){let n=0,s=0;while(state.p<a.length&&s<=28){const b=a[state.p++];n|=(b&127)<<s;if(!(b&128))return n>>>0;s+=7;}throw new Error('varint');}
function encodeDelta(list){const out=[0];putVar(out,list.length);let prev=-1;for(const idx of list){putVar(out,idx-prev-1);prev=idx;}return new Uint8Array(out);}
function encodeRanges(list){const runs=[];for(let i=0;i<list.length;){let s=list[i],e=s;i++;while(i<list.length&&list[i]===e+1)e=list[i++];runs.push([s,e-s+1]);}const out=[1];putVar(out,runs.length);let prevEnd=-1;for(const [s,len] of runs){putVar(out,s-prevEnd-1);putVar(out,len);prevEnd=s+len-1;}return new Uint8Array(out);}
function compressMissing(list){const sorted=Array.from(new Set(list)).sort((a,b)=>a-b),a=encodeDelta(sorted),b=encodeRanges(sorted);return a.length<=b.length?a:b;}
function decompressMissing(payload,total){if(!payload.length)return[];const st={p:1},out=[];if(payload[0]===0){const n=getVar(payload,st);let prev=-1;for(let i=0;i<n;i++){const idx=prev+1+getVar(payload,st);if(idx>=total)throw new Error('missing index');out.push(idx);prev=idx;}}else if(payload[0]===1){const n=getVar(payload,st);let prevEnd=-1;for(let i=0;i<n;i++){const start=prevEnd+1+getVar(payload,st),len=getVar(payload,st);if(start+len>total)throw new Error('missing range');for(let j=0;j<len;j++)out.push(start+j);prevEnd=start+len-1;}}else throw new Error('missing codec');return out;}

function makePacket(type,{session,round=0,bits=3,total=0,fileCrc=0,missing=[]}){const payload=type===TYPE.NACK?compressMissing(missing):new Uint8Array(0),h=new Uint8Array(23);h.set(MAGIC,0);h[4]=VERSION;h[5]=type;h.set(u32(session>>>0),6);h.set(u16(round),10);h[12]=bits;h.set(u32(total>>>0),13);h.set(u32(fileCrc>>>0),17);h.set(u16(payload.length),21);const body=concat(h,payload);return concat(body,new Uint8Array(u32(crc32(body))));}
function parsePacket(a,off=0){if(a.length-off<27)return null;for(let i=0;i<4;i++)if(a[off+i]!==MAGIC[i])return null;if(a[off+4]!==VERSION)return null;const type=a[off+5],session=readU32(a,off+6),round=readU16(a,off+10),bits=a[off+12],total=readU32(a,off+13),fileCrc=readU32(a,off+17),len=readU16(a,off+21),need=27+len;if(type!==TYPE.NACK&&type!==TYPE.COMPLETE)return null;if(a.length-off<need)return{pending:true,need};const body=a.slice(off,off+23+len),expected=readU32(a,off+23+len);if(crc32(body)!==expected)return{bad:true,need};const payload=a.slice(off+23,off+23+len);let missing=[];try{if(type===TYPE.NACK)missing=decompressMissing(payload,total);}catch{return{bad:true,need};}return{ok:true,need,type,session,round,bits,total,fileCrc,missing,payloadBytes:len};}

async function unlockSpeaker(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');if(!outCtx)outCtx=new AC({latencyHint:'interactive'});if(outCtx.state==='suspended')await outCtx.resume();return outCtx;}
async function ensureSenderMic(){if(micStream&&analyser)return true;if(!navigator.mediaDevices?.getUserMedia)throw new Error('Micrófono no disponible');setStatus('ACÚSTICO · PIDIENDO MIC…','mid');micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false});const AC=window.AudioContext||window.webkitAudioContext;micCtx=new AC({latencyHint:'interactive'});if(micCtx.state==='suspended')await micCtx.resume();micSource=micCtx.createMediaStreamSource(micStream);analyser=micCtx.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;micSource.connect(analyser);setStatus('ACÚSTICO · MIC LISTO','on');emit('mic-ready',{sampleRate:micCtx.sampleRate});return true;}
function stopMic(){listenToken++;try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();}catch{}micStream=null;micSource=null;analyser=null;try{micCtx?.close?.();}catch{}micCtx=null;}

function bytesToSymbols(bytes){const pad=(3-bytes.length%3)%3,b=new Uint8Array(bytes.length+pad);b.set(bytes);const out=[];for(let i=0;i<b.length;i+=3)out.push((b[i]<<16)|(b[i+1]<<8)|b[i+2]);return out;}
function buildAudio(packet,repeats=1){const bytes=[];for(let r=0;r<repeats;r++){bytes.push(...PREAMBLE,...packet);if(r<repeats-1)bytes.push(...new Array(12).fill(0));}const symbols=bytesToSymbols(new Uint8Array(bytes)),ctx=outCtx,sr=ctx.sampleRate,symN=Math.round(sr*SYMBOL_MS/1000),toneN=Math.round(sr*TONE_MS/1000),buf=ctx.createBuffer(1,symbols.length*symN,sr),d=buf.getChannelData(0),fade=Math.max(8,Math.round(sr*.0015));let parity=0;for(let si=0;si<symbols.length;si++,parity^=1){const word=symbols[si]>>>0,start=si*symN,pilot=PILOTS[parity],active=[];for(let bit=0;bit<24;bit++)if(word&(1<<(23-bit)))active.push(CARRIERS[bit]);for(let n=0;n<toneN;n++){const t=n/sr,env=Math.min(1,n/fade,(toneN-1-n)/fade);let v=.035*Math.sin(2*Math.PI*pilot*t);for(let j=0;j<active.length;j++)v+=.012*Math.sin(2*Math.PI*active[j]*t+j*.73);d[start+n]=Math.max(-.82,Math.min(.82,v))*env;}}return buf;}
async function playPacket(packet,{repeats=1,label='CONTROL'}={}){await unlockSpeaker();const buf=buildAudio(packet,Math.max(1,repeats)),src=outCtx.createBufferSource();src.buffer=buf;src.connect(outCtx.destination);setStatus(`ACÚSTICO · TX ${label}`,'mid');emit('tx-start',{bytes:packet.length,repeats,durationMs:buf.duration*1000,label});return new Promise((resolve,reject)=>{src.onended=()=>{setStatus('ACÚSTICO · TX OK','on');emit('tx-end',{label});resolve();};try{src.start();}catch(e){reject(e);}});}
async function sendNack(args){const p=makePacket(TYPE.NACK,args),repeats=p.length<=900?2:1;return playPacket(p,{repeats,label:`NACK ${args.missing?.length||0}`});}
async function sendComplete(args){return playPacket(makePacket(TYPE.COMPLETE,args),{repeats:3,label:'COMPLETE'});}

function dbAt(data,f,sr,fft){const bin=Math.round(f*fft/sr);return data[Math.max(0,Math.min(data.length-1,bin))]??-120;}
async function listenControl({session,round=null,timeoutMs=90000}={}){await ensureSenderMic();const token=++listenToken,fft=analyser.fftSize,sr=micCtx.sampleRate,freq=new Float32Array(analyser.frequencyBinCount),rxBytes=[];let armed=true,decodedSymbols=0,crcFails=0;setStatus('ACÚSTICO · ESCUCHANDO…','mid');emit('listen-start',{session,round,timeoutMs});return new Promise((resolve,reject)=>{let timer=null,timeout=null;const cleanup=()=>{if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);};const scanPackets=()=>{for(let off=0;off<=rxBytes.length-4;off++){if(rxBytes[off]!==MAGIC[0]||rxBytes[off+1]!==MAGIC[1]||rxBytes[off+2]!==MAGIC[2]||rxBytes[off+3]!==MAGIC[3])continue;const r=parsePacket(new Uint8Array(rxBytes),off);if(r?.pending)return false;if(r?.bad){crcFails++;continue;}if(r?.ok){if(session!=null&&r.session!==(session>>>0))continue;if(round!=null&&r.round!==round)continue;cleanup();setStatus(`ACÚSTICO · RX ${r.type===TYPE.NACK?'NACK':'COMPLETE'} OK`,'on');emit('rx-ok',{type:r.type,bytes:r.need,payloadBytes:r.payloadBytes,decodedSymbols,crcFails});resolve(r);return true;}}return false;};const decodeOne=()=>{if(token!==listenToken){cleanup();return;}analyser.getFloatFrequencyData(freq);const pilot=Math.max(dbAt(freq,PILOTS[0],sr,fft),dbAt(freq,PILOTS[1],sr,fft));if(pilot<-62){armed=true;return;}if(!armed||pilot<-52)return;armed=false;setTimeout(()=>{if(token!==listenToken)return;analyser.getFloatFrequencyData(freq);const q=Math.max(dbAt(freq,PILOTS[0],sr,fft),dbAt(freq,PILOTS[1],sr,fft));if(q<-58){armed=true;return;}const th=Math.max(-78,q-19);let word=0;for(let bit=0;bit<24;bit++){word<<=1;if(dbAt(freq,CARRIERS[bit],sr,fft)>th)word|=1;}rxBytes.push((word>>>16)&255,(word>>>8)&255,word&255);decodedSymbols++;if(rxBytes.length>24000)rxBytes.splice(0,6000);scanPackets();},10);};timer=setInterval(decodeOne,4);timeout=setTimeout(()=>{cleanup();setStatus('ACÚSTICO · TIMEOUT','off');emit('timeout',{decodedSymbols,crcFails});reject(new Error('Timeout acústico'));},timeoutMs);});}

document.addEventListener('change',e=>{if(e.target?.id==='controlMode')setStatus(e.target.value==='acoustic'?'ACÚSTICO · SE ACTIVARÁ AL PREPARAR':'NACK MANUAL',e.target.value==='acoustic'?'mid':'on');});
document.addEventListener('click',e=>{if(e.target?.id==='cameraBtn')unlockSpeaker().catch(()=>{});},{capture:true});
window.addEventListener('pagehide',()=>stopMic());
window.HopperAcoustic={VERSION,TYPE,mode,unlockSpeaker,ensureSenderMic,stopMic,sendNack,sendComplete,listenControl,compressMissing,decompressMissing,makePacket,parsePacket};
window.__hopperAcoustic={version:'0.9.0c',mode:'HAC1 multitone',carriers:24,symbolMs:SYMBOL_MS,estimatedBytesPerSecond:3/(SYMBOL_MS/1000),syntaxGuard:true};
})();