(() => {
'use strict';

const VERSION='0.10.4',MAGIC=[0x53,0x38],PROTO=1;
const TYPE={ACK:1,PROGRESS:2,BLOOM:3,COMPLETE:4};
const PROFILES={
  high:{name:'HIGH',freq:[17400,18000,18600,19200]},
  mid:{name:'MID',freq:[13800,14400,15000,15600]},
  safe:{name:'SAFE',freq:[10800,11600,12400,13200]}
};
const ORDER=['mid','safe','high'],SYNC=[1,0,1,1,0,1,0,0,1,1,1,0,0,1,0,1];
const FFT=256,POLL=3,LEAD=70,START=86,START_GAP=20,CLOCK=8,SWITCH=2,DATA=10,BIT_GAP=4,PROFILE_GAP=170,TAIL=90;
const START_MIN=38,CLOCK_MIN=3.5,DATA_MIN=4.5,SYNC_ERRORS=2,RX_GUARD=100;
let outCtx=null,micCtx=null,micStream=null,micSource=null,analyser=null,silentGain=null,timer=null,listenCb=null;
let outputUnlocked=false,inputReady=false,lastSettings=null,txActive=false,rxMuteUntil=0,preferred='mid',txChain=Promise.resolve();

const u16=n=>[(n>>>8)&255,n&255],u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
const r16=(a,o)=>(a[o]<<8)|a[o+1];
const r32=(a,o)=>((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);
function crc8(a){let c=0x5a;for(const b of a){c^=b;for(let i=0;i<8;i++)c=(c&0x80)?((c<<1)^7)&255:(c<<1)&255;}return c;}
function concat(...xs){const n=xs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of xs){o.set(a,p);p+=a.length;}return o;}
function pack(type,session,payload=new Uint8Array()){payload=payload instanceof Uint8Array?payload:new Uint8Array(payload);if(payload.length>64)throw Error('Sonic payload >64 B');const h=new Uint8Array(9);h.set(MAGIC);h[2]=PROTO;h[3]=type;h.set(u32(session>>>0),4);h[8]=payload.length;const b=concat(h,payload);return concat(b,new Uint8Array([crc8(b)]));}
function unpack(a,o=0){if(a.length-o<10)return{pending:true};if(a[o]!==MAGIC[0]||a[o+1]!==MAGIC[1]||a[o+2]!==PROTO)return null;const len=a[o+8],need=10+len;if(len>64)return{bad:true,need};if(a.length-o<need)return{pending:true,need};const body=a.slice(o,o+9+len);if(crc8(body)!==a[o+9+len])return{bad:true,need};return{ok:true,need,type:a[o+3],session:r32(a,o+4),payload:a.slice(o+9,o+9+len)};}
function bytesToSymbols(bytes){const out=[];for(const b of bytes)out.push((b>>>6)&3,(b>>>4)&3,(b>>>2)&3,b&3);return out;}
function symbolsToBytes(sym){const out=new Uint8Array(Math.floor(sym.length/4));for(let i=0;i<out.length;i++)out[i]=(sym[i*4]<<6)|(sym[i*4+1]<<4)|(sym[i*4+2]<<2)|sym[i*4+3];return out;}
function hammingEncodeByte(b){const w=new Array(13).fill(0),dp=[3,5,6,7,9,10,11,12];for(let i=0;i<8;i++)w[dp[i]]=(b>>(7-i))&1;for(const p of [1,2,4,8]){let x=0;for(let i=1;i<=12;i++)if((i&p)&&i!==p)x^=w[i];w[p]=x;}return w.slice(1);}
function hammingDecodeCodeword(bits){if(bits?.length!==12)return null;const w=[0,...bits.map(Number)];let syn=0;for(const p of [1,2,4,8]){let x=0;for(let i=1;i<=12;i++)if(i&p)x^=w[i];if(x)syn|=p;}if(syn>12)return null;if(syn)w[syn]^=1;let b=0;for(const p of [3,5,6,7,9,10,11,12])b=(b<<1)|w[p];return{byte:b,corrected:syn?1:0,syndrome:syn};}
function encodePacketBits(packet){const out=[];for(const b of packet)out.push(...hammingEncodeByte(b));return out;}
function hdist(a,b){let n=Math.abs(a.length-b.length);for(let i=0;i<Math.min(a.length,b.length);i++)n+=a[i]!==b[i];return n;}

function emit(n,d={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-sonic-${n}`,{detail:d}));}catch{}}
function log(s){const e=document.getElementById('sendLog');if(e)e.textContent=`[${new Date().toLocaleTimeString()}] SONIC8R · ${s}\n`+e.textContent.slice(0,8500);}
function status(s,k=''){const e=document.getElementById('hps8SonicStatus');if(e){e.textContent=s;e.className='chip '+k;}}
function overlay(s,k=''){let e=document.getElementById('sonicOverlayDiag'),o=document.getElementById('streamOverlay');if(!o)return;if(!e){e=document.createElement('div');e.id='sonicOverlayDiag';e.style.cssText='position:absolute;left:12px;top:max(52px,calc(env(safe-area-inset-top) + 42px));z-index:75;padding:7px 9px;border-radius:10px;background:rgba(2,6,23,.82);border:1px solid rgba(103,232,249,.38);color:#dbeafe;font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none';o.appendChild(e);}e.textContent=s;e.dataset.kind=k;}
function stage(stage,d={}){emit('frame-stage',{stage,...d});}
function micLive(){const t=micStream?.getAudioTracks?.()[0];return!!t&&t.readyState==='live';}
function duplexState(){return{outputUnlocked,outState:outCtx?.state||'none',inputReady:inputReady&&micLive(),micState:micCtx?.state||'none',dsp:!!analyser&&!!timer,duplexReady:!!(outputUnlocked&&outCtx?.state==='running'&&inputReady&&micLive()&&micCtx?.state==='running'&&analyser&&timer),settings:lastSettings,preferredProfile:preferred,txActive,modem:'clocked-bfsk-hamming'};}
function publish(){const s=duplexState();status(s.duplexReady?'SONIC · DUPLEX READY':s.inputReady?'SONIC · MIC READY':'SONIC · AUDIO INIT',s.duplexReady?'on':'mid');emit('duplex-state',s);return s;}
async function ensureOutput(){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio no disponible');if(!outCtx||outCtx.state==='closed')outCtx=new AC({latencyHint:'interactive'});if(outCtx.state==='suspended')await outCtx.resume();return outCtx;}
async function unlockOutput(){const c=await ensureOutput();try{const b=c.createBuffer(1,1,c.sampleRate),s=c.createBufferSource();s.buffer=b;s.connect(c.destination);s.start();}catch{}outputUnlocked=c.state==='running';log(`speaker unlock · ${c.state}`);publish();return outputUnlocked;}
function profiles(repeats=2,requested){if(Array.isArray(requested)&&requested.length)return [...new Set(requested.filter(x=>PROFILES[x]))];const a=[preferred,...ORDER].filter((x,i,z)=>PROFILES[x]&&z.indexOf(x)===i);return a.slice(0,Math.max(1,Math.min(a.length,repeats|0||1)));}
function learn(p){if(PROFILES[p]&&preferred!==p){preferred=p;emit('profile-lock',{profile:p});log(`band lock · ${p.toUpperCase()}`);}}
function tone(d,pos,n,sr,hz,amp){const fade=Math.max(4,Math.round(sr*.0013));for(let i=0;i<n;i++){const env=Math.min(1,i/fade,(n-1-i)/fade);d[pos+i]=amp*env*Math.sin(2*Math.PI*hz*i/sr);}return pos+n;}
function build(packet,ps){const sr=outCtx.sampleRate,bits=[...SYNC,...encodePacketBits(packet)],N=x=>Math.round(sr*x/1000),lead=N(LEAD),st=N(START),sg=N(START_GAP),cl=N(CLOCK),sw=N(SWITCH),da=N(DATA),bg=N(BIT_GAP),pg=N(PROFILE_GAP),tail=N(TAIL),per=st+sg+bits.length*(cl+sw+da+bg),buf=outCtx.createBuffer(1,lead+ps.length*per+Math.max(0,ps.length-1)*pg+tail,sr),d=buf.getChannelData(0);let pos=lead;for(let pi=0;pi<ps.length;pi++){const f=PROFILES[ps[pi]].freq;pos=tone(d,pos,st,sr,f[1],.2);pos+=sg;for(const bit of bits){pos=tone(d,pos,cl,sr,f[2],.16);pos+=sw;pos=tone(d,pos,da,sr,bit?f[3]:f[0],.18);pos+=bg;}if(pi<ps.length-1)pos+=pg;}return{buffer:buf,bits:bits.length};}
function send(type,session,payload,opts={}){const run=async()=>{if(!outputUnlocked||outCtx?.state!=='running')await unlockOutput();const packet=pack(type,session,payload),ps=profiles(opts.repeats??2,opts.profiles),b=build(packet,ps),src=outCtx.createBufferSource();src.buffer=b.buffer;src.connect(outCtx.destination);txActive=true;status(`SONIC · TX ${opts.label||'CTRL'}`,'mid');overlay(`SONIC TX · ${opts.label||'CTRL'} · CLOCK+BFSK · ${ps.map(x=>x.toUpperCase()).join('→')}`,'tx');emit('tx',{type,session,bytes:packet.length,durationMs:b.buffer.duration*1000,label:opts.label||'CTRL',profiles:ps,fec:'Hamming(12,8)',clocked:true});return new Promise((res,rej)=>{src.onended=()=>{txActive=false;rxMuteUntil=performance.now()+RX_GUARD;publish();res();};try{src.start();}catch(e){txActive=false;rej(e);}});};const p=txChain.catch(()=>{}).then(run);txChain=p;return p;}
function dbAt(a,hz,sr,fft){return a[Math.max(0,Math.min(a.length-1,Math.round(hz*fft/sr)))]??-120;}
function median(a){const x=a.slice().sort((a,b)=>a-b);return x[Math.floor(x.length/2)]??-120;}
function stopListener(){if(timer){clearInterval(timer);timer=null;}try{micStream?.getTracks?.().forEach(t=>t.stop());}catch{}try{micSource?.disconnect?.();analyser?.disconnect?.();silentGain?.disconnect?.();}catch{}try{micCtx?.close?.();}catch{}micCtx=micStream=micSource=analyser=silentGain=listenCb=null;inputReady=false;publish();}

async function startListener(onMessage){
  listenCb=onMessage||listenCb;
  if(micLive()&&analyser&&timer&&micCtx&&micCtx.state!=='closed'){if(micCtx.state==='suspended')try{await micCtx.resume();}catch{}inputReady=micCtx.state==='running';publish();return inputReady;}
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Micrófono no disponible');
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false}),AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio no disponible');
  micCtx=new AC({latencyHint:'interactive'});if(micCtx.state==='suspended')await micCtx.resume();micStream=stream;micSource=micCtx.createMediaStreamSource(stream);analyser=micCtx.createAnalyser();analyser.fftSize=FFT;analyser.smoothingTimeConstant=0;analyser.minDecibels=-110;analyser.maxDecibels=-8;silentGain=micCtx.createGain();silentGain.gain.value=1e-7;micSource.connect(analyser);analyser.connect(silentGain);silentGain.connect(micCtx.destination);
  const sr=micCtx.sampleRate,freq=new Float32Array(analyser.frequencyBinCount),settings=stream.getAudioTracks?.()[0]?.getSettings?.()||{};lastSettings=settings;inputReady=true;
  let stableKey='',stableTone=null,segStart=0,lastToneAt=0,lastDiag=0,lastPacketKey='',lastPacketTs=0,frame=null;
  function reset(reason='RESET'){if(frame&&reason!=='DONE')stage(reason,{profile:frame.profile,bits:frame.raw.length,bytes:frame.bytes.length,corrections:frame.corrections});frame=null;}
  function begin(profile,db){frame={profile,sync:[],syncOk:false,code:[],bytes:[],needed:null,expect:false,raw:[],corrections:0};stage('CLOCK_LOCK',{profile,db});overlay(`SONIC RX · CLOCK LOCK · ${profile.toUpperCase()}`,'signal');}
  function bit(v){if(!frame)return;frame.raw.push(v);if(!frame.syncOk){frame.sync.push(v);if(frame.sync.length===SYNC.length){const errors=hdist(frame.sync,SYNC);if(errors>SYNC_ERRORS){stage('SYNC_FAIL',{profile:frame.profile,errors});reset('SYNC_RESET');return;}frame.syncOk=true;stage('SYNC_OK',{profile:frame.profile,errors});}return;}frame.code.push(v);while(frame&&frame.code.length>=12){const d=hammingDecodeCodeword(frame.code.splice(0,12));if(!d){stage('FEC_FAIL',{profile:frame.profile});reset('FEC_RESET');return;}frame.bytes.push(d.byte);frame.corrections+=d.corrected;if(frame.bytes.length===9){if(frame.bytes[0]!==MAGIC[0]||frame.bytes[1]!==MAGIC[1]||frame.bytes[2]!==PROTO||frame.bytes[8]>64){stage('HEADER_FAIL',{profile:frame.profile});reset('HEADER_RESET');return;}frame.needed=10+frame.bytes[8];stage('HEADER_OK',{profile:frame.profile,neededBytes:frame.needed,corrections:frame.corrections});}if(frame?.needed&&frame.bytes.length>=frame.needed){const r=unpack(Uint8Array.from(frame.bytes.slice(0,frame.needed)));if(!r?.ok){stage('CRC_FAIL',{profile:frame.profile,corrections:frame.corrections});reset('CRC_RESET');return;}const prof=frame.profile,corr=frame.corrections,now=performance.now(),key=`${r.session}:${r.type}:${crc8(r.payload||[])}`;stage('CRC_OK',{profile:prof,type:r.type,session:r.session,corrections:corr,bytes:r.need});learn(prof);if(!(key===lastPacketKey&&now-lastPacketTs<1500)){lastPacketKey=key;lastPacketTs=now;overlay(`SONIC RX ✓ · TYPE ${r.type} · ${prof.toUpperCase()} · FEC ${corr} · CRC OK`,'ok');emit('rx',{type:r.type,session:r.session,bytes:r.need,profile:prof,fecCorrections:corr});try{listenCb?.({...r,profile:prof,fecCorrections:corr});}catch(e){console.error(e);}}reset('DONE');return;}}}
  function segment(t,dur){if(!t||dur<=0||txActive||performance.now()<rxMuteUntil)return;if(t.role==='start'&&dur>=START_MIN){begin(t.profile,t.db);return;}if(!frame||t.profile!==frame.profile)return;if(t.role==='clock'&&dur>=CLOCK_MIN){if(frame.expect){stage('ERASURE',{profile:frame.profile,atBit:frame.raw.length});reset('ERASURE_RESET');return;}frame.expect=true;return;}if((t.role==='data0'||t.role==='data1')&&dur>=DATA_MIN&&frame.expect){frame.expect=false;bit(t.role==='data1'?1:0);}}
  function finish(now){if(stableTone)segment(stableTone,now-segStart);stableTone=null;stableKey='';segStart=0;}
  status('SONIC · ESCUCHANDO','on');overlay('SONIC RX · ROBUST DSP · esperando START…','listen');log(`RX Robust · ${sr} Hz · FFT ${FFT} · CLOCK+BFSK · Hamming(12,8)`);
  timer=setInterval(()=>{analyser.getFloatFrequencyData(freq);const cand=[];for(const [pk,p] of Object.entries(PROFILES)){const roles=['data0','start','clock','data1'];for(let i=0;i<4;i++)cand.push({profile:pk,role:roles[i],db:dbAt(freq,p.freq[i],sr,FFT),hz:p.freq[i]});}cand.sort((a,b)=>b.db-a.db);const best=cand[0],second=cand[1],floor=median(cand.map(x=>x.db)),margin=best.db-second.db,snr=best.db-floor,tone=best.db>-84&&margin>2.8&&snr>6?best:null,now=performance.now();if(txActive||now<rxMuteUntil){if(stableTone)finish(now);reset('LOCAL_TX_GUARD');}else if(tone){lastToneAt=now;const key=`${tone.profile}:${tone.role}`;if(key!==stableKey){if(stableTone)finish(now);stableKey=key;stableTone=tone;segStart=now;}else stableTone={...stableTone,db:Math.max(stableTone.db,tone.db)};}else if(stableTone&&now-lastToneAt>=5)finish(now);if(now-lastDiag>220){lastDiag=now;emit('spectrum',{profile:tone?.profile||null,role:tone?.role||null,hz:tone?.hz||best.hz,bestDb:best.db,margin,snr,floor,settings,frameActive:!!frame});}},POLL);
  publish();emit('listener-ready',{sampleRate:sr,fft:FFT,settings,persistent:true,clockedBfsk:true,fec:'Hamming(12,8)',syncTolerance:SYNC_ERRORS});return true;
}

async function primeDuplex(onMessage){await unlockOutput();await startListener(onMessage);const s=publish();if(!s.duplexReady)throw Error(`Sonic duplex incompleto · speaker ${s.outState} · mic ${s.micState}`);emit('duplex-ready',s);return s;}
function progressPayload(permille,missing,flags=0){return new Uint8Array([...u16(Math.max(0,Math.min(1000,permille))),...u16(Math.max(0,Math.min(65535,missing))),flags&255]);}
const parseProgress=p=>p.length>=5?{permille:r16(p,0),missing:r16(p,2),flags:p[4]}:null;
const bloomPayload=(missing,bloom)=>concat(new Uint8Array(u16(Math.min(65535,missing))),bloom);
const parseBloom=p=>p.length>=6?{missing:r16(p,0),bloom:p.slice(2)}:null;
const completePayload=fileCrc=>new Uint8Array(u32(fileCrc>>>0));
const parseComplete=p=>p.length>=4?{fileCrc:r32(p,0)}:null;

window.__hopperHPS8Sonic={version:VERSION,type:TYPE,frequencies:PROFILES.high.freq.slice(),profiles:PROFILES,adaptiveBands:true,guardedSymbols:true,persistentDuplex:true,userGesturePrime:true,clockedBfsk:true,hammingFec:true,tolerantSync:true,nearUltrasonic:true,timing:{pollMs:POLL,fftSize:FFT,startMs:START,clockMs:CLOCK,dataMs:DATA,bitGapMs:BIT_GAP},syncBits:SYNC.slice(),pack,unpack,bytesToSymbols,symbolsToBytes,hammingEncodeByte,hammingDecodeCodeword,encodePacketBits,ensureOutput,unlockOutput,primeDuplex,duplexState,startListener,stopListener,send,progressPayload,parseProgress,bloomPayload,parseBloom,completePayload,parseComplete};
})();
