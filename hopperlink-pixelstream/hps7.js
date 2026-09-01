(() => {
'use strict';

const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();

const MAGIC = [0x48,0x50,0x53,0x37]; // HPS7
const VERSION = 7;
const HEADER = 28;
const PILOT_CELLS = 32;
const CONTROL_GRID = 56;
const BASE_CHUNK = 360;
const DATA_GRIDS = [56,64,72];
const ALL_GRIDS = [56,64,72];
const BITS_OPTIONS = [2,3,4];
const DATA_MIN = .12, DATA_MAX = .88;
const MARKER_KEYS = ['tl','tr','bl','br'];
const MARKER_NORM = {tl:[.06,.06],tr:[.94,.06],bl:[.06,.94],br:[.94,.94]};
const TYPE = {HELLO:1,DATA:2,PASS_END:3,NACK:4,COMPLETE:5};
const SPEED = {
  compatible:{label:'Compatible',fps:8,repeat:2,hint:'Compatible · 8 fps · repetición 2 · máximo margen óptico.'},
  balanced:{label:'Balanceado',fps:12,repeat:1,hint:'Balanceado · 12 imágenes/s · recomendado si hay movimiento o brillo irregular.'},
  turbo:{label:'Turbo',fps:15,repeat:1,hint:'Turbo · 15 imágenes/s · recomendado con grid 56.'},
  optical:{label:'Ultra Optical',fps:18,repeat:1,hint:'Ultra Optical · 18 imágenes/s · úsalo solo con LOCK estable.'}
};
const TXS={IDLE:'IDLE',PREPARED:'PREPARED',HELLO:'HELLO_HOLD',SENDING:'SENDING',PASS_END:'PASS_END_HOLD',LISTEN:'LISTEN_CONTROL',NACK_READY:'NACK_READY',DONE:'DONE'};
const RXS={IDLE:'IDLE',CAMERA:'RX_CAMERA',LOCKED:'SESSION_LOCKED',RECEIVING:'RECEIVING',NACK:'NACK_SCREEN',COMPLETE:'COMPLETE_SCREEN',WAIT_REPAIR:'WAIT_REPAIR',DONE:'DONE'};

const CONTROL_PALETTE = [
  [26,26,26],[92,92,92],[164,164,164],[236,236,236]
];
const HUE_BASES = [
  [1.00,.14,.07],
  [.07,1.00,.16],
  [.07,.24,1.00],
  [1.00,.07,.70]
];
const LEVELS_3 = [.58,.94];
const LEVELS_4 = [.48,.64,.80,.96];
const MARKER_TARGETS = [
  [.03,.485,.485],
  [.485,.03,.485],
  [.485,.485,.03],
  [.03,.68,.29]
];

let txState=TXS.IDLE, rxState=RXS.IDLE;
let tx=null, rx=freshRx();
let cameraStream=null, cameraMode='idle';
let scanHandle=null, scanMode='none', scanGeneration=0;
let wakeLock=null, controlRx=null, currentOverlayAction=null;
let txRunToken=0;
let trackedH=null, trackedMarkers=null, trackedFails=0, trackedSuccess=0;
let markerMemory=null;
let lastCaptureW=1,lastCaptureH=1,lastPhoto=null;

function freshRx(){
  return {
    session:null,total:0,dataGrid:56,preferredBits:4,lastBits:4,autoMod:true,
    fileCrc:0,fileSize:0,chunks:new Map(),errors:0,lastPassRound:-1,round:0,
    startedAt:0,lastCount:0,lastTs:0,emaRate:0,complete:null,
    passStartCount:0,lastPassReceived:0
  };
}
function now(){return new Date().toLocaleTimeString();}
function log(el,msg){if(!el)return;el.textContent=`[${now()}] ${msg}\n`+el.textContent.slice(0,9000);}
function slog(msg){log($('sendLog'),msg);} function rlog(msg){log($('rxLog'),msg);}
function setPhase(text,kind=''){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip '+(kind||'');}}
function fmtBytes(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';return(n/1048576).toFixed(2)+' MB';}
function fmtTime(sec){if(!Number.isFinite(sec)||sec<0)return'—';sec=Math.round(sec);const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}
function u16(n){return[(n>>>8)&255,n&255];}
function u32(n){return[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];}
function readU16(a,o){return(a[o]<<8)|a[o+1];}
function readU32(a,o){return((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0);}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),out=new Uint8Array(n);let p=0;for(const a of arrs){out.set(a,p);p+=a.length;}return out;}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1;}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0;}return t;})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}

function speedProfile(){return SPEED[$('speedMode')?.value]||SPEED.turbo;}
function modulationSelection(){
  const v=$('modulationMode')?.value||'auto4';
  if(v==='gray2')return{bits:2,auto:false,label:'Robust Gray 2-bit'};
  if(v==='color3')return{bits:3,auto:false,label:'Color 3-bit'};
  return{bits:4,auto:true,label:'Adaptive Color 4-bit'};
}
function symbolCount(bits){return 1<<bits;}
function pilotPositions(grid){
  const out=[];
  const add=(row,col)=>{for(let i=0;i<8;i++)out.push(row*grid+col+i);};
  add(0,0);add(0,grid-8);add(grid-1,0);add(grid-1,grid-8);
  return out;
}
function pilotEntries(grid,bits){
  const n=symbolCount(bits),pos=pilotPositions(grid);
  return pos.map((idx,i)=>[idx,i%n]);
}
function pilotMap(grid,bits){return new Map(pilotEntries(grid,bits));}
function rawCapacity(grid,bits){return Math.floor((grid*grid-PILOT_CELLS)*bits/8);}
function payloadCapacity(grid,bits){return rawCapacity(grid,bits)-HEADER;}
function maxChunksPerVisual(grid,bits){
  return Math.max(1,Math.floor((payloadCapacity(grid,bits)-1)/(BASE_CHUNK+6)));
}
function projectedThroughput(grid,bits,sp){return maxChunksPerVisual(grid,bits)*BASE_CHUNK*sp.fps/sp.repeat;}
function updateModeHint(){
  const sp=speedProfile(),grid=Number($('gridSize')?.value||56),mod=modulationSelection();
  const chunks=maxChunksPerVisual(grid,mod.bits),bps=projectedThroughput(grid,mod.bits,sp),six=6*1024*1024/Math.max(1,bps);
  if($('speedHint'))$('speedHint').textContent=sp.hint;
  if($('modulationHint'))$('modulationHint').textContent=`${mod.label} · ${1<<mod.bits} símbolos · ${mod.bits} bits/celda · ${chunks} bloques lógicos por imagen.`;
  if($('throughputHint'))$('throughputHint').textContent=`Teórico útil aprox.: ${(bps/1024).toFixed(1)} KiB/s · 6 MiB ≈ ${fmtTime(six)} antes de reparaciones.`;
  if($('capacity'))$('capacity').textContent=`${BASE_CHUNK} B lógico`;
}

function makePacket(type,session,round,index,total,payload,grid,bits){
  const h=new Uint8Array(HEADER);
  h.set(MAGIC,0);h[4]=VERSION;h[5]=type;h[6]=grid;h[7]=bits;
  h.set(u32(session),8);h.set(u16(round),12);h.set(u32(index),14);h.set(u32(total),18);h.set(u16(payload.length),22);
  h.set(u32(crc32(concat(h.slice(0,24),payload))),24);
  return concat(h,payload);
}
function parsePacket(bytes){
  if(bytes.length<HEADER)return null;
  for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;
  if(bytes[4]!==VERSION)return null;
  const type=bytes[5],grid=bytes[6],bits=bytes[7],session=readU32(bytes,8),round=readU16(bytes,12),
        index=readU32(bytes,14),total=readU32(bytes,18),len=readU16(bytes,22),expected=readU32(bytes,24);
  if(!Object.values(TYPE).includes(type)||!ALL_GRIDS.includes(grid)||!BITS_OPTIONS.includes(bits)||!session||!total||round>4095)return null;
  if(type!==TYPE.DATA&&bits!==2)return null;
  if(type===TYPE.DATA&&index>=total)return null;
  if((type===TYPE.NACK||type===TYPE.COMPLETE)&&index>=total)return null;
  if((type===TYPE.HELLO||type===TYPE.PASS_END)&&index!==0)return null;
  if(len>bytes.length-HEADER||len>payloadCapacity(grid,bits))return null;
  const payload=bytes.slice(HEADER,HEADER+len),actual=crc32(concat(bytes.slice(0,24),payload));
  if(actual!==expected)return{bad:true};
  return{type,grid,bits,session,round,index,total,payload};
}

function palette(bits){
  if(bits===2)return CONTROL_PALETTE;
  const lev=bits===3?LEVELS_3:LEVELS_4,out=[],levels=bits===3?2:4;
  for(let li=0;li<levels;li++){
    for(let h=0;h<4;h++){
      const b=HUE_BASES[h],s=lev[li];
      out.push(b.map(v=>Math.round(clamp(v*s*255,0,255))));
    }
  }
  return out;
}
function rawToSymbols(raw,grid,bits){
  const out=new Uint8Array(grid*grid),pilots=pilotMap(grid,bits);
  for(const[i,s]of pilots)out[i]=s;
  let bitPos=0,totalBits=raw.length*8;
  for(let i=0;i<out.length;i++){
    if(pilots.has(i))continue;
    let v=0;
    for(let k=0;k<bits;k++){
      v<<=1;
      if(bitPos<totalBits){
        const bi=bitPos>>3,shift=7-(bitPos&7);
        v|=(raw[bi]>>shift)&1;
      }
      bitPos++;
    }
    out[i]=v;
  }
  return out;
}
function symbolsToBytes(sym,grid,bits){
  const pilots=pilotMap(grid,bits),data=[];
  for(let i=0;i<sym.length;i++)if(!pilots.has(i))data.push(sym[i]);
  const out=new Uint8Array(Math.floor(data.length*bits/8));
  let bitPos=0;
  for(const val of data){
    for(let k=bits-1;k>=0;k--){
      if(bitPos>=out.length*8)break;
      const bit=(val>>k)&1,bi=bitPos>>3,shift=7-(bitPos&7);
      out[bi]|=bit<<shift;bitPos++;
    }
  }
  return out;
}
function renderPacket(raw,grid,bits){
  const c=$('pixelCanvas');c.width=grid;c.height=grid;
  const ctx=c.getContext('2d',{alpha:false}),sym=rawToSymbols(raw,grid,bits),pal=palette(bits),img=ctx.createImageData(grid,grid);
  for(let i=0;i<sym.length;i++){
    const rgb=pal[sym[i]]||pal[0],p=i*4;
    img.data[p]=rgb[0];img.data[p+1]=rgb[1];img.data[p+2]=rgb[2];img.data[p+3]=255;
  }
  ctx.putImageData(img,0,0);
}

function openOverlay(meta,bottom,actionLabel,action){
  $('streamOverlay').style.display='flex';document.body.style.overflow='hidden';
  $('streamMeta').textContent=meta;$('streamBottom').textContent=bottom;
  const b=$('overlayActionBtn');b.textContent=actionLabel||'';b.style.display=actionLabel?'inline-flex':'none';
  currentOverlayAction=action||null;
}
function closeOverlay(){if($('streamOverlay'))$('streamOverlay').style.display='none';document.body.style.overflow='';currentOverlayAction=null;}
async function getWake(){try{if(navigator.wakeLock?.request&&!wakeLock)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
function releaseWake(){if(wakeLock){Promise.resolve(wakeLock.release?.()).catch(()=>{});wakeLock=null;}}

function bundleGroups(indices,bits){
  const cap=payloadCapacity(tx.grid,bits),groups=[];
  let entries=[],used=1;
  const flush=()=>{
    if(!entries.length)return;
    const parts=[new Uint8Array([entries.length])];
    for(const e of entries)parts.push(new Uint8Array(u32(e.idx)),new Uint8Array(u16(e.data.length)),e.data);
    groups.push({first:entries[0].idx,payload:concat(...parts),count:entries.length});
    entries=[];used=1;
  };
  for(const idx of indices){
    const data=tx.chunks[idx],need=6+data.length;
    if(entries.length&&used+need>cap)flush();
    if(1+need>cap)throw new Error(`Bloque lógico ${idx} no cabe en modulación ${bits}-bit.`);
    entries.push({idx,data});used+=need;
  }
  flush();return groups;
}
function parseBundle(payload,total){
  if(!payload.length)return null;
  const count=payload[0];if(!count||count>16)return null;
  let p=1,out=[];
  for(let i=0;i<count;i++){
    if(p+6>payload.length)return null;
    const idx=readU32(payload,p),len=readU16(payload,p+4);p+=6;
    if(idx>=total||len>BASE_CHUNK||p+len>payload.length)return null;
    out.push({idx,data:payload.slice(p,p+len)});p+=len;
  }
  return out;
}

async function prepareTransfer(){
  try{
    cancelProtocol(false);
    const f=$('fileInput')?.files?.[0];if(!f){alert('Selecciona un archivo.');return;}
    const grid=Number($('gridSize').value),mod=modulationSelection(),fileBytes=new Uint8Array(await f.arrayBuffer());
    const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));
    if(meta.length>65535)throw new Error('Metadata demasiado grande.');
    const pkg=concat(new Uint8Array(u16(meta.length)),meta,fileBytes),chunks=[];
    for(let p=0;p<pkg.length;p+=BASE_CHUNK)chunks.push(pkg.slice(p,Math.min(pkg.length,p+BASE_CHUNK)));
    tx={session:randomId(),grid,preferredBits:mod.bits,activeBits:mod.bits,autoMod:mod.auto,f,fileBytes,fileCrc:crc32(fileBytes),chunks,total:chunks.length,round:0,pendingMissing:null,repairBits:mod.bits};
    txState=TXS.PREPARED;
    $('fileSize').textContent=fmtBytes(f.size);$('frameCount').textContent=tx.total;$('sendBtn').disabled=false;$('txRepairBtn').style.display='none';
    updateModeHint();
    const visual=Math.ceil(tx.total/maxChunksPerVisual(grid,mod.bits));
    slog(`Preparado HPS7 · ${f.name} · ${tx.total} bloques lógicos · ≈${visual} imágenes DATA · ${mod.bits}-bit.`);
    setPhase('EMISOR · HPS7 PREPARADO','on');
  }catch(e){slog('ERROR preparando: '+(e?.message||e));alert('No se pudo preparar: '+(e?.message||e));}
}
function helloPayload(){
  return concat(new Uint8Array([tx.grid,tx.preferredBits,tx.autoMod?1:0]),new Uint8Array(u16(BASE_CHUNK)),new Uint8Array(u32(tx.fileCrc)),new Uint8Array(u32(tx.fileBytes.length)));
}
function passEndPayload(bits){
  return concat(new Uint8Array([tx.grid,bits]),new Uint8Array(u32(tx.fileCrc)));
}
function showHello(){
  if(!tx)return;stopCamera();getWake();txState=TXS.HELLO;
  const raw=makePacket(TYPE.HELLO,tx.session,0,0,tx.total,helloPayload(),CONTROL_GRID,2);
  openOverlay(`HPS7 HELLO · ${tx.preferredBits}-bit DATA`,'Control gris robusto. Espera “Sesión bloqueada” en el receptor.','Receptor listo · Iniciar HPS7',()=>sendDataPass(Array.from({length:tx.total},(_,i)=>i),0,false,tx.preferredBits));
  renderPacket(raw,CONTROL_GRID,2);setPhase('EMISOR · HELLO ROBUSTO','mid');
  slog(`HELLO fijo · DATA grid ${tx.grid} · modulación inicial ${tx.preferredBits}-bit.`);
}
function repairPasses(n){return n<=100?3:n<=300?2:1;}
async function sendDataPass(indices,round,isRepair,bits){
  if(!tx||!indices.length)return;
  const token=++txRunToken;closeOverlay();stopCamera();getWake();txState=TXS.SENDING;tx.round=round;tx.activeBits=bits;
  const sp=speedProfile(),passes=isRepair?repairPasses(indices.length):1,frameMs=Math.max(45,Math.round(1000/sp.fps));
  const groups=bundleGroups(indices,bits);
  openOverlay(`HPS7 · R${round+1} · ${bits}-bit`,'Transmitiendo símbolos ópticos calibrados…',null,null);
  setPhase(isRepair?`EMISOR · REPAIR ${bits}-BIT`:`EMISOR · DATA ${bits}-BIT`,'on');
  if(isRepair){
    const g=groups[0],raw=makePacket(TYPE.DATA,tx.session,round,g.first,tx.total,g.payload,tx.grid,bits);
    renderPacket(raw,tx.grid,bits);
    $('streamMeta').textContent=`REPAIR ${bits}-bit · primer paquete fijo 3s`;
    $('streamBottom').textContent=`${g.count} bloque(s) lógicos visibles mientras la cámara estabiliza exposición/color.`;
    await sleep(3000);if(token!==txRunToken)return;
  }
  for(let pass=1;pass<=passes;pass++){
    const repeats=pass===1?sp.repeat:1;
    for(let gi=0;gi<groups.length;gi++){
      const g=groups[gi],raw=makePacket(TYPE.DATA,tx.session,round,g.first,tx.total,g.payload,tx.grid,bits);
      for(let r=0;r<repeats;r++){
        if(token!==txRunToken)return;
        renderPacket(raw,tx.grid,bits);
        $('streamMeta').textContent=isRepair?`REPAIR ${pass}/${passes} · ${gi+1}/${groups.length} · ${bits}-bit`:`DATA ${gi+1}/${groups.length} · ${bits}-bit`;
        $('streamBottom').textContent=`Grid ${tx.grid} · ${bits} bits/celda · ${g.count} bloque(s)/imagen · ${sp.fps} img/s`;
        await sleep(frameMs);
      }
    }
  }
  if(token!==txRunToken)return;showPassEnd(round,bits);
}
function showPassEnd(round,bits){
  txState=TXS.PASS_END;
  const raw=makePacket(TYPE.PASS_END,tx.session,round,0,tx.total,passEndPayload(bits),CONTROL_GRID,2);
  openOverlay(`PASS_END · R${round+1}`,'Control vuelve a gris 2-bit. Espera NACK/COMPLETE.','Receptor mostró control · Leer NACK/COMPLETE',()=>listenForControl(round));
  renderPacket(raw,CONTROL_GRID,2);setPhase('EMISOR · PASS_END ROBUSTO','mid');
  slog(`PASS_END · última ronda ${bits}-bit.`);
}
async function listenForControl(round){
  closeOverlay();releaseWake();txState=TXS.LISTEN;controlRx={session:tx.session,round,kind:0,totalParts:0,parts:new Map()};
  try{await startCamera('senderControl');setPhase('EMISOR · LEYENDO CONTROL','mid');slog('Cámara lista para NACK/COMPLETE HPS7.');}catch(e){slog('ERROR cámara control: '+e.message);}
}
function sendRepair(){
  if(!tx?.pendingMissing?.length)return;
  const list=tx.pendingMissing.slice(),bits=tx.repairBits||tx.activeBits;
  tx.pendingMissing=null;$('txRepairBtn').style.display='none';
  sendDataPass(list,tx.round+1,true,bits);
}

function resetRxSession(session,total,dataGrid,bits,autoMod,fileCrc=0,fileSize=0){
  rx=freshRx();rx.session=session;rx.total=total;rx.dataGrid=dataGrid;rx.preferredBits=bits;rx.lastBits=bits;rx.autoMod=autoMod;rx.fileCrc=fileCrc;rx.fileSize=fileSize;
  $('rxFrames').textContent='0';$('rxTotal').textContent=total;$('rxMissing').textContent=total;$('rxBar').style.width='0%';$('receivedBox').style.display='none';
  trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;
}
function handleHello(p){
  if(cameraMode!=='receiverData'||p.grid!==CONTROL_GRID||p.bits!==2||p.payload.length<13)return;
  const dataGrid=p.payload[0],bits=p.payload[1],autoMod=!!p.payload[2],base=readU16(p.payload,3),fileCrc=readU32(p.payload,5),fileSize=readU32(p.payload,9);
  if(!DATA_GRIDS.includes(dataGrid)||!BITS_OPTIONS.includes(bits)||base!==BASE_CHUNK)return;
  if(rx.session===null){
    resetRxSession(p.session,p.total,dataGrid,bits,autoMod,fileCrc,fileSize);rxState=RXS.LOCKED;rx.passStartCount=0;
    rlog(`HPS7 sesión bloqueada · ${p.total} bloques · grid ${dataGrid} · ${bits}-bit${autoMod?' adaptativo':''} · ${fmtBytes(fileSize)}.`);
    setPhase(`RECEPTOR · LOCK ${bits}-BIT`,'on');
  }else if(rx.session!==p.session)rlog('HELLO de otra sesión ignorado.');
}
function handleData(p){
  if(cameraMode!=='receiverData'||rx.session===null)return;
  if(p.session!==rx.session||p.total!==rx.total||p.grid!==rx.dataGrid||!BITS_OPTIONS.includes(p.bits)){rx.errors++;updateErrors();return;}
  const bundle=parseBundle(p.payload,rx.total);if(!bundle){rx.errors++;updateErrors();return;}
  rxState=RXS.RECEIVING;rx.round=Math.max(rx.round,p.round);rx.lastBits=p.bits;
  let added=0;
  for(const e of bundle)if(!rx.chunks.has(e.idx)){rx.chunks.set(e.idx,e.data);added++;}
  if(added){
    $('rxFrames').textContent=rx.chunks.size;$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);
    $('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';updateMetrics();
  }
  setPhase(`RECEPTOR · ${p.bits}-BIT · ${rx.chunks.size}/${rx.total}`,'on');
}
function makeMissingBitmap(){
  const bits=new Uint8Array(Math.ceil(rx.total/8));let missing=0;
  for(let i=0;i<rx.total;i++)if(!rx.chunks.has(i)){bits[i>>3]|=1<<(i&7);missing++;}
  return{bits,missing};
}
function parseMissingBitmap(bits,total){const out=[];for(let i=0;i<total;i++)if(bits[i>>3]&(1<<(i&7)))out.push(i);return out;}
function suggestedRepairBits(missing,lastBits){
  if(!rx.autoMod)return lastBits;
  const ratio=missing/Math.max(1,rx.total);
  const receivedThisPass=Math.max(0,rx.chunks.size-rx.passStartCount);
  const progress=receivedThisPass/Math.max(1,missing+receivedThisPass);
  if(lastBits===4){
    if(ratio>.32||progress<.45)return 2;
    if(ratio>.12||progress<.72)return 3;
  }
  if(lastBits===3&&(ratio>.28||progress<.60))return 2;
  return lastBits;
}
function handlePassEnd(p){
  if(cameraMode!=='receiverData'||p.grid!==CONTROL_GRID||p.bits!==2||p.payload.length<6)return;
  const dataGrid=p.payload[0],lastBits=p.payload[1],fileCrc=readU32(p.payload,2);
  if(rx.session===null){resetRxSession(p.session,p.total,dataGrid,lastBits,true,fileCrc,0);rlog('PASS_END recuperó sesión; se solicitará todo lo faltante.');}
  if(p.session!==rx.session||p.total!==rx.total||dataGrid!==rx.dataGrid){rx.errors++;updateErrors();return;}
  if(p.round<=rx.lastPassRound)return;
  rx.lastPassRound=p.round;rx.round=p.round;rx.lastBits=lastBits;if(fileCrc&&!rx.fileCrc)rx.fileCrc=fileCrc;
  const{missing}=makeMissingBitmap(),suggest=suggestedRepairBits(missing,lastBits);
  const gained=Math.max(0,rx.chunks.size-rx.passStartCount);
  rlog(`PASS_END R${p.round+1}: +${gained} bloques · ${rx.chunks.size}/${rx.total} · faltan ${missing} · siguiente ${suggest}-bit.`);
  rx.passStartCount=rx.chunks.size;stopCamera();
  if(missing===0){
    const assembled=assembleFile();
    if(!assembled){rlog('CRC/ensamblado falló; solicitando reparación robusta.');showNack(p.round,2);}
    else showComplete(p.round,assembled);
  }else showNack(p.round,suggest);
}
function controlPayloadNack(suggestBits){
  const{bits}=makeMissingBitmap();
  return concat(new Uint8Array([rx.dataGrid,suggestBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(rx.fileCrc)),bits);
}
function splitControl(type,round,payload){
  const cap=payloadCapacity(CONTROL_GRID,2),parts=[];
  for(let p=0;p<payload.length;p+=cap)parts.push(payload.slice(p,Math.min(payload.length,p+cap)));
  return parts.map((part,i)=>makePacket(type,rx.session,round,i,parts.length,part,CONTROL_GRID,2));
}
function repeatControl(packets,metaFn,period=450){
  let active=true,i=0;const token=++txRunToken;
  const loop=async()=>{while(active&&token===txRunToken&&$('streamOverlay').style.display!=='none'){renderPacket(packets[i],CONTROL_GRID,2);$('streamMeta').textContent=metaFn(i,packets.length);i=(i+1)%packets.length;await sleep(period);}};
  loop();return()=>{active=false;};
}
function showNack(round,suggestBits){
  rxState=RXS.NACK;const packets=splitControl(TYPE.NACK,round,controlPayloadNack(suggestBits)),missing=rx.total-rx.chunks.size;
  openOverlay(`NACK · ${missing} faltante(s) · repair ${suggestBits}-bit`,'Control gris robusto. Déjalo visible hasta que el emisor lo lea.','Emisor leyó NACK · Volver a cámara',()=>receiverWaitRepair());
  repeatControl(packets,(i,n)=>`NACK · R${round+1} · ${i+1}/${n} · sugiere ${suggestBits}-bit`);
  setPhase(`RECEPTOR · NACK ${missing} · ${suggestBits}-BIT`,'mid');
  rlog(`NACK HPS7 · ${missing} faltantes · reparación sugerida ${suggestBits}-bit.`);
}
function showComplete(round,assembled){
  rxState=RXS.COMPLETE;rx.complete=assembled;
  const payload=concat(new Uint8Array([rx.dataGrid,rx.lastBits]),new Uint8Array(u32(rx.total)),new Uint8Array(u32(crc32(assembled.data))));
  const packets=splitControl(TYPE.COMPLETE,round,payload);renderReceived(assembled);
  openOverlay('COMPLETE','CRC final verificado. Déjalo hasta confirmación del emisor.','Emisor confirmó · Finalizar receptor',()=>{closeOverlay();rxState=RXS.DONE;setPhase('RECEPTOR · COMPLETADO','on');});
  repeatControl(packets,()=>`COMPLETE · ${rx.session.toString(16)}`,600);setPhase('RECEPTOR · COMPLETE','on');
}
async function receiverWaitRepair(){
  closeOverlay();rxState=RXS.WAIT_REPAIR;rx.passStartCount=rx.chunks.size;
  try{await startCamera('receiverData');setPhase(`RECEPTOR · ESPERANDO REPAIR`,'mid');rlog('Cámara lista; conserva todos los bloques ya recibidos.');}catch(e){rlog('ERROR cámara: '+e.message);}
}
function handleControlPart(p){
  if(cameraMode!=='senderControl'||!tx||p.session!==tx.session||p.grid!==CONTROL_GRID||p.bits!==2)return;
  if(p.type!==TYPE.NACK&&p.type!==TYPE.COMPLETE)return;
  if(!controlRx||controlRx.kind!==p.type||controlRx.round!==p.round||controlRx.totalParts!==p.total)controlRx={session:p.session,round:p.round,kind:p.type,totalParts:p.total,parts:new Map()};
  if(!controlRx.parts.has(p.index))controlRx.parts.set(p.index,p.payload);
  setPhase(`EMISOR · CONTROL ${controlRx.parts.size}/${controlRx.totalParts}`,'mid');
  if(controlRx.parts.size!==controlRx.totalParts)return;
  const parts=[];for(let i=0;i<controlRx.totalParts;i++){if(!controlRx.parts.has(i))return;parts.push(controlRx.parts.get(i));}
  const payload=concat(...parts);stopCamera();
  if(p.type===TYPE.NACK){
    if(payload.length<10)return;
    const dataGrid=payload[0],suggestBits=payload[1],dataTotal=readU32(payload,2),fileCrc=readU32(payload,6);
    if(dataGrid!==tx.grid||dataTotal!==tx.total||(fileCrc&&fileCrc!==tx.fileCrc)||!BITS_OPTIONS.includes(suggestBits)){slog('NACK rechazado: identidad HPS7 no coincide.');return;}
    const missing=parseMissingBitmap(payload.slice(10),dataTotal);
    tx.pendingMissing=missing;tx.round=p.round;tx.repairBits=tx.autoMod?suggestBits:tx.preferredBits;txState=TXS.NACK_READY;
    $('txRepairBtn').style.display='inline-flex';$('txRepairBtn').textContent=`Enviar Repair Burst (${missing.length}) · ${tx.repairBits}-bit`;
    setPhase(`EMISOR · ${missing.length} FALTANTES · ${tx.repairBits}-BIT`,'mid');
    slog(`NACK válido · ${missing.length} faltantes · reparación ${tx.repairBits}-bit · ${repairPasses(missing.length)} pasada(s).`);
  }else{
    if(payload.length<10)return;
    const dataGrid=payload[0],lastBits=payload[1],dataTotal=readU32(payload,2),fileCrc=readU32(payload,6);
    const ok=dataGrid===tx.grid&&dataTotal===tx.total&&fileCrc===tx.fileCrc&&BITS_OPTIONS.includes(lastBits);
    txState=ok?TXS.DONE:TXS.NACK_READY;setPhase(ok?'EMISOR · COMPLETADO':'EMISOR · COMPLETE INVÁLIDO',ok?'on':'mid');
    slog(ok?'HPS7 COMPLETE confirmado por CRC.':'COMPLETE inválido.');
  }
}

function assembleFile(){
  if(!rx.total||rx.chunks.size!==rx.total)return null;
  const parts=[];for(let i=0;i<rx.total;i++){if(!rx.chunks.has(i))return null;parts.push(rx.chunks.get(i));}
  const pkg=concat(...parts),ml=readU16(pkg,0);if(ml<=0||ml>pkg.length-2)return null;
  let meta;try{meta=JSON.parse(dec.decode(pkg.slice(2,2+ml)));}catch{return null;}
  const data=pkg.slice(2+ml,2+ml+meta.size);if(data.length!==meta.size)return null;
  if(rx.fileCrc&&crc32(data)!==rx.fileCrc)return null;
  return{meta,data};
}
function renderReceived(a){
  const blob=new Blob([a.data],{type:a.meta.type||'application/octet-stream'}),url=URL.createObjectURL(blob),box=$('receivedBox');
  box.style.display='block';
  box.innerHTML=`<b>✓ Archivo reconstruido HPS7</b><br><span class="mono">${escapeHtml(a.meta.name)}</span><br><span class="small">${fmtBytes(a.data.length)} · CRC ${crc32(a.data).toString(16)}</span><br><br><a class="btn good" style="display:inline-block;text-decoration:none" href="${url}" download="${escapeAttr(a.meta.name)}">Guardar archivo</a>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[m]));}
function escapeAttr(s){return String(s).replace(/"/g,'');}

function captureFrame(){
  const v=$('video'),c=$('capture');if(!v.videoWidth)return null;
  const maxW=1080,scale=Math.min(1,maxW/v.videoWidth),w=Math.max(320,Math.round(v.videoWidth*scale)),h=Math.max(240,Math.round(v.videoHeight*scale));
  c.width=w;c.height=h;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,w,h);
  lastCaptureW=w;lastCaptureH=h;return{w,h,data:ctx.getImageData(0,0,w,h).data};
}
function photoStats(frame){
  const vals=[],chrom=[];const step=Math.max(6,Math.floor(Math.min(frame.w,frame.h)/70));
  for(let y=step>>1;y<frame.h;y+=step)for(let x=step>>1;x<frame.w;x+=step){
    const p=(y*frame.w+x)*4,r=frame.data[p],g=frame.data[p+1],b=frame.data[p+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);
    vals.push((r+g+b)/3);chrom.push((mx-mn)/Math.max(1,mx));
  }
  vals.sort((a,b)=>a-b);chrom.sort((a,b)=>a-b);
  const q=(a,f)=>a[Math.min(a.length-1,Math.max(0,Math.floor(a.length*f)))]||0;
  return{p10:q(vals,.10),p50:q(vals,.50),p90:q(vals,.90),contrast:q(vals,.90)-q(vals,.10),sat50:q(chrom,.50)};
}
function markerClass(r,g,b,st){
  const sum=r+g+b;if(sum<18)return 0;
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),sat=(mx-mn)/Math.max(1,mx),lum=sum/3;
  const minLum=Math.max(7,st.p10*.45),minSat=st.contrast<45?.075:.10;
  if(lum<minLum||sat<minSat)return 0;
  const nr=r/sum,ng=g/sum,nb=b/sum;
  let best=-1,bs=99,second=99;
  for(let i=0;i<4;i++){
    const t=MARKER_TARGETS[i],d=Math.hypot(nr-t[0],ng-t[1],nb-t[2]);
    if(d<bs){second=bs;bs=d;best=i;}else if(d<second)second=d;
  }
  const limit=st.contrast<45?.30:.265;
  return(bs<.205||(bs<limit&&second-bs>.010))?best+1:0;
}
function regionLuma(frame,x0,y0,x1,y1,mode){
  const sx=Math.max(1,Math.floor((x1-x0+1)/8)),sy=Math.max(1,Math.floor((y1-y0+1)/8));
  let s=0,n=0;
  for(let y=y0;y<=y1;y+=sy)for(let x=x0;x<=x1;x+=sx){
    const nx=(x-x0)/Math.max(1,x1-x0),ny=(y-y0)/Math.max(1,y1-y0);
    const center=nx>.28&&nx<.72&&ny>.28&&ny<.72;
    if((mode==='center')!==center)continue;
    const p=(clamp(y,0,frame.h-1)*frame.w+clamp(x,0,frame.w-1))*4;
    s+=(frame.data[p]+frame.data[p+1]+frame.data[p+2])/3;n++;
  }
  return n?s/n:0;
}
function candidateFromComp(frame,type,count,minX,minY,maxX,maxY,stride,st){
  const x0=Math.max(0,minX*stride),y0=Math.max(0,minY*stride),x1=Math.min(frame.w-1,(maxX+1)*stride-1),y1=Math.min(frame.h-1,(maxY+1)*stride-1);
  const w=x1-x0+1,h=y1-y0+1,aspect=w/Math.max(1,h),rel=Math.max(w,h)/Math.min(frame.w,frame.h);
  const center=regionLuma(frame,x0,y0,x1,y1,'center'),ring=regionLuma(frame,x0,y0,x1,y1,'ring');
  const contrast=(ring-center)/Math.max(18,ring),square=Math.exp(-Math.abs(Math.log(Math.max(.01,aspect)))*1.8);
  const fill=count/Math.max(1,((maxX-minX+1)*(maxY-minY+1)));
  const cx=(x0+x1)/2,cy=(y0+y1)/2;
  const q=[
    cx<frame.w*.62&&cy<frame.h*.62,
    cx>frame.w*.38&&cy<frame.h*.62,
    cx<frame.w*.62&&cy>frame.h*.38,
    cx>frame.w*.38&&cy>frame.h*.38
  ][type-1];
  const valid=aspect>.48&&aspect<2.08&&rel>.022&&rel<.34&&contrast>.08&&q;
  const score=(valid?120:0)+square*28+clamp(contrast,0,1)*55+clamp(fill,0,1)*12+Math.min(25,count/3);
  return{type,count,x0,y0,x1,y1,cx,cy,aspect,contrast,score,valid};
}
function setGeometryScore(set,frame){
  const[tl,tr,bl,br]=set;
  if(!(tl.cx<tr.cx&&bl.cx<br.cx&&tl.cy<bl.cy&&tr.cy<br.cy))return-Infinity;
  const top=dist(tl,tr),bot=dist(bl,br),left=dist(tl,bl),right=dist(tr,br);
  const width=(top+bot)/2,height=(left+right)/2,minDim=Math.min(frame.w,frame.h);
  if(width<minDim*.10||height<minDim*.10)return-Infinity;
  const ratio=width/Math.max(1,height);if(ratio<.38||ratio>2.65)return-Infinity;
  const d1=dist(tl,br),d2=dist(tr,bl),diag=Math.min(d1,d2)/Math.max(d1,d2);
  const sideBalance=Math.min(top,bot)/Math.max(top,bot)*Math.min(left,right)/Math.max(left,right);
  const sizes=set.map(c=>Math.sqrt((c.x1-c.x0+1)*(c.y1-c.y0+1))),sizeBal=Math.min(...sizes)/Math.max(...sizes);
  let mem=0;
  if(markerMemory&&performance.now()-markerMemory.ts<900){
    for(let i=0;i<4;i++){const m=markerMemory.markers[MARKER_KEYS[i]];if(m)mem+=Math.max(0,1-dist({x:set[i].cx,y:set[i].cy},m)/(minDim*.18));}
  }
  return set.reduce((s,c)=>s+c.score,0)+diag*90+sideBalance*60+sizeBal*35+mem*22;
}
function markersFromSet(set){return{tl:{x:set[0].cx,y:set[0].cy},tr:{x:set[1].cx,y:set[1].cy},bl:{x:set[2].cx,y:set[2].cy},br:{x:set[3].cx,y:set[3].cy}};}
function predictMissing(markers,key){
  const m=markers;
  if(key==='br'&&m.tl&&m.tr&&m.bl)return{x:m.tr.x+m.bl.x-m.tl.x,y:m.tr.y+m.bl.y-m.tl.y};
  if(key==='bl'&&m.tl&&m.tr&&m.br)return{x:m.tl.x+m.br.x-m.tr.x,y:m.tl.y+m.br.y-m.tr.y};
  if(key==='tr'&&m.tl&&m.bl&&m.br)return{x:m.tl.x+m.br.x-m.bl.x,y:m.tl.y+m.br.y-m.bl.y};
  if(key==='tl'&&m.tr&&m.bl&&m.br)return{x:m.tr.x+m.bl.x-m.br.x,y:m.tr.y+m.bl.y-m.br.y};
  return null;
}
function detectFiducials(frame){
  const st=photoStats(frame);lastPhoto=st;
  const stride=Math.max(2,Math.floor(Math.min(frame.w,frame.h)/210)),gw=Math.ceil(frame.w/stride),gh=Math.ceil(frame.h/stride),mask=new Uint8Array(gw*gh);
  for(let gy=0;gy<gh;gy++){const y=Math.min(frame.h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(frame.w-1,gx*stride+(stride>>1)),p=(y*frame.w+x)*4;mask[gy*gw+gx]=markerClass(frame.data[p],frame.data[p+1],frame.data[p+2],st);}}
  const seen=new Uint8Array(mask.length),byType=[[],[],[],[]];
  for(let idx=0;idx<mask.length;idx++){
    const type=mask[idx];if(!type||seen[idx])continue;
    const stack=[idx];seen[idx]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    while(stack.length){
      const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;
        const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]===type){seen[ni]=1;stack.push(ni);}
      }
    }
    if(count<4)continue;
    const c=candidateFromComp(frame,type,count,minX,minY,maxX,maxY,stride,st);if(c.valid)byType[type-1].push(c);
  }
  for(const a of byType)a.sort((a,b)=>b.score-a.score);
  const lists=byType.map(a=>a.slice(0,4));
  let bestSet=null,bestScore=-Infinity;
  if(lists.every(a=>a.length)){
    for(const tl of lists[0])for(const tr of lists[1])for(const bl of lists[2])for(const br of lists[3]){
      const set=[tl,tr,bl,br],s=setGeometryScore(set,frame);if(s>bestScore){bestScore=s;bestSet=set;}
    }
  }
  let markers=bestSet?markersFromSet(bestSet):{};
  let found=MARKER_KEYS.filter(k=>markers[k]).length;
  if(found===3){
    const missing=MARKER_KEYS.find(k=>!markers[k]),p=predictMissing(markers,missing);
    if(p&&p.x>=0&&p.y>=0&&p.x<frame.w&&p.y<frame.h){markers[missing]=p;found=4;}
  }
  if(found<3&&markerMemory&&performance.now()-markerMemory.ts<650){
    const present=MARKER_KEYS.filter(k=>markers[k]&&markerMemory.markers[k]);
    if(present.length>=2){
      let dx=0,dy=0;for(const k of present){dx+=markers[k].x-markerMemory.markers[k].x;dy+=markers[k].y-markerMemory.markers[k].y;}dx/=present.length;dy/=present.length;
      for(const k of MARKER_KEYS)if(!markers[k]&&markerMemory.markers[k])markers[k]={x:markerMemory.markers[k].x+dx,y:markerMemory.markers[k].y+dy};
      found=MARKER_KEYS.filter(k=>markers[k]).length;
    }
  }
  if(found<4)return{found,markers,photo:st};
  const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>markers[k]),H=computeHomography(src,dst);
  if(!H)return{found,markers,invalid:true,photo:st};
  const q=clamp(Math.round(55+(bestScore>0?Math.min(35,bestScore/25):10)+Math.min(10,st.contrast/10)),0,100);
  return{found,markers,H,quality:q,photo:st};
}
function solveLinear(A,b){
  const n=b.length,M=A.map((r,i)=>r.concat([b[i]]));
  for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}
  return M.map(r=>r[n]);
}
function computeHomography(src,dst){
  const A=[],b=[];for(let i=0;i<4;i++){const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);}
  const h=solveLinear(A,b);return h?[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]:null;
}
function mapPoint(H,x,y){const d=H[6]*x+H[7]*y+H[8];return{x:(H[0]*x+H[1]*y+H[2])/d,y:(H[3]*x+H[4]*y+H[5])/d};}
function rgbAt(frame,x,y,rad){
  const xi=Math.round(x),yi=Math.round(y);if(xi<0||yi<0||xi>=frame.w||yi>=frame.h)return[0,0,0];
  let r=0,g=0,b=0,n=0;
  for(let yy=Math.max(0,yi-rad);yy<=Math.min(frame.h-1,yi+rad);yy++)for(let xx=Math.max(0,xi-rad);xx<=Math.min(frame.w-1,xi+rad);xx++){const p=(yy*frame.w+xx)*4;r+=frame.data[p];g+=frame.data[p+1];b+=frame.data[p+2];n++;}
  return[r/n,g/n,b/n];
}
function sampleGridRGB(frame,grid,H){
  const a=mapPoint(H,DATA_MIN,DATA_MIN),b=mapPoint(H,DATA_MAX,DATA_MIN),c=mapPoint(H,DATA_MIN,DATA_MAX),d=mapPoint(H,DATA_MAX,DATA_MAX);
  const cell=(dist(a,b)+dist(c,d)+dist(a,c)+dist(b,d))/(4*grid),rad=Math.max(0,Math.min(2,Math.floor(cell*.16))),out=new Float32Array(grid*grid*3);
  let k=0;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const nx=DATA_MIN+(x+.5)*(DATA_MAX-DATA_MIN)/grid,ny=DATA_MIN+(y+.5)*(DATA_MAX-DATA_MIN)/grid,p=mapPoint(H,nx,ny),rgb=rgbAt(frame,p.x,p.y,rad);out[k++]=rgb[0];out[k++]=rgb[1];out[k++]=rgb[2];}
  return out;
}
function decodeGray(samples,grid){
  const pilots=pilotEntries(grid,2),sum=[0,0,0,0],cnt=[0,0,0,0];
  for(const[idx,s]of pilots){const p=idx*3,v=(samples[p]+samples[p+1]+samples[p+2])/3;sum[s]+=v;cnt[s]++;}
  const means=sum.map((v,i)=>v/Math.max(1,cnt[i]));if(!(means[0]+3<means[1]&&means[1]+3<means[2]&&means[2]+3<means[3]))return null;
  const sym=new Uint8Array(grid*grid);let err=0;
  for(const[idx,s]of pilots){const p=idx*3,v=(samples[p]+samples[p+1]+samples[p+2])/3;err+=Math.abs(v-means[s]);}
  for(let i=0;i<sym.length;i++){const p=i*3,v=(samples[p]+samples[p+1]+samples[p+2])/3;let best=0,bd=1e9;for(let s=0;s<4;s++){const dd=Math.abs(v-means[s]);if(dd<bd){bd=dd;best=s;}}sym[i]=best;}
  return{bytes:symbolsToBytes(sym,grid,2),quality:clamp(Math.round(100-(err/pilots.length)*1.5),0,100)};
}
function decodeColor(samples,grid,bits){
  const n=1<<bits,pilots=pilotEntries(grid,bits),sum=Array.from({length:n},()=>[0,0,0]),cnt=new Array(n).fill(0);
  for(const[idx,s]of pilots){const p=idx*3;sum[s][0]+=samples[p];sum[s][1]+=samples[p+1];sum[s][2]+=samples[p+2];cnt[s]++;}
  if(cnt.some(c=>!c))return null;
  const cent=sum.map((v,i)=>v.map(x=>x/cnt[i]));
  const mins=[Math.min(...cent.map(c=>c[0])),Math.min(...cent.map(c=>c[1])),Math.min(...cent.map(c=>c[2]))];
  const maxs=[Math.max(...cent.map(c=>c[0])),Math.max(...cent.map(c=>c[1])),Math.max(...cent.map(c=>c[2]))];
  const ranges=maxs.map((v,i)=>Math.max(18,v-mins[i]));
  const norm=rgb=>[(rgb[0]-mins[0])/ranges[0],(rgb[1]-mins[1])/ranges[1],(rgb[2]-mins[2])/ranges[2]];
  const nc=cent.map(norm);
  let minSep=99;for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)minSep=Math.min(minSep,Math.hypot(nc[i][0]-nc[j][0],nc[i][1]-nc[j][1],nc[i][2]-nc[j][2]));
  if(minSep<(bits===4?.105:.13))return null;
  let pilotErr=0;
  for(const[idx,s]of pilots){const p=idx*3,z=norm([samples[p],samples[p+1],samples[p+2]]);pilotErr+=Math.hypot(z[0]-nc[s][0],z[1]-nc[s][1],z[2]-nc[s][2]);}
  pilotErr/=pilots.length;if(pilotErr>.24)return null;
  const sym=new Uint8Array(grid*grid);
  for(let i=0;i<sym.length;i++){
    const p=i*3,z=norm([samples[p],samples[p+1],samples[p+2]]);let best=0,bd=99;
    for(let s=0;s<n;s++){const dd=Math.hypot(z[0]-nc[s][0],z[1]-nc[s][1],z[2]-nc[s][2]);if(dd<bd){bd=dd;best=s;}}
    sym[i]=best;
  }
  const q=clamp(Math.round(100-pilotErr*180+Math.min(18,minSep*35)),0,100);
  return{bytes:symbolsToBytes(sym,grid,bits),quality:q};
}
function expectedModes(){
  if(cameraMode==='senderControl'||rx.session===null)return[{grid:CONTROL_GRID,bits:2}];
  return[{grid:rx.dataGrid,bits:rx.lastBits},{grid:CONTROL_GRID,bits:2}].filter((v,i,a)=>a.findIndex(x=>x.grid===v.grid&&x.bits===v.bits)===i);
}
function decodeWithH(frame,H){
  for(const m of expectedModes()){
    const samples=sampleGridRGB(frame,m.grid,H),ds=m.bits===2?decodeGray(samples,m.grid):decodeColor(samples,m.grid,m.bits);
    if(!ds)continue;const p=parsePacket(ds.bytes);
    if(p?.bad){rx.errors++;updateErrors();continue;}
    if(p)return{p,q:ds.quality};
  }
  return null;
}
function markerDistance(a,b){let s=0,n=0;for(const k of MARKER_KEYS)if(a?.[k]&&b?.[k]){s+=dist(a[k],b[k]);n++;}return n?s/n:1e9;}
function smoothMarkers(oldM,newM,alpha=.24){
  const out={};for(const k of MARKER_KEYS){if(oldM?.[k]&&newM?.[k])out[k]={x:oldM[k].x*(1-alpha)+newM[k].x*alpha,y:oldM[k].y*(1-alpha)+newM[k].y*alpha};else out[k]=newM?.[k]||oldM?.[k];}return out;
}
function drawGuide(markers,H,state){
  const c=$('guideCanvas'),v=$('video');if(!c||!v.clientWidth)return;
  c.width=Math.round(v.clientWidth);c.height=Math.round(v.clientHeight);const sx=c.width/lastCaptureW,sy=c.height/lastCaptureH,ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);
  if(markers){const cs={tl:'#00ffff',tr:'#ff00ff',bl:'#ffff00',br:'#00dc66'};for(const k of MARKER_KEYS){const m=markers[k];if(!m)continue;ctx.beginPath();ctx.arc(m.x*sx,m.y*sy,8,0,Math.PI*2);ctx.strokeStyle=cs[k];ctx.lineWidth=3;ctx.stroke();}}
  if(H){const pts=[[DATA_MIN,DATA_MIN],[DATA_MAX,DATA_MIN],[DATA_MAX,DATA_MAX],[DATA_MIN,DATA_MAX]].map(([x,y])=>mapPoint(H,x,y));ctx.beginPath();ctx.moveTo(pts[0].x*sx,pts[0].y*sy);for(let i=1;i<4;i++)ctx.lineTo(pts[i].x*sx,pts[i].y*sy);ctx.closePath();ctx.strokeStyle=state==='LOCK'?'#34d399':'#67e8f9';ctx.lineWidth=3;ctx.stroke();}
}
function setQuality(q,label){
  const e=$('lockQuality');if(!e)return;
  const light=lastPhoto?` · L${Math.round(lastPhoto.p50)} C${Math.round(lastPhoto.contrast)}`:'';
  e.textContent=`${label} · ${q||0}%${light}`;e.className='lock '+(label.startsWith('LOCK')?'good':q>=45?'mid':'');
}
function adoptGeometry(det){
  trackedMarkers=trackedMarkers?smoothMarkers(trackedMarkers,det.markers,.28):det.markers;
  const src=MARKER_KEYS.map(k=>({x:MARKER_NORM[k][0],y:MARKER_NORM[k][1]})),dst=MARKER_KEYS.map(k=>trackedMarkers[k]);
  trackedH=computeHomography(src,dst)||det.H;trackedFails=0;markerMemory={markers:trackedMarkers,ts:performance.now()};
}
function tryDecode(){
  const frame=captureFrame();if(!frame)return;
  if(trackedH){
    const r=decodeWithH(frame,trackedH);
    if(r){
      trackedFails=0;trackedSuccess++;drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(r.q,'LOCK FAST');dispatchPacket(r.p);
      if(trackedSuccess%10===0){
        const det=detectFiducials(frame);
        if(det.H&&markerDistance(trackedMarkers,det.markers)<Math.min(frame.w,frame.h)*.10)adoptGeometry(det);
      }
      return;
    }
    trackedFails++;
    if(trackedFails<=6){
      if(trackedFails%2===0){
        const det=detectFiducials(frame);
        if(det.H){
          const r2=decodeWithH(frame,det.H);
          if(r2){adoptGeometry(det);drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(r2.q,'LOCK RECOVER');dispatchPacket(r2.p);return;}
        }
      }
      setQuality(50,'TRACK HOLD');return;
    }
    trackedH=null;trackedMarkers=null;trackedFails=0;
  }
  const det=detectFiducials(frame);
  if(!det.H){drawGuide(det.markers||null,null,'SEARCH');setQuality((det.found||0)*18,`BUSCANDO ${det.found||0}/4`);return;}
  const r=decodeWithH(frame,det.H);
  if(r){adoptGeometry(det);drawGuide(trackedMarkers,trackedH,'LOCK');setQuality(Math.round((r.q+(det.quality||60))/2),'LOCK');dispatchPacket(r.p);return;}
  drawGuide(det.markers,det.H,'AUTO');setQuality(det.quality||55,'AUTOLOCK');
}
function dispatchPacket(p){
  if(cameraMode==='receiverData'){
    if(p.type===TYPE.HELLO)handleHello(p);
    else if(p.type===TYPE.DATA)handleData(p);
    else if(p.type===TYPE.PASS_END)handlePassEnd(p);
  }else if(cameraMode==='senderControl'&&(p.type===TYPE.NACK||p.type===TYPE.COMPLETE))handleControlPart(p);
}
function scheduleScan(gen){
  const v=$('video');if(gen!==scanGeneration||!cameraStream)return;
  if(typeof v.requestVideoFrameCallback==='function'){
    scanMode='rvfc';scanHandle=v.requestVideoFrameCallback(()=>{if(gen!==scanGeneration)return;tryDecode();scheduleScan(gen);});
  }else{
    scanMode='timeout';scanHandle=setTimeout(()=>{if(gen!==scanGeneration)return;tryDecode();scheduleScan(gen);},50);
  }
}
async function openCameraStream(){
  const attempts=[
    {video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30,min:15}},audio:false},
    {video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false},
    {video:{facingMode:{ideal:'environment'}},audio:false}
  ];
  let last;
  for(const c of attempts){try{return await navigator.mediaDevices.getUserMedia(c);}catch(e){last=e;}}
  throw last||new Error('No se pudo abrir cámara');
}
async function tuneCamera(track){
  try{
    const cap=track?.getCapabilities?.()||{},advanced={};
    if(Array.isArray(cap.focusMode)&&cap.focusMode.includes('continuous'))advanced.focusMode='continuous';
    if(Array.isArray(cap.exposureMode)&&cap.exposureMode.includes('continuous'))advanced.exposureMode='continuous';
    if(Array.isArray(cap.whiteBalanceMode)&&cap.whiteBalanceMode.includes('continuous'))advanced.whiteBalanceMode='continuous';
    if(Object.keys(advanced).length)await track.applyConstraints({advanced:[advanced]});
  }catch{}
}
async function startCamera(mode){
  stopCamera();cameraMode=mode;cameraStream=await openCameraStream();
  const v=$('video');v.srcObject=cameraStream;await v.play();$('cameraBtn').disabled=true;$('stopCameraBtn').disabled=false;
  trackedH=null;trackedMarkers=null;trackedFails=0;trackedSuccess=0;markerMemory=null;
  const track=cameraStream.getVideoTracks()[0];await tuneCamera(track);const s=track?.getSettings?.()||{};
  rlog(`Cámara HPS7: ${s.width||'?'}×${s.height||'?'} @ ${s.frameRate?Number(s.frameRate).toFixed(0):'?'} fps · exposición/WB adaptativas · decoder ${typeof v.requestVideoFrameCallback==='function'?'frame-synced':'fallback'}.`);
  const gen=++scanGeneration;scheduleScan(gen);setTimeout(()=>$('receiverPanel')?.scrollIntoView({behavior:'smooth',block:'center'}),100);
}
function stopCamera(){
  scanGeneration++;const v=$('video');
  if(scanHandle!==null){
    if(scanMode==='rvfc'&&v?.cancelVideoFrameCallback)try{v.cancelVideoFrameCallback(scanHandle);}catch{}
    else if(scanMode==='timeout')clearTimeout(scanHandle);
    scanHandle=null;
  }
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null;}
  if(v)v.srcObject=null;if($('cameraBtn'))$('cameraBtn').disabled=false;if($('stopCameraBtn'))$('stopCameraBtn').disabled=true;
  cameraMode='idle';trackedH=null;trackedMarkers=null;
}
function startReceiver(){
  if(rxState===RXS.DONE||rx.session===null)rx=freshRx();rxState=RXS.CAMERA;
  startCamera('receiverData').then(()=>{setPhase('RECEPTOR · HPS7 BUSCANDO HELLO','on');rlog('Esperando HELLO HPS7 en control gris 2-bit.');}).catch(e=>{rlog('ERROR cámara: '+e.message);alert('No se pudo abrir cámara: '+e.message);});
}

function updateErrors(){if($('rxErrors'))$('rxErrors').textContent=rx.errors;}
function updateMetrics(){
  const count=rx.chunks.size,total=rx.total,ts=performance.now();if(!count||!total)return;
  if(!rx.startedAt){rx.startedAt=ts;rx.lastTs=ts;rx.lastCount=count;}
  const elapsed=(ts-rx.startedAt)/1000;
  if(count>rx.lastCount&&ts>rx.lastTs){const inst=(count-rx.lastCount)/((ts-rx.lastTs)/1000);rx.emaRate=rx.emaRate?rx.emaRate*.72+inst*.28:inst;rx.lastCount=count;rx.lastTs=ts;}
  const rate=rx.emaRate||count/Math.max(.25,elapsed),byteRate=rate*BASE_CHUNK;
  $('rxElapsed').textContent=fmtTime(elapsed);$('rxRate').textContent=rate?`${rate.toFixed(rate<20?1:0)} blk/s · ${(byteRate/1024).toFixed(1)} KiB/s`:'—';$('rxEta').textContent=count>=total?'0s':rate?`≈ ${fmtTime((total-count)/rate)}`:'—';
}
function cancelProtocol(reset=true){
  txRunToken++;stopCamera();closeOverlay();releaseWake();controlRx=null;txState=TXS.IDLE;rxState=RXS.IDLE;
  if(reset){tx=null;rx=freshRx();$('sendBtn').disabled=true;$('txRepairBtn').style.display='none';setPhase('HPS7 LISTO','on');}
}

$('prepareBtn').onclick=prepareTransfer;
$('sendBtn').onclick=showHello;
$('txRepairBtn').onclick=sendRepair;
$('cameraBtn').onclick=startReceiver;
$('stopCameraBtn').onclick=stopCamera;
$('overlayActionBtn').onclick=()=>{const fn=currentOverlayAction;if(fn)fn();};
$('closeStream').onclick=()=>{if(confirm('¿Cancelar el flujo óptico actual?'))cancelProtocol(false);};
$('gridSize').onchange=()=>{updateModeHint();if(txState!==TXS.IDLE&&txState!==TXS.PREPARED){$('sendBtn').disabled=true;tx=null;txState=TXS.IDLE;}};
$('speedMode').onchange=updateModeHint;
$('modulationMode').onchange=()=>{updateModeHint();if(txState===TXS.PREPARED){$('sendBtn').disabled=true;tx=null;txState=TXS.IDLE;}};

updateModeHint();
$('cameraChip').textContent=navigator.mediaDevices?.getUserMedia?'● Cámara: disponible':'○ Cámara: no disponible';
$('cameraChip').className='chip '+(navigator.mediaDevices?.getUserMedia?'on':'off');
$('wakeChip').textContent='wakeLock'in navigator?'● Wake Lock: disponible':'○ Wake Lock: no disponible';
$('wakeChip').className='chip '+('wakeLock'in navigator?'on':'off');
setPhase('HPS7 ADAPTIVE OPTICAL MODEM LISTO','on');
setInterval(updateMetrics,500);
window.addEventListener('pagehide',()=>{txRunToken++;stopCamera();releaseWake();});
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
slog('HPS7 cargado · bloques lógicos 360 B · modulación 2/3/4-bit · AutoLock fotométrico.');
})();