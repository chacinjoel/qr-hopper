import { buildTransport, buildFrameSchedule, humanBytes } from './src/superstream.js';
import { resolveProfile, renderOpticalFrame, renderDiscoveryFrame, HDP } from './src/optical2.js';
import { CameraTracker } from './src/receiver2.js';
import { DownloadSession, prepareTransfer, metadataSchedule, estimateTransmission, duration, BUILD } from './src/transfer-metrics.js';
import { TorchChannel, FlashListener, torchAvailable } from './src/flash-channel.js';
import { feedbackText, parseFeedbackText, repairIndices, REPAIR_ALL, COMPLETE, FLASH_MESSAGE_MS } from './src/feedback.js';
import { controlFrame, parseControl } from './src/control-frame.js';

const $ = s => document.querySelector(s);
const log = msg => { const e=$('#diagnostics'); if(e)e.textContent=`[${new Date().toLocaleTimeString()}] ${msg}\n`+e.textContent.slice(0,10000); };
const text = (id,value) => {const e=$('#'+id);if(e)e.textContent=String(value);};
const rate = n => `${humanBytes(n)}/s`;
const setStatus = (id,value,live=false) => {text(id,value);$('#'+id).className='status-dot '+(live?'live':'idle');};
const uiError = error => {log('ERROR: '+error.message);text('transferNotice',error.message);};

// All interpolated file names below use textContent, never HTML.
$('#send .setup-card').insertAdjacentHTML('afterend', `<div class="card transfer-card">
  <h2>Transferencia <span class="build-chip">${BUILD}</span></h2>
  <strong id="sendName" class="file-name">Selecciona un archivo</strong>
  <div class="download-metrics"><div>Primera pasada estimada<b id="sendFirstEta">—</b></div><div>Con rescates programados<b id="sendPlanEta">—</b></div><div>Tiempo transcurrido<b id="sendElapsed">0 s</b></div><div>Salida medida al canvas<b id="sendRate">0 B/s</b></div></div>
  <p id="sendConfirm" class="muted">La duración real la confirma el receptor; las estimaciones no incluyen el retorno por flash.</p>
  <details><summary>Retorno automático por flash · experimental</summary>
    <p>El flash trasero del receptor apunta a la cámara frontal de este emisor. Actívalo antes de transmitir. Un mensaje tarda aproximadamente ${Math.ceil(FLASH_MESSAGE_MS/1000)} s. No usa micrófono ni red.</p>
    <button id="listenFlashBtn" class="secondary" type="button">Activar cámara frontal para retorno</button>
    <p id="frontState" role="status">Desactivado. Sin retorno se mantienen las pasadas de rescate actuales.</p>
    <label>Código de reparación alternativo<input id="repairInput" type="text" placeholder="HXR1-…" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>
    <button id="applyRepairBtn" class="secondary" type="button">Agregar faltantes a la cola</button>
    <p id="repairQueueState" role="status">Sin solicitudes.</p>
  </details>
  <p id="transferNotice" role="status"></p>
</div>`);
$('#cameraStage').insertAdjacentHTML('beforebegin', `<div class="download-card" aria-label="Descarga óptica">
  <div class="download-head"><strong id="downloadName" class="file-name">Esperando archivo…</strong><b id="downloadPercent">0.0%</b></div>
  <p id="downloadSizes" class="muted">El nombre aparecerá al recibir los primeros bloques.</p>
  <div class="progress" role="progressbar" aria-label="Archivo reconstruido y verificado" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="downloadBar"><div id="downloadFill"></div></div>
  <div class="download-metrics"><div>Velocidad útil actual<b id="downloadSpeed">0 B/s</b></div><div>Velocidad media<b id="downloadAverage">0 B/s</b></div><div>Transcurrido<b id="downloadElapsed">0 s</b></div><div>Restante estimado<b id="downloadEta">—</b></div></div>
  <p id="downloadState" role="status">Esperando datos.</p>
  <details><summary>Retroalimentación al emisor</summary>
    <label class="check-line"><input id="autoTorch" type="checkbox"> Permitir retorno automático con flash (experimental)</label>
    <p>Emite destellos. No apuntes a los ojos; no lo actives si eres sensible a ellos. La disponibilidad depende del teléfono y navegador.</p>
    <p id="torchState" role="status">Primero inicia la cámara para comprobar compatibilidad.</p>
    <button id="requestRepairBtn" class="secondary" type="button">Enviar solicitud ahora</button>
    <label>Código de reparación sin flash<input id="repairOutput" type="text" readonly aria-label="Código de reparación"></label>
    <button id="copyRepairBtn" class="secondary" type="button">Copiar código</button>
    <p>Alternativa manual: introduce este código en el emisor. Sin flash, la cola sigue siendo selectiva, pero copiar el código no es automático.</p>
  </details>
</div>`);
const frontVideo=document.createElement('video');
frontVideo.muted=true;frontVideo.playsInline=true;frontVideo.autoplay=true;frontVideo.className='front-sampler';
frontVideo.setAttribute('aria-hidden','true');document.body.append(frontVideo);

let selectedFile=null, prepared=null, transport=null, profile=null, schedules=[];
let tx=null, txRaf=0, frontEnabled=false, frontBusy=false, preparing=false;
let media=null, tracker=null, torch=null, rxActive=false, assembling=false, rxEpoch=0, receivedUrl=null, latestControl=null, lastAttempt='', settleUntil=0, cameraBusy=false;
const rx=new DownloadSession();
const listener=new FlashListener(frontVideo, request=>acceptFeedback(request,true), msg=>{text('frontState',msg);log(msg);});

function configuredProfile(){return resolveProfile($('#profileSelect').value,$('#gridSelect').value);}
function benchmark(){const p=configuredProfile(),fps=Number($('#fpsSelect').value);text('bCells',p.payloadCells.toLocaleString());text('bBpc',p.bits);text('bGross',rate(p.payloadBytes*fps));text('bNet',rate(p.payloadBytes*fps*p.k/(p.k+p.r)));$('#txStage').style.aspectRatio=`${p.cols}/${p.rows}`;}
function invalidate(){if(tx?.running)return;prepared=null;transport=null;schedules=[];$('#startTxBtn').disabled=true;}
for(const id of ['profileSelect','gridSelect','fpsSelect'])$('#'+id).addEventListener('change',()=>{invalidate();benchmark();});
for(const button of document.querySelectorAll('.tab'))button.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));button.classList.add('active');$('#'+button.dataset.tab)?.classList.add('active');};
function chooseFile(file){if(!file||tx?.running||preparing)return;invalidate();selectedFile=file;text('fileState',`${file.name} · ${humanBytes(file.size)}`);text('sendName',file.name);$('#prepareBtn').disabled=false;}
$('#fileInput').onchange=e=>chooseFile(e.target.files[0]);$('#dropzone').ondragover=e=>e.preventDefault();$('#dropzone').ondrop=e=>{e.preventDefault();chooseFile(e.dataTransfer.files[0]);};
function lockInputs(locked){for(const id of ['fileInput','profileSelect','gridSelect','fpsSelect'])$('#'+id).disabled=locked;$('#prepareBtn').disabled=locked||!selectedFile;$('#startTxBtn').disabled=locked||!transport;}
$('#prepareBtn').onclick=async()=>{if(!selectedFile||preparing||tx?.running)return;preparing=true;lockInputs(true);text('prepareBtn','Preparando…');
  try{profile=configuredProfile();prepared=await prepareTransfer(selectedFile);transport=buildTransport(prepared.stream,profile);
    if(transport.groupCount>=REPAIR_ALL)throw new Error('Archivo demasiado grande para el índice de grupos del protocolo.');
    const primary=[...metadataSchedule(transport,prepared.metadataBytes),...buildFrameSchedule(transport,{pass:0})];
    const rescues=profile.key==='robust'?2:1;schedules=[primary,...Array.from({length:rescues},(_,i)=>buildFrameSchedule(transport,{dataOnly:true,pass:i+1}))];
    text('mOriginal',humanBytes(prepared.originalBytes));text('mPacked',humanBytes(prepared.stream.length));text('mCompression',prepared.meta.codec==='raw'?'sin recomprimir':`${(prepared.originalBytes/prepared.packedBytes).toFixed(2)}× gzip`);
    text('mCollapse',`${Math.ceil(prepared.originalBytes/profile.payloadBytes)} → ${transport.dataCount}`);text('mPayload',humanBytes(profile.payloadBytes));text('mFec',`RS ${profile.k}+${profile.r} · ${rescues} rescates`);
    text('tGain',`${(prepared.originalBytes/prepared.stream.length).toFixed(2)}×`);text('sendName',prepared.meta.name);
    const fps=Number($('#fpsSelect').value);text('sendFirstEta',duration(estimateTransmission([primary],fps,HDP)));text('sendPlanEta',duration(estimateTransmission(schedules,fps,HDP)));
    $('#txPlaceholder').classList.add('hidden');renderDiscoveryFrame($('#txCanvas'),profile,0);
    log(`Preparado: ${prepared.meta.name}; ${transport.dataCount} bloques, ${profile.payloadBytes} B/frame; sesión ${prepared.meta.linkId.toString(16)}.`);
  }catch(error){prepared=null;transport=null;uiError(error);}finally{preparing=false;lockInputs(false);text('prepareBtn','Analizar y preparar');}};

function enterEmission(){document.body.classList.add('tx-active');$('#txExitBtn').hidden=false;
  try{const p=screen.orientation?.lock?.('portrait');p?.catch?.(()=>{});}catch{}
  try{const p=$('#txStage').requestFullscreen?.();p?.catch?.(()=>{});}catch{}}
function exitEmission(){document.body.classList.remove('tx-active');$('#txExitBtn').hidden=true;try{document.exitFullscreen?.()?.catch?.(()=>{});}catch{}}
function stopTx(status='EMISIÓN DETENIDA'){if(tx){tx.running=false;tx.ended=performance.now();}cancelAnimationFrame(txRaf);listener.arm(false);setStatus('txStatus',status);lockInputs(false);$('#pauseTxBtn').disabled=true;exitEmission();}
function scheduleLoop(){cancelAnimationFrame(txRaf);if(tx?.running)txRaf=requestAnimationFrame(txLoop);}
function setPhase(index,now){tx.index=index;tx.position=0;tx.schedule=schedules[index];tx.label=index?'RESCATE '+index:'PRINCIPAL';tx.sinceBeacon=0;tx.phasePending=false;tx.holdUntil=now+180;renderDiscoveryFrame($('#txCanvas'),profile,0);setStatus('txStatus',tx.label,true);}
function feedbackWindow(now){
  if(!frontEnabled || tx.windows>=3){stopTx('EMISIÓN FINALIZADA · SIN CONFIRMACIÓN');text('sendConfirm','Se enviaron las pasadas. El receptor confirma el archivo al verificar SHA-256.');return;}
  tx.windows++;tx.waiting=true;tx.phasePending=false;tx.waitUntil=now+65000;tx.position=0;tx.sinceBeacon=0;
  const frame=controlFrame(transport,{action:'feedback',linkId:prepared.meta.linkId,window:tx.windows,streamLength:transport.streamLength,blockLen:transport.blockLen,k:transport.k,r:transport.r});
  renderOpticalFrame($('#txCanvas'),frame,transport,profile,0,transport.frames.length);listener.arm(true);
  setStatus('txStatus','ESPERANDO RETORNO POR FLASH',true);text('frontState',`Ventana ${tx.windows}/3 · esperando mensaje (hasta 65 s).`);
}
function finishPhase(now){if(tx.selective){tx.selective=false;feedbackWindow(now);return;}if(tx.index+1<schedules.length)setPhase(tx.index+1,now);else feedbackWindow(now);}
function txLoop(now){if(!tx?.running)return;try{
  if(tx.paused)return;
  if(document.hidden){tx.paused=true;setStatus('txStatus','PAUSA · PÁGINA OCULTA');return;}
  if(tx.waiting){if(now>=tx.waitUntil){listener.arm(false);tx.waiting=false;feedbackWindow(now);}return;}
  if(now<tx.discoveryUntil){if(now-tx.last>100){tx.last=now;renderDiscoveryFrame($('#txCanvas'),profile,tx.phase++);}return;}
  if(now<tx.holdUntil)return;
  const interval=1000/tx.fps;if(now-tx.last<interval)return;tx.last=now;
  // Do NOT paint a beacon or leave fullscreen in the same callback as the
  // final data frame: it must remain physically displayed for its full dwell.
  if(tx.phasePending){finishPhase(now);return;}
  if(tx.sinceBeacon>=HDP.beaconEvery){tx.sinceBeacon=0;tx.holdUntil=now+HDP.beaconHoldMs;renderDiscoveryFrame($('#txCanvas'),profile,tx.phase++);return;}
  const index=tx.schedule[tx.position];if(index===undefined)throw new Error('Cola de transmisión inválida.');
  renderOpticalFrame($('#txCanvas'),transport.frames[index],transport,profile,index,transport.frames.length);
  tx.position++;tx.sinceBeacon++;tx.sent++;tx.bytesOut+=transport.blockLen;
  text('tFrame',`${tx.label} ${tx.position}/${tx.schedule.length}`);setStatus('txStatus',tx.label,true);
  $('#txProgress').style.width=`${Math.min(100,tx.sent/tx.totalPlanned*100)}%`;
  if(tx.position>=tx.schedule.length)tx.phasePending=true;
}catch(error){uiError(error);stopTx('ERROR DE EMISIÓN');}finally{scheduleLoop();}}
function beginTx(){if(!transport||tx?.running)return;const now=performance.now();tx={running:true,paused:false,index:0,position:0,schedule:schedules[0],label:'PRINCIPAL',sinceBeacon:0,last:0,discoveryUntil:now+HDP.discoveryMs,holdUntil:0,phase:0,phasePending:false,sent:0,bytesOut:0,started:now,ended:null,totalPlanned:schedules.reduce((n,s)=>n+s.length,0),waiting:false,windows:0,selective:false,fps:Number($('#fpsSelect').value)};
  lockInputs(true);$('#pauseTxBtn').disabled=false;text('pauseTxBtn','Pausar');text('sendConfirm','Emitiendo. Aún sin confirmación del receptor.');enterEmission();scheduleLoop();}
$('#startTxBtn').onclick=beginTx;
$('#pauseTxBtn').onclick=()=>{if(!tx?.running)return;tx.paused=!tx.paused;text('pauseTxBtn',tx.paused?'Continuar':'Pausar');if(!tx.paused){tx.last=0;if(tx.waiting)tx.waitUntil=performance.now()+65000;scheduleLoop();}else setStatus('txStatus','PAUSA');};
$('#txExitBtn').onclick=()=>stopTx();$('#fullTxBtn').onclick=enterEmission;
$('#listenFlashBtn').onclick=async()=>{if(frontBusy)return;frontBusy=true;$('#listenFlashBtn').disabled=true;
  try{if(frontEnabled){listener.stop();frontEnabled=false;text('listenFlashBtn','Activar cámara frontal para retorno');text('frontState','Retorno desactivado.');}
    else{if(media)throw new Error('Apaga primero la cámara receptora en este teléfono.');await listener.start();frontEnabled=true;text('listenFlashBtn','Desactivar cámara frontal');}}
  catch(error){uiError(error);}finally{frontBusy=false;$('#listenFlashBtn').disabled=false;}};
function acceptFeedback(request,fromFlash=false){try{
  if(!prepared||!transport)return;if(fromFlash&&!tx?.waiting)return;
  const indices=repairIndices(transport,request,prepared.meta.linkId);
  if(!fromFlash && tx?.running && !tx.waiting)throw new Error('Espera a que terminen las pasadas antes de aplicar el código de reparación.');
  if(request.group===COMPLETE){stopTx('RECEPTOR: SHA-256 OK');text('sendConfirm','El receptor confirmó el archivo verificado.');log('Confirmación recibida.');return;}
  if(!tx?.running){beginTx();tx.discoveryUntil=performance.now()+400;}
  listener.arm(false);tx.waiting=false;tx.selective=true;tx.schedule=[...new Set(indices)];tx.position=0;tx.label='REPARACIÓN SOLICITADA';tx.phasePending=false;tx.paused=false;tx.sinceBeacon=0;tx.totalPlanned+=tx.schedule.length;tx.holdUntil=performance.now()+600;
  renderDiscoveryFrame($('#txCanvas'),profile,0);text('repairQueueState',`${tx.schedule.length} bloques agregados automáticamente a la cola.`);log(`NACK válido: grupo=${request.group}, máscara=${request.mask.toString(16)}, cola=${tx.schedule.length}.`);scheduleLoop();
}catch(error){if(!fromFlash)uiError(error);}}
$('#applyRepairBtn').onclick=()=>{const r=parseFeedbackText($('#repairInput').value);if(!r)return uiError(new Error('Código de reparación inválido o CRC incorrecto.'));acceptFeedback(r);};

function requestForReceiver(){const linkId=rx.meta?.linkId||latestControl?.linkId;if(!linkId)return null;
  if(rx.verified)return{linkId,group:COMPLETE,mask:0};const m=rx.nextMissing();
  if(!m||rx.progress().pendingGroups>3)return{linkId,group:REPAIR_ALL,mask:0};return{linkId,...m};}
function showRepairCode(){const request=requestForReceiver();text('torchState',torchAvailable(media?.getVideoTracks()[0])?'Control de flash disponible; enlace físico todavía experimental.':'Flash no disponible. Usa el código o las pasadas de rescate.');if(request)$('#repairOutput').value=feedbackText(request);}
async function sendReturn(manual=false){
  if(torch?.busy)return;
  if(!$('#autoTorch').checked){if(manual)uiError(new Error('Autoriza los destellos o usa el código de reparación.'));return;}
  const request=requestForReceiver();if(!request)return;
  if(manual&&!latestControl){text('torchState','Espera la ventana de retorno del emisor. El código manual ya está disponible.');return;}
  if(!torch||!torchAvailable(torch.track)){text('torchState','Flash no disponible en esta cámara/navegador.');return;}
  const epoch=rxEpoch;
  try{text('torchState','Enviando retorno…');settleUntil=Infinity;
    await torch.send(request,p=>text('torchState',`Retorno por flash ${p}% · no muevas los teléfonos.`));
    if(epoch===rxEpoch)text('torchState','Mensaje emitido. Esperando reparación o confirmación del emisor.');
  }catch(error){$('#autoTorch').checked=false;text('torchState',error.message);log('FLASH: '+error.message);}
  finally{settleUntil=performance.now()+500;}}
$('#autoTorch').onchange=()=>{if(!$('#autoTorch').checked){torch?.stop();return;}if(!torchAvailable(media?.getVideoTracks()[0])){$('#autoTorch').checked=false;text('torchState','No hay control de flash disponible; inicia la cámara o utiliza el código.');}};
$('#requestRepairBtn').onclick=()=>{showRepairCode();sendReturn(true);};
$('#copyRepairBtn').onclick=async()=>{const request=requestForReceiver();if(!request)return;const s=feedbackText(request);$('#repairOutput').value=s;try{await navigator.clipboard.writeText(s);text('torchState','Código copiado.');}catch{$('#repairOutput').focus();$('#repairOutput').select();text('torchState','Selecciona y copia el código manualmente.');}};
function handleControl(decoded){const c=parseControl(decoded);if(!c)return;
  if(rx.meta?.linkId && c.linkId!==rx.meta.linkId)return;
  if(rx.streamLength&&(rx.streamLength!==c.streamLength||rx.blockLen!==c.blockLen||rx.k!==c.k||rx.r!==c.r))return;
  latestControl=c;const key=c.linkId+':'+c.window;
  const request=requestForReceiver();if(request)$('#repairOutput').value=feedbackText(request);
  if(key!==lastAttempt && $('#autoTorch').checked && !torch?.busy){lastAttempt=key;sendReturn();}}
async function onDecoded(decoded){if(decoded.header.kind===2){handleControl(decoded);return;}if(!rxActive||rx.verified||rx.failure||assembling||performance.now()<settleUntil)return;
  try{const p=rx.ingest(decoded);if(!p)return;latestControl=null;text('rFrames',`${p.have}/${p.total}`);text('rRecovered',p.recovered);text('rBer',`CRC OK · faltan ${p.missing}`);
    if(rx.meta) {const req=requestForReceiver();if(req)$('#repairOutput').value=feedbackText(req);}
    if(p.complete){assembling=true;const epoch=rxEpoch;text('downloadState','Verificando SHA-256…');
      try{const file=await rx.verify();if(epoch!==rxEpoch)return;
        if(receivedUrl)URL.revokeObjectURL(receivedUrl);receivedUrl=URL.createObjectURL(new Blob([file.data],{type:file.meta.type||'application/octet-stream'}));
        const box=$('#receivedFile');box.replaceChildren();const name=document.createElement('strong');name.textContent=file.meta.name;const info=document.createElement('p');info.textContent=`${humanBytes(file.data.length)} · SHA-256 OK · ${duration(rx.metrics().elapsed)}`;
        const link=document.createElement('a');link.href=receivedUrl;link.download=file.meta.name;link.textContent='Guardar archivo recibido';box.append(name,info,link);box.classList.remove('hidden');rxActive=false;
        setStatus('rxStatus','COMPLETO · SHA-256 OK',true);text('receiveBtn','Comenzar recepción');log(`Archivo verificado: ${file.meta.name}; ${duration(rx.metrics().elapsed)}; ${rate(rx.metrics().average)} de media.`);
      }catch(error){if(epoch===rxEpoch){rx.failure=error.message;text('downloadState','Error de verificación: '+error.message);uiError(error);}}
      finally{if(epoch===rxEpoch)assembling=false;}}
  }catch(error){uiError(error);}}
async function closeCamera(){rxActive=false;tracker?.stop();await torch?.stop();media?.getTracks().forEach(t=>t.stop());media=null;torch=null;tracker=null;$('#rxVideo').srcObject=null;text('cameraBtn','Iniciar cámara');$('#receiveBtn').disabled=true;text('receiveBtn','Comenzar recepción');setStatus('rxStatus',rx.verified?'COMPLETO · SHA-256 OK':'CÁMARA OFF',rx.verified);}
$('#cameraBtn').onclick=async()=>{if(cameraBusy)return;cameraBusy=true;$('#cameraBtn').disabled=true;
  try{if(media){await closeCamera();return;}if(frontEnabled)throw new Error('Desactiva la cámara frontal de retorno antes de recibir en este teléfono.');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Abre la página por HTTPS y permite el acceso a cámara.');
    media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}},audio:false});
    const video=$('#rxVideo');video.srcObject=media;await video.play();$('#cameraStage').style.aspectRatio=`${video.videoWidth}/${video.videoHeight}`;
    const track=media.getVideoTracks()[0];torch=new TorchChannel(track);
    try{const caps=track.getCapabilities?.()||{},advanced=[];for(const mode of ['focusMode','exposureMode','whiteBalanceMode'])if(caps[mode]?.includes('continuous'))advanced.push({[mode]:'continuous'});if(advanced.length)await track.applyConstraints({advanced});}catch{}
    tracker=new CameraTracker(video,$('#rxOverlay'),q=>{text('rLock',`${Math.round(q.lock*100)}%`);if(!rx.verified&&!assembling&&!rx.failure)setStatus('rxStatus',q.lock>.62?'LIGHTHOUSE LOCK':'BUSCANDO BALIZAS',q.lock>.62);},onDecoded);
    tracker.start();rxActive=!rx.verified;$('#receiveBtn').disabled=false;text('cameraBtn','Apagar cámara');text('receiveBtn',rxActive?'Detener recepción':'Archivo verificado');showRepairCode();
  }catch(error){await closeCamera();uiError(error);}finally{cameraBusy=false;$('#cameraBtn').disabled=false;}};
$('#receiveBtn').onclick=()=>{if(rx.verified)return;rxActive=!rxActive;text('receiveBtn',rxActive?'Detener recepción':'Comenzar recepción');};
$('#resetRxBtn').onclick=()=>{rxEpoch++;torch?.stop();rx.reset();assembling=false;latestControl=null;lastAttempt='';rxActive=!!media;if(receivedUrl)URL.revokeObjectURL(receivedUrl);receivedUrl=null;$('#receivedFile').replaceChildren();$('#receivedFile').classList.add('hidden');$('#repairOutput').value='';text('rFrames','0');text('rRecovered','0');text('rBer','—');};

function refreshMetrics(){const m=rx.metrics();text('downloadName',m.name);text('downloadPercent',`${m.percent.toFixed(1)}%`);text('downloadSpeed',rate(m.speed));text('downloadAverage',rate(m.average));text('downloadElapsed',duration(m.elapsed));text('downloadEta',m.eta===null?(m.stalled?'Esperando bloques…':'Calculando…'):duration(m.eta));
  text('downloadSizes',m.total?`${humanBytes(m.bytes)} / ${humanBytes(m.total)} del flujo válido${m.originalSize!==null?' · archivo original '+humanBytes(m.originalSize):''}`:'Esperando cabecera del archivo…');
  const state=m.verified?'Archivo completo · SHA-256 OK':m.failure?'Error de verificación: '+m.failure:m.awaitingVerification?'Verificando integridad…':m.stalled?'Esperando bloques faltantes; el progreso se conserva.':m.total?'Recibiendo · la velocidad excluye duplicados y paridad no utilizada.':'Esperando datos.';
  text('downloadState',state);text('rxHint',m.total?`${m.percent.toFixed(1)}% · ${rx.progress().missing} bloques pendientes`:'Incluye las cuatro balizas en la cámara.');
  $('#downloadFill').style.width=`${m.percent}%`;$('#rxProgress').style.width=`${m.percent}%`;$('#downloadBar').setAttribute('aria-valuenow',m.percent.toFixed(1));
  if(tx){const elapsed=((tx.ended??performance.now())-tx.started)/1000;text('sendElapsed',duration(elapsed));text('sendRate',rate(elapsed>0?tx.bytesOut/elapsed:0));text('tGross',rate(elapsed>0?tx.bytesOut/elapsed:0));text('tRate','Ver receptor');}}
const metricsTimer=setInterval(refreshMetrics,250);
document.addEventListener('visibilitychange',()=>{if(document.hidden)torch?.stop();});
window.addEventListener('pagehide',()=>{clearInterval(metricsTimer);cancelAnimationFrame(txRaf);listener.stop();tracker?.stop();torch?.stop();media?.getTracks().forEach(t=>t.stop());});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
benchmark();refreshMetrics();window.__hopperBootOK=true;log(`${BUILD}: panel de descarga y cola de retorno listos. Flash experimental; protocolo DATA conservado.`);
