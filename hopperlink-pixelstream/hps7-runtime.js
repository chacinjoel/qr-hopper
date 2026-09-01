(() => {
'use strict';

const CORE_URL='./hps7.js?v=083core';

function replaceOne(src,label,from,to){
  if(!src.includes(from)) throw new Error(`HPS7 runtime patch missing: ${label}`);
  const out=src.replace(from,to);
  if(out===src) throw new Error(`HPS7 runtime patch failed: ${label}`);
  return out;
}

function patchCore(src){
  src=replaceOne(src,'dense-logical-blocks',
    "const BASE_CHUNK = 360;",
    "const BASE_CHUNK = 372;");

  src=replaceOne(src,'repair-500',
    "function repairPasses(n){return n<=100?3:n<=300?2:1;}",
    "function repairPasses(n){return n>0&&n<=500?3:1;}");

  src=replaceOne(src,'rx-telemetry-state',
    "function freshRx(){return{session:null,total:0,dataGrid:56,preferredBits:4,lastBits:4,nextBits:null,autoMod:true,fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null,passStartCount:0,lastPassReceived:0};}",
    "function freshRx(){return{session:null,total:0,dataGrid:56,preferredBits:4,lastBits:4,nextBits:null,autoMod:true,fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null,passStartCount:0,lastPassReceived:0,sessionStartedAt:0,firstDataAt:0,completedAt:0,bytesReceived:0,lastBytes:0,byteRateEma:0,peakByteRate:0,validDataPackets:0,duplicateBlocks:0,roundStartedAt:0,lastDataRound:-1,roundStats:[]};}");

  src=replaceOne(src,'metric-and-vsync',
    "function clamp(v,a,b){return Math.max(a,Math.min(b,v));}",
    "function clamp(v,a,b){return Math.max(a,Math.min(b,v));}\nfunction emitMetric(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:'+name,{detail}));}catch{}}\nfunction opticalHold(ms){return new Promise(resolve=>{const start=performance.now();const step=t=>{if(t-start>=ms-1)resolve();else requestAnimationFrame(step);};requestAnimationFrame(step);});}");

  src=replaceOne(src,'micro-cell-guard',
    "function renderPacket(raw,grid,bits){const c=$('pixelCanvas');c.width=grid;c.height=grid;const ctx=c.getContext('2d',{alpha:false}),sym=rawToSymbols(raw,grid,bits),pal=palette(bits),img=ctx.createImageData(grid,grid);for(let i=0;i<sym.length;i++){const rgb=pal[sym[i]]||pal[0],p=i*4;img.data[p]=rgb[0];img.data[p+1]=rgb[1];img.data[p+2]=rgb[2];img.data[p+3]=255;}ctx.putImageData(img,0,0);}",
    "function renderPacket(raw,grid,bits){const c=$('pixelCanvas'),sym=rawToSymbols(raw,grid,bits),pal=palette(bits);if(bits===2){c.width=grid;c.height=grid;const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(grid,grid);for(let i=0;i<sym.length;i++){const rgb=pal[sym[i]]||pal[0],p=i*4;img.data[p]=rgb[0];img.data[p+1]=rgb[1];img.data[p+2]=rgb[2];img.data[p+3]=255;}ctx.putImageData(img,0,0);return;}const S=8,P=1,W=grid*S;c.width=W;c.height=W;const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(W,W),d=img.data;for(let p=0;p<d.length;p+=4){d[p]=58;d[p+1]=58;d[p+2]=58;d[p+3]=255;}for(let gy=0;gy<grid;gy++)for(let gx=0;gx<grid;gx++){const rgb=pal[sym[gy*grid+gx]]||pal[0],x0=gx*S+P,y0=gy*S+P;for(let y=y0;y<(gy+1)*S-P;y++)for(let x=x0;x<(gx+1)*S-P;x++){const p=(y*W+x)*4;d[p]=rgb[0];d[p+1]=rgb[1];d[p+2]=rgb[2];}}ctx.putImageData(img,0,0);}");

  src=replaceOne(src,'closing-burst-order',
    "for(let pass=1;pass<=passes;pass++){const repeats=pass===1?sp.repeat:1;for(let gi=0;gi<groups.length;gi++){const g=groups[gi],raw=makePacket(TYPE.DATA,tx.session,round,g.first,tx.total,g.payload,tx.grid,bits);",
    "for(let pass=1;pass<=passes;pass++){const repeats=pass===1?sp.repeat:1,passGroups=pass===1?groups:(pass===2?groups.slice().reverse():groups.filter((_,i)=>i%2===0).concat(groups.filter((_,i)=>i%2===1)));if(isRepair&&passes===3){slog(`Closing Burst ciclo ${pass}/3 · ${indices.length} faltantes · orden ${pass===1?'normal':pass===2?'invertido':'intercalado'}.`);emitMetric('closing-cycle',{cycle:pass,cycles:3,missing:indices.length,bits});}for(let gi=0;gi<passGroups.length;gi++){const g=passGroups[gi],raw=makePacket(TYPE.DATA,tx.session,round,g.first,tx.total,g.payload,tx.grid,bits);");

  src=replaceOne(src,'vsync-pacing',
    "await sleep(frameMs);}}}",
    "await opticalHold(frameMs);}}}");

  src=replaceOne(src,'reset-session-time',
    "function resetRxSession(session,total,dataGrid,bits,autoMod,fileCrc=0,fileSize=0){rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.preferredBits=bits;rx.lastBits=bits;rx.autoMod=autoMod;rx.fileCrc=fileCrc;rx.fileSize=fileSize;$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;}",
    "function resetRxSession(session,total,dataGrid,bits,autoMod,fileCrc=0,fileSize=0){rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.preferredBits=bits;rx.lastBits=bits;rx.autoMod=autoMod;rx.fileCrc=fileCrc;rx.fileSize=fileSize;rx.sessionStartedAt=performance.now();$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;}");

  src=replaceOne(src,'hello-event',
    "setPhase(`RECEPTOR · LOCK ${bits}-BIT`,'on');}else if(rx.session!==p.session)",
    "setPhase(`RECEPTOR · LOCK ${bits}-BIT`,'on');emitMetric('hello',{session:p.session,total:p.total,fileSize,dataGrid,bits,autoMod,baseChunk:BASE_CHUNK});}else if(rx.session!==p.session)");

  src=replaceOne(src,'data-telemetry',
    "function handleData(p){if(cameraMode!=='receiverData'||rx.session===null)return;if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid||!BITS_OPTIONS.includes(p.bits)){rx.errors++;updateErrors();return;}const bundle=parseBundle(p.payload,rx.total);if(!bundle){rx.errors++;updateErrors();return;}rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);rx.lastBits=p.bits;rx.nextBits=null;let added=0;for(const e of bundle)if(!rx.chunks.has(e.idx)){rx.chunks.set(e.idx,e.data);added++;}if(added){$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}setPhase(`RECEPTOR · ${p.bits}-BIT · ${rx.chunks.size}/${rx.total}`,'on');}",
    "function handleData(p){if(cameraMode!=='receiverData'||rx.session===null)return;if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid||!BITS_OPTIONS.includes(p.bits)){rx.errors++;updateErrors();emitMetric('reject',{errors:rx.errors,reason:'identity'});return;}const bundle=parseBundle(p.payload,rx.total);if(!bundle){rx.errors++;updateErrors();emitMetric('reject',{errors:rx.errors,reason:'bundle'});return;}rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);rx.lastBits=p.bits;rx.nextBits=null;const ts=performance.now();if(!rx.firstDataAt)rx.firstDataAt=ts;if(rx.lastDataRound!==p.round){rx.lastDataRound=p.round;rx.roundStartedAt=ts;}let added=0,addedBytes=0,dups=0;for(const e of bundle){if(!rx.chunks.has(e.idx)){rx.chunks.set(e.idx,e.data);added++;addedBytes+=e.data.length;}else dups++;}rx.validDataPackets++;rx.duplicateBlocks+=dups;if(added){rx.bytesReceived+=addedBytes;$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}emitMetric('data',{round:p.round+1,bits:p.bits,added,addedBytes,duplicates:dups,count:rx.chunks.size,total:rx.total,bytesReceived:rx.bytesReceived,validPackets:rx.validDataPackets,errors:rx.errors});setPhase(`RECEPTOR · ${p.bits}-BIT · ${rx.chunks.size}/${rx.total}`,'on');}");

  src=replaceOne(src,'passend-telemetry',
    "const{missing}=makeMissingBitmap(),suggest=suggestedRepairBits(missing,lastBits),gained=Math.max(0,rx.chunks.size-rx.passStartCount);rlog(`PASS_END R${p.round+1}: +${gained} bloques · ${rx.chunks.size}/${rx.total} · faltan ${missing} · siguiente ${suggest}-bit.`);rx.passStartCount=rx.chunks.size;stopCamera();",
    "const{missing}=makeMissingBitmap(),suggest=suggestedRepairBits(missing,lastBits),gained=Math.max(0,rx.chunks.size-rx.passStartCount),roundMs=rx.roundStartedAt?performance.now()-rx.roundStartedAt:0;rx.roundStats.push({round:p.round+1,gained,missing,bits:lastBits,roundMs});emitMetric('passend',{round:p.round+1,gained,missing,bits:lastBits,suggest,roundMs,count:rx.chunks.size,total:rx.total});rlog(`PASS_END R${p.round+1}: +${gained} bloques · ${rx.chunks.size}/${rx.total} · faltan ${missing} · siguiente ${suggest}-bit.`);rx.passStartCount=rx.chunks.size;stopCamera();");

  src=replaceOne(src,'nack-event',
    "rlog(`NACK HPS7 · ${missing} faltantes · reparación sugerida ${suggestBits}-bit.`);}",
    "rlog(`NACK HPS7 · ${missing} faltantes · reparación sugerida ${suggestBits}-bit.`);emitMetric('nack',{round:round+1,missing,suggestBits,closingBurst:missing>0&&missing<=500,cycles:missing>0&&missing<=500?3:1});}");

  src=replaceOne(src,'complete-event',
    "function showComplete(round,assembled){rxState=RXS.COMPLETE;rx.complete=assembled;const payload=concat(new Uint8Array([rx.dataGrid,rx.lastBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data)))),packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');}",
    "function showComplete(round,assembled){rxState=RXS.COMPLETE;rx.complete=assembled;rx.completedAt=performance.now();const dataMs=rx.firstDataAt?rx.completedAt-rx.firstDataAt:0,sessionMs=rx.sessionStartedAt?rx.completedAt-rx.sessionStartedAt:dataMs,avgBps=dataMs>0?assembled.data.length/(dataMs/1000):0;const payload=concat(new Uint8Array([rx.dataGrid,rx.lastBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data)))),packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);emitMetric('complete',{fileSize:assembled.data.length,total:rx.total,round:round+1,repairs:round,errors:rx.errors,validPackets:rx.validDataPackets,duplicateBlocks:rx.duplicateBlocks,dataMs,sessionMs,avgBps,peakBps:rx.peakByteRate,roundStats:rx.roundStats.slice(),bits:rx.lastBits,grid:rx.dataGrid,crc:crc32(assembled.data),baseChunk:BASE_CHUNK});openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');}");

  src=replaceOne(src,'live-metrics',
    "function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;}const elapsed=(ts-rx.startedAt)/1000;if(count>rx.lastCount&&ts>rx.lastTs){const inst=(count-rx.lastCount)/((ts-rx.lastTs)/1000);rx.emaRate=rx.emaRate?rx.emaRate*.72+inst*.28:inst;rx.lastCount=count;rx.lastTs=ts;}const rate=rx.emaRate||count/Math.max(.25,elapsed),byteRate=rate*BASE_CHUNK;$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=rate?`${rate.toFixed(rate<20?1:0)} blk/s · ${(byteRate/1024).toFixed(1)} KiB/s`:'—';$('rxEta').textContent=count>=total?'0s':rate?`≈ ${fmtTime((total-count)/rate)}`:'—';}",
    "function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;rx.lastBytes=rx.bytesReceived;}const elapsed=(ts-rx.startedAt)/1000;if(rx.bytesReceived>rx.lastBytes&&ts>rx.lastTs){const instBps=(rx.bytesReceived-rx.lastBytes)/((ts-rx.lastTs)/1000);rx.byteRateEma=rx.byteRateEma?rx.byteRateEma*.72+instBps*.28:instBps;rx.peakByteRate=Math.max(rx.peakByteRate,instBps);rx.lastCount=count;rx.lastBytes=rx.bytesReceived;rx.lastTs=ts;}const byteRate=rx.byteRateEma||rx.bytesReceived/Math.max(.25,elapsed),rate=byteRate/BASE_CHUNK;$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=byteRate?`${rate.toFixed(rate<20?1:0)} blk/s · ${(byteRate/1024).toFixed(1)} KiB/s`:'—';$('rxEta').textContent=count>=total?'0s':byteRate?`≈ ${fmtTime(((total-count)*BASE_CHUNK)/byteRate)}`:'—';emitMetric('metrics',{count,total,elapsed,byteRate,peakBps:rx.peakByteRate,errors:rx.errors,validPackets:rx.validDataPackets,duplicateBlocks:rx.duplicateBlocks,round:rx.round+1,bytesReceived:rx.bytesReceived,baseChunk:BASE_CHUNK});}");

  src=replaceOne(src,'direct-binary-geometry',
    "function detectFiducials(frame){const st=photoStats(frame);",
    "function detectFiducials(frame){const st=photoStats(frame);const bridge=window.__hopperBinaryTagBridge?.last;if(bridge?.valid&&bridge.markers){const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>bridge.markers[k]),H=computeHomography(src,dst);if(H){lastPhoto=st;return{found:4,markers:bridge.markers,H,quality:bridge.quality||94,photo:st};}}");

  src=replaceOne(src,'robust-cell-sampling',
    "function rgbAt(frame,x,y,rad){const xi=Math.round(x),yi=Math.round(y);if(xi<0||yi<0||xi>=frame.w||yi>=frame.h)return[0,0,0];let r=0,g=0,b=0,n=0;for(let yy=Math.max(0,yi-rad);yy<=Math.min(frame.h-1,yi+rad);yy++)for(let xx=Math.max(0,xi-rad);xx<=Math.min(frame.w-1,xi+rad);xx++){const p=(yy*frame.w+xx)*4;r+=frame.data[p];g+=frame.data[p+1];b+=frame.data[p+2];n++;}return[r/n,g/n,b/n];}",
    "function rgbAt(frame,x,y,rad){const xi=Math.round(x),yi=Math.round(y);if(xi<0||yi<0||xi>=frame.w||yi>=frame.h)return[0,0,0];const s=Math.max(1,rad),pts=[[0,0],[-s,0],[s,0],[0,-s],[0,s]],rs=[],gs=[],bs=[];for(const[dx,dy]of pts){const xx=clamp(xi+dx,0,frame.w-1),yy=clamp(yi+dy,0,frame.h-1),p=(yy*frame.w+xx)*4;rs.push(frame.data[p]);gs.push(frame.data[p+1]);bs.push(frame.data[p+2]);}rs.sort((a,b)=>a-b);gs.sort((a,b)=>a-b);bs.sort((a,b)=>a-b);return[rs[2],gs[2],bs[2]];}");

  src=replaceOne(src,'camera-exposure-governor',
    "async function tuneCamera(track){try{const cap=track?.getCapabilities?.()||{},advanced={};if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('continuous'))advanced.focusMode='continuous';if(Array.isArray(cap.exposureMode)&&cap.exposureMode.includes('continuous'))advanced.exposureMode='continuous';if(Array.isArray(cap.whiteBalanceMode)&&cap.whiteBalanceMode.includes('continuous'))advanced.whiteBalanceMode='continuous';if(Object.keys(advanced).length)await track.applyConstraints({advanced:[advanced]});}catch{}}",
    "async function tuneCamera(track){try{const cap=track?.getCapabilities?.()||{},advanced={};if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('continuous'))advanced.focusMode='continuous';if(Array.isArray(cap.exposureMode)&&cap.exposureMode.includes('continuous'))advanced.exposureMode='continuous';if(Array.isArray(cap.whiteBalanceMode)&&cap.whiteBalanceMode.includes('continuous'))advanced.whiteBalanceMode='continuous';if(cap.exposureCompensation&&Number.isFinite(cap.exposureCompensation.min)&&Number.isFinite(cap.exposureCompensation.max)){advanced.exposureCompensation=clamp(-0.7,cap.exposureCompensation.min,cap.exposureCompensation.max);}if(Object.keys(advanced).length)await track.applyConstraints({advanced:[advanced]});emitMetric('camera-tuned',{capabilities:cap,settings:track?.getSettings?.()||{},exposureCompensation:advanced.exposureCompensation??null});}catch{}}"
  );

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
    new Function(`${patched}\n//# sourceURL=hps7-core-v083.js`)();
    window.__hopperRuntime={version:'0.8.3',closingBurstThreshold:500,closingBurstCycles:3,stableFps:12,baseChunk:372,vsyncPacing:true,microCellGuard:true,directBinaryGeometry:true,robustMedianSampling:true,patched:true};
    await loadScript('./color-warmup.js?v=083');
    await loadScript('./transfer-telemetry.js?v=083');
    window.dispatchEvent(new CustomEvent('hopper:runtime-ready',{detail:window.__hopperRuntime}));
  }catch(err){
    console.error(err);
    const phase=document.getElementById('phaseStatus');
    if(phase){phase.textContent='ERROR HPS7 RUNTIME';phase.className='chip off';}
    const log=document.getElementById('sendLog');
    if(log)log.textContent=`ERROR v0.8.3: ${err.message}\n`+log.textContent;
  }
}

boot();
})();