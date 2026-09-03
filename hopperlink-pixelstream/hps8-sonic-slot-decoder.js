(() => {
'use strict';

const S=window.__hopperHPS8Sonic;
if(!S){console.error('Sonic8 Slot Decoder: base modem missing');return;}

const VERSION='0.10.9';
const PROFILES=S.profiles||{};
const SYNC=Array.isArray(S.syncBits)?S.syncBits.slice():[1,0,1,1,0,1,0,0,1,1,1,0,0,1,0,1];
const FFT=256,POLL=3,START_HITS=7,START_RELEASE=12,CLOCK_MIN_SPACING=14,SLOT_TIMEOUT=38;
const SYNC_ERRORS=4,MAX_SYNC_ERASURES=4,MAX_CODE_ERASURES=2,RX_GUARD=120;
const baseStart=S.startListener.bind(S),baseStop=S.stopListener.bind(S),basePrime=S.primeDuplex?.bind(S),baseDuplex=S.duplexState?.bind(S);

let ctx=null,stream=null,source=null,analyser=null,silent=null,timer=null,cb=null,inputReady=false,lastSettings=null;
let localTxUntil=0,lastPacketKey='',lastPacketTs=0;

function emit(n,d={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-sonic-${n}`,{detail:d}));}catch{}}
function stage(name,d={}){emit('frame-stage',{stage:name,...d,slotDecoder:true});}
function overlay(text,kind=''){let e=document.getElementById('sonicOverlayDiag'),o=document.getElementById('streamOverlay');if(!o)return;if(!e){e=document.createElement('div');e.id='sonicOverlayDiag';e.style.cssText='position:absolute;left:12px;top:max(52px,calc(env(safe-area-inset-top) + 42px));z-index:75;padding:7px 9px;border-radius:10px;background:rgba(2,6,23,.84);border:1px solid rgba(103,232,249,.42);color:#dbeafe;font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none';o.appendChild(e);}e.textContent=text;e.dataset.kind=kind;}
function status(text,kind=''){const e=document.getElementById('hps8SonicStatus');if(e){e.textContent=text;e.className='chip '+kind;}}
function log(text){const e=document.getElementById('sendLog');if(e)e.textContent=`[${new Date().toLocaleTimeString()}] SONIC8 SLOT · ${text}\n`+e.textContent.slice(0,8500);}
function live(){const t=stream?.getAudioTracks?.()[0];return!!t&&t.readyState==='live';}
function dbAt(a,hz,sr,fft){return a[Math.max(0,Math.min(a.length-1,Math.round(hz*fft/sr)))]??-120;}
function median(a){const x=a.slice().sort((a,b)=>a-b);return x[Math.floor(x.length/2)]??-120;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function hdistSoft(bits,target){let errors=0,erasures=0;for(let i=0;i<target.length;i++){const v=bits[i];if(v==null)erasures++;else if(v!==target[i])errors++;}return{errors,erasures,score:errors+erasures*.5};}

function decodeCodewordSoft(items){
  if(!Array.isArray(items)||items.length!==12)return null;
  const erased=[];for(let i=0;i<12;i++)if(items[i]?.v==null)erased.push(i);
  if(erased.length>MAX_CODE_ERASURES)return null;
  const tries=1<<erased.length,cands=[];
  for(let mask=0;mask<tries;mask++){
    const bits=items.map(x=>x?.v==null?0:x.v);
    for(let j=0;j<erased.length;j++)bits[erased[j]]=(mask>>j)&1;
    const d=S.hammingDecodeCodeword(bits);if(!d)continue;
    let penalty=d.corrected||0;
    for(let j=0;j<erased.length;j++){const conf=items[erased[j]]?.conf||0;penalty+=Math.max(0,.35-conf*.05);}
    cands.push({byte:d.byte,corrected:d.corrected||0,penalty});
  }
  if(!cands.length)return null;
  cands.sort((a,b)=>a.penalty-b.penalty);
  const best=cands[0],same=cands.filter(x=>Math.abs(x.penalty-best.penalty)<.001);
  if(same.some(x=>x.byte!==best.byte))return null;
  return{byte:best.byte,corrected:best.corrected,erasures:erased.length};
}

function stopSlotListener(){
  if(timer){clearInterval(timer);timer=null;}
  try{stream?.getTracks?.().forEach(t=>t.stop());}catch{}
  try{source?.disconnect?.();analyser?.disconnect?.();silent?.disconnect?.();}catch{}
  try{ctx?.close?.();}catch{}
  ctx=stream=source=analyser=silent=null;cb=null;inputReady=false;
  try{baseStop();}catch{}
  publish();
}

function duplexState(){
  const b=baseDuplex?baseDuplex():{};
  return{...b,inputReady:inputReady&&live(),micState:ctx?.state||b.micState||'none',dsp:!!analyser&&!!timer,duplexReady:!!(b.outputUnlocked&&b.outState==='running'&&inputReady&&live()&&ctx?.state==='running'&&analyser&&timer),settings:lastSettings||b.settings,modem:'clocked-bfsk-slot-soft',slotDecoder:true,softDecision:true,erasureRecovery:true};
}
function publish(){const d=duplexState();status(d.duplexReady?'SONIC · DUPLEX READY':d.inputReady?'SONIC · SLOT RX READY':'SONIC · AUDIO INIT',d.duplexReady?'on':'mid');emit('duplex-state',d);return d;}

async function startSlotListener(onMessage){
  cb=onMessage||cb;
  if(live()&&analyser&&timer&&ctx&&ctx.state!=='closed'){
    if(ctx.state==='suspended')try{await ctx.resume();}catch{}
    inputReady=ctx.state==='running';publish();return inputReady;
  }
  try{baseStop();}catch{}
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Micrófono no disponible');
  const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw Error('Web Audio no disponible');
  stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1,sampleRate:{ideal:48000}},video:false});
  ctx=new AC({latencyHint:'interactive'});if(ctx.state==='suspended')await ctx.resume();
  source=ctx.createMediaStreamSource(stream);analyser=ctx.createAnalyser();analyser.fftSize=FFT;analyser.smoothingTimeConstant=0;analyser.minDecibels=-110;analyser.maxDecibels=-8;silent=ctx.createGain();silent.gain.value=1e-7;source.connect(analyser);analyser.connect(silent);silent.connect(ctx.destination);
  const sr=ctx.sampleRate,freq=new Float32Array(analyser.frequencyBinCount),settings=stream.getAudioTracks?.()[0]?.getSettings?.()||{};lastSettings=settings;inputReady=true;

  let startProfile=null,startHits=0,startLast=0,startReleasedAt=0,frame=null,lastDiag=0;

  function reset(reason='RESET'){
    if(frame&&reason!=='DONE')stage(reason,{profile:frame.profile,bits:frame.raw.length,bytes:frame.bytes.length,corrections:frame.corrections,erasures:frame.erasures});
    frame=null;
  }
  function begin(profile,db){
    frame={profile,sync:[],syncOk:false,code:[],bytes:[],needed:null,raw:[],corrections:0,erasures:0,slot:null,lastClockAt:0,clockArmed:true,clockWeak:0};
    stage('CLOCK_LOCK',{profile,db,decoder:'slot-soft'});overlay(`SONIC RX · SLOT LOCK · ${profile.toUpperCase()}`,'signal');
  }
  function consume(v,conf=0,erasure=false){
    if(!frame)return;frame.raw.push(v);if(erasure)frame.erasures++;
    if(!frame.syncOk){
      frame.sync.push(v);
      if(frame.sync.length===SYNC.length){
        const q=hdistSoft(frame.sync,SYNC);
        if(q.errors>SYNC_ERRORS||q.erasures>MAX_SYNC_ERASURES||q.score>SYNC_ERRORS){stage('SYNC_FAIL',{profile:frame.profile,errors:q.errors,erasures:q.erasures});reset('SYNC_RESET');return;}
        frame.syncOk=true;stage('SYNC_OK',{profile:frame.profile,errors:q.errors,erasures:q.erasures});overlay(`SONIC RX · SYNC ✓ · ${frame.profile.toUpperCase()} · err ${q.errors} · era ${q.erasures}`,'signal');
      }
      return;
    }
    frame.code.push({v,conf});
    while(frame&&frame.code.length>=12){
      const word=frame.code.splice(0,12),d=decodeCodewordSoft(word);
      if(!d){stage('FEC_FAIL',{profile:frame.profile,erasures:word.filter(x=>x.v==null).length});reset('FEC_RESET');return;}
      frame.bytes.push(d.byte);frame.corrections+=d.corrected;frame.erasures+=d.erasures;
      if(frame.bytes.length===9){
        if(frame.bytes[0]!==0x53||frame.bytes[1]!==0x38||frame.bytes[2]!==1||frame.bytes[8]>64){stage('HEADER_FAIL',{profile:frame.profile,bytes:frame.bytes.slice(0,9)});reset('HEADER_RESET');return;}
        frame.needed=10+frame.bytes[8];stage('HEADER_OK',{profile:frame.profile,neededBytes:frame.needed,corrections:frame.corrections,erasures:frame.erasures});overlay(`SONIC RX · HEADER ✓ · ${frame.needed} B · ${frame.profile.toUpperCase()}`,'signal');
      }
      if(frame?.needed&&frame.bytes.length>=frame.needed){
        const r=S.unpack(Uint8Array.from(frame.bytes.slice(0,frame.needed)));
        if(!r?.ok){stage('CRC_FAIL',{profile:frame.profile,corrections:frame.corrections,erasures:frame.erasures});reset('CRC_RESET');return;}
        const prof=frame.profile,corr=frame.corrections,eras=frame.erasures,now=performance.now(),key=`${r.session}:${r.type}:${r.payload?.length||0}:${r.payload?.[0]??0}`;
        stage('CRC_OK',{profile:prof,type:r.type,session:r.session,corrections:corr,erasures:eras,bytes:r.need});
        if(!(key===lastPacketKey&&now-lastPacketTs<1500)){
          lastPacketKey=key;lastPacketTs=now;overlay(`SONIC RX ✓ · TYPE ${r.type} · ${prof.toUpperCase()} · CRC OK · era ${eras}`,'ok');emit('rx',{type:r.type,session:r.session,bytes:r.need,profile:prof,fecCorrections:corr,erasures:eras,slotDecoder:true});
          try{cb?.({...r,profile:prof,fecCorrections:corr,erasures:eras,slotDecoder:true});}catch(e){console.error(e);}
        }
        reset('DONE');return;
      }
    }
  }
  function finalizeSlot(reason='BOUNDARY'){
    if(!frame?.slot)return;
    const s=frame.slot;frame.slot=null;
    let v=null,conf=0;
    if(s.samples>0){const avg=s.score/s.samples,peak=s.peakDiff||0;conf=Math.max(Math.abs(avg),Math.abs(peak));if(conf>=.55)v=(avg||peak)>0?1:0;}
    if(v==null){stage('ERASURE',{profile:frame.profile,atBit:frame.raw.length,reason,samples:s.samples,peak:s.peak});consume(null,conf,true);}
    else{stage('SOFT_BIT',{profile:frame.profile,atBit:frame.raw.length,value:v,confidence:conf,samples:s.samples});consume(v,conf,false);}
  }
  function openClock(now,clockDb,margin){
    if(!frame)return;if(now-frame.lastClockAt<CLOCK_MIN_SPACING)return;
    if(frame.slot)finalizeSlot('NEXT_CLOCK');
    frame.lastClockAt=now;frame.slot={openedAt:now,score:0,samples:0,peak:-120,peakDiff:0};frame.clockArmed=false;frame.clockWeak=0;
    stage('CLOCK_TICK',{profile:frame.profile,atBit:frame.raw.length,db:clockDb,margin});
  }

  status('SONIC · SLOT RX ESCUCHANDO','on');overlay('SONIC RX · SLOT/SOFT · esperando START…','listen');log(`RX Slot/Soft · ${sr} Hz · FFT ${FFT} · CLOCK recovery + erasure Hamming`);

  timer=setInterval(()=>{
    analyser.getFloatFrequencyData(freq);const now=performance.now(),cand=[];
    for(const [pk,p] of Object.entries(PROFILES)){const roles=['data0','start','clock','data1'];for(let i=0;i<4;i++)cand.push({profile:pk,role:roles[i],db:dbAt(freq,p.freq[i],sr,FFT),hz:p.freq[i]});}
    cand.sort((a,b)=>b.db-a.db);const best=cand[0],second=cand[1],floor=median(cand.map(x=>x.db)),margin=best.db-second.db,snr=best.db-floor;

    const native=S.__slotNativeTxState?.()||null;
    if(native?.txActive) localTxUntil=now+RX_GUARD;
    if(now<localTxUntil){reset('LOCAL_TX_GUARD');startHits=0;startProfile=null;return;}

    if(!frame){
      const startCand=cand.find(x=>x.role==='start'&&x.db>-86&&x.db-floor>7);
      if(startCand){
        if(startProfile===startCand.profile&&now-startLast<15)startHits++;else{startProfile=startCand.profile;startHits=1;}
        startLast=now;startReleasedAt=0;
      }else if(startHits>=START_HITS){
        if(!startReleasedAt)startReleasedAt=now;
        if(now-startReleasedAt>=START_RELEASE){const p=startProfile,db=(PROFILES[p]&&dbAt(freq,PROFILES[p].freq[1],sr,FFT))||best.db;begin(p,db);startHits=0;startProfile=null;startReleasedAt=0;}
      }else if(now-startLast>45){startHits=0;startProfile=null;startReleasedAt=0;}
    }else{
      const p=PROFILES[frame.profile];if(!p){reset('PROFILE_RESET');return;}
      const d0=dbAt(freq,p.freq[0],sr,FFT),st=dbAt(freq,p.freq[1],sr,FFT),cl=dbAt(freq,p.freq[2],sr,FFT),d1=dbAt(freq,p.freq[3],sr,FFT),competitor=Math.max(st,d0,d1),cm=cl-competitor;
      const clockStrong=cl>-88&&((cm>.65)||(cl>-68&&cm>-.8));
      if(clockStrong){
        frame.clockWeak=0;
        if(frame.clockArmed)openClock(now,cl,cm);
      }else{
        frame.clockWeak++;
        if(frame.clockWeak>=1)frame.clockArmed=true;
        if(frame.slot){
          const maxData=Math.max(d0,d1),diff=d1-d0;
          if(maxData>-94&&Math.abs(diff)>.25){frame.slot.score+=clamp(diff,-24,24);frame.slot.samples++;if(maxData>frame.slot.peak){frame.slot.peak=maxData;frame.slot.peakDiff=diff;}}
          if(now-frame.slot.openedAt>SLOT_TIMEOUT)finalizeSlot('TIMEOUT');
        }
      }
    }

    if(now-lastDiag>180){lastDiag=now;emit('spectrum',{profile:frame?.profile||best.profile||null,role:best.role||null,hz:best.hz,bestDb:best.db,margin,snr,floor,settings,frameActive:!!frame,slotActive:!!frame?.slot,slotBits:frame?.raw.length||0,decoder:'slot-soft'});}
  },POLL);

  publish();emit('listener-ready',{sampleRate:sr,fft:FFT,settings,persistent:true,clockedBfsk:true,fec:'Hamming(12,8)+erasures',syncTolerance:SYNC_ERRORS,slotDecoder:true,softDecision:true});return true;
}

const nativeSend=S.send.bind(S);
S.send=function(...args){localTxUntil=performance.now()+RX_GUARD;const p=nativeSend(...args);Promise.resolve(p).finally(()=>{localTxUntil=performance.now()+RX_GUARD;});return p;};
S.__slotNativeTxState=()=>{const b=baseDuplex?baseDuplex():{};return{txActive:!!b.txActive};};
S.startListener=startSlotListener;
S.stopListener=stopSlotListener;
S.duplexState=duplexState;
S.primeDuplex=async function(onMessage){await S.unlockOutput();await startSlotListener(onMessage);const d=publish();if(!d.duplexReady)throw Error(`Sonic duplex incompleto · speaker ${d.outState} · mic ${d.micState}`);emit('duplex-ready',d);return d;};
S.version=VERSION;S.slotDecoder=true;S.softDecision=true;S.erasureRecovery=true;S.clockRecoveryV2=true;
window.__hopperHPS8SonicSlotDecoder={version:VERSION,active:true,slotClock:true,softDecision:true,erasureRecovery:true,maxCodeErasures:MAX_CODE_ERASURES,baseVersion:'0.10.4'};
})();
