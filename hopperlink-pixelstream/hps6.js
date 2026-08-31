(() => {
'use strict';

const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();

const MAGIC = [0x48,0x50,0x53,0x36]; // HPS6
const VERSION = 6;
const HEADER = 28;
const PILOT_CELLS = 32;
const LEVELS = [26,92,164,236];
const DATA_MIN=.12, DATA_MAX=.88;
const CONTROL_GRID=56;
const GRID_OPTIONS=[32,40,48,56,64,72,80];
const MARKER_KEYS=['tl','tr','bl','br'];
const MARKER_NORM={tl:[.06,.06],tr:[.94,.06],bl:[.06,.94],br:[.94,.94]};
const TYPE={HELLO:1,DATA:2,PASS_END:3,NACK:4,COMPLETE:5};
const SPEED={
  compatible:{label:'Compatible',fps:6,repeat:2,hint:'Compatible · 6 fps · 2 copias/frame · máxima tolerancia.'},
  balanced:{label:'Balanceado',fps:10,repeat:1,hint:'Balanceado · 10 DATA/s · buena velocidad con margen óptico.'},
  turbo:{label:'Turbo',fps:15,repeat:1,hint:'Turbo · 15 DATA/s · recomendado para grid 72.'},
  optical:{label:'Ultra Optical',fps:18,repeat:1,hint:'Ultra Optical · 18 DATA/s · recomendado solo con LOCK estable.'}
};
const TXS={IDLE:'IDLE',PREPARED:'PREPARED',HELLO:'HELLO_HOLD',SENDING:'SENDING',PASS_END:'PASS_END_HOLD',LISTEN:'LISTEN_CONTROL',NACK_READY:'NACK_READY',DONE:'DONE'};
const RXS={IDLE:'IDLE',CAMERA:'RX_CAMERA',LOCKED:'SESSION_LOCKED',RECEIVING:'RECEIVING',NACK:'NACK_SCREEN',COMPLETE:'COMPLETE_SCREEN',WAIT_REPAIR:'WAIT_REPAIR',DONE:'DONE'};

let txState=TXS.IDLE, rxState=RXS.IDLE;
let tx=null, rx=freshRx();
let cameraStream=null, cameraMode='idle';
let scanHandle=null, scanMode='none', scanGeneration=0;
let wakeLock=null, controlRx=null, currentOverlayAction=null;
let txRunToken=0;
let trackedH=null, trackedMarkers=null, trackedFails=0;
let lastCaptureW=1,lastCaptureH=1;

function freshRx(){return {session:null,total:0,dataGrid:0,fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null};}
function now(){return new Date().toLocaleTimeString();}
function log(el,msg){if(!el)return;el.textContent=`[${now()}] ${msg}\n`+el.textContent.slice(0,8000);}
function slog(msg){log($('sendLog'),msg);} function rlog(msg){log($('rxLog'),msg);}
function setPhase(text,kind=''){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip '+(kind||'');}}
function fmtBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB';}
function fmtTime(sec){if(!Number.isFinite(sec)||sec<0)return '—';sec=Math.round(sec);const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}
function u16(n){return[(n>>>8)&255,n&255];}
function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];}
function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),out=new Uint8Array(n);let p=0;for(const a of arrs){out.set(a,p);p+=a.length;}return out;}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1;}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

function speedProfile(){return SPEED[$('speedMode')?.value]||SPEED.turbo;}
function pilotEntries(grid){const out=[];const add=(row,col,p)=>{for(let i=0;i<8;i++)out.push([row*grid+col+i,p[i]]);};add(0,0,[0,1,2,3,0,1,2,3]);add(0,grid-8,[3,2,1,0,3,2,1,0]);add(grid-1,0,[1,3,0,2,1,3,0,2]);add(grid-1,grid-8,[2,0,3,1,2,0,3,1]);return out;}
function pilotMap(grid){return new Map(pilotEntries(grid));}
function rawCapacity(grid){return Math.floor((grid*grid-PILOT_CELLS)*2/8);}
function payloadCapacity(grid){return rawCapacity(grid)-HEADER;}
function projectedThroughput(grid,sp){return payloadCapacity(grid)*sp.fps/sp.repeat;}
function updateModeHint(){
  const sp=speedProfile(),grid=Number($('gridSize')?.value||72),bps=projectedThroughput(grid,sp),six=6*1024*1024/Math.max(1,bps);
  if($('speedHint'))$('speedHint').textContent=sp.hint;
  if($('throughputHint'))$('throughputHint').textContent=`Teórico bruto: ${(bps/1024).toFixed(1)} KiB/s · 6 MiB ≈ ${fmtTime(six)} antes de reparaciones.`;
  if($('capacity'))$('capacity').textContent=payloadCapacity(grid)+' B';
}

function makePacket(type,session,round,index,total,payload,grid){
  const h=new Uint8Array(HEADER);h.set(MAGIC,0);h[4]=VERSION;h[5]=type;h[6]=grid;h[7]=0;h.set(u32(session),8);h.set(u16(round),12);h.set(u32(index),14);h.set(u32(total),18);h.set(u16(payload.length),22);
  h.set(u32(crc32(concat(h.slice(0,24),payload))),24);return concat(h,payload);
}
function parsePacket(bytes){
  if(bytes.length<HEADER)return null;for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;
  if(bytes[4]!==VERSION||bytes[7]!==0)return null;
  const type=bytes[5],grid=bytes[6],session=readU32(bytes,8),round=readU16(bytes,12),index=readU32(bytes,14),total=readU32(bytes,18),len=readU16(bytes,22),expected=readU32(bytes,24);
  if(!Object.values(TYPE).includes(type)||!GRID_OPTIONS.includes(grid)||!session||!total||round>4095||len>bytes.length-HEADER||len>payloadCapacity(grid))return null;
  if(type===TYPE.DATA&&index>=total)return null;
  if((type===TYPE.NACK||type===TYPE.COMPLETE)&&index>=total)return null;
  if((type===TYPE.HELLO||type===TYPE.PASS_END)&&index!==0)return null;
  const payload=bytes.slice(HEADER,HEADER+len),actual=crc32(concat(bytes.slice(0,24),payload));
  if(actual!==expected)return{bad:true};return{type,grid,session,round,index,total,payload};
}
function rawToSymbols(raw,grid){const out=new Uint8Array(grid*grid),pilots=pilotMap(grid);for(const[i,s]of pilots)out[i]=s;let bp=0,shift=6;for(let i=0;i<out.length;i++){if(pilots.has(i))continue;if(bp<raw.length){out[i]=(raw[bp]>>shift)&3;shift-=2;if(shift<0){shift=6;bp++;}}}return out;}
function symbolsToBytes(sym,grid){const pilots=pilotMap(grid),data=[];for(let i=0;i<sym.length;i++)if(!pilots.has(i))data.push(sym[i]);const out=new Uint8Array(Math.floor(data.length/4));for(let i=0;i<out.length;i++)out[i]=(data[i*4]<<6)|(data[i*4+1]<<4)|(data[i*4+2]<<2)|data[i*4+3];return out;}
function renderPacket(raw,grid){const c=$('pixelCanvas');c.width=grid;c.height=grid;const ctx=c.getContext('2d',{alpha:false}),sym=rawToSymbols(raw,grid),img=ctx.createImageData(grid,grid);for(let i=0;i<sym.length;i++){const v=LEVELS[sym[i]],p=i*4;img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255;}ctx.putImageData(img,0,0);}

function openOverlay(meta,bottom,actionLabel,action){$('streamOverlay').style.display='flex';document.body.style.overflow='hidden';$('streamMeta').textContent=meta;$('streamBottom').textContent=bottom;const b=$('overlayActionBtn');b.textContent=actionLabel||'';b.style.display=actionLabel?'inline-flex':'none';currentOverlayAction=action||null;}
function closeOverlay(){if($('streamOverlay'))$('streamOverlay').style.display='none';document.body.style.overflow='';currentOverlayAction=null;}
async function getWake(){try{if(navigator.wakeLock?.request&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
function releaseWake(){if(wakeLock){Promise.resolve(wakeLock.release?.()).catch(()=>{});wakeLock=null;}}

async function prepareTransfer(){
  try{
    cancelProtocol(false);const f=$('fileInput')?.files?.[0];if(!f){alert('Selecciona un archivo.');return;}
    const grid=Number($('gridSize').value),cap=payloadCapacity(grid),fileBytes=new Uint8Array(await f.arrayBuffer());
    const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));
    const pkg=concat(new Uint8Array(u16(meta.length)),meta,fileBytes),chunks=[];for(let p=0;p<pkg.length;p+=cap)chunks.push(pkg.slice(p,Math.min(pkg.length,p+cap)));
    tx={session:randomId(),grid,cap,f,fileBytes,fileCrc:crc32(fileBytes),chunks,total:chunks.length,round:0,pendingMissing:null};txState=TXS.PREPARED;
    $('fileSize').textContent=fmtBytes(f.size);$('frameCount').textContent=tx.total;$('sendBtn').disabled=false;$('txRepairBtn').style.display='none';updateModeHint();
    slog(`Preparado HPS6 · ${f.name} · grid ${grid} · ${tx.total} DATA · CRC ${tx.fileCrc.toString(16)}`);setPhase('EMISOR · HPS6 PREPARADO','on');
  }catch(e){slog('ERROR preparando: '+(e?.message||e));alert('No se pudo preparar: '+(e?.message||e));}
}
function helloPayload(){return concat(new Uint8Array([tx.grid]),new Uint8Array(u32(tx.fileCrc)),new Uint8Array(u32(tx.fileBytes.length)));}
function passEndPayload(){return concat(new Uint8Array([tx.grid]),new Uint8Array(u32(tx.fileCrc)));}
function showHello(){
  if(!tx)return;stopCamera();getWake();txState=TXS.HELLO;const raw=makePacket(TYPE.HELLO,tx.session,0,0,tx.total,helloPayload(),CONTROL_GRID);
  openOverlay(`HPS6 HELLO · DATA grid ${tx.grid}`,'Control óptico robusto en grid 56. Espera “Sesión bloqueada” en el receptor.','Receptor listo · Iniciar Turbo',()=>sendDataPass(Array.from({length:tx.total},(_,i)=>i),0,false));
  renderPacket(raw,CONTROL_GRID);setPhase('EMISOR · HELLO 56','mid');slog(`HELLO fijo en grid ${CONTROL_GRID}; DATA viajará en grid ${tx.grid}.`);
}
function repairPasses(n){return n<=100?3:n<=300?2:1;}
async function sendDataPass(indices,round,isRepair){
  if(!tx||!indices.length)return;const token=++txRunToken;closeOverlay();stopCamera();getWake();txState=TXS.SENDING;tx.round=round;const sp=speedProfile();
  const passes=isRepair?repairPasses(indices.length):1,frameMs=Math.max(45,Math.round(1000/sp.fps));
  openOverlay(`HPS6 · ronda ${round+1}`,'Transmitiendo DATA óptico…',null,null);setPhase(isRepair?'EMISOR · REPAIR BURST':'EMISOR · TURBO DATA','on');
  if(isRepair){
    const idx=indices[0];renderPacket(makePacket(TYPE.DATA,tx.session,round,idx,tx.total,tx.chunks[idx],tx.grid),tx.grid);
    $('streamMeta').textContent=`REPAIR · primer faltante ${idx+1}/${tx.total} · LOCK 3s`;$('streamBottom').textContent=`Primer DATA fijo 3 s. Después ${passes} pasada(s) internas sin cambiar de rol.`;
    slog(`Repair First-Frame Lock 3 s · ${indices.length} faltantes · ${passes} pasada(s).`);await sleep(3000);if(token!==txRunToken)return;
  }
  for(let pass=1;pass<=passes;pass++){
    const repeats=pass===1?sp.repeat:1;
    for(let p=0;p<indices.length;p++){
      const idx=indices[p];
      for(let r=0;r<repeats;r++){
        if(token!==txRunToken)return;
        renderPacket(makePacket(TYPE.DATA,tx.session,round,idx,tx.total,tx.chunks[idx],tx.grid),tx.grid);
        $('streamMeta').textContent=isRepair?`REPAIR ${pass}/${passes} · ${p+1}/${indices.length} · frame ${idx+1}`:`DATA ${p+1}/${indices.length} · frame ${idx+1}/${tx.total}`;
        $('streamBottom').textContent=isRepair&&passes>1?'Repair Burst activo; el receptor permanece en cámara.':`Grid ${tx.grid} · ${sp.label} · ${sp.fps} fps · repeat ${sp.repeat}`;
        await sleep(frameMs);
      }
    }
  }
  if(token!==txRunToken)return;showPassEnd(round);
}
function showPassEnd(round){
  txState=TXS.PASS_END;const raw=makePacket(TYPE.PASS_END,tx.session,round,0,tx.total,passEndPayload(),CONTROL_GRID);
  openOverlay(`PASS_END · ronda ${round+1}`,'PASS_END vuelve a grid 56 para máxima robustez. Espera NACK/COMPLETE.','Receptor mostró control · Leer NACK/COMPLETE',()=>listenForControl(round));
  renderPacket(raw,CONTROL_GRID);setPhase('EMISOR · PASS_END 56','mid');slog('PASS_END fijo en grid 56.');
}
async function listenForControl(round){closeOverlay();releaseWake();txState=TXS.LISTEN;controlRx={session:tx.session,round,kind:0,totalParts:0,parts:new Map()};try{await startCamera('senderControl');setPhase('EMISOR · LEYENDO CONTROL 56','mid');slog('Cámara HPS6 activa para NACK/COMPLETE.');}catch(e){slog('ERROR cámara control: '+e.message);}}
function sendRepair(){if(!tx?.pendingMissing?.length)return;const list=tx.pendingMissing.slice();tx.pendingMissing=null;$('txRepairBtn').style.display='none';sendDataPass(list,tx.round+1,true);}

function resetRxSession(session,total,dataGrid,fileCrc=0,fileSize=0){rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.fileCrc=fileCrc;rx.fileSize=fileSize;$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';trackedH=null;trackedFails=0;}
function handleHello(p){if(cameraMode!=='receiverData'||p.grid!==CONTROL_GRID||p.payload.length<9)return;const dataGrid=p.payload[0],fileCrc=readU32(p.payload,1),fileSize=readU32(p.payload,5);if(!GRID_OPTIONS.includes(dataGrid))return;if(rx.session===null){resetRxSession(p.session,p.total,dataGrid,fileCrc,fileSize);rxState=RXS.LOCKED;rlog(`HPS6 sesión bloqueada · ${p.total} DATA · grid ${dataGrid} · ${fmtBytes(fileSize)}.`);setPhase(`RECEPTOR · LOCK · GRID ${dataGrid}`,'on');}else if(rx.session!==p.session)rlog('HELLO de otra sesión ignorado.');}
function handleData(p){if(cameraMode!=='receiverData')return;if(rx.session===null)return;if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid){rx.errors++;updateErrors();return;}rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);if(!rx.chunks.has(p.index)){rx.chunks.set(p.index,p.payload);$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}setPhase(`RECEPTOR · GRID ${rx.dataGrid} · ${rx.chunks.size}/${rx.total}`,'on');}
function makeMissingBitmap(){const bits=new Uint8Array(Math.ceil(rx.total/8));let missing=0;for(let i=0;i<rx.total;i++)if(!rx.chunks.has(i)){bits[i>>3]|=1<<(i&7);missing++;}return{bits,missing};}
function parseMissingBitmap(bits,total){const out=[];for(let i=0;i<total;i++)if(bits[i>>3]&(1<<(i&7)))out.push(i);return out;}
function handlePassEnd(p){
  if(cameraMode!=='receiverData'||p.grid!==CONTROL_GRID||p.payload.length<5)return;const dataGrid=p.payload[0],fileCrc=readU32(p.payload,1);
  if(rx.session===null){resetRxSession(p.session,p.total,dataGrid,fileCrc,0);rlog('PASS_END recuperó una sesión no bloqueada; se pedirá lo faltante.');}
  if(p.session!==rx.session||p.total!==rx.total||dataGrid!==rx.dataGrid){rx.errors++;updateErrors();return;}if(p.round<=rx.lastPassRound)return;rx.lastPassRound=p.round;rx.round=p.round;if(fileCrc&&!rx.fileCrc)rx.fileCrc=fileCrc;
  const{missing}=makeMissingBitmap();rlog(`PASS_END R${p.round+1}: ${rx.chunks.size}/${rx.total}; faltan ${missing}.`);stopCamera();
  if(missing===0){const assembled=assembleFile();if(!assembled){rlog('CRC/ensamblado falló; solicitando nueva reparación.');showNack(p.round);}else showComplete(p.round,assembled);}else showNack(p.round);
}
function controlPayloadNack(){const{bits}=makeMissingBitmap();return concat(new Uint8Array([rx.dataGrid]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(rx.fileCrc)),bits);}
function splitControl(type,round,payload){const cap=payloadCapacity(CONTROL_GRID),parts=[];for(let p=0;p<payload.length;p+=cap)parts.push(payload.slice(p,Math.min(payload.length,p+cap)));return parts.map((part,i)=>makePacket(type,rx.session,round,i,parts.length,part,CONTROL_GRID));}
function repeatControl(packets,metaFn,period=450){let active=true,i=0;const token=++txRunToken;const loop=async()=>{while(active&&token===txRunToken&&$('streamOverlay').style.display!=='none'){renderPacket(packets[i],CONTROL_GRID);$('streamMeta').textContent=metaFn(i,packets.length);i=(i+1)%packets.length;await sleep(period);}};loop();return()=>{active=false;};}
function showNack(round){rxState=RXS.NACK;const packets=splitControl(TYPE.NACK,round,controlPayloadNack()),missing=rx.total-rx.chunks.size;openOverlay(`NACK · ${missing} faltante(s)`,'Control robusto en grid 56. Déjalo hasta que el emisor lo lea.','Emisor leyó NACK · Volver a cámara',()=>receiverWaitRepair());repeatControl(packets,(i,n)=>`NACK · R${round+1} · ${i+1}/${n}`);setPhase(`RECEPTOR · NACK ${missing}`,'mid');rlog(`NACK HPS6: ${missing} faltantes · ${packets.length} parte(s).`);}
function showComplete(round,assembled){rxState=RXS.COMPLETE;rx.complete=assembled;const payload=concat(new Uint8Array([rx.dataGrid]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data)))),packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');}
async function receiverWaitRepair(){closeOverlay();rxState=RXS.WAIT_REPAIR;try{await startCamera('receiverData');setPhase(`RECEPTOR · ESPERANDO REPAIR GRID ${rx.dataGrid}`,'mid');rlog('Cámara lista para Repair Burst.');}catch(e){rlog('ERROR cámara: '+e.message);}}

function handleControlPart(p){
  if(cameraMode!=='senderControl'||!tx||p.session!==tx.session||p.grid!==CONTROL_GRID)return;if(p.type!==TYPE.NACK&&p.type!==TYPE.COMPLETE)return;
  if(!controlRx||controlRx.kind!==p.type||controlRx.round!==p.round||controlRx.totalParts!==p.total)controlRx={session:p.session,round:p.round,kind:p.type,totalParts:p.total,parts:new Map()};
  if(!controlRx.parts.has(p.index))controlRx.parts.set(p.index,p.payload);setPhase(`EMISOR · CONTROL ${controlRx.parts.size}/${controlRx.totalParts}`,'mid');if(controlRx.parts.size!==controlRx.totalParts)return;
  const parts=[];for(let i=0;i<controlRx.totalParts;i++){if(!controlRx.parts.has(i))return;parts.push(controlRx.parts.get(i));}const payload=concat(...parts);stopCamera();
  if(p.type===TYPE.NACK){if(payload.length<9)return;const dataGrid=payload[0],dataTotal=readU32(payload,1),fileCrc=readU32(payload,5);if(dataGrid!==tx.grid||dataTotal!==tx.total||(fileCrc&&fileCrc!==tx.fileCrc)){slog('NACK rechazado: identidad HPS6 no coincide.');return;}const missing=parseMissingBitmap(payload.slice(9),dataTotal);tx.pendingMissing=missing;tx.round=p.round;txState=TXS.NACK_READY;$('txRepairBtn').style.display='inline-flex';$('txRepairBtn').textContent=`Enviar Repair Burst (${missing.length})`;setPhase(`EMISOR · ${missing.length} FALTANTES`,'mid');slog(`NACK válido · ${missing.length} faltantes · plan ${repairPasses(missing.length)} pasada(s).`);}
  else{if(payload.length<9)return;const dataGrid=payload[0],dataTotal=readU32(payload,1),fileCrc=readU32(payload,5),ok=dataGrid===tx.grid&&dataTotal===tx.total&&fileCrc===tx.fileCrc;txState=ok?TXS.DONE:TXS.NACK_READY;setPhase(ok?'EMISOR · COMPLETADO':'EMISOR · COMPLETE INVÁLIDO',ok?'on':'mid');slog(ok?'HPS6 COMPLETE confirmado por CRC.':'COMPLETE inválido.');}
}

function assembleFile(){if(!rx.total||rx.chunks.size!==rx.total)return null;const parts=[];for(let i=0;i<rx.total;i++){if(!rx.chunks.has(i))return null;parts.push(rx.chunks.get(i));}const pkg=concat(...parts),ml=readU16(pkg,0);if(ml<=0||ml>pkg.length-2)return null;let meta;try{meta=JSON.parse(dec.decode(pkg.slice(2,2+ml)));}catch{return null;}const data=pkg.slice(2+ml,2+ml+meta.size);if(data.length!==meta.size)return null;const c=crc32(data);if(rx.fileCrc&&c!==rx.fileCrc)return null;return{meta,data};}
function renderReceived(a){const blob=new Blob([a.data],{type:a.meta.type||'application/octet-stream'}),url=URL.createObjectURL(blob),box=$('receivedBox');box.style.display='block';box.innerHTML=`<b>✓ Archivo reconstruido HPS6</b><br><span class="mono">${escapeHtml(a.meta.name)}</span><br><span class="small">${fmtBytes(a.data.length)} · CRC ${crc32(a.data).toString(16)}</span><br><br><a class="btn good" style="display:inline-block;text-decoration:none" href="${url}" download="${escapeAttr(a.meta.name)}">Guardar archivo</a>`;}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}function escapeAttr(s){return String(s).replace(/"/g,'');}

function markerClass(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),ch=mx-mn,sum=r+g+b;if(mx<42||sum<92||ch<18||ch/Math.max(1,mx)<.13)return 0;const nr=r/sum,ng=g/sum,nb=b/sum,targets=[[.03,.485,.485],[.485,.03,.485],[.485,.485,.03],[.03,.68,.29]];let best=-1,bs=99,second=99;for(let i=0;i<4;i++){const t=targets[i],d=Math.hypot(nr-t[0],ng-t[1],nb-t[2]);if(d<bs){second=bs;bs=d;best=i;}else if(d<second)second=d;}return(bs<.20||(bs<.27&&second-bs>.012))?best+1:0;}
function captureFrame(){const v=$('video'),c=$('capture');if(!v.videoWidth)return null;const maxW=960,scale=Math.min(1,maxW/v.videoWidth),w=Math.max(320,Math.round(v.videoWidth*scale)),h=Math.max(240,Math.round(v.videoHeight*scale));c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,w,h);lastCaptureW=w;lastCaptureH=h;return{w,h,data:ctx.getImageData(0,0,w,h).data};}
function detectFiducials(frame){const stride=Math.max(2,Math.floor(Math.min(frame.w,frame.h)/200)),gw=Math.ceil(frame.w/stride),gh=Math.ceil(frame.h/stride),mask=new Uint8Array(gw*gh);for(let gy=0;gy<gh;gy++){const y=Math.min(frame.h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(frame.w-1,gx*stride+(stride>>1)),p=(y*frame.w+x)*4;mask[gy*gw+gx]=markerClass(frame.data[p],frame.data[p+1],frame.data[p+2]);}}
  const seen=new Uint8Array(mask.length),best={};for(let idx=0;idx<mask.length;idx++){const type=mask[idx];if(!type||seen[idx])continue;const stack=[idx];seen[idx]=1;let count=0,sx=0,sy=0;while(stack.length){const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;sx+=cx;sy+=cy;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]===type){seen[ni]=1;stack.push(ni);}}}if(count<4)continue;const key=MARKER_KEYS[type-1],cand={x:(sx/count+.5)*stride,y:(sy/count+.5)*stride,count};if(!best[key]||cand.count>best[key].count)best[key]=cand;}
  const found=MARKER_KEYS.filter(k=>best[k]).length;if(found<4)return{found,markers:best};const poly=[best.tl,best.tr,best.br,best.bl];let area=0;for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4];area+=a.x*b.y-b.x*a.y;}area=Math.abs(area)/2;const areaRatio=area/(frame.w*frame.h),minSide=Math.min(dist(best.tl,best.tr),dist(best.tr,best.br),dist(best.br,best.bl),dist(best.bl,best.tl));if(areaRatio<.012||minSide<Math.min(frame.w,frame.h)*.10)return{found,markers:best,invalid:true};const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>({x:best[k].x,y:best[k].y})),H=computeHomography(src,dst);return H?{found,markers:best,H,quality:Math.min(100,Math.round(60+areaRatio*180))}:{found,markers:best,invalid:true};}
function solveLinear(A,b){const n=b.length,M=A.map((r,i)=>r.concat([b[i]]));for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}return M.map(r=>r[n]);}
function computeHomography(src,dst){const A=[],b=[];for(let i=0;i<4;i++){const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}const h=solveLinear(A,b);return h?[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]:null;}
function mapPoint(H,x,y){const d=H[6]*x+H[7]*y+H[8];return{x:(H[0]*x+H[1]*y+H[2])/d,y:(H[3]*x+H[4]*y+H[5])/d};}
function lum(frame,x,y,rad){const xi=Math.round(x),yi=Math.round(y);if(xi<0||yi<0||xi>=frame.w||yi>=frame.h)return 0;let s=0,n=0;for(let yy=Math.max(0,yi-rad);yy<=Math.min(frame.h-1,yi+rad);yy++)for(let xx=Math.max(0,xi-rad);xx<=Math.min(frame.w-1,xi+rad);xx++){const p=(yy*frame.w+xx)*4;s+=(frame.data[p]+frame.data[p+1]+frame.data[p+2])/3;n++;}return s/Math.max(1,n);}
function sampleGrid(frame,grid,H){const a=mapPoint(H,DATA_MIN,DATA_MIN),b=mapPoint(H,DATA_MAX,DATA_MIN),c=mapPoint(H,DATA_MIN,DATA_MAX),d=mapPoint(H,DATA_MAX,DATA_MAX),cell=(dist(a,b)+dist(c,d)+dist(a,c)+dist(b,d))/(4*grid),rad=Math.max(0,Math.min(2,Math.floor(cell*.14))),out=new Float32Array(grid*grid);let k=0;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const nx=DATA_MIN+(x+.5)*(DATA_MAX-DATA_MIN)/grid,ny=DATA_MIN+(y+.5)*(DATA_MAX-DATA_MIN)/grid,p=mapPoint(H,nx,ny);out[k++]=lum(frame,p.x,p.y,rad);}return out;}
function decodeSamples(samples,grid){const pilots=pilotEntries(grid),sum=[0,0,0,0],cnt=[0,0,0,0];for(const[idx,s]of pilots){sum[s]+=samples[idx];cnt[s]++;}const means=sum.map((v,i)=>v/Math.max(1,cnt[i]));if(!(means[0]+4<means[1]&&means[1]+4<means[2]&&means[2]+4<means[3]))return null;const sym=new Uint8Array(samples.length);let err=0;for(const[idx,s]of pilots)err+=Math.abs(samples[idx]-means[s]);for(let i=0;i<samples.length;i++){let best=0,bd=1e9;for(let s=0;s<4;s++){const d=Math.abs(samples[i]-means[s]);if(d<bd){bd=d;best=s;}}sym[i]=best;}return{bytes:symbolsToBytes(sym,grid),quality:Math.max(0,Math.min(100,Math.round(100-(err/pilots.length)*1.7)))};}
function expectedGrids(){if(cameraMode==='senderControl')return[CONTROL_GRID];if(rx.session===null)return[CONTROL_GRID];return[rx.dataGrid,CONTROL_GRID].filter((v,i,a)=>a.indexOf(v)===i);}
function decodeWithH(frame,H){for(const g of expectedGrids()){const ds=decodeSamples(sampleGrid(frame,g,H),g);if(!ds)continue;const p=parsePacket(ds.bytes);if(p?.bad){rx.errors++;updateErrors();continue;}if(p)return{p,q:ds.quality};}return null;}
function drawGuide(markers,H,state){const c=$('guideCanvas'),v=$('video');if(!c||!v.clientWidth)return;c.width=Math.round(v.clientWidth);c.height=Math.round(v.clientHeight);const sx=c.width/lastCaptureW,sy=c.height/lastCaptureH,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(markers){const cs={tl:'#00ffff',tr:'#ff00ff',bl:'#ffff00',br:'#00dc66'};for(const k of MARKER_KEYS){const m=markers[k];if(!m)continue;ctx.beginPath();ctx.arc(m.x*sx,m.y*sy,8,0,Math.PI*2);ctx.strokeStyle=cs[k];ctx.lineWidth=3;ctx.stroke();}}if(H){const pts=[[DATA_MIN,DATA_MIN],[DATA_MAX,DATA_MIN],[DATA_MAX,DATA_MAX],[DATA_MIN,DATA_MAX]].map(([x,y])=>mapPoint(H,x,y));ctx.beginPath();ctx.moveTo(pts[0].x*sx,pts[0].y*sy);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x*sx,pts[i].y*sy);ctx.closePath();ctx.strokeStyle=state==='LOCK'?'#34d399':'#67e8f9';ctx.lineWidth=3;ctx.stroke();}}
function setQuality(q,label){const e=$('lockQuality');if(e){e.textContent=`${label} · ${q||0}%`;e.className='lock '+(label==='LOCK'?'good':q>=45?'mid':'');}}
function tryDecode(){const frame=captureFrame();if(!frame)return;if(trackedH){const r=decodeWithH(frame,trackedH);if(r){trackedFails=0;drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(r.q,'LOCK FAST');dispatchPacket(r.p);return;}trackedFails++;if(trackedFails<2){setQuality(55,'TRACK');return;}trackedH=null;trackedMarkers=null;}
  const det=detectFiducials(frame);if(!det.H){drawGuide(det.markers||null,null,'SEARCH');setQuality((det.found||0)*20,`BUSCANDO ${det.found||0}/4`);return;}const r=decodeWithH(frame,det.H);if(r){trackedH=det.H;trackedMarkers=det.markers;trackedFails=0;drawGuide(det.markers,det.H,'LOCK');setQuality(Math.round((r.q+(det.quality||60))/2),'LOCK');dispatchPacket(r.p);return;}drawGuide(det.markers,det.H,'AUTO');setQuality(det.quality||55,'AUTOLOCK');}
function dispatchPacket(p){if(cameraMode==='receiverData'){if(p.type===TYPE.HELLO)handleHello(p);else if(p.type===TYPE.DATA)handleData(p);else if(p.type===TYPE.PASS_END)handlePassEnd(p);}else if(cameraMode==='senderControl'&&(p.type===TYPE.NACK||p.type===TYPE.COMPLETE))handleControlPart(p);}
function scheduleScan(gen){const v=$('video');if(gen!==scanGeneration||!cameraStream)return;if(typeof v.requestVideoFrameCallback==='function'){scanMode='rvfc';scanHandle=v.requestVideoFrameCallback(()=>{if(gen!==scanGeneration)return;tryDecode();scheduleScan(gen);});}else{scanMode='timeout';scanHandle=setTimeout(()=>{if(gen!==scanGeneration)return;tryDecode();scheduleScan(gen);},55);}}
async function startCamera(mode){stopCamera();cameraMode=mode;const constraints={video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,min:15}},audio:false};cameraStream=await navigator.mediaDevices.getUserMedia(constraints);const v=$('video');v.srcObject=cameraStream;await v.play();$('cameraBtn').disabled=true;$('stopCameraBtn').disabled=false;trackedH=null;trackedMarkers=null;trackedFails=0;const track=cameraStream.getVideoTracks()[0],s=track?.getSettings?.()||{};rlog(`Cámara: ${s.width||'?'}×${s.height||'?'} @ ${s.frameRate?Number(s.frameRate).toFixed(0):'?'} fps · decoder ${typeof v.requestVideoFrameCallback==='function'?'frame-synced':'fallback'}.`);const gen=++scanGeneration;scheduleScan(gen);setTimeout(()=>$('receiverPanel')?.scrollIntoView({behavior:'smooth',block:'center'}),100);}
function stopCamera(){scanGeneration++;const v=$('video');if(scanHandle!==null){if(scanMode==='rvfc'&&v?.cancelVideoFrameCallback)try{v.cancelVideoFrameCallback(scanHandle);}catch{}else if(scanMode==='timeout')clearTimeout(scanHandle);scanHandle=null;}if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}if(v)v.srcObject=null;if($('cameraBtn'))$('cameraBtn').disabled=false;if($('stopCameraBtn'))$('stopCameraBtn').disabled=true;cameraMode='idle';trackedH=null;}
function startReceiver(){if(rxState===RXS.DONE||rx.session===null)rx=freshRx();rxState=RXS.CAMERA;startCamera('receiverData').then(()=>{setPhase('RECEPTOR · HPS6 BUSCANDO HELLO 56','on');rlog('Esperando HELLO HPS6 en control grid 56.');}).catch(e=>{rlog('ERROR cámara: '+e.message);alert('No se pudo abrir cámara: '+e.message);});}

function updateErrors(){if($('rxErrors'))$('rxErrors').textContent=rx.errors;}
function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;}const elapsed=(ts-rx.startedAt)/1000;if(count>rx.lastCount&&ts>rx.lastTs){const inst=(count-rx.lastCount)/((ts-rx.lastTs)/1000);rx.emaRate=rx.emaRate?rx.emaRate*.72+inst*.28:inst;rx.lastCount=count;rx.lastTs=ts;}const rate=rx.emaRate||count/Math.max(.25,elapsed);$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=rate?`${rate.toFixed(rate<10?1:0)} DATA/s`:'—';$('rxEta').textContent=count>=total?'0s':rate?`≈ ${fmtTime((total-count)/rate)}`:'—';}
function cancelProtocol(reset=true){txRunToken++;stopCamera();closeOverlay();releaseWake();controlRx=null;txState=TXS.IDLE;rxState=RXS.IDLE;if(reset){tx=null;rx=freshRx();$('sendBtn').disabled=true;$('txRepairBtn').style.display='none';setPhase('HPS6 LISTO','on');}}

$('prepareBtn').onclick=prepareTransfer;$('sendBtn').onclick=showHello;$('txRepairBtn').onclick=sendRepair;$('cameraBtn').onclick=startReceiver;$('stopCameraBtn').onclick=stopCamera;
$('overlayActionBtn').onclick=()=>{const fn=currentOverlayAction;if(fn)fn();};$('closeStream').onclick=()=>{if(confirm('¿Cancelar el flujo óptico actual?'))cancelProtocol(false);};
$('gridSize').onchange=()=>{updateModeHint();if(txState!==TXS.IDLE&&txState!==TXS.PREPARED){$('sendBtn').disabled=true;tx=null;txState=TXS.IDLE;}};$('speedMode').onchange=updateModeHint;
updateModeHint();$('cameraChip').textContent=navigator.mediaDevices?.getUserMedia?'● Cámara: disponible':'○ Cámara: no disponible';$('cameraChip').className='chip '+(navigator.mediaDevices?.getUserMedia?'on':'off');$('wakeChip').textContent='wakeLock'in navigator?'● Wake Lock: disponible':'○ Wake Lock: no disponible';$('wakeChip').className='chip '+('wakeLock'in navigator?'on':'off');setPhase('HPS6 OPTICAL TURBO LISTO','on');setInterval(updateMetrics,500);window.addEventListener('pagehide',()=>{txRunToken++;stopCamera();releaseWake();});if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});slog('HPS6 Optical Turbo cargado · control 56 + DATA 32…80 + frame-synced decoder.');
})();