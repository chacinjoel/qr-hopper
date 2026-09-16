import {BUILD,CATALOG_HASH,profile,bootstrap,KIND,controlBytes,readControl,decodeReport,encodeReport,fourOpportunitySchedules} from './protocol.js?v=rxfix1';
import {render,AdaptiveTracker,stabilizeTrack} from './optics.js?v=rxfix1';
import {CalibrationSender,CalibrationReceiver} from './calibration.js?v=rxfix1';
import {SoundChannel} from './audio.js?v=rxfix1';
import {AUDIO,BANDS,SOUND_SECONDS} from './audio-codec.js?v=rxfix1';
import {QRScanner,reportQR} from './qr.js?v=rxfix1';
import {prepareTransfer,DownloadSession,metadataSchedule,duration} from '../src/transfer-metrics.js?v=rxfix1';
import {buildTransport,buildFrameSchedule,humanBytes} from '../src/superstream.js?v=rxfix1';
const $=id=>document.getElementById(id),text=(id,s)=>{$(id).textContent=String(s);},rate=n=>humanBytes(n)+'/s';
const log=s=>{text('diagnostics',new Date().toLocaleTimeString()+' '+s+'\n'+$('diagnostics').textContent.slice(0,14000));};
const failures=[],events=[],results=[];
function note(s){log(s);events.push({t:performance.now(),message:s});if(events.length>300)events.shift();}
function error(e){const m=e?.message||String(e);failures.push(m);text('calState',m);text('rxCalState',m);note('ERROR: '+m);}
let selectedFile=null,packed=null,transport=null,chosen=null,cal=null,tx=null,calRaf=0,txRaf=0,micReady=false,preparing=false,pendingReport=null;
let media=null,tracker=null,rxActive=false,rxSid=0,rxProfile=null,rxToken=0,rxAudio=-1,rxEpoch=0,verifyBusy=false,url=null,rxClosed=false;
let lastControl=0,lastAck=0,ackCount=0,lastSlow=0,lastQuality=null,lastCheckpoint=null,stabilized=false;
const download=new DownloadSession();
const sound=new SoundChannel(onAudio,s=>{text('audioState',s);note(s);});
const receiver=new CalibrationReceiver(receiverEvent);
const qrScanner=new QRScanner($('scanVideo'),r=>{pendingReport=r;qrScanner.stop();$('scanDialog').close();$('resumeQRBtn').hidden=false;text('calState','Informe leído. Vuelve a colocar ambos teléfonos y pulsa continuar validación.');},error);
for(const b of document.querySelectorAll('.tab'))b.onclick=()=>{document.querySelectorAll('.tab,.panel').forEach(e=>e.classList.remove('active'));b.classList.add('active');$(b.dataset.tab).classList.add('active');};
text('build',BUILD);text('diagnostics',BUILD+' · módulos listos.');
function lockSetup(locked){$('fileInput').disabled=locked;$('calMode').disabled=locked;$('useAudio').disabled=locked;$('prepareBtn').disabled=locked||!selectedFile;$('calibrateBtn').disabled=locked||!packed;$('startTxBtn').disabled=locked||!chosen;}
function surface(on){document.body.classList.toggle('emitting',on);}
function control(c){render($('txCanvas'),{kind:KIND.CONTROL,payload:controlBytes(c)},bootstrap,c.sid,0,1,1);text('surfaceState',c.op.toUpperCase()+' · '+(c.pid===undefined?'control B/N':profile(c.pid).name));lastControl=performance.now();}
$('fileInput').onchange=e=>{if(tx?.running||cal&&!cal.ended)return;selectedFile=e.target.files[0]||null;packed=null;chosen=null;transport=null;text('fileState',selectedFile?selectedFile.name+' · '+humanBytes(selectedFile.size):'Selecciona un archivo.');lockSetup(false);};
$('prepareBtn').onclick=async()=>{if(!selectedFile||preparing)return;preparing=true;lockSetup(true);try{packed=await prepareTransfer(selectedFile);chosen=null;transport=null;text('calState','Preparado: '+humanBytes(packed.stream.length)+' de flujo. Inicia el receptor y calibra el enlace.');note('Archivo preparado localmente: '+packed.meta.name);render($('txCanvas'),null,bootstrap,packed.meta.linkId);}catch(e){error(e);}finally{preparing=false;lockSetup(false);}};
function runCalibration(now){if(!cal||cal.ended)return;cal.tick(now);if(!cal.ended)calRaf=requestAnimationFrame(runCalibration);}
$('calibrateBtn').onclick=async()=>{if(!packed||tx?.running||cal&&!cal.ended)return;
 if(media)return error(Error('Apaga la cámara receptora antes de calibrar como emisor.'));
 lockSetup(true);chosen=null;try{
  if(cal){packed=await prepareTransfer(selectedFile);transport=null;pendingReport=null;}
  if($('useAudio').checked){try{await sound.enable({microphone:true});micReady=true;}catch(e){micReady=false;text('audioState','Sin micrófono: usa el informe QR. '+e.message);}}
  else{sound.close();micReady=false;}
  cal=new CalibrationSender({sid:packed.meta.linkId,mode:$('calMode').value,audio:micReady,onEvent:senderEvent});
  // A previous result only prioritises a candidate. Every session is re-tested.
  try{const cached=JSON.parse(localStorage.getItem('hopper-adaptive-hint')||'null');if(cached?.catalog===CATALOG_HASH&&Date.now()-cached.date<86400000&&cached.chosen>0&&cached.chosen<11&&cal.mode==='quick')cal.plan=[...new Set([cached.chosen,...cal.plan])];}catch{}
  text('calState','Calibrando. Sostén ambos teléfonos como los usarás.');surface(true);cal.start(performance.now());calRaf=requestAnimationFrame(runCalibration);
 }catch(e){error(e);lockSetup(false);surface(false);}};
function senderEvent(e){
 if(e.type==='control'){control(e.c);text('calState',e.c.op==='audio'?'Prueba acústica '+(e.c.index+1)+' · el otro teléfono reproduce tonos.':e.c.op==='trial'?'Ronda '+e.c.round+' · '+profile(e.c.pid).name:e.c.op==='summary'?'Esperando informe del receptor…':e.c.op==='offer'?'Comprobación final · esperando READY.':'Calibración: '+e.c.op);}
 if(e.type==='probe'){render($('txCanvas'),e.f,e.p,cal.sid,e.seq,e.t.frames.length,e.t.streamLength);text('surfaceState','PRUEBA '+e.p.name+' · '+e.seq+'/'+e.t.frames.length);}
 if(e.type==='audio-result'){text('audioState',e.band<0?'No llegó ninguna prueba sonora válida. Se ofrece QR.':'Retorno elegido: '+BANDS[e.band].join(' / ')+' Hz · mensaje '+SOUND_SECONDS.toFixed(2)+' s');note('Audio elegido: banda '+e.band+'; paquetes válidos '+e.samples.length);}
 if(e.type==='report'){note('Informe recibido: perfil '+e.report.chosen+'; huella '+e.report.fingerprint.toString(16));}
 if(e.type==='qr-needed'){surface(false);text('calState',e.message);$('scanQRBtn').focus();}
 if(e.type==='manual-ready'){surface(false);$('manualReadyBtn').hidden=false;text('calState',e.message);}
 if(e.type==='ready'){
  chosen=e;transport=buildTransport(packed.stream,profile(e.profile));if(transport.groupCount>=65535){error(Error('Archivo demasiado grande para este perfil.'));chosen=null;return;}
  surface(false);lockSetup(false);$('manualReadyBtn').hidden=true;text('profileState',profile(e.profile).name+' · RS '+transport.k+'+'+transport.r+' · '+(e.audioBand<0?'retorno QR/manual':'audio verificado en entrenamiento'));
  text('calState','Perfil acordado. Calibración: '+duration(e.elapsedMs/1000)+'. Ya puedes transmitir.');note('Negociación lista: perfil '+e.profile+(e.manual?' · confirmación manual':' · READY sonoro válido'));
  try{localStorage.setItem('hopper-adaptive-hint',JSON.stringify({catalog:CATALOG_HASH,chosen:e.profile,date:Date.now()}));}catch{}
  const schedules=fourOpportunitySchedules(transport),count=schedules.reduce((n,s)=>n+s.length,0)+metadataSchedule(transport,packed.metadataBytes).length;
  text('txEta',duration(count/profile(e.profile).fps+Math.floor(count/60)*.14+2.2));
 }
}
async function receiverEvent(e){try{
 if(e.type==='session-acquired')note(e.late?'Sesión recuperada después del anuncio inicial.':'Anuncio de sesión recibido.');
 if(e.type==='play-training'){if($('rxSound').checked)await sound.send(e.packet);else text('rxCalState','Sonido desactivado. El informe se intercambiará por QR.');}
 if(e.type==='trial'){text('rxCalState',(e.round===0?'Exploración':e.round===1?'Validación con datos nuevos':'Comprobación final')+' · '+profile(e.id).name);}
 if(e.type==='result'){results.push(e.result);const tr=document.createElement('tr');for(const v of [profile(e.result.id).name,e.result.round,e.result.valid+'/'+e.result.expected,e.result.groups+'/'+e.result.totalGroups,rate(e.result.rate),e.result.pass?'Superada':'No apta']){const td=document.createElement('td');td.textContent=v;tr.append(td);}$('probeTable').tBodies[0].append(tr);note('Prueba '+e.result.id+' ronda '+e.result.round+': '+e.result.valid+'/'+e.result.expected+' · '+rate(e.result.rate));}
 if(e.type==='report'){
  $('showReportBtn').hidden=false;text('rxCalState','Mejor perfil probado: '+profile(e.report.chosen).name+'. Devolviendo informe…');
  if(e.band>=0&&$('rxSound').checked){await sendReportSound(e.report,e.band);}else{text('rxCalState','Informe listo. Muéstralo como QR al emisor y vuelve a la posición de transferencia.');showQR(e.report);}
 }
 if(e.type==='failed'){text('rxCalState','Ningún perfil completó los datos de prueba. Acerca los teléfonos y repite la calibración; no se inventa un perfil ganador.');note('Calibración sin candidato apto.');}
 if(e.type==='offer'){
  const live=performance.now()-(tracker?.lastSeen||0)<350;
  if(!live){text('rxCalState','Vuelve a incluir las cuatro balizas para confirmar la geometría.');receiver.seen.delete(e.controlKey);return;}
  text('rxCalState','LISTO · validación final superada. '+profile(e.report.chosen).name);
  if(e.band>=0&&$('rxSound').checked)await sound.send({type:AUDIO.READY,sid:e.report.sid,seq:e.report.epoch,arg0:e.report.chosen,arg1:e.report.fingerprint,band:e.band});
 }
}catch(e){error(e);}};
async function sendReportSound(report,band){for(let i=0;i<2;i++){if(receiver.report!==report||document.hidden)return;await sound.send({type:AUDIO.REPORT,band,sid:report.sid,seq:report.epoch,arg0:report.chosen,arg1:report.fingerprint,token:report.fallback});if(i===0)await new Promise(r=>setTimeout(r,350));}}
function showQR(r=receiver.report){if(!r)return;const compact={sid:r.sid,catalog:r.catalog,epoch:r.epoch,chosen:r.chosen,fallback:r.fallback,fingerprint:r.fingerprint};$('reportOutput').value=encodeReport(compact);try{reportQR($('reportCanvas'),compact);}catch(e){error(e);}if(!$('qrDialog').open)$('qrDialog').showModal();}
$('showReportBtn').onclick=()=>showQR();$('closeQRBtn').onclick=()=>{$('qrDialog').close();text('rxCalState','Apunta de nuevo al emisor. Esperando validación.');};
$('scanQRBtn').onclick=async()=>{if(!cal||!['report','qr'].includes(cal.state))return error(Error('Primero ejecuta la calibración y espera el informe.'));surface(false);$('scanDialog').showModal();try{await qrScanner.start(cal.sid);}catch(e){error(e);}};
$('closeScanBtn').onclick=()=>{qrScanner.stop();$('scanDialog').close();};$('scanDialog').addEventListener('cancel',()=>qrScanner.stop());
$('applyReportBtn').onclick=()=>{const r=decodeReport($('reportInput').value.trim(),cal?.sid);if(!r)return error(Error('Informe inválido, de otra sesión o con CRC incorrecto.'));pendingReport=r;$('resumeQRBtn').hidden=false;text('calState','Coloca ambos teléfonos antes de continuar validación.');};
$('resumeQRBtn').onclick=()=>{if(pendingReport&&cal?.acceptReport(pendingReport,performance.now())){pendingReport=null;$('resumeQRBtn').hidden=true;surface(true);}else error(Error('Informe caducado o no esperado en esta fase.'));};
$('manualReadyBtn').onclick=()=>{if(!confirm('¿El receptor muestra LISTO y validación final superada? No confirmes si muestra errores.'))return;cal?.confirmManual(performance.now());};
function onAudio(packet){
 if(cal&&!cal.ended&&cal.receiveAudio(packet,performance.now()))return;
 if(!tx||packet.sid!==tx.sid||packet.seq!==chosen?.report.epoch||(!tx.running&&!tx.finished))return;
 if(packet.type===AUDIO.COMPLETE&&packet.arg0===chosen.profile&&packet.arg1===(parseInt(packed.meta.sha256.slice(0,8),16)>>>0)){
  tx.confirmed=true;tx.running=false;sound.close();micReady=false;tx.ended=performance.now();cancelAnimationFrame(txRaf);control({op:'closed',sid:tx.sid,fingerprint:chosen.report.fingerprint});text('txConfirmed','SHA-256 OK, confirmado');text('txState','Receptor completo y verificado. Se detuvo la cola.');note('COMPLETE sonoro correcto; emisión detenida.');setTimeout(()=>surface(false),1800);lockSetup(false);return;
 }
 if(!tx.running||packet.arg1!==chosen?.report.fingerprint)return;
 if(packet.type===AUDIO.SLOW&&performance.now()-tx.lastSlow>10000){tx.fps=Math.max(8,tx.fps*.75);tx.lastSlow=performance.now();if(!tx.extra){tx.queue.push(...buildFrameSchedule(transport,{dataOnly:true,pass:5}));tx.extra=true;}note('Receptor solicitó margen: '+tx.fps.toFixed(1)+' símbolos/s. Bloques y FEC sin cambiar.');}
 if(packet.type===AUDIO.STATUS&&tx.finished){
  const group=packet.arg0,mask=packet.token;const indices=group===65535?buildFrameSchedule(transport,{dataOnly:true,pass:6}):transport.frames.map((f,i)=>({f,i})).filter(o=>o.f.group===group&&o.f.kind===0&&(mask&(1<<o.f.slot))).map(o=>o.i);
  if(!indices.length||tx.repairs>=3)return;tx.repairs++;tx.queue.push(...indices);tx.finished=false;tx.holdUntil=performance.now()+1000;beginControl();note('Solicitud acústica: '+indices.length+' bloques a la cola.');
 }
}
function beginControl(){control({op:'begin',sid:packed.meta.linkId,pid:chosen.profile,audio:chosen.audioBand,epoch:chosen.report.epoch,fingerprint:chosen.report.fingerprint,hash:packed.meta.sha256.slice(0,8),bytes:transport.streamLength,block:transport.blockLen});}
$('startTxBtn').onclick=async()=>{if(!transport||!chosen||tx?.running)return;
 if(chosen.audioBand>=0&&!micReady){try{await sound.enable({microphone:true});micReady=true;}catch(e){note('No se pudo reactivar el retorno: '+e.message);}}
 const p=profile(chosen.profile),plans=fourOpportunitySchedules(transport);tx={running:true,sid:packed.meta.linkId,queue:[...metadataSchedule(transport,packed.metadataBytes),...plans.flat()],position:0,fps:p.fps,last:0,started:performance.now(),ended:null,holdUntil:performance.now()+1300,sinceBeacon:0,bytes:0,finished:false,confirmed:false,lastSlow:0,extra:false,repairs:0};
 beginControl();surface(true);lockSetup(true);text('txConfirmed','Pendiente');text('txState','Cuatro oportunidades por bloque + FEC.');txRaf=requestAnimationFrame(transmit);
};
function transmit(now){if(!tx?.running)return;try{
 if(document.hidden){stopEverything('Pausa por página oculta. Reinicia la emisión para continuar el carrusel.');return;}
 if(tx.finished){if(now>=tx.finishDeadline){tx.running=false;tx.ended=now;sound.close();micReady=false;text('txState','Plan emitido. Sin confirmación acústica; revisa el receptor.');text('txConfirmed','No confirmada');surface(false);lockSetup(false);}return;}
 if(now<tx.holdUntil||now-tx.last<1000/tx.fps)return;tx.last=now;
 if(tx.position>=tx.queue.length){tx.finished=true;tx.finishDeadline=now+(micReady?18000:1000);control({op:'finish',sid:tx.sid,fingerprint:chosen.report.fingerprint,audio:chosen.audioBand});return;}
 if(tx.sinceBeacon>=60){tx.sinceBeacon=0;tx.holdUntil=now+140;beginControl();return;}
 const seq=tx.queue[tx.position++],f=transport.frames[seq];render($('txCanvas'),f,profile(chosen.profile),tx.sid,seq,transport.frames.length,transport.streamLength);tx.bytes+=transport.blockLen;tx.sinceBeacon++;
 text('surfaceState','DATOS '+tx.position+'/'+tx.queue.length+' · '+tx.fps.toFixed(1)+'/s');text('txState','Emitiendo '+tx.position+'/'+tx.queue.length+' presentaciones.');$('txProgress').firstElementChild.style.width=(100*tx.position/tx.queue.length)+'%';
 }catch(e){error(e);stopEverything('Error de emisión.');}finally{if(tx?.running)txRaf=requestAnimationFrame(transmit);}}
function stopEverything(message='Detenido por el usuario.'){
 cal?.cancel();if(tx){tx.running=false;tx.ended=performance.now();}cancelAnimationFrame(calRaf);cancelAnimationFrame(txRaf);surface(false);sound.close();micReady=false;text('calState',message);text('txState',message);lockSetup(false);
}
$('cancelBtn').onclick=()=>stopEverything();$('exitSurfaceBtn').onclick=()=>stopEverything();
async function onFrame(d){
 if(d.header.kind===KIND.CONTROL){const c=readControl(d);if(!c){
  try{const raw=JSON.parse(new TextDecoder().decode(d.payload));if(d.crcOK&&raw.catalog!==CATALOG_HASH){
   text('rxCalState','Versiones diferentes: recarga HopperLink en AMBOS teléfonos. Área detectada, pero el protocolo no coincide.');
   text('captureState','Control recibido de otra versión. No se mezclan los archivos.');
  }}catch{}return;
 }
  if(['hello','audio','trial','endtrial','summary','reacquire','offer'].includes(c.op)){if(rxActive&&download.streamLength&&!download.verified&&rxSid!==c.sid)return;receiver.control(c,performance.now());return;}
  if(c.op==='begin'){
   if(!receiver.report||c.sid!==receiver.sid||c.pid!==receiver.report.chosen||c.fingerprint!==receiver.report.fingerprint||!profile(c.pid))return;
   if(rxSid&&rxSid!==c.sid&&download.streamLength&&!download.verified){text('rxCalState','Otra sesión detectada. Pulsa Nueva recepción para descartarla.');return;}
   if(rxSid!==c.sid){download.reset();rxSid=c.sid;rxEpoch++;rxClosed=false;ackCount=0;lastAck=0;}
   rxProfile=c.pid;rxToken=c.fingerprint;rxAudio=c.audio;rxActive=true;text('rxCalState','Recibiendo con el perfil negociado: '+profile(c.pid).name);return;
  }
  if(c.sid!==rxSid)return;if(c.op==='closed'&&download.verified&&c.fingerprint===rxToken){rxClosed=true;sound.cancel();text('downloadState','Archivo verificado. El emisor confirmó el cierre.');}
  if(c.op==='finish'&&!download.verified&&c.fingerprint===rxToken)requestRepair().catch(error);return;
 }
 if(d.header.kind===KIND.PROBE){receiver.ingest(d,performance.now());return;}
 if(!rxActive||verifyBusy||download.verified||download.failure||d.header.sid!==rxSid||d.header.profileId!==rxProfile)return;
 const p=download.ingest(d);if(!p)return;
 if(p.complete){verifyBusy=true;const epoch=rxEpoch;try{const file=await download.verify();if(epoch!==rxEpoch)return;if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([file.data],{type:file.meta.type||'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=file.meta.name;a.textContent='Guardar '+file.meta.name;const status=document.createElement('p');status.textContent='SHA-256 OK · '+duration(download.metrics().elapsed);$('receivedFile').replaceChildren(status,a);$('receivedFile').classList.remove('hidden');$('repeatAckBtn').hidden=false;note('Archivo completo y verificado: '+file.meta.name);sendComplete().catch(error);}catch(e){if(epoch===rxEpoch){download.failure=e.message;error(e);}}finally{verifyBusy=false;}}
}
async function sendComplete(force=false){if(!download.verified||rxClosed||rxAudio<0||!$('rxSound').checked||sound.busy)return;if(!force&&(ackCount>=3||performance.now()-lastAck<4200))return;lastAck=performance.now();ackCount++;
 await sound.send({type:AUDIO.COMPLETE,sid:rxSid,seq:receiver.report.epoch,arg0:rxProfile,arg1:parseInt(download.meta.sha256.slice(0,8),16)>>>0,band:rxAudio});}
$('repeatAckBtn').onclick=()=>sendComplete(true);
async function requestRepair(){if(sound.busy||rxAudio<0||!$('rxSound').checked||performance.now()-lastSlow<7000)return;const p=download.progress(),m=download.nextMissing();if(!m)return;lastSlow=performance.now();await sound.send({type:AUDIO.STATUS,band:rxAudio,sid:rxSid,seq:receiver.report.epoch,arg0:p.pendingGroups>3?65535:m.group,token:m.mask,arg1:rxToken});}
function quality(q){lastQuality=q;const stats=q.stats||{};text('lockState','Área: '+Math.round(q.lock*100)+'%');text('motionState','Movimiento: '+(stats.motion||0).toFixed(2)+' celdas / captura');
 if(q.error){text('captureState','Error de procesamiento: '+q.error);if(failures.at(-1)!==q.error){failures.push(q.error);note('Cámara: '+q.error);}}
 else text('captureState','Capturas '+(stats.capture||0)+' · cabeceras '+(stats.headers||0)+' · CRC válidos '+(stats.valid||0)+' · '+(q.lock>0?'área localizada':'buscando las 4 balizas'));

 if(!stabilized&&q.lock>.8&&receiver.sid){stabilized=true;stabilizeTrack(media.getVideoTracks()[0]).then(r=>note(r.locked?'Ajustes de cámara fijados en valores observados.':r.note));}
 if(rxActive&&rxSid&&!download.verified&&rxAudio>=0&&$('rxSound').checked&&!sound.busy&&performance.now()-lastSlow>15000){const now=performance.now();if(!lastCheckpoint){lastCheckpoint={t:now,...stats};return;}if(now-lastCheckpoint.t>4500){const h=stats.headers-lastCheckpoint.headers,bad=stats.crcFailed-lastCheckpoint.crcFailed;if(h>8&&bad/h>.32){lastSlow=now;sound.send({type:AUDIO.SLOW,sid:rxSid,band:rxAudio,seq:receiver.report.epoch,arg1:rxToken}).catch(error);}lastCheckpoint={t:now,...stats};}}
}
let cameraBusy=false;
$('cameraBtn').onclick=async()=>{if(cameraBusy)return;cameraBusy=true;$('cameraBtn').disabled=true;try{
 if(media){tracker?.stop();media.getTracks().forEach(t=>t.stop());media=null;rxActive=false;rxAudio=-1;sound.cancel();text('cameraBtn','Iniciar cámara y sonido');return;}
 if(tx?.running||cal&&!cal.ended)throw Error('Detén la emisión antes de recibir en este teléfono.');
 if($('rxSound').checked){try{await sound.enable();}catch(e){$('rxSound').checked=false;note('Se usará QR: '+e.message);}}
 media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:60}},audio:false});$('rxVideo').srcObject=media;await $('rxVideo').play();$('cameraStage').style.aspectRatio=$('rxVideo').videoWidth+'/'+$('rxVideo').videoHeight;
 tracker=new AdaptiveTracker($('rxVideo'),$('rxOverlay'),quality,onFrame);tracker.start();rxActive=true;stabilized=false;text('cameraBtn','Apagar cámara');text('rxCalState','Listo para pruebas. Inicia Calibrar enlace en el emisor.');
 }catch(e){media?.getTracks().forEach(t=>t.stop());media=null;error(e);}finally{cameraBusy=false;$('cameraBtn').disabled=false;}};
$('rxSound').onchange=async()=>{if(!$('rxSound').checked){sound.cancel();return;}try{await sound.enable();}catch(e){$('rxSound').checked=false;error(e);}};
$('resetRxBtn').onclick=()=>{rxEpoch++;sound.cancel();download.reset();receiver.reset();tracker?.resetAcquisition();rxSid=0;rxProfile=null;rxClosed=false;verifyBusy=false;stabilized=false;rxActive=!!media;if(url)URL.revokeObjectURL(url);url=null;$('receivedFile').replaceChildren();$('receivedFile').classList.add('hidden');$('repeatAckBtn').hidden=true;$('showReportBtn').hidden=true;text('rxCalState','Nueva recepción. Esperando calibración.');text('captureState','Detector reiniciado; los permisos se conservan.');};
function refresh(){const m=download.metrics();text('downloadName',m.name);text('downloadPercent',m.percent.toFixed(1)+'%');text('downloadSpeed',rate(m.speed));text('downloadAverage',rate(m.average));text('downloadElapsed',duration(m.elapsed));text('downloadEta',m.eta===null?(m.stalled?'Esperando bloques…':'Calculando…'):duration(m.eta));text('downloadSizes',m.total?humanBytes(m.bytes)+' / '+humanBytes(m.total)+' del flujo · original '+humanBytes(m.originalSize||0):'Esperando metadatos del archivo.');
 $('downloadFill').style.width=m.percent+'%';$('downloadBar').setAttribute('aria-valuenow',m.percent.toFixed(1));text('downloadState',m.verified?'Archivo completo · SHA-256 OK'+(rxClosed?' · cierre confirmado':''):m.failure?'Error: '+m.failure:m.awaitingVerification?'Verificando integridad…':m.stalled?'Esperando bloques; el progreso se conserva.':m.total?'Recibiendo datos únicos.':'Esperando datos.');const p=download.progress();text('rxCounters','Bloques '+p.have+'/'+p.total+' · pendientes '+p.missing+' · FEC '+p.recovered);
 if(download.verified)sendComplete().catch(error);if(tx){const elapsed=((tx.ended??performance.now())-tx.started)/1000;text('txElapsed',duration(elapsed));text('txRate',rate(tx.bytes/Math.max(.001,elapsed)));}}
const refreshTimer=setInterval(refresh,250);
$('exportBtn').onclick=()=>{const data={build:BUILD,captureSessionActive:!!media,catalog:CATALOG_HASH,results,events,failures,quality:lastQuality,download:download.metrics(),camera:media?.getVideoTracks()[0]?.getSettings?.()};if(data.camera){delete data.camera.deviceId;delete data.camera.groupId;}const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='hopper-diagnostico.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);};
document.addEventListener('visibilitychange',()=>{if(document.hidden){sound.cancel();if(cal&&!cal.ended)stopEverything('Calibración cancelada: la página quedó oculta. Repite con ambos teléfonos visibles.');}});
window.addEventListener('pagehide',()=>{clearInterval(refreshTimer);cancelAnimationFrame(calRaf);cancelAnimationFrame(txRaf);sound.close();tracker?.stop();qrScanner.stop();media?.getTracks().forEach(t=>t.stop());});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
// Explicit diagnostic hooks: same production classes, no fake received state.
window.hopperAdaptive={get sender(){return cal;},get receiver(){return receiver;},get download(){return download;},get tx(){return tx;},get tracker(){return tracker;},sound,profile,receiverEvent,onAudio};
render($('txCanvas'),null,bootstrap,0);refresh();window.__hopperBootOK=true;
