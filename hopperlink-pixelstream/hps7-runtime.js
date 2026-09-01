(() => {
'use strict';

const CORE_URL='./hps7.js?v=082core';

function replaceOne(src,label,from,to){
  if(!src.includes(from)) throw new Error(`HPS7 runtime patch missing: ${label}`);
  const out=src.replace(from,to);
  if(out===src) throw new Error(`HPS7 runtime patch failed: ${label}`);
  return out;
}

function patchCore(src){
  src=replaceOne(src,'stable-plus-speed',
    "balanced:{label:'Balanceado',fps:12,repeat:1,hint:'Balanceado · 12 imágenes/s · recomendado si hay movimiento o brillo irregular.'},",
    "balanced:{label:'Stable+',fps:13,repeat:1,hint:'Stable+ · 13 imágenes/s · ajuste moderado sobre el perfil estable.'},");

  src=replaceOne(src,'repair-500',
    "function repairPasses(n){return n<=100?3:n<=300?2:1;}",
    "function repairPasses(n){return n>0&&n<500?3:1;}");

  src=replaceOne(src,'rx-telemetry-state',
    "function freshRx(){return{session:null,total:0,dataGrid:56,preferredBits:4,lastBits:4,nextBits:null,autoMod:true,fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null,passStartCount:0,lastPassReceived:0};}",
    "function freshRx(){return{session:null,total:0,dataGrid:56,preferredBits:4,lastBits:4,nextBits:null,autoMod:true,fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null,passStartCount:0,lastPassReceived:0,sessionStartedAt:0,firstDataAt:0,completedAt:0,bytesReceived:0,lastBytes:0,byteRateEma:0,peakByteRate:0,validDataPackets:0,duplicateBlocks:0,roundStartedAt:0,lastDataRound:-1,roundStats:[]};}");

  src=replaceOne(src,'metric-emitter',
    "function clamp(v,a,b){return Math.max(a,Math.min(b,v));}",
    "function clamp(v,a,b){return Math.max(a,Math.min(b,v));}\nfunction emitMetric(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:'+name,{detail}));}catch{}}");

  src=replaceOne(src,'reset-session-time',
    "function resetRxSession(session,total,dataGrid,bits,autoMod,fileCrc=0,fileSize=0){rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.preferredBits=bits;rx.lastBits=bits;rx.autoMod=autoMod;rx.fileCrc=fileCrc;rx.fileSize=fileSize;$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;}",
    "function resetRxSession(session,total,dataGrid,bits,autoMod,fileCrc=0,fileSize=0){rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.preferredBits=bits;rx.lastBits=bits;rx.autoMod=autoMod;rx.fileCrc=fileCrc;rx.fileSize=fileSize;rx.sessionStartedAt=performance.now();$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;}");

  src=replaceOne(src,'hello-event',
    "setPhase(`RECEPTOR · LOCK ${bits}-BIT`,'on');}else if(rx.session!==p.session)",
    "setPhase(`RECEPTOR · LOCK ${bits}-BIT`,'on');emitMetric('hello',{session:p.session,total:p.total,fileSize,dataGrid,bits,autoMod});}else if(rx.session!==p.session)");

  src=replaceOne(src,'data-telemetry',
    "function handleData(p){if(cameraMode!=='receiverData'||rx.session===null)return;if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid||!BITS_OPTIONS.includes(p.bits)){rx.errors++;updateErrors();return;}const bundle=parseBundle(p.payload,rx.total);if(!bundle){rx.errors++;updateErrors();return;}rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);rx.lastBits=p.bits;rx.nextBits=null;let added=0;for(const e of bundle)if(!rx.chunks.has(e.idx)){rx.chunks.set(e.idx,e.data);added++;}if(added){$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}setPhase(`RECEPTOR · ${p.bits}-BIT · ${rx.chunks.size}/${rx.total}`,'on');}",
    "function handleData(p){if(cameraMode!=='receiverData'||rx.session===null)return;if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid||!BITS_OPTIONS.includes(p.bits)){rx.errors++;updateErrors();emitMetric('reject',{errors:rx.errors,reason:'identity'});return;}const bundle=parseBundle(p.payload,rx.total);if(!bundle){rx.errors++;updateErrors();emitMetric('reject',{errors:rx.errors,reason:'bundle'});return;}rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);rx.lastBits=p.bits;rx.nextBits=null;const ts=performance.now();if(!rx.firstDataAt)rx.firstDataAt=ts;if(rx.lastDataRound!==p.round){rx.lastDataRound=p.round;rx.roundStartedAt=ts;}let added=0,addedBytes=0,dups=0;for(const e of bundle){if(!rx.chunks.has(e.idx)){rx.chunks.set(e.idx,e.data);added++;addedBytes+=e.data.length;}else dups++;}rx.validDataPackets++;rx.duplicateBlocks+=dups;if(added){rx.bytesReceived+=addedBytes;$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}emitMetric('data',{round:p.round+1,bits:p.bits,added,addedBytes,duplicates:dups,count:rx.chunks.size,total:rx.total,bytesReceived:rx.bytesReceived,validPackets:rx.validDataPackets,errors:rx.errors});setPhase(`RECEPTOR · ${p.bits}-BIT · ${rx.chunks.size}/${rx.total}`,'on');}");

  src=replaceOne(src,'passend-telemetry',
    "const{missing}=makeMissingBitmap(),suggest=suggestedRepairBits(missing,lastBits),gained=Math.max(0,rx.chunks.size-rx.passStartCount);rlog(`PASS_END R${p.round+1}: +${gained} bloques · ${rx.chunks.size}/${rx.total} · faltan ${missing} · siguiente ${suggest}-bit.`);rx.passStartCount=rx.chunks.size;stopCamera();",
    "const{missing}=makeMissingBitmap(),suggest=suggestedRepairBits(missing,lastBits),gained=Math.max(0,rx.chunks.size-rx.passStartCount),roundMs=rx.roundStartedAt?performance.now()-rx.roundStartedAt:0;rx.roundStats.push({round:p.round+1,gained,missing,bits:lastBits,roundMs});emitMetric('passend',{round:p.round+1,gained,missing,bits:lastBits,suggest,roundMs,count:rx.chunks.size,total:rx.total});rlog(`PASS_END R${p.round+1}: +${gained} bloques · ${rx.chunks.size}/${rx.total} · faltan ${missing} · siguiente ${suggest}-bit.`);rx.passStartCount=rx.chunks.size;stopCamera();");

  src=replaceOne(src,'nack-event',
    "rlog(`NACK HPS7 · ${missing} faltantes · reparación sugerida ${suggestBits}-bit.`);}",
    "rlog(`NACK HPS7 · ${missing} faltantes · reparación sugerida ${suggestBits}-bit.`);emitMetric('nack',{round:round+1,missing,suggestBits,closingBurst:missing>0&&missing<500,cycles:missing>0&&missing<500?3:1});}");

  src=replaceOne(src,'complete-event',
    "function showComplete(round,assembled){rxState=RXS.COMPLETE;rx.complete=assembled;const payload=concat(new Uint8Array([rx.dataGrid,rx.lastBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data)))),packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');}",
    "function showComplete(round,assembled){rxState=RXS.COMPLETE;rx.complete=assembled;rx.completedAt=performance.now();const dataMs=rx.firstDataAt?rx.completedAt-rx.firstDataAt:0,sessionMs=rx.sessionStartedAt?rx.completedAt-rx.sessionStartedAt:dataMs,avgBps=dataMs>0?assembled.data.length/(dataMs/1000):0;const payload=concat(new Uint8Array([rx.dataGrid,rx.lastBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data)))),packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);emitMetric('complete',{fileSize:assembled.data.length,total:rx.total,round:round+1,repairs:round,errors:rx.errors,validPackets:rx.validDataPackets,duplicateBlocks:rx.duplicateBlocks,dataMs,sessionMs,avgBps,peakBps:rx.peakByteRate,roundStats:rx.roundStats.slice(),bits:rx.lastBits,grid:rx.dataGrid,crc:crc32(assembled.data)});openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');}");

  src=replaceOne(src,'live-metrics',
    "function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;}const elapsed=(ts-rx.startedAt)/1000;if(count>rx.lastCount&&ts>rx.lastTs){const inst=(count-rx.lastCount)/((ts-rx.lastTs)/1000);rx.emaRate=rx.emaRate?rx.emaRate*.72+inst*.28:inst;rx.lastCount=count;rx.lastTs=ts;}const rate=rx.emaRate||count/Math.max(.25,elapsed),byteRate=rate*BASE_CHUNK;$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=rate?`${rate.toFixed(rate<20?1:0)} blk/s · ${(byteRate/1024).toFixed(1)} KiB/s`:'—';$('rxEta').textContent=count>=total?'0s':rate?`≈ ${fmtTime((total-count)/rate)}`:'—';}",
    "function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;rx.lastBytes=rx.bytesReceived;}const elapsed=(ts-rx.startedAt)/1000;if(rx.bytesReceived>rx.lastBytes&&ts>rx.lastTs){const instBps=(rx.bytesReceived-rx.lastBytes)/((ts-rx.lastTs)/1000);rx.byteRateEma=rx.byteRateEma?rx.byteRateEma*.72+instBps*.28:instBps;rx.peakByteRate=Math.max(rx.peakByteRate,instBps);rx.lastCount=count;rx.lastBytes=rx.bytesReceived;rx.lastTs=ts;}const byteRate=rx.byteRateEma||rx.bytesReceived/Math.max(.25,elapsed),rate=byteRate/BASE_CHUNK;$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=byteRate?`${rate.toFixed(rate<20?1:0)} blk/s · ${(byteRate/1024).toFixed(1)} KiB/s`:'—';$('rxEta').textContent=count>=total?'0s':byteRate?`≈ ${fmtTime(((total-count)*BASE_CHUNK)/byteRate)}`:'—';emitMetric('metrics',{count,total,elapsed,byteRate,peakBps:rx.peakByteRate,errors:rx.errors,validPackets:rx.validDataPackets,duplicateBlocks:rx.duplicateBlocks,round:rx.round+1,bytesReceived:rx.bytesReceived});}");

  return src;
}

function loadScript(src){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

async function boot(){
  try{
    const res=await fetch(CORE_URL,{cache:'no-store'});
    if(!res.ok)throw new Error(`HPS7 core HTTP ${res.status}`);
    const original=await res.text();
    const patched=patchCore(original);
    new Function(`${patched}\n//# sourceURL=hps7-core-v082.js`)();
    window.__hopperRuntime={version:'0.8.2',closingBurstThreshold:500,closingBurstCycles:3,stableFps:13,patched:true};
    await loadScript('./color-warmup.js?v=082');
    await loadScript('./transfer-telemetry.js?v=082');
    window.dispatchEvent(new CustomEvent('hopper:runtime-ready',{detail:window.__hopperRuntime}));
  }catch(err){
    console.error(err);
    const phase=document.getElementById('phaseStatus');
    if(phase){phase.textContent='ERROR HPS7 RUNTIME';phase.className='chip off';}
    const log=document.getElementById('sendLog');
    if(log)log.textContent=`ERROR v0.8.2: ${err.message}\n`+log.textContent;
  }
}

boot();
})();