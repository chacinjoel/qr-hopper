(() => {
'use strict';

const S=window.__hopperHPS8Sonic;
if(!S){console.error('Sonic8 Timeline Decoder: base modem missing');return;}

const VERSION='0.10.14';
const PROFILES=S.profiles||{};
const SYNC=Array.isArray(S.syncBits)?S.syncBits.slice():[1,0,1,1,0,1,0,0,1,1,1,0,0,1,0,1];
const FFT=256,POLL=3,START_MS=86,START_HOLD=28,START_TIMEOUT=180;
const START_GAP=20,CLOCK_MS=8,SWITCH_MS=2,DATA_MS=10,BIT_GAP=4,PERIOD=CLOCK_MS+SWITCH_MS+DATA_MS+BIT_GAP;
const FIRST_CLOCK_START=START_GAP,FIRST_CLOCK_END=START_GAP+CLOCK_MS;
const FIRST_DATA_START=START_GAP+CLOCK_MS+SWITCH_MS,FIRST_DATA_END=FIRST_DATA_START+DATA_MS,FIRST_BIT_END=START_GAP+PERIOD;
const SYNC_ERRORS=2,MAX_SYNC_ERASURES=2,MAX_SYNC_SEARCH=22,MAX_CODE_ERASURES=2,RX_GUARD=140,FRAME_TIMEOUT=24000;
const DATA_PAD=2.5,CLOCK_PAD=2.5;
const baseStop=S.stopListener.bind(S),baseDuplex=S.duplexState?.bind(S);

let ctx=null,stream=null,source=null,analyser=null,silent=null,timer=null,cb=null,inputReady=false,lastSettings=null;
let localTxUntil=0,lastPacketKey='',lastPacketTs=0;

function emit(n,d={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-sonic-${n}`,{detail:d}));}catch{}}
function stage(name,d={}){emit('frame-stage',{stage:name,...d,timelineDecoder:true,onsetAnchored:true});}
function overlay(text,kind=''){let e=document.getElementById('sonicOverlayDiag'),o=document.getElementById('streamOverlay');if(!o)return;if(!e){e=document.createElement('div');e.id='sonicOverlayDiag';e.style.cssText='position:absolute;left:12px;top:max(52px,calc(env(safe-area-inset-top) + 42px));z-index:75;padding:7px 9px;border-radius:10px;background:rgba(2,6,23,.84);border:1px solid rgba(103,232,249,.42);color:#dbeafe;font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none';o.appendChild(e);}e.textContent=text;e.dataset.kind=kind;}
function status(text,kind=''){const e=document.getElementById('hps8SonicStatus');if(e){e.textContent=text;e.className='chip '+kind;}}
function log(text){const e=document.getElementById('sendLog');if(e)e.textContent=`[${new Date().toLocaleTimeString()}] SONIC8 TIMELINE · ${text}\n`+e.textContent.slice(0,8500);}
function live(){const t=stream?.getAudioTracks?.()[0];return!!t&&t.readyState==='live';}
function dbAt(a,hz,sr,fft){return a[Math.max(0,Math.min(a.length-1,Math.round(hz*fft/sr)))]??-120;}
function median(a){const x=a.slice().sort((a,b)=>a-b);return x[Math.floor(x.length/2)]??-120;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function r32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function hdistSoft(bits,target){let errors=0,erasures=0;for(let i=0;i<target.length;i++){const v=bits[i]?.v;if(v==null)erasures++;else if(v!==target[i])errors++;}return{errors,erasures,score:errors+erasures*.5};}

function decodeCodewordSoft(items){
  if(!Array.isArray(items)||items.length!==12)return null;
  const erased=[];for(let i=0;i<12;i++)if(items[i]?.v==null)erased.push(i);
  if(erased.length>MAX_CODE_ERASURES)return null;
  const tries=1<<erased.length,cands=[];
  for(let mask=0;mask<tries;mask++){
    const bits=items.map(x=>x?.v==null?0:x.v);
    for(let j=0;j<erased.length;j++)bits[erased[j]]=(mask>>j)&1;
    const d=S.hammingDecodeCodeword(bits);if(!d)continue;
    let penalty=(d.corrected||0)*.9;
    for(const i of erased)penalty+=Math.max(.1,.55-(items[i]?.conf||0)*.04);
    cands.push({byte:d.byte,corrected:d.corrected||0,penalty});
  }
  if(!cands.length)return null;
  cands.sort((a,b)=>a.penalty-b.penalty);
  const best=cands[0],same=cands.filter(x=>Math.abs(x.penalty-best.penalty)<.001);
  if(same.some(x=>x.byte!==best.byte))return null;
  return{byte:best.byte,corrected:best.corrected,erasures:erased.length};
}

function stopTimelineListener(){
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
  return{...b,inputReady:inputReady&&live(),micState:ctx?.state||b.micState||'none',dsp:!!analyser&&!!timer,duplexReady:!!(b.outputUnlocked&&b.outState==='running'&&inputReady&&live()&&ctx?.state==='running'&&analyser&&timer),settings:lastSettings||b.settings,modem:'clocked-bfsk-onset-timeline',slotDecoder:true,softDecision:true,erasureRecovery:true,deterministicPll:true,onsetAnchored:true,clockDoesNotShiftTimeline:true,earlyAck:false};
}
function publish(){const d=duplexState();status(d.duplexReady?'SONIC · DUPLEX READY':d.inputReady?'SONIC · TIMELINE RX READY':'SONIC · AUDIO INIT',d.duplexReady?'on':'mid');emit('duplex-state',d);return d;}

async function startTimelineListener(onMessage){
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

  let start={profile:null,onsetAt:0,lastAt:0,peak:-120},frame=null,lastDiag=0;

  function clearStart(){start={profile:null,onsetAt:0,lastAt:0,peak:-120};}
  function reset(reason='RESET'){
    if(frame&&reason!=='DONE')stage(reason,{profile:frame.profile,bits:frame.raw.length,bytes:frame.bytes.length,corrections:frame.corrections,erasures:frame.erasures,onsetAt:frame.onsetAt});
    frame=null;clearStart();
  }
  function lockStart(profile,db,onsetAt,now){
    const startEnd=onsetAt+START_MS;
    frame={profile,onsetAt,startEnd,startedAt:onsetAt,syncBuf:[],syncOk:false,code:[],bytes:[],needed:null,raw:[],corrections:0,erasures:0,bitNo:0,bit:{score:0,samples:0,peak:-120,peakDiff:0,clockPeak:-120,clockSamples:0},lastFinalizedAt:-1};
    stage('START_LOCK',{profile,db,onsetAt,confirmedAt:now,anchorAgeMs:now-onsetAt,startEnd,onsetAnchored:true});
    stage('START_ANCHOR',{profile,onsetAt,startEnd,startMs:START_MS});
    overlay(`SONIC RX · START ANCHOR ✓ · ${profile.toUpperCase()} · t0 fijo`,'signal');
  }
  function consume(item){
    if(!frame)return;frame.raw.push(item.v);if(item.v==null)frame.erasures++;
    if(!frame.syncOk){
      frame.syncBuf.push(item);if(frame.syncBuf.length>MAX_SYNC_SEARCH)frame.syncBuf.shift();
      if(frame.syncBuf.length>=SYNC.length){
        const w=frame.syncBuf.slice(-SYNC.length),q=hdistSoft(w,SYNC);
        if(q.errors<=SYNC_ERRORS&&q.erasures<=MAX_SYNC_ERASURES&&q.score<=SYNC_ERRORS){
          frame.syncOk=true;frame.syncBuf=[];stage('SYNC_OK',{profile:frame.profile,errors:q.errors,erasures:q.erasures,bits:frame.raw.length});
          overlay(`SONIC RX · SYNC ✓ · ${frame.profile.toUpperCase()} · err ${q.errors} · era ${q.erasures}`,'signal');return;
        }
        stage('SYNC_SEARCH',{profile:frame.profile,bits:frame.raw.length,errors:q.errors,erasures:q.erasures});
        if(frame.raw.length>=MAX_SYNC_SEARCH){stage('SYNC_FAIL',{profile:frame.profile,errors:q.errors,erasures:q.erasures});reset('SYNC_RESET');}
      }
      return;
    }
    frame.code.push(item);
    while(frame&&frame.code.length>=12){
      const word=frame.code.splice(0,12),d=decodeCodewordSoft(word);
      if(!d){stage('FEC_FAIL',{profile:frame.profile,erasures:word.filter(x=>x.v==null).length});reset('FEC_RESET');return;}
      frame.bytes.push(d.byte);frame.corrections+=d.corrected;frame.erasures+=d.erasures;
      if(frame.bytes.length===9){
        if(frame.bytes[0]!==0x53||frame.bytes[1]!==0x38||frame.bytes[2]!==1||frame.bytes[8]>64){stage('HEADER_FAIL',{profile:frame.profile,prefix:frame.bytes.slice(0,9)});reset('HEADER_RESET');return;}
        frame.needed=10+frame.bytes[8];
        stage('HEADER_OK',{profile:frame.profile,type:frame.bytes[3],session:r32(frame.bytes,4),neededBytes:frame.needed,corrections:frame.corrections,erasures:frame.erasures});
        overlay(`SONIC RX · HEADER ✓ · TYPE ${frame.bytes[3]} · ${frame.profile.toUpperCase()}`,'signal');
      }
      if(frame?.needed&&frame.bytes.length>=frame.needed){
        const r=S.unpack(Uint8Array.from(frame.bytes.slice(0,frame.needed)));
        if(!r?.ok){stage('CRC_FAIL',{profile:frame.profile,corrections:frame.corrections,erasures:frame.erasures});reset('CRC_RESET');return;}
        const prof=frame.profile,corr=frame.corrections,eras=frame.erasures,now=performance.now(),key=`${r.session}:${r.type}:${r.payload?.length||0}:${r.payload?.[0]??0}`;
        stage('CRC_OK',{profile:prof,type:r.type,session:r.session,corrections:corr,erasures:eras,bytes:r.need});
        if(!(key===lastPacketKey&&now-lastPacketTs<1500)){
          lastPacketKey=key;lastPacketTs=now;overlay(`SONIC RX ✓ · TYPE ${r.type} · ${prof.toUpperCase()} · CRC OK`,'ok');
          emit('rx',{type:r.type,session:r.session,bytes:r.need,profile:prof,fecCorrections:corr,erasures:eras,timelineDecoder:true,onsetAnchored:true});
          try{cb?.({...r,profile:prof,fecCorrections:corr,erasures:eras,timelineDecoder:true,onsetAnchored:true});}catch(e){console.error(e);}
        }
        reset('DONE');return;
      }
    }
  }
  function finalizeBit(reason='TIMELINE'){
    if(!frame)return;
    const s=frame.bit;let v=null,conf=0;
    if(s.samples){const avg=s.score/s.samples,peak=s.peakDiff||0;conf=Math.max(Math.abs(avg),Math.abs(peak));if(conf>=.25)v=(Math.abs(avg)>=Math.abs(peak)?avg:peak)>0?1:0;}
    const item={v,conf};
    if(v==null)stage('ERASURE',{profile:frame.profile,atBit:frame.raw.length,reason,samples:s.samples,clockSamples:s.clockSamples});
    else stage('SOFT_BIT',{profile:frame.profile,atBit:frame.raw.length,value:v,confidence:conf,samples:s.samples,clockSamples:s.clockSamples});
    consume(item);if(!frame)return;
    frame.lastFinalizedAt=frame.bitNo;frame.bitNo++;frame.bit={score:0,samples:0,peak:-120,peakDiff:0,clockPeak:-120,clockSamples:0};
  }

  status('SONIC · TIMELINE RX ESCUCHANDO','on');overlay('SONIC RX · TIMELINE · esperando START…','listen');
  log(`RX onset timeline · ${sr} Hz · FFT ${FFT} · START ${START_MS} ms · period ${PERIOD} ms · CLOCK no desplaza t0`);

  timer=setInterval(()=>{
    analyser.getFloatFrequencyData(freq);const now=performance.now(),cand=[];
    for(const [pk,p] of Object.entries(PROFILES)){const roles=['data0','start','clock','data1'];for(let i=0;i<4;i++)cand.push({profile:pk,role:roles[i],db:dbAt(freq,p.freq[i],sr,FFT),hz:p.freq[i]});}
    cand.sort((a,b)=>b.db-a.db);const best=cand[0],second=cand[1],floor=median(cand.map(x=>x.db)),margin=best.db-second.db,snr=best.db-floor;
    const native=baseDuplex?baseDuplex():{};if(native.txActive)localTxUntil=now+RX_GUARD;
    if(now<localTxUntil){reset('LOCAL_TX_GUARD');return;}

    if(!frame){
      let bestStart=null;
      for(const [pk,p] of Object.entries(PROFILES)){
        const d0=dbAt(freq,p.freq[0],sr,FFT),st=dbAt(freq,p.freq[1],sr,FFT),cl=dbAt(freq,p.freq[2],sr,FFT),d1=dbAt(freq,p.freq[3],sr,FFT),local=Math.max(d0,cl,d1),startSnr=st-floor,localMargin=st-local;
        if(st>-92&&startSnr>3.3&&(localMargin>-3||st>-60)){
          const score=startSnr+Math.max(-3,localMargin)*.7;if(!bestStart||score>bestStart.score)bestStart={profile:pk,db:st,score};
        }
      }
      if(bestStart){
        if(start.profile!==bestStart.profile||now-start.lastAt>18){start.profile=bestStart.profile;start.onsetAt=now;start.peak=bestStart.db;}
        else start.peak=Math.max(start.peak,bestStart.db);
        start.lastAt=now;
        if(start.onsetAt&&now-start.onsetAt>=START_HOLD)lockStart(start.profile,start.peak,start.onsetAt,now);
      }else if(start.profile&&now-start.lastAt>START_TIMEOUT)clearStart();
    }else{
      if(now-frame.startedAt>FRAME_TIMEOUT){reset('FRAME_TIMEOUT');return;}
      const p=PROFILES[frame.profile];if(!p){reset('PROFILE_RESET');return;}
      const d0=dbAt(freq,p.freq[0],sr,FFT),cl=dbAt(freq,p.freq[2],sr,FFT),d1=dbAt(freq,p.freq[3],sr,FFT),rel=now-frame.startEnd,n=frame.bitNo;
      const dataA=FIRST_DATA_START+n*PERIOD-DATA_PAD,dataB=FIRST_DATA_END+n*PERIOD+DATA_PAD;
      const clockA=FIRST_CLOCK_START+n*PERIOD-CLOCK_PAD,clockB=FIRST_CLOCK_END+n*PERIOD+CLOCK_PAD;
      if(rel>=clockA&&rel<=clockB){frame.bit.clockSamples++;if(cl>frame.bit.clockPeak)frame.bit.clockPeak=cl;}
      if(rel>=dataA&&rel<=dataB){
        const maxData=Math.max(d0,d1),diff=d1-d0;
        if(maxData>-98&&Math.abs(diff)>.08){frame.bit.score+=clamp(diff,-30,30);frame.bit.samples++;if(maxData>frame.bit.peak){frame.bit.peak=maxData;frame.bit.peakDiff=diff;}}
      }
      let guard=0;
      while(frame&&now-frame.startEnd>=FIRST_BIT_END+frame.bitNo*PERIOD+DATA_PAD&&guard++<6)finalizeBit('ONSET_TIMELINE');
    }

    if(now-lastDiag>180){lastDiag=now;emit('spectrum',{profile:frame?.profile||start.profile||best.profile||null,role:best.role||null,hz:best.hz,bestDb:best.db,margin,snr,floor,settings,frameActive:!!frame,slotActive:!!frame,slotBits:frame?.raw.length||0,decoder:'onset-timeline',onsetAnchored:true});}
  },POLL);

  publish();emit('listener-ready',{sampleRate:sr,fft:FFT,settings,persistent:true,clockedBfsk:true,fec:'Hamming(12,8)+erasures',syncTolerance:SYNC_ERRORS,slotDecoder:true,softDecision:true,deterministicPll:true,onsetAnchored:true,clockDoesNotShiftTimeline:true,earlyAck:false});return true;
}

const nativeSend=S.send.bind(S);
S.send=function(...args){localTxUntil=performance.now()+RX_GUARD;const p=nativeSend(...args);Promise.resolve(p).finally(()=>{localTxUntil=performance.now()+RX_GUARD;});return p;};
S.startListener=startTimelineListener;
S.stopListener=stopTimelineListener;
S.duplexState=duplexState;
S.primeDuplex=async function(onMessage){await S.unlockOutput();await startTimelineListener(onMessage);const d=publish();if(!d.duplexReady)throw Error(`Sonic duplex incompleto · speaker ${d.outState} · mic ${d.micState}`);emit('duplex-ready',d);return d;};
S.version=VERSION;S.slotDecoder=true;S.softDecision=true;S.erasureRecovery=true;S.clockRecoveryV2=true;S.deterministicPll=true;S.onsetAnchored=true;S.clockDoesNotShiftTimeline=true;S.earlyAck=false;
window.__hopperHPS8SonicSlotDecoder={version:VERSION,active:true,slotClock:true,softDecision:true,erasureRecovery:true,deterministicPll:true,onsetAnchored:true,clockDoesNotShiftTimeline:true,earlyAck:false,startMs:START_MS,periodMs:PERIOD,maxCodeErasures:MAX_CODE_ERASURES,baseVersion:'0.10.4'};
})();