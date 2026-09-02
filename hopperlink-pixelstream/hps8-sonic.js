(() => {
'use strict';

const VERSION='0.10.0',MAGIC=[0x53,0x38],PROTO=1;
const TYPE={ACK:1,PROGRESS:2,BLOOM:3,COMPLETE:4};
const FREQ=[18000,18500,19000,19500];
const PREAMBLE=new Uint8Array([0xF0,0xA5,0xF0,0xA5]);
const TONE_MS=34,GAP_MS=18,LEAD_MS=220,TAIL_MS=100;
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,silentGain=null,listenTimer=null,listenCb=null;

function u16(n){return[(n>>>8)&255,n&255];}function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];}function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function crc8(a){let c=0x5a;for(const b of a){c^=b;for(let i=0;i<8;i++)c=(c&0x80)?((c<<1)^0x07)&255:(c<<1)&255;}return c;}
function concat(...xs){const n=xs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of xs){o.set(a,p);p+=a.length;}return o;}
function pack(type,session,payload=new Uint8Array(0)){payload=payload instanceof Uint8Array?payload:new Uint8Array(payload);if(payload.length>64)throw new Error('SonicLink payload >64 B');const h=new Uint8Array(9);h.set(MAGIC,0);h[2]=PROTO;h[3]=type;h.set(u32(session>>>0),4);h[8]=payload.length;const body=concat(h,payload);return concat(body,new Uint8Array([crc8(body)]));}
function unpack(a,off=0){if(a.length-off<10)return{pending:true};if(a[off]!==MAGIC[0]||a[off+1]!==MAGIC[1]||a[off+2]!==PROTO)return null;const len=a[off+8],need=10+len;if(a.length-off<need)return{pending:true,need};const body=a.slice(off,off+9+len),expected=a[off+9+len];if(crc8(body)!==expected)return{bad:true,need};return{ok:true,need,type:a[off+3],session:readU32(a,off+4),payload:a.slice(off+9,off+9+len)};}
function bytesToSymbols(bytes){const out=[];for(const b of bytes){out.push((b>>>6)&3,(b>>>4)&3,(b>>>2)&3,b&3);}return out;}
function symbolsToBytes(sym){const n=Math.floor(sym.length/4),out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=(sym[i*4]<<6)|(sym[i*4+1]<<4)|(sym[i*4+2]<<2)|sym[i*4+3];return out;}
const PRE_SYM=bytesToSymbols(PREAMBLE);
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:hps8-sonic-'+name,{detail}));}catch{}}
function log(msg){const e=document.getElementById('sendLog');if(!e)return;e.textContent=`[${new Date().toLocaleTimeString()}] SONIC8 · ${msg}\n`+e.textContent.slice(0,8500);}
function status(text,kind=''){const e=document.getElementById('hps8SonicStatus');if(e){e.textContent=text;e.className='chip '+kind;}}

async function ensureOutput(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');if(!outCtx)outCtx=new AC({latencyHint:'interactive'});if(outCtx.state==='suspended')await outCtx.resume();return outCtx;}
function buildBuffer(symbols,repeats=1){const ctx=outCtx,sr=ctx.sampleRate,toneN=Math.round(sr*TONE_MS/1000),gapN=Math.round(sr*GAP_MS/1000),leadN=Math.round(sr*LEAD_MS/1000),tailN=Math.round(sr*TAIL_MS/1000),all=[];for(let r=0;r<repeats;r++){all.push(...PRE_SYM,...symbols);if(r<repeats-1)all.push(-1,-1,-1,-1);}const total=leadN+all.reduce((s,v)=>s+(v<0?gapN*2:toneN+gapN),0)+tailN,b=ctx.createBuffer(1,total,sr),d=b.getChannelData(0);let p=leadN;const fade=Math.max(8,Math.round(sr*.002));for(const sym of all){if(sym<0){p+=gapN*2;continue;}const f=FREQ[sym];for(let i=0;i<toneN;i++){const env=Math.min(1,i/fade,(toneN-1-i)/fade),t=i/sr;d[p+i]=.13*env*Math.sin(2*Math.PI*f*t);}p+=toneN+gapN;}return b;}
async function send(type,session,payload,{repeats=2,label='CTRL'}={}){await ensureOutput();const packet=pack(type,session,payload),symbols=bytesToSymbols(packet),buf=buildBuffer(symbols,Math.max(1,repeats)),src=outCtx.createBufferSource();src.buffer=buf;src.connect(outCtx.destination);status(`SONIC · TX ${label}`,'mid');emit('tx',{type,session,bytes:packet.length,durationMs:buf.duration*1000,label});return new Promise((resolve,reject)=>{src.onended=()=>{status('SONIC · LISTO','on');resolve();};try{src.start();}catch(e){reject(e);}});}

function dbAt(freq,f,sr,fft){const bin=Math.round(f*fft/sr);return freq[Math.max(0,Math.min(freq.length-1,bin))]??-120;}
function stopListener(){if(listenTimer){clearInterval(listenTimer);listenTimer=null;}try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();analyser?.disconnect?.();silentGain?.disconnect?.();}catch{}try{micCtx?.close?.();}catch{}micCtx=null;micStream=null;micSource=null;analyser=null;silentGain=null;listenCb=null;status('SONIC · OFF','');}
async function startListener(onMessage){stopListener();if(!navigator.mediaDevices?.getUserMedia)throw new Error('Micrófono no disponible');const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false}),AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Web Audio no disponible');micCtx=new AC({latencyHint:'interactive'});if(micCtx.state==='suspended')await micCtx.resume();micStream=stream;micSource=micCtx.createMediaStreamSource(stream);analyser=micCtx.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.08;analyser.minDecibels=-110;analyser.maxDecibels=-10;silentGain=micCtx.createGain();silentGain.gain.value=1e-7;micSource.connect(analyser);analyser.connect(silentGain);silentGain.connect(micCtx.destination);listenCb=onMessage;const sr=micCtx.sampleRate,fft=analyser.fftSize,freq=new Float32Array(analyser.frequencyBinCount),symbols=[];let active=-1,hits=0,quiet=0,lastEmit=0;status('SONIC · ESCUCHANDO','on');log(`RX near-ultrasonic · ${sr} Hz · ${FREQ[0]/1000}-${FREQ[FREQ.length-1]/1000} kHz`);
  function feedSymbol(s){symbols.push(s);if(symbols.length>1200)symbols.splice(0,symbols.length-800);scan();}
  function findPreamble(){outer:for(let i=0;i<=symbols.length-PRE_SYM.length;i++){for(let j=0;j<PRE_SYM.length;j++)if(symbols[i+j]!==PRE_SYM[j])continue outer;return i;}return-1;}
  function scan(){while(true){const p=findPreamble();if(p<0)return;if(p>0)symbols.splice(0,p);const body=symbols.slice(PRE_SYM.length),bytes=symbolsToBytes(body),r=unpack(bytes,0);if(r?.pending)return;if(!r||r.bad){symbols.shift();continue;}const consumed=PRE_SYM.length+r.need*4;symbols.splice(0,consumed);const now=performance.now();if(now-lastEmit<250)continue;lastEmit=now;status(`SONIC · RX ${r.type}`,'on');emit('rx',{type:r.type,session:r.session,bytes:r.need});try{listenCb?.(r);}catch(e){console.error(e);}}}
  listenTimer=setInterval(()=>{if(!analyser||!micCtx)return;analyser.getFloatFrequencyData(freq);const vals=FREQ.map(f=>dbAt(freq,f,sr,fft)),order=vals.map((v,i)=>[v,i]).sort((a,b)=>b[0]-a[0]),best=order[0],second=order[1],tone=best[0]>-74&&best[0]-second[0]>3.2?best[1]:-1;if(tone>=0){quiet=0;if(active===tone)hits++;else{if(active>=0&&hits>=2)feedSymbol(active);active=tone;hits=1;}}else{quiet++;if(active>=0&&quiet>=2){if(hits>=2)feedSymbol(active);active=-1;hits=0;quiet=0;}}},10);emit('listener-ready',{sampleRate:sr,fft,frequencies:FREQ.slice()});return true;}

function progressPayload(permille,missing,flags=0){return new Uint8Array([...u16(Math.max(0,Math.min(1000,permille))),...u16(Math.max(0,Math.min(65535,missing))),flags&255]);}
function parseProgress(p){return p.length>=5?{permille:readU16(p,0),missing:readU16(p,2),flags:p[4]}:null;}
function bloomPayload(missing,bloom){return concat(new Uint8Array(u16(Math.min(65535,missing))),bloom);}
function parseBloom(p){return p.length>=6?{missing:readU16(p,0),bloom:p.slice(2)}:null;}
function completePayload(fileCrc){return new Uint8Array(u32(fileCrc>>>0));}
function parseComplete(p){return p.length>=4?{fileCrc:readU32(p,0)}:null;}

window.__hopperHPS8Sonic={version:VERSION,type:TYPE,frequencies:FREQ.slice(),nearUltrasonic:true,pack,unpack,bytesToSymbols,symbolsToBytes,ensureOutput,startListener,stopListener,send,progressPayload,parseProgress,bloomPayload,parseBloom,completePayload,parseComplete};
})();
