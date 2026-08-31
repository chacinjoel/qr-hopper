(() => {
'use strict';

const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();

const MAGIC = [0x48,0x50,0x53,0x35]; // HPS5
const VERSION = 5;
const HEADER = 28;
const PILOT_CELLS = 32;
const LEVELS = [26,92,164,236];
const DATA_MIN = .12, DATA_MAX = .88;
const GRID_OPTIONS = [32,40,48,56];
const MARKER_KEYS = ['tl','tr','bl','br'];
const MARKER_NORM = {tl:[.06,.06],tr:[.94,.06],bl:[.06,.94],br:[.94,.94]};
const TYPE = {HELLO:1, DATA:2, PASS_END:3, NACK:4, COMPLETE:5};
const SPEED = {
  slow:{label:'Lenta',mult:1,fps:3,repeat:3,uniqueFps:1,hint:'Lenta: 1 frame nuevo/s · máxima estabilidad.'},
  normal:{label:'Normal',mult:2,fps:6,repeat:3,uniqueFps:2,hint:'Normal: 2 frames nuevos/s · equilibrio recomendado.'},
  fast:{label:'Rápida',mult:4,fps:12,repeat:3,uniqueFps:4,hint:'Rápida: 4 frames nuevos/s · requiere AutoLock estable.'},
  ultra:{label:'Experimental',mult:8,fps:24,repeat:3,uniqueFps:8,hint:'Experimental: 8 frames nuevos/s · HPS5 repara las pérdidas por NACK.'}
};

const TXS = {IDLE:'IDLE',PREPARED:'PREPARED',HELLO:'HELLO_HOLD',SENDING:'SENDING',PASS_END:'PASS_END_HOLD',LISTEN:'LISTEN_CONTROL',NACK_READY:'NACK_READY',DONE:'DONE'};
const RXS = {IDLE:'IDLE',CAMERA:'RX_CAMERA',LOCKED:'SESSION_LOCKED',RECEIVING:'RECEIVING',NACK:'NACK_SCREEN',COMPLETE:'COMPLETE_SCREEN',WAIT_REPAIR:'WAIT_REPAIR',DONE:'DONE'};

let txState = TXS.IDLE, rxState = RXS.IDLE;
let tx = null;
let rx = freshRx();
let cameraStream = null, scanTimer = null, cameraMode = 'idle';
let displayTimer = null, wakeLock = null;
let controlRx = null;
let currentOverlayAction = null;

function freshRx(){return {session:null,total:0,fileCrc:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null};}
function now(){return new Date().toLocaleTimeString();}
function log(el,msg){if(!el)return;el.textContent=`[${now()}] ${msg}\n`+el.textContent.slice(0,7000);}
function slog(msg){log($('sendLog'),msg);} function rlog(msg){log($('rxLog'),msg);}
function setPhase(text,kind=''){const e=$('phaseStatus');if(!e)return;e.textContent=text;e.className='chip '+(kind||'');}
function fmtBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB';}
function fmtTime(sec){if(!Number.isFinite(sec)||sec<0)return '—';sec=Math.round(sec);const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}
function u16(n){return[(n>>>8)&255,n&255];}
function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];}
function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),out=new Uint8Array(n);let p=0;for(const a of arrs){out.set(a,p);p+=a.length;}return out;}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1;}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

function speedProfile(){return SPEED[$('speedMode')?.value]||SPEED.slow;}
function updateSpeedHint(){if($('speedHint'))$('speedHint').textContent=speedProfile().hint;}
function pilotEntries(grid){const out=[];const add=(row,col,p)=>{for(let i=0;i<8;i++)out.push([row*grid+col+i,p[i]]);};add(0,0,[0,1,2,3,0,1,2,3]);add(0,grid-8,[3,2,1,0,3,2,1,0]);add(grid-1,0,[1,3,0,2,1,3,0,2]);add(grid-1,grid-8,[2,0,3,1,2,0,3,1]);return out;}
function pilotMap(grid){return new Map(pilotEntries(grid));}
function rawCapacity(grid){return Math.floor((grid*grid-PILOT_CELLS)*2/8);}
function payloadCapacity(grid){return rawCapacity(grid)-HEADER;}

function makePacket(type,session,round,index,total,payload,grid){
  const h=new Uint8Array(HEADER);h.set(MAGIC,0);h[4]=VERSION;h[5]=type;h[6]=grid;h[7]=0;h.set(u32(session),8);h.set(u16(round),12);h.set(u32(index),14);h.set(u32(total),18);h.set(u16(payload.length),22);
  const check=crc32(concat(h.slice(0,24),payload));h.set(u32(check),24);return concat(h,payload);
}
function parsePacket(bytes){
  if(bytes.length<HEADER)return null;for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;
  if(bytes[4]!==VERSION||bytes[7]!==0)return null;
  const type=bytes[5],grid=bytes[6],session=readU32(bytes,8),round=readU16(bytes,12),index=readU32(bytes,14),total=readU32(bytes,18),len=readU16(bytes,22),expected=readU32(bytes,24);
  if(!Object.values(TYPE).includes(type)||!GRID_OPTIONS.includes(grid)||!session||!total||round>4095||len>bytes.length-HEADER||len>payloadCapacity(grid))return null;
  if(type===TYPE.DATA&&index>=total)return null;
  if((type===TYPE.NACK||type===TYPE.COMPLETE)&&index>=total)return null;
  if((type===TYPE.HELLO||type===TYPE.PASS_END)&&index!==0)return null;
  const payload=bytes.slice(HEADER,HEADER+len);const actual=crc32(concat(bytes.slice(0,24),payload));
  if(actual!==expected)return {bad:true};
  return {type,grid,session,round,index,total,payload};
}

function rawToSymbols(raw,grid){const out=new Uint8Array(grid*grid),pilots=pilotMap(grid);for(const [i,s] of pilots)out[i]=s;let bp=0,shift=6;for(let i=0;i<out.length;i++){if(pilots.has(i))continue;if(bp<raw.length){out[i]=(raw[bp]>>shift)&3;shift-=2;if(shift<0){shift=6;bp++;}}}return out;}
function symbolsToBytes(sym,grid){const pilots=pilotMap(grid),data=[];for(let i=0;i<sym.length;i++)if(!pilots.has(i))data.push(sym[i]);const out=new Uint8Array(Math.floor(data.length/4));for(let i=0;i<out.length;i++)out[i]=(data[i*4]<<6)|(data[i*4+1]<<4)|(data[i*4+2]<<2)|data[i*4+3];return out;}
function renderPacket(raw,grid){const c=$('pixelCanvas');c.width=grid;c.height=grid;const ctx=c.getContext('2d',{alpha:false}),sym=rawToSymbols(raw,grid),img=ctx.createImageData(grid,grid);for(let i=0;i<sym.length;i++){const v=LEVELS[sym[i]],p=i*4;img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255;}ctx.putImageData(img,0,0);}

function openOverlay(meta,bottom,actionLabel,action){stopDisplay();$('streamOverlay').style.display='flex';document.body.style.overflow='hidden';$('streamMeta').textContent=meta;$('streamBottom').textContent=bottom;const b=$('overlayActionBtn');b.textContent=actionLabel||'';b.style.display=actionLabel?'inline-flex':'none';currentOverlayAction=action||null;}
function closeOverlay(){stopDisplay();$('streamOverlay').style.display='none';document.body.style.overflow='';currentOverlayAction=null;}
function stopDisplay(){if(displayTimer){clearInterval(displayTimer);displayTimer=null;}}
function repeatControlPackets(packets,grid,metaFn,period=500){let i=0;const draw=()=>{renderPacket(packets[i],grid);$('streamMeta').textContent=metaFn(i,packets.length);i=(i+1)%packets.length;};draw();if(packets.length>1)displayTimer=setInterval(draw,period);}
async function getWake(){try{if(navigator.wakeLock?.request&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
function releaseWake(){if(wakeLock){Promise.resolve(wakeLock.release?.()).catch(()=>{});wakeLock=null;}}

async function prepareTransfer(){
  try{
    cancelProtocol(false);const f=$('fileInput')?.files?.[0];if(!f){alert('Selecciona un archivo.');return;}
    const grid=Number($('gridSize').value),cap=payloadCapacity(grid);const fileBytes=new Uint8Array(await f.arrayBuffer());
    const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));if(meta.length>65535)throw new Error('Metadata demasiado grande');
    const pkg=concat(new Uint8Array(u16(meta.length)),meta,fileBytes),chunks=[];for(let p=0;p<pkg.length;p+=cap)chunks.push(pkg.slice(p,Math.min(pkg.length,p+cap)));
    tx={session:randomId(),grid,cap,f,fileBytes,fileCrc:crc32(fileBytes),chunks,total:chunks.length,round:0,pendingMissing:null};txState=TXS.PREPARED;
    $('fileSize').textContent=fmtBytes(f.size);$('frameCount').textContent=tx.total;$('capacity').textContent=cap+' B';$('sendBtn').disabled=false;$('txRepairBtn').style.display='none';
    slog(`Preparado HPS5 · ${f.name} · ${tx.total} frames · CRC ${tx.fileCrc.toString(16)}`);setPhase('EMISOR · PREPARADO','on');
  }catch(e){slog('ERROR preparando: '+(e?.message||e));alert('No se pudo preparar: '+(e?.message||e));}
}
function helloPayload(){return concat(new Uint8Array(u32(tx.fileCrc)),new Uint8Array(u32(tx.fileBytes.length)));}
function passEndPayload(){return new Uint8Array(u32(tx.fileCrc));}
function showHello(){
  if(!tx)return;stopCamera();getWake();txState=TXS.HELLO;const raw=makePacket(TYPE.HELLO,tx.session,0,0,tx.total,helloPayload(),tx.grid);
  openOverlay(`HANDSHAKE · sesión ${tx.session.toString(16)}`,'Apunta el receptor hasta que muestre “Sesión bloqueada”. Este patrón no avanza solo.','Receptor listo · Iniciar transferencia',()=>sendPass(Array.from({length:tx.total},(_,i)=>i),0));
  renderPacket(raw,tx.grid);setPhase('EMISOR · HANDSHAKE','mid');slog('HELLO fijo. Esperando confirmación visual del receptor.');
}
function sendPass(indices,round){
  if(!tx||!indices.length)return;closeOverlay();stopCamera();getWake();txState=TXS.SENDING;tx.round=round;const sp=speedProfile();let pos=0,rep=0;
  openOverlay(`Ronda ${round+1}`,'Transmitiendo datos…',null,null);setPhase(round?'EMISOR · REPARANDO':'EMISOR · ENVIANDO','on');
  const tick=()=>{
    const idx=indices[pos],raw=makePacket(TYPE.DATA,tx.session,round,idx,tx.total,tx.chunks[idx],tx.grid);renderPacket(raw,tx.grid);$('streamMeta').textContent=`Ronda ${round+1} · Frame ${idx+1}/${tx.total} · ${sp.label} ${sp.mult}×`;rep++;
    if(rep>=sp.repeat){rep=0;pos++;if(pos>=indices.length){stopDisplay();showPassEnd(round);}}
  };
  tick();displayTimer=setInterval(tick,Math.max(30,Math.round(1000/sp.fps)));slog(`${round?'REPARACIÓN':'PASADA INICIAL'}: ${indices.length} frame(s).`);
}
function showPassEnd(round){
  txState=TXS.PASS_END;const raw=makePacket(TYPE.PASS_END,tx.session,round,0,tx.total,passEndPayload(),tx.grid);
  openOverlay(`PASS_END · ronda ${round+1}`,'Déjalo visible hasta que el receptor cambie a NACK o COMPLETE. Luego pulsa “Leer control”.','Receptor mostró control · Leer NACK/COMPLETE',()=>listenForControl(round));
  renderPacket(raw,tx.grid);setPhase('EMISOR · PASS_END','mid');slog(`PASS_END ronda ${round+1} fijo; no hay temporizador.`);
}
async function listenForControl(round){
  closeOverlay();releaseWake();txState=TXS.LISTEN;controlRx={session:tx.session,round,kind:0,totalParts:0,parts:new Map()};
  try{await startCamera('senderControl');setPhase('EMISOR · LEYENDO CONTROL','mid');slog('Cámara activa. NACK/COMPLETE puede permanecer en pantalla todo el tiempo necesario.');}catch(e){slog('ERROR cámara control: '+e.message);alert('No se pudo abrir cámara: '+e.message);}
}
function sendRepair(){if(!tx?.pendingMissing?.length)return;const list=tx.pendingMissing.slice();tx.pendingMissing=null;$('txRepairBtn').style.display='none';sendPass(list,tx.round+1);}

function resetRxSession(session,total,fileCrc=0){rx=freshRx();rx.session=session;rx.total=total;rx.fileCrc=fileCrc;$('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';}
function handleHello(p){
  if(cameraMode!=='receiverData'||p.payload.length<8)return;const fileCrc=readU32(p.payload,0);
  if(rx.session===null){resetRxSession(p.session,p.total,fileCrc);rxState=RXS.LOCKED;rlog(`Sesión bloqueada: ${p.session.toString(16)} · ${p.total} frames · listo para iniciar.`);setPhase('RECEPTOR · SESIÓN BLOQUEADA','on');}
  else if(rx.session!==p.session)rlog('HELLO de otra sesión ignorado; la sesión activa se conserva.');
}
function handleData(p){
  if(cameraMode!=='receiverData')return;
  if(rx.session===null){resetRxSession(p.session,p.total,0);rlog(`Sesión adoptada desde DATA: ${p.session.toString(16)}.`);}
  if(p.session!==rx.session||p.total!==rx.total){rx.errors++;updateErrors();return;}
  rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);
  if(!rx.chunks.has(p.index)){rx.chunks.set(p.index,p.payload);$('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();}
  setPhase(`RECEPTOR · RECIBIENDO R${p.round+1}`,'on');
}
function makeMissingBitmap(){const bits=new Uint8Array(Math.ceil(rx.total/8));let missing=0;for(let i=0;i<rx.total;i++)if(!rx.chunks.has(i)){bits[i>>3]|=1<<(i&7);missing++;}return{bits,missing};}
function parseMissingBitmap(bits,total){const out=[];for(let i=0;i<total;i++)if(bits[i>>3]&(1<<(i&7)))out.push(i);return out;}
function handlePassEnd(p){
  if(cameraMode!=='receiverData')return;
  const fileCrc=p.payload.length>=4?readU32(p.payload,0):0;
  if(rx.session===null){resetRxSession(p.session,p.total,fileCrc);rlog(`PASS_END recuperó la sesión ${p.session.toString(16)}. Se solicitará todo lo no recibido.`);}
  if(p.session!==rx.session||p.total!==rx.total){rx.errors++;updateErrors();return;}
  if(fileCrc&&!rx.fileCrc)rx.fileCrc=fileCrc;if(p.round<=rx.lastPassRound)return;rx.lastPassRound=p.round;rx.round=p.round;
  const {missing}=makeMissingBitmap();rlog(`PASS_END ronda ${p.round+1}: ${rx.chunks.size}/${rx.total} recibidos · faltan ${missing}.`);
  stopCamera();
  if(missing===0){const assembled=assembleFile();if(!assembled){rlog('El ensamblado final falló; solicitando todos los frames de nuevo.');rx.chunks.clear();showNack(p.round);return;}showComplete(p.round,assembled);}else showNack(p.round);
}
function controlPayloadNack(){const {bits}=makeMissingBitmap();return concat(new Uint8Array(u32(rx.total)),new Uint8Array(u32(rx.fileCrc)),bits);}
function splitControl(type,round,payload){const grid=Number($('gridSize').value||32),cap=payloadCapacity(grid),parts=[];for(let p=0;p<payload.length;p+=cap)parts.push(payload.slice(p,Math.min(payload.length,p+cap)));return {grid,packets:parts.map((part,i)=>makePacket(type,rx.session,round,i,parts.length,part,grid))};}
function showNack(round){
  rxState=RXS.NACK;const {grid,packets}=splitControl(TYPE.NACK,round,controlPayloadNack());const missing=rx.total-rx.chunks.size;
  openOverlay(`NACK · ${missing} faltante(s)`,'Déjalo visible hasta que el emisor confirme que leyó el NACK. Después pulsa el botón.','Emisor leyó NACK · Volver a cámara',()=>receiverWaitRepair());
  repeatControlPackets(packets,grid,(i,n)=>`NACK · ronda ${round+1} · parte ${i+1}/${n}`,500);setPhase(`RECEPTOR · NACK ${missing}`,'mid');rlog(`NACK persistente: ${missing} faltante(s) en ${packets.length} parte(s).`);
}
function showComplete(round,assembled){
  rxState=RXS.COMPLETE;rx.complete=assembled;const payload=concat(new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data))));const {grid,packets}=splitControl(TYPE.COMPLETE,round,payload);
  renderReceived(assembled);
  openOverlay('COMPLETE','Archivo reconstruido y CRC verificado. Déjalo visible hasta que el emisor confirme COMPLETE.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});
  repeatControlPackets(packets,grid,()=>`COMPLETE · sesión ${rx.session.toString(16)}`,700);setPhase('RECEPTOR · COMPLETE','on');rlog('COMPLETE persistente listo para ser leído por el emisor.');
}
async function receiverWaitRepair(){closeOverlay();rxState=RXS.WAIT_REPAIR;try{await startCamera('receiverData');setPhase('RECEPTOR · ESPERANDO REPARACIÓN','mid');rlog('NACK cerrado. Cámara lista para recibir solo los frames solicitados.');}catch(e){rlog('ERROR reabriendo cámara: '+e.message);}}

function handleControlPart(p){
  if(cameraMode!=='senderControl'||!tx||p.session!==tx.session)return;
  if(p.type!==TYPE.NACK&&p.type!==TYPE.COMPLETE)return;
  if(!controlRx||controlRx.kind!==p.type||controlRx.round!==p.round||controlRx.totalParts!==p.total){controlRx={session:p.session,round:p.round,kind:p.type,totalParts:p.total,parts:new Map()};}
  if(!controlRx.parts.has(p.index))controlRx.parts.set(p.index,p.payload);setPhase(`EMISOR · CONTROL ${controlRx.parts.size}/${controlRx.totalParts}`,'mid');
  if(controlRx.parts.size!==controlRx.totalParts)return;
  const parts=[];for(let i=0;i<controlRx.totalParts;i++){if(!controlRx.parts.has(i))return;parts.push(controlRx.parts.get(i));}
  const payload=concat(...parts);stopCamera();
  if(p.type===TYPE.NACK){
    if(payload.length<8)return;const dataTotal=readU32(payload,0),fileCrc=readU32(payload,4);if(dataTotal!==tx.total||(fileCrc&&fileCrc!==tx.fileCrc)){slog('NACK rechazado: identidad de transferencia no coincide.');return;}
    const missing=parseMissingBitmap(payload.slice(8),dataTotal);tx.pendingMissing=missing;tx.round=p.round;txState=TXS.NACK_READY;$('txRepairBtn').style.display='inline-flex';$('txRepairBtn').textContent=`Enviar reparación (${missing.length})`;setPhase(`EMISOR · NACK LEÍDO · ${missing.length} FALTANTES`,'mid');slog(`NACK válido. Receptor solicita ${missing.length} frame(s). Cierra el NACK en el receptor antes de enviar reparación.`);
  } else {
    if(payload.length<8)return;const dataTotal=readU32(payload,0),fileCrc=readU32(payload,4);const ok=dataTotal===tx.total&&fileCrc===tx.fileCrc;txState=ok?TXS.DONE:TXS.NACK_READY;setPhase(ok?'EMISOR · COMPLETADO':'EMISOR · COMPLETE INVÁLIDO',ok?'on':'mid');slog(ok?'COMPLETE recibido y CRC final confirmado.':'COMPLETE inválido: total o CRC no coincide.');
  }
}

function assembleFile(){
  if(!rx.total||rx.chunks.size!==rx.total)return null;const parts=[];for(let i=0;i<rx.total;i++){if(!rx.chunks.has(i))return null;parts.push(rx.chunks.get(i));}
  const pkg=concat(...parts),ml=readU16(pkg,0);if(ml<=0||ml>pkg.length-2)return null;let meta;try{meta=JSON.parse(dec.decode(pkg.slice(2,2+ml)));}catch{return null;}
  const data=pkg.slice(2+ml,2+ml+meta.size);if(data.length!==meta.size)return null;const c=crc32(data);if(rx.fileCrc&&c!==rx.fileCrc)return null;if(!rx.fileCrc)rx.fileCrc=c;return{meta,data};
}
function renderReceived(a){const blob=new Blob([a.data],{type:a.meta.type||'application/octet-stream'}),url=URL.createObjectURL(blob),box=$('receivedBox');box.style.display='block';box.innerHTML=`<b>✓ Archivo reconstruido</b><br><span class="mono">${escapeHtml(a.meta.name)}</span><br><span class="small">${fmtBytes(a.data.length)} · CRC ${crc32(a.data).toString(16)}</span><br><br><a class="btn good" style="display:inline-block;text-decoration:none" href="${url}" download="${escapeAttr(a.meta.name)}">Guardar archivo</a>`;}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}function escapeAttr(s){return String(s).replace(/"/g,'');}

function markerClass(r,g,b){const mx=Math.max(r,g,b),mn=Math.min(r,g,b),ch=mx-mn,sum=r+g+b;if(mx<45||sum<100||ch<22||ch/Math.max(1,mx)<.16)return 0;const nr=r/sum,ng=g/sum,nb=b/sum,targets=[[.03,.485,.485],[.485,.03,.485],[.485,.485,.03],[.03,.68,.29]];let best=-1,bs=99,second=99;for(let i=0;i<4;i++){const t=targets[i],d=Math.hypot(nr-t[0],ng-t[1],nb-t[2]);if(d<bs){second=bs;bs=d;best=i;}else if(d<second)second=d;}if(bs<.18||(bs<.245&&second-bs>.015))return best+1;return 0;}
function captureFrame(){const v=$('video'),c=$('capture');if(!v.videoWidth||!v.clientWidth)return null;const w=Math.max(1,Math.round(v.clientWidth)),h=Math.max(1,Math.round(v.clientHeight));c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,w,h);return{w,h,data:ctx.getImageData(0,0,w,h).data};}
function detectFiducials(frame){const stride=Math.max(2,Math.floor(Math.min(frame.w,frame.h)/190)),gw=Math.ceil(frame.w/stride),gh=Math.ceil(frame.h/stride),mask=new Uint8Array(gw*gh);for(let gy=0;gy<gh;gy++){const y=Math.min(frame.h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(frame.w-1,gx*stride+(stride>>1)),p=(y*frame.w+x)*4;mask[gy*gw+gx]=markerClass(frame.data[p],frame.data[p+1],frame.data[p+2]);}}
  const seen=new Uint8Array(mask.length),best={};for(let idx=0;idx<mask.length;idx++){const type=mask[idx];if(!type||seen[idx])continue;const stack=[idx];seen[idx]=1;let count=0,sx=0,sy=0;while(stack.length){const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;sx+=cx;sy+=cy;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]===type){seen[ni]=1;stack.push(ni);}}}if(count<5)continue;const key=MARKER_KEYS[type-1],cand={x:(sx/count+.5)*stride,y:(sy/count+.5)*stride,count};if(!best[key]||cand.count>best[key].count)best[key]=cand;}
  const found=MARKER_KEYS.filter(k=>best[k]).length;if(found<4)return{found,markers:best};const counts=MARKER_KEYS.map(k=>best[k].count),ratio=Math.max(...counts)/Math.max(1,Math.min(...counts)),poly=[best.tl,best.tr,best.br,best.bl];let area=0;for(let i=0;i<4;i++){const a=poly[i],b=poly[(i+1)%4];area+=a.x*b.y-b.x*a.y;}area=Math.abs(area)/2;const areaRatio=area/(frame.w*frame.h),minSide=Math.min(dist(best.tl,best.tr),dist(best.tr,best.br),dist(best.br,best.bl),dist(best.bl,best.tl));if(areaRatio<.012||minSide<Math.min(frame.w,frame.h)*.10||ratio>12)return{found,markers:best,invalid:true};const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>({x:best[k].x,y:best[k].y})),H=computeHomography(src,dst);return H?{found,markers:best,H,quality:Math.min(100,Math.round(60+areaRatio*180))}:{found,markers:best,invalid:true};}
function solveLinear(A,b){const n=b.length,M=A.map((r,i)=>r.concat([b[i]]));for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}return M.map(r=>r[n]);}
function computeHomography(src,dst){const A=[],b=[];for(let i=0;i<4;i++){const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}const h=solveLinear(A,b);return h?[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]:null;}
function mapPoint(H,x,y){const d=H[6]*x+H[7]*y+H[8];return{x:(H[0]*x+H[1]*y+H[2])/d,y:(H[3]*x+H[4]*y+H[5])/d};}
function lum(frame,x,y,rad){const xi=Math.round(x),yi=Math.round(y);if(xi<0||yi<0||xi>=frame.w||yi>=frame.h)return 0;let s=0,n=0;for(let yy=Math.max(0,yi-rad);yy<=Math.min(frame.h-1,yi+rad);yy++)for(let xx=Math.max(0,xi-rad);xx<=Math.min(frame.w-1,xi+rad);xx++){const p=(yy*frame.w+xx)*4;s+=(frame.data[p]+frame.data[p+1]+frame.data[p+2])/3;n++;}return s/Math.max(1,n);}
function sampleGrid(frame,grid,H){const a=mapPoint(H,DATA_MIN,DATA_MIN),b=mapPoint(H,DATA_MAX,DATA_MIN),c=mapPoint(H,DATA_MIN,DATA_MAX),d=mapPoint(H,DATA_MAX,DATA_MAX),cell=(dist(a,b)+dist(c,d)+dist(a,c)+dist(b,d))/(4*grid),rad=Math.max(0,Math.min(2,Math.floor(cell*.12))),out=new Float32Array(grid*grid);let k=0;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const nx=DATA_MIN+(x+.5)*(DATA_MAX-DATA_MIN)/grid,ny=DATA_MIN+(y+.5)*(DATA_MAX-DATA_MIN)/grid,p=mapPoint(H,nx,ny);out[k++]=lum(frame,p.x,p.y,rad);}return out;}
function decodeSamples(samples,grid){const pilots=pilotEntries(grid),sum=[0,0,0,0],cnt=[0,0,0,0];for(const [idx,s] of pilots){sum[s]+=samples[idx];cnt[s]++;}const means=sum.map((v,i)=>v/Math.max(1,cnt[i]));if(!(means[0]+5<means[1]&&means[1]+5<means[2]&&means[2]+5<means[3]))return null;const sym=new Uint8Array(samples.length);let err=0;for(const [idx,s] of pilots)err+=Math.abs(samples[idx]-means[s]);for(let i=0;i<samples.length;i++){let best=0,bd=1e9;for(let s=0;s<4;s++){const d=Math.abs(samples[i]-means[s]);if(d<bd){bd=d;best=s;}}sym[i]=best;}return{bytes:symbolsToBytes(sym,grid),quality:Math.max(0,Math.min(100,Math.round(100-(err/pilots.length)*1.8)))};}
function drawGuide(markers,H,state){const c=$('guideCanvas'),v=$('video');if(!c||!v.clientWidth)return;c.width=Math.round(v.clientWidth);c.height=Math.round(v.clientHeight);const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);if(markers){const cs={tl:'#00ffff',tr:'#ff00ff',bl:'#ffff00',br:'#00dc66'};for(const k of MARKER_KEYS){const m=markers[k];if(!m)continue;ctx.beginPath();ctx.arc(m.x,m.y,9,0,Math.PI*2);ctx.strokeStyle=cs[k];ctx.lineWidth=3;ctx.stroke();}}if(H){const pts=[[DATA_MIN,DATA_MIN],[DATA_MAX,DATA_MIN],[DATA_MAX,DATA_MAX],[DATA_MIN,DATA_MAX]].map(([x,y])=>mapPoint(H,x,y));ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.strokeStyle=state==='LOCK'?'#34d399':'#67e8f9';ctx.lineWidth=3;ctx.stroke();}}
function setQuality(q,label){const e=$('lockQuality');if(!e)return;e.textContent=`${label} · ${q||0}%`;e.className='lock '+(label==='LOCK'?'good':q>=45?'mid':'');}
function tryDecode(){const frame=captureFrame();if(!frame)return;const det=detectFiducials(frame);if(!det.H){drawGuide(det.markers||null,null,'SEARCH');setQuality((det.found||0)*20,`BUSCANDO ${det.found||0}/4`);return;}const grids=[Number($('gridSize').value||32),...GRID_OPTIONS].filter((v,i,a)=>a.indexOf(v)===i);for(const g of grids){const ds=decodeSamples(sampleGrid(frame,g,det.H),g);if(!ds)continue;const p=parsePacket(ds.bytes);if(p?.bad){rx.errors++;updateErrors();continue;}if(p){drawGuide(det.markers,det.H,'LOCK');setQuality(Math.round((ds.quality+(det.quality||60))/2),'LOCK');dispatchPacket(p);return;}}drawGuide(det.markers,det.H,'AUTO');setQuality(det.quality||55,'AUTOLOCK');}
function dispatchPacket(p){if(cameraMode==='receiverData'){if(p.type===TYPE.HELLO)handleHello(p);else if(p.type===TYPE.DATA)handleData(p);else if(p.type===TYPE.PASS_END)handlePassEnd(p);}else if(cameraMode==='senderControl'){if(p.type===TYPE.NACK||p.type===TYPE.COMPLETE)handleControlPart(p);}}
async function startCamera(mode){stopCamera();cameraMode=mode;cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1280}},audio:false});$('video').srcObject=cameraStream;await $('video').play();$('cameraBtn').disabled=true;$('stopCameraBtn').disabled=false;scanTimer=setInterval(tryDecode,90);setTimeout(()=>$('receiverPanel')?.scrollIntoView({behavior:'smooth',block:'center'}),100);}
function stopCamera(){if(scanTimer){clearInterval(scanTimer);scanTimer=null;}if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}if($('video'))$('video').srcObject=null;$('cameraBtn').disabled=false;$('stopCameraBtn').disabled=true;cameraMode='idle';}
function startReceiver(){if(rxState===RXS.DONE||rx.session===null)rx=freshRx();rxState=RXS.CAMERA;startCamera('receiverData').then(()=>{setPhase('RECEPTOR · BUSCANDO HANDSHAKE','on');rlog('Cámara activa. Esperando HELLO/DATA/PASS_END HPS5.');}).catch(e=>{rlog('ERROR cámara: '+e.message);alert('No se pudo abrir cámara: '+e.message);});}

function updateErrors(){if($('rxErrors'))$('rxErrors').textContent=rx.errors;}
function updateMetrics(){const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;}const elapsed=(ts-rx.startedAt)/1000;if(count>rx.lastCount&&ts>rx.lastTs){const inst=(count-rx.lastCount)/((ts-rx.lastTs)/1000);rx.emaRate=rx.emaRate?rx.emaRate*.7+inst*.3:inst;rx.lastCount=count;rx.lastTs=ts;}const rate=rx.emaRate||count/Math.max(.25,elapsed);$('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=rate?`${rate.toFixed(rate<10?1:0)} fr/s`:'—';$('rxEta').textContent=count>=total?'0s':rate?`≈ ${fmtTime((total-count)/rate)}`:'—';}
function cancelProtocol(reset=true){stopDisplay();stopCamera();closeOverlay();releaseWake();controlRx=null;txState=TXS.IDLE;rxState=RXS.IDLE;if(reset){tx=null;rx=freshRx();$('sendBtn').disabled=true;$('txRepairBtn').style.display='none';setPhase('HPS5 LISTO','on');}}

$('prepareBtn').onclick=prepareTransfer;
$('sendBtn').onclick=showHello;
$('txRepairBtn').onclick=sendRepair;
$('cameraBtn').onclick=startReceiver;
$('stopCameraBtn').onclick=stopCamera;
$('overlayActionBtn').onclick=()=>{const fn=currentOverlayAction;if(fn)fn();};
$('closeStream').onclick=()=>{if(confirm('¿Cancelar el flujo óptico actual?'))cancelProtocol(false);};
$('gridSize').onchange=()=>{$('capacity').textContent=payloadCapacity(Number($('gridSize').value))+' B';if(txState!==TXS.IDLE){$('sendBtn').disabled=true;tx=null;txState=TXS.IDLE;}};
$('speedMode').onchange=updateSpeedHint;
$('capacity').textContent=payloadCapacity(Number($('gridSize').value||32))+' B';updateSpeedHint();
$('cameraChip').textContent=navigator.mediaDevices?.getUserMedia?'● Cámara: disponible':'○ Cámara: no disponible';$('cameraChip').className='chip '+(navigator.mediaDevices?.getUserMedia?'on':'off');
$('wakeChip').textContent='wakeLock'in navigator?'● Wake Lock: disponible':'○ Wake Lock: no disponible';$('wakeChip').className='chip '+('wakeLock'in navigator?'on':'off');
setPhase('HPS5 LISTO','on');setInterval(updateMetrics,500);window.addEventListener('pagehide',()=>{stopDisplay();stopCamera();releaseWake();});if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});slog('HPS5 StateFlow cargado · sin wrappers de timers.');
})();