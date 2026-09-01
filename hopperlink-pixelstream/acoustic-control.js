(() => {
'use strict';

// HAC2 Robust16
// Acoustic backchannel optimized for real phone speakers/microphones.
// 16 OOK carriers + alternating pilot, short FFT window and explicit guard interval.
const VERSION=2, MAGIC=[0x48,0x41,0x43,0x32]; // HAC2
const TYPE={NACK:1,COMPLETE:2};
const CARRIERS=Array.from({length:16},(_,i)=>1800+i*260); // 1.8–5.7 kHz
const PILOTS=[6500,7100];
const SYMBOL_MS=48, TONE_MS=26, LEAD_MS=700, REPEAT_GAP_MS=220;
const PREAMBLE=[0xAA,0x55,0xCC,0x33,0xF0,0x0F,0x96,0x69,0x5A,0xA5,0x3C,0xC3,0x87,0x78,0xE1,0x1E];
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,silentGain=null,listenToken=0;

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
function u16(n){return[(n>>>8)&255,n&255];} function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];} function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length;}return o;}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:acoustic-'+name,{detail}));}catch{}}
function setStatus(text,kind=''){const e=document.getElementById('controlChannelStatus');if(!e)return;e.textContent=text;e.className='chip '+kind;}
function setOverlay(text){const o=document.getElementById('streamOverlay'),e=document.getElementById('streamBottom');if(!e||!o||o.style.display==='none')return;e.textContent=text;}
function mode(){return document.getElementById('controlMode')?.value||'manual';}
function alog(msg){const e=document.getElementById('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] HAC2 · ${msg}\n`+e.textContent.slice(0,8500);}

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
    if(micCtx.state!=='running'){try{await micCtx.resume();}catch(e){alog(`resume falló: ${e.message}`);}}
    if(micCtx.state==='running'){
      setStatus('ACÚSTICO · DSP RUNNING','on');
      setOverlay('HAC2 RX · DSP RUNNING · esperando señal del receptor…');
      emit('dsp-ready',{sampleRate:micCtx.sampleRate,fftSize:analyser.fftSize,state:micCtx.state,reused:true});
      return true;
    }
    stopMic();
  }
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Micrófono no disponible');
  setStatus('ACÚSTICO · PIDIENDO MIC…','mid');
  micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false});
  const AC=window.AudioContext||window.webkitAudioContext;
  micCtx=new AC({latencyHint:'interactive'});
  if(micCtx.state==='suspended')await micCtx.resume();
  micSource=micCtx.createMediaStreamSource(micStream);
  analyser=micCtx.createAnalyser();
  analyser.fftSize=1024;analyser.smoothingTimeConstant=0;analyser.minDecibels=-100;analyser.maxDecibels=-10;
  silentGain=micCtx.createGain();silentGain.gain.value=1e-7;
  micSource.connect(analyser);analyser.connect(silentGain);silentGain.connect(micCtx.destination);
  const track=micStream.getAudioTracks?.()[0],settings=track?.getSettings?.()||{};
  micCtx.onstatechange=()=>{alog(`AudioContext → ${micCtx?.state||'closed'}`);emit('dsp-state',{state:micCtx?.state||'closed'});};
  setStatus('ACÚSTICO · DSP RUNNING','on');
  setOverlay('HAC2 RX · DSP RUNNING · micrófono listo');
  alog(`micrófono + DSP vivos · ${micCtx.sampleRate} Hz · FFT ${analyser.fftSize} (${(analyser.fftSize/micCtx.sampleRate*1000).toFixed(1)} ms) · graph→destination`);
  emit('mic-ready',{sampleRate:micCtx.sampleRate,fftSize:analyser.fftSize,settings,state:micCtx.state,graphPulled:true});
  return true;
}
function stopMic(){listenToken++;try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();}catch{}try{analyser?.disconnect?.();}catch{}try{silentGain?.disconnect?.();}catch{}micStream=null;micSource=null;analyser=null;silentGain=null;try{micCtx?.close?.();}catch{}micCtx=null;}

function bytesToSymbols(bytes){const pad=bytes.length&1,b=new Uint8Array(bytes.length+pad);b.set(bytes);const out=[];for(let i=0;i<b.length;i+=2)out.push((b[i]<<8)|b[i+1]);return out;}
function buildAudio(packet,repeats=1){const ctx=outCtx,sr=ctx.sampleRate,symN=Math.round(sr*SYMBOL_MS/1000),toneN=Math.round(sr*TONE_MS/1000),leadN=Math.round(sr*LEAD_MS/1000),gapN=Math.round(sr*REPEAT_GAP_MS/1000),tailN=Math.round(sr*.10),groups=[];for(let r=0;r<repeats;r++)groups.push(bytesToSymbols(new Uint8Array([...PREAMBLE,...packet])));const total=leadN+groups.reduce((s,g)=>s+g.length*symN,0)+Math.max(0,repeats-1)*gapN+tailN,buf=ctx.createBuffer(1,total,sr),d=buf.getChannelData(0),fade=Math.max(8,Math.round(sr*.0015));let cursor=leadN,parity=0;for(let r=0;r<groups.length;r++){for(const word of groups[r]){const pilot=PILOTS[parity];parity^=1;for(let n=0;n<toneN;n++){const t=n/sr,env=Math.min(1,n/fade,(toneN-1-n)/fade);let v=.052*Math.sin(2*Math.PI*pilot*t+.13);for(let bit=0;bit<16;bit++)if(word&(1<<(15-bit)))v+=.020*Math.sin(2*Math.PI*CARRIERS[bit]*t+bit*.71);d[cursor+n]=Math.max(-.86,Math.min(.86,v))*env;}cursor+=symN;}if(r<groups.length-1)cursor+=gapN;}return buf;}
async function playPacket(packet,{repeats=1,label='CONTROL'}={}){await unlockSpeaker();const buf=buildAudio(packet,Math.max(1,repeats)),src=outCtx.createBufferSource();src.buffer=buf;src.connect(outCtx.destination);setStatus(`ACÚSTICO · TX ${label}`,'mid');alog(`TX ${label} · ${packet.length} B · ${repeats}x · ${buf.duration.toFixed(1)} s`);emit('tx-start',{bytes:packet.length,repeats,durationMs:buf.duration*1000,label,protocol:'HAC2'});return new Promise((resolve,reject)=>{src.onended=()=>{setStatus('ACÚSTICO · TX OK','on');emit('tx-end',{label});resolve();};try{src.start();}catch(e){reject(e);}});}
async function sendNack(args){const p=makePacket(TYPE.NACK,args),repeats=p.length<=260?2:1;return playPacket(p,{repeats,label:`NACK ${args.missing?.length||0}`});}
async function sendComplete(args){return playPacket(makePacket(TYPE.COMPLETE,args),{repeats:3,label:'COMPLETE'});}

function dbAt(data,f,sr,fft){const bin=Math.round(f*fft/sr);return data[Math.max(0,Math.min(data.length-1,bin))]??-120;}
function qtile(a,f){if(!a.length)return-100;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor((s.length-1)*f)))];}
function classifyWord(freq,sr,fft,pilotDb){const vals=CARRIERS.map(f=>dbAt(freq,f,sr,fft)),floor=qtile(vals,.18),threshold=Math.max(-82,Math.min(floor+8,pilotDb-14));let word=0;for(let bit=0;bit<16;bit++){word<<=1;if(vals[bit]>=threshold)word|=1;}return{word,threshold,floor,maxCarrier:Math.max(...vals)};}
function signalLabel(db){return db>-18?'MUY FUERTE':db>-58?'SEÑAL OK':db>-68?'SEÑAL BAJA':'SIN SEÑAL';}

async function listenControl({session,round=null,timeoutMs=90000}={}){
  await ensureSenderMic();
  if(!micCtx||micCtx.state!=='running'||!analyser)throw new Error(`DSP acústico no está RUNNING (${micCtx?.state||'sin contexto'})`);
  const token=++listenToken,fft=analyser.fftSize,sr=micCtx.sampleRate,freq=new Float32Array(analyser.frequencyBinCount),rxBytes=[];
  let armed=true,lastPilot=-1,quietHits=0,decodedSymbols=0,crcFails=0,lastDiag=0,bestPilot=-120;
  setStatus('ACÚSTICO · DSP RUNNING · ESCUCHANDO','mid');setOverlay('HAC2 RX · DSP RUNNING · esperando NACK/COMPLETE…');
  alog(`escuchando control · sesión ${Number(session>>>0).toString(16)} · ronda ${round==null?'*':round+1} · ctx ${micCtx.state}`);
  emit('listen-start',{session,round,timeoutMs,fft,symbolMs:SYMBOL_MS,contextState:micCtx.state});
  return new Promise((resolve,reject)=>{
    let timer=null,timeout=null;
    const cleanup=()=>{if(timer)clearInterval(timer);if(timeout)clearTimeout(timeout);};
    const scanPackets=()=>{for(let off=0;off<=rxBytes.length-4;off++){if(rxBytes[off]!==MAGIC[0]||rxBytes[off+1]!==MAGIC[1]||rxBytes[off+2]!==MAGIC[2]||rxBytes[off+3]!==MAGIC[3])continue;const r=parsePacket(new Uint8Array(rxBytes),off);if(r?.pending)return false;if(r?.bad){crcFails++;continue;}if(r?.ok){if(session!=null&&r.session!==(session>>>0))continue;if(round!=null&&r.round!==round)continue;cleanup();setStatus(`ACÚSTICO · RX ${r.type===TYPE.NACK?'NACK':'COMPLETE'} OK`,'on');setOverlay(`HAC2 RX · ${r.type===TYPE.NACK?'NACK':'COMPLETE'} CRC OK · ${decodedSymbols} símbolos`);alog(`RX ${r.type===TYPE.NACK?'NACK':'COMPLETE'} OK · ${decodedSymbols} símbolos · CRC fail ${crcFails}`);emit('rx-ok',{type:r.type,bytes:r.need,payloadBytes:r.payloadBytes,decodedSymbols,crcFails,bestPilot,protocol:'HAC2'});resolve(r);return true;}}return false;};
    const diagnostic=(pilot,dominant)=>{const now=performance.now();if(now-lastDiag<180)return;lastDiag=now;bestPilot=Math.max(bestPilot,pilot);const label=signalLabel(pilot);setStatus(`ACÚSTICO · ${label} · ${decodedSymbols} sym`,pilot>-68?'mid':'off');setOverlay(`HAC2 RX · ${label} · ${decodedSymbols} símbolos / ${rxBytes.length} bytes · CRC fail ${crcFails}`);emit('rx-signal',{pilotDb:pilot,dominantPilot:dominant,decodedSymbols,bytes:rxBytes.length,crcFails,bestPilot,contextState:micCtx?.state});};
    const decodeOne=()=>{if(token!==listenToken){cleanup();return;}if(!micCtx||micCtx.state!=='running'||!analyser){setOverlay(`HAC2 RX · DSP ${micCtx?.state||'OFF'} · intentando reanudar…`);micCtx?.resume?.().catch(()=>{});return;}analyser.getFloatFrequencyData(freq);const p0=dbAt(freq,PILOTS[0],sr,fft),p1=dbAt(freq,PILOTS[1],sr,fft),pilot=Math.max(p0,p1),dominant=p1>p0?1:0;diagnostic(pilot,dominant);if(pilot<-67){quietHits++;if(quietHits>=2){armed=true;lastPilot=-1;}return;}quietHits=0;if(pilot<-57)return;const newSymbol=armed||dominant!==lastPilot;if(!newSymbol)return;armed=false;lastPilot=dominant;setTimeout(()=>{if(token!==listenToken||!analyser||micCtx?.state!=='running')return;analyser.getFloatFrequencyData(freq);const a0=dbAt(freq,PILOTS[0],sr,fft),a1=dbAt(freq,PILOTS[1],sr,fft),q=Math.max(a0,a1),dom=a1>a0?1:0;if(q<-61)return;const d=classifyWord(freq,sr,fft,q),word=d.word;rxBytes.push((word>>>8)&255,word&255);decodedSymbols++;setOverlay(`HAC2 RX · DECODIFICANDO · ${decodedSymbols} símbolos / ${rxBytes.length} bytes`);if(rxBytes.length>24000)rxBytes.splice(0,6000);emit('symbol',{decodedSymbols,bytes:rxBytes.length,pilotDb:q,pilot:dom,threshold:d.threshold,floor:d.floor,maxCarrier:d.maxCarrier});scanPackets();},5);};
    timer=setInterval(decodeOne,3);
    timeout=setTimeout(()=>{cleanup();setStatus(`ACÚSTICO · TIMEOUT · ${decodedSymbols} sym`,'off');setOverlay(`HAC2 RX · TIMEOUT · ${decodedSymbols} símbolos · mejor señal ${bestPilot.toFixed(1)} dB`);alog(`TIMEOUT · ${decodedSymbols} símbolos · ${rxBytes.length} bytes · CRC fail ${crcFails} · mejor piloto ${bestPilot.toFixed(1)} dB`);emit('timeout',{decodedSymbols,bytes:rxBytes.length,crcFails,bestPilot,contextState:micCtx?.state});reject(new Error(`Timeout acústico: ${decodedSymbols} símbolos detectados`));},timeoutMs);
  });
}

document.addEventListener('change',e=>{if(e.target?.id==='controlMode')setStatus(e.target.value==='acoustic'?'ACÚSTICO HAC2 · SE ACTIVARÁ AL PREPARAR':'NACK MANUAL',e.target.value==='acoustic'?'mid':'on');});
document.addEventListener('click',e=>{if(e.target?.id==='cameraBtn')unlockSpeaker().catch(()=>{});},{capture:true});
window.addEventListener('pagehide',()=>stopMic());
window.HopperAcoustic={VERSION,TYPE,mode,unlockSpeaker,ensureSenderMic,stopMic,sendNack,sendComplete,listenControl,compressMissing,decompressMissing,makePacket,parsePacket,classifyWord};
window.__hopperAcoustic={version:'0.9.3',protocol:'HAC2 Robust16 · pulled DSP graph',carriers:16,fftSize:1024,symbolMs:SYMBOL_MS,toneMs:TONE_MS,leadMs:LEAD_MS,estimatedBytesPerSecond:2/(SYMBOL_MS/1000)};
})();
