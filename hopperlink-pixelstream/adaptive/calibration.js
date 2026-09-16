import {buildTransport,buildFrameSchedule} from '../src/superstream.js?v=rxfix1';
import {recoverData} from '../src/gf256.js?v=rxfix1';
import {crc32} from '../src/crc32.js?v=rxfix1';
import {CATALOG_HASH,profile,randomBytes,trialSeed} from './protocol.js?v=rxfix1';
import {AUDIO} from './audio-codec.js?v=rxfix1';
export const PLANS={quick:[9,1,2,4],full:[9,1,2,3,4,5,6,7,8,10]};
export function createTrial(sid,pid,round,groups=3){const p=profile(pid),source=randomBytes(p.payloadBytes*p.k*groups-7,trialSeed(sid,pid,round)),transport=buildTransport(source,p);return {p,source,transport,schedule:buildFrameSchedule(transport,{pass:round})};}
function lowerBound(success,total){if(!total)return 0;const z=1.645,f=success/total,den=1+z*z/total;return(f+z*z/(2*total)-z*Math.sqrt(f*(1-f)/total+z*z/(4*total*total)))/den;}
export class TrialResult{
 constructor(sid,pid,round){Object.assign(this,createTrial(sid,pid,round));this.sid=sid;this.pid=pid;this.round=round;this.received=new Map();this.observed=new Set();this.bitErrors=0;this.bitTotal=0;this.motion=[];this.confusion=Array.from({length:2**this.p.bits},()=>new Uint32Array(2**this.p.bits));this.started=null;this.last=0;this.sealed=false;}
 ingest(d,now){const h=d.header;if(this.sealed||h.sid!==this.sid||h.profileId!==this.pid||h.round!==this.round||h.kind!==3||h.seq>=this.transport.frames.length)return false;
  if(this.started===null)this.started=now;this.last=now;if(this.observed.has(h.seq))return false;this.observed.add(h.seq);const expected=this.transport.frames[h.seq].payload;
  if(d.payload.length!==expected.length)return false;
  for(let i=0;i<expected.length;i++){let x=expected[i]^d.payload[i];while(x){this.bitErrors+=x&1;x>>=1;}}this.bitTotal+=expected.length*8;
  if(d.symbols){let bit=0;for(const got of d.symbols){let want=0;for(let j=0;j<this.p.bits;j++){want=(want<<1)|(expected[bit>>3]>>(7-bit%8)&1);bit++;}if(bit<=expected.length*8)this.confusion[want][got]++;}}
  if(d.crcOK)this.received.set(h.seq,d.payload);if(Number.isFinite(d.motion))this.motion.push(d.motion);return true;
 }
 finish(durationMs){this.sealed=true;const t=this.transport;let bytes=0,groups=0;
  for(let g=0;g<t.groupCount;g++){const m=new Map();for(let slot=0;slot<t.k+t.r;slot++){const seq=g*(t.k+t.r)+slot;if(this.received.has(seq))m.set(slot,this.received.get(seq));}
   let recovered=null;if(m.size>=t.k){try{recovered=recoverData(m,t.k,t.r,t.blockLen);}catch{}}
   let all=true;for(let s=0;s<t.k;s++){const b=recovered?.[s]||m.get(s),i=g*t.k+s,expected=t.frames[g*(t.k+t.r)+s].payload;if(b&&crc32(b)===crc32(expected))bytes+=Math.min(t.blockLen,Math.max(0,this.source.length-i*t.blockLen));else all=false;}if(all)groups++;
  }
  const valid=this.received.size,expected=t.frames.length,rate=bytes/Math.max(.001,durationMs/1000),motion=[...this.motion].sort((a,b)=>a-b),motion95=motion[Math.floor(motion.length*.95)]||0;
  const pass=groups===t.groupCount&&valid>=Math.min(12,expected)&&valid/expected>=.68;
  return {id:this.pid,round:this.round,valid,expected,recoveredBytes:bytes,groups,totalGroups:t.groupCount,durationMs,rate,bitErrorRate:this.bitTotal?this.bitErrors/this.bitTotal:null,motion95,pass,score:pass?rate*lowerBound(valid,expected)/(1+Math.max(0,motion95-.2)*.2):0};
 }
}
export function pickProfiles(results){const viable=results.filter(r=>r.pass&&r.score>0).sort((a,b)=>b.score-a.score);if(!viable.length)return null;
 const best=viable[0],similar=viable.filter(r=>r.score>=best.score*.93).sort((a,b)=>profile(a.id).bits-profile(b.id).bits||profile(a.id).payloadCells-profile(b.id).payloadCells);const chosen=similar[0]||best;const fallback=viable.filter(r=>r.id!==chosen.id).sort((a,b)=>profile(a.id).bits-profile(b.id).bits)[0]||chosen;
 return {chosen:chosen.id,fallback:fallback.id};}
export function reportFor(sid,epoch,results){const selection=pickProfiles(results);if(!selection)return null;const compact=results.map(r=>({id:r.id,v:r.valid,n:r.expected,g:r.groups,d:Math.round(r.durationMs),b:r.recoveredBytes,p:r.pass,s:Math.round(r.score)}));const fingerprint=crc32(new TextEncoder().encode(JSON.stringify({sid,epoch,selection,compact})));
 return {sid,catalog:CATALOG_HASH,epoch,...selection,fingerprint,results:compact};}
export class CalibrationSender{
 constructor({sid,mode='quick',audio=true,onEvent=()=>{}}){this.sid=sid;this.mode=mode;this.wantAudio=audio;this.onEvent=onEvent;this.state='idle';this.epoch=1;this.audioBand=-1;this.audioResults=[];this.controlSeq=0;this.position=0;this.plan=[...PLANS[mode]];this.selected=null;this.round=0;this.ended=false;this.calibrationStarted=0;}
 start(now){this.calibrationStarted=now;this.control({op:'hello',mode:this.mode},now,1800,'audioStart');}
 control(c,now,hold,next){this.state='hold';this.deadline=now+hold;this.next=next;this.onEvent({type:'control',c:{...c,sid:this.sid,epoch:this.epoch,serial:++this.controlSeq,audio:this.audioBand}});}
 beginProbe(now){const pid=this.plan[this.position];if(pid===undefined){if(this.round===2){this.control({op:'reacquire',chosen:this.selected.chosen,fingerprint:this.selected.fingerprint},now,400,'offer');return;}this.state='report';this.reportDeadline=now+25000;this.onEvent({type:'control',c:{op:'summary',sid:this.sid,epoch:this.epoch,serial:++this.controlSeq,round:this.round,audio:this.audioBand}});return;}
  this.trial=createTrial(this.sid,pid,this.round);this.control({op:'trial',pid,round:this.round,total:this.trial.transport.frames.length},now,800,'probeStart');}
 tick(now){if(this.ended)return;
  if(this.state==='hold'&&now>=this.deadline){const next=this.next;
   if(next==='audioStart'){if(!this.wantAudio){this.beginProbe(now);return;}this.audioIndex=0;this.beginAudio(now);}
   else if(next==='audioNext'){if(++this.audioIndex<(this.mode==='full'?6:3))this.beginAudio(now);else{const scored=this.audioResults.filter(r=>r.type===AUDIO.TRAIN);const bands=[0,1,2].map(band=>({band,items:scored.filter(s=>s.band===band)})).filter(b=>b.items.length);bands.sort((a,b)=>b.items.length-a.items.length||b.items.reduce((s,x)=>s+x.margin,0)/b.items.length-a.items.reduce((s,x)=>s+x.margin,0)/a.items.length);this.audioBand=bands[0]?.band??-1;this.onEvent({type:'audio-result',band:this.audioBand,samples:scored});this.beginProbe(now);}}
   else if(next==='recheckStart'){this.beginProbe(now);}
   else if(next==='probeStart'){this.state='probe';this.trialStart=now;this.last=now-1000;this.framePosition=0;}
   else if(next==='nextTrial'){this.position++;this.beginProbe(now);}
   else if(next==='offer'){this.state='offer';this.offerDeadline=now+20000;this.onEvent({type:'control',c:{op:'offer',sid:this.sid,epoch:this.epoch,serial:++this.controlSeq,chosen:this.selected.chosen,fallback:this.selected.fallback,fingerprint:this.selected.fingerprint,audio:this.audioBand}});}
  }
  if(this.state==='probe'&&now-this.last>=1000/this.trial.p.fps){this.last=now;
   if(this.framePosition>=this.trial.schedule.length){const elapsed=now-this.trialStart;this.control({op:'endtrial',pid:this.trial.p.id,round:this.round,durationMs:Math.round(elapsed)},now,650,'nextTrial');return;}
   const seq=this.trial.schedule[this.framePosition++],f={...this.trial.transport.frames[seq],kind:3,round:this.round};this.onEvent({type:'probe',p:this.trial.p,f,seq,t:this.trial.transport});
  }
  if(this.state==='report'&&now>=this.reportDeadline){this.state='qr';this.onEvent({type:'qr-needed',message:'No llegó el informe acústico. Escanea el QR del receptor o introduce su código.'});}
  if(this.state==='offer'&&now>=this.offerDeadline){this.state='manual-ready';this.onEvent({type:'manual-ready',message:'Sin READY sonoro. Confirma solo si el receptor muestra la validación correcta.'});}
 }
 beginAudio(now){const band=this.audioIndex%3;this.control({op:'audio',band,index:this.audioIndex},now,4300,'audioNext');}
 receiveAudio(packet,now){if(packet.sid!==this.sid)return false;
  if(packet.type===AUDIO.TRAIN&&this.state==='hold'&&this.next==='audioNext'&&packet.seq===this.audioIndex){this.audioResults.push(packet);return true;}
  if(packet.type===AUDIO.REPORT&&['report','qr'].includes(this.state)&&packet.seq===this.epoch){return this.acceptReport({sid:this.sid,catalog:CATALOG_HASH,epoch:packet.seq,chosen:packet.arg0,fallback:packet.token,fingerprint:packet.arg1},now);}
  if(packet.type===AUDIO.READY&&['offer','manual-ready'].includes(this.state)&&packet.seq===this.epoch&&packet.arg0===this.selected?.chosen&&packet.arg1===this.selected?.fingerprint){this.finish(now,false);return true;}return false;
 }
 acceptReport(r,now){if(!['report','qr'].includes(this.state)||r.sid!==this.sid||r.catalog!==CATALOG_HASH||r.epoch!==this.epoch||!profileSafe(r.chosen)||!profileSafe(r.fallback)||!Number.isInteger(r.fingerprint))return false;
  this.selected=r;this.onEvent({type:'report',report:r});if(this.round===0){this.round=1;this.epoch++;this.plan=[...new Set([r.chosen,r.fallback])];this.position=0;this.beginProbe(now);}
  else{this.round=2;this.plan=[r.chosen];this.position=0;this.control({op:'reacquire',chosen:r.chosen,fingerprint:r.fingerprint},now,1800,'recheckStart');}return true;
 }
 confirmManual(now){if(this.state!=='manual-ready'&&this.state!=='offer')return false;this.finish(now,true);return true;}
 finish(now,manual){this.ended=true;this.state='ready';this.onEvent({type:'ready',profile:this.selected.chosen,audioBand:this.audioBand,manual,report:this.selected,elapsedMs:now-this.calibrationStarted});}
 cancel(){this.ended=true;this.state='cancelled';}
}
const profileSafe=id=>Number.isInteger(id)&&id>0&&id<11;
export class CalibrationReceiver{
 constructor(onEvent=()=>{}){this.onEvent=onEvent;this.reset();}
 reset(){this.sid=0;this.epoch=0;this.trial=null;this.results=[];this.report=null;this.audioBand=-1;this.seen=new Set();this.allowNew=true;}
 control(c,now){
  // The application calls this only for a CRC-valid, matching-catalogue control.
  // Joining after HELLO (permissions/focus/reacquisition) must not strand sid=0.
  const joinable=['hello','audio','trial'].includes(c.op);
  if(c.sid!==this.sid&&joinable&&(c.op==='hello'||!this.sid||c.round===0)){
   this.reset();this.sid=c.sid;
   this.onEvent({type:'session-acquired',sid:c.sid,late:c.op!=='hello'});
  }
  if(c.sid!==this.sid)return false;this.audioBand=c.audio??this.audioBand;const key=c.epoch+':'+c.serial;if(this.seen.has(key))return true;this.seen.add(key);
  if(c.epoch!==this.epoch){this.epoch=c.epoch;this.results=[];this.report=null;}
  if(c.op==='audio')this.onEvent({type:'play-training',packet:{type:AUDIO.TRAIN,sid:c.sid,band:c.band,seq:c.index,arg0:c.band}});
  if(c.op==='trial'&&profileSafe(c.pid)){this.trial=new TrialResult(c.sid,c.pid,c.round);this.onEvent({type:'trial',id:c.pid,round:c.round});}
  if(c.op==='endtrial'&&this.trial&&c.pid===this.trial.pid&&c.round===this.trial.round){const result=this.trial.finish(c.durationMs);this.results.push(result);this.onEvent({type:'result',result});}
  if(c.op==='summary'){this.report=reportFor(this.sid,this.epoch,this.results);this.onEvent({type:this.report?'report':'failed',report:this.report,band:this.audioBand});}
  if(c.op==='reacquire')this.reacquire=now;
  if(c.op==='offer'&&this.report&&this.trial?.round===2&&this.results.at(-1)?.pass&&c.chosen===this.report.chosen&&c.fingerprint===this.report.fingerprint){this.onEvent({type:'offer',report:this.report,band:this.audioBand,controlKey:key});}
  return true;
 }
 ingest(d,now){return this.trial?.ingest(d,now)||false;}
}
