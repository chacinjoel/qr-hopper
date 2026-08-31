(() => {
'use strict';

const $ = id => document.getElementById(id);
const enc = new TextEncoder(), dec = new TextDecoder();
const LEVELS = [26, 92, 164, 236];
const MAGIC = [0x48,0x50,0x53,0x32]; // HPS2
const VERSION = 2;
const PILOT_CELLS = 32;

let prepared = null, timer = null, wakeLock = null, cameraStream = null, scanTimer = null;
let rx = {id:null,total:null,chunks:new Map(),errors:0,lastGood:0};

function log(el,msg){
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${msg}\n` + el.textContent.slice(0,5500);
}
function fmtBytes(n){
  if(n<1024) return n+' B';
  if(n<1048576) return (n/1024).toFixed(1)+' KB';
  return (n/1048576).toFixed(2)+' MB';
}
function u32(n){return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]}
function readU32(a,o){return ((((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3])>>>0)}
function u16(n){return [(n>>>8)&255,n&255]}
function readU16(a,o){return (a[o]<<8)|a[o+1]}
const crcTable=(()=>{let t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0}return t})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length}return o}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]>>>0}

function pilotEntries(grid){
  const out=[];
  const add=(row,colStart,pattern)=>{for(let i=0;i<8;i++)out.push([row*grid+colStart+i,pattern[i]])};
  add(0,0,              [0,1,2,3,0,1,2,3]);
  add(0,grid-8,         [3,2,1,0,3,2,1,0]);
  add(grid-1,0,         [1,3,0,2,1,3,0,2]);
  add(grid-1,grid-8,    [2,0,3,1,2,0,3,1]);
  return out;
}
function pilotMap(grid){ return new Map(pilotEntries(grid)); }
function rawCapacity(grid){ return Math.floor((grid*grid-PILOT_CELLS)*2/8); }
function payloadCapacity(grid){ return rawCapacity(grid)-26; }

function makeFrame(tid,index,total,chunk,grid){
  const header=new Uint8Array(22);
  header.set(MAGIC,0); header[4]=VERSION; header[5]=grid;
  header.set(u32(tid),6); header.set(u32(index),10); header.set(u32(total),14);
  header.set(u16(chunk.length),18); header.set(u16(0),20);
  const crcBytes=new Uint8Array(u32(crc32(chunk)));
  return concat(header,crcBytes,chunk);
}

function rawToGridSymbols(raw,grid){
  const total=grid*grid, out=new Uint8Array(total), pilots=pilotMap(grid);
  for(const [idx,s] of pilots) out[idx]=s;
  let bytePos=0, shift=6;
  for(let i=0;i<total;i++){
    if(pilots.has(i)) continue;
    if(bytePos<raw.length){
      out[i]=(raw[bytePos]>>shift)&3;
      shift-=2;
      if(shift<0){shift=6;bytePos++;}
    } else out[i]=0;
  }
  return out;
}

function dataSymbolsToBytes(sym,grid){
  const pilots=pilotMap(grid), data=[];
  for(let i=0;i<sym.length;i++) if(!pilots.has(i)) data.push(sym[i]);
  const n=Math.floor(data.length/4), out=new Uint8Array(n);
  for(let i=0;i<n;i++) out[i]=(data[i*4]<<6)|(data[i*4+1]<<4)|(data[i*4+2]<<2)|data[i*4+3];
  return out;
}

function renderFrame(raw,grid){
  const c=$('pixelCanvas'); c.width=grid; c.height=grid;
  const ctx=c.getContext('2d',{alpha:false});
  const sym=rawToGridSymbols(raw,grid), img=ctx.createImageData(grid,grid);
  for(let i=0;i<sym.length;i++){
    const v=LEVELS[sym[i]],p=i*4;
    img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255;
  }
  ctx.putImageData(img,0,0);
}

async function prepare(){
  const f=$('fileInput').files[0];
  if(!f){alert('Selecciona un archivo.');return}
  const grid=+$('gridSize').value, cap=payloadCapacity(grid);
  if(cap<32){alert('Grid demasiado pequeño.');return}
  const fileBytes=new Uint8Array(await f.arrayBuffer());
  const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));
  if(meta.length>65535){alert('Metadata demasiado grande.');return}
  const packageBytes=concat(new Uint8Array(u16(meta.length)),meta,fileBytes);
  const total=Math.ceil(packageBytes.length/cap), tid=randomId(), frames=[];
  for(let i=0;i<total;i++){
    const chunk=packageBytes.slice(i*cap,Math.min(packageBytes.length,(i+1)*cap));
    frames.push(makeFrame(tid,i,total,chunk,grid));
  }
  prepared={f,grid,cap,tid,total,frames};
  $('fileSize').textContent=fmtBytes(f.size);
  $('frameCount').textContent=total;
  $('capacity').textContent=cap+' B';
  $('sendBtn').disabled=false;
  log($('sendLog'),`Preparado ${f.name} · ${fmtBytes(f.size)} · ${total} frames · HPS2 Safe · ${grid}×${grid}`);
}

async function startSend(){
  if(!prepared)return;
  const fps=+$('fps').value, repeat=+$('repeat').value;
  let i=0,r=0;
  $('streamOverlay').style.display='flex';
  try{if('wakeLock'in navigator)wakeLock=await navigator.wakeLock.request('screen')}catch{}
  const tick=()=>{
    renderFrame(prepared.frames[i],prepared.grid);
    $('streamMeta').textContent=`Frame ${i+1}/${prepared.total} · ${prepared.cap} B · ${fps} FPS · x${repeat}`;
    r++;
    if(r>=repeat){r=0;i=(i+1)%prepared.total;}
  };
  tick(); timer=setInterval(tick,1000/fps);
}
function stopSend(){
  if(timer){clearInterval(timer);timer=null}
  $('streamOverlay').style.display='none';
  if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null}
}

function parseFrame(bytes){
  if(bytes.length<26)return null;
  for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;
  if(bytes[4]!==VERSION)return null;
  const grid=bytes[5],tid=readU32(bytes,6),index=readU32(bytes,10),total=readU32(bytes,14),len=readU16(bytes,18),expected=readU32(bytes,22);
  if(total===0||index>=total||len>bytes.length-26)return null;
  const chunk=bytes.slice(26,26+len);
  if(crc32(chunk)!==expected)return {bad:true};
  return {grid,tid,index,total,chunk};
}

function captureFrame(){
  const v=$('video'), c=$('capture');
  if(!v.videoWidth||!v.clientWidth)return null;
  const w=Math.max(1,Math.round(v.clientWidth)), h=Math.max(1,Math.round(v.clientHeight));
  c.width=w;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(v,0,0,w,h);
  return {w,h,data:ctx.getImageData(0,0,w,h).data};
}

function nominalGridBox(){
  const v=$('video'), aim=document.querySelector('.aim');
  const vr=v.getBoundingClientRect(), ar=aim.getBoundingClientRect();
  const shellX=ar.left-vr.left, shellY=ar.top-vr.top, shellW=ar.width, shellH=ar.height;
  return {
    cx:shellX+shellW/2,
    cy:shellY+shellH/2,
    side:Math.min(shellW,shellH)*0.944
  };
}

function luminanceAt(frame,x,y,rad){
  const {w,h,data}=frame;
  const xi=Math.round(x), yi=Math.round(y);
  let sum=0,n=0;
  for(let yy=Math.max(0,yi-rad);yy<=Math.min(h-1,yi+rad);yy++){
    let p=(yy*w+Math.max(0,xi-rad))*4;
    for(let xx=Math.max(0,xi-rad);xx<=Math.min(w-1,xi+rad);xx++,p+=4){
      sum+=(data[p]+data[p+1]+data[p+2])/3;n++;
    }
  }
  return sum/Math.max(1,n);
}

function sampleGrid(frame,grid,opts){
  const box=nominalGridBox(), cell=(box.side*opts.scale)/grid;
  const side=cell*grid;
  const x0=box.cx-side/2+opts.dx*cell, y0=box.cy-side/2+opts.dy*cell;
  const rad=Math.max(0,Math.min(2,Math.floor(cell*0.12)));
  const samples=new Float32Array(grid*grid);
  let k=0;
  const a=opts.angle||0, ca=Math.cos(a), sa=Math.sin(a), cx=box.cx, cy=box.cy;
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    let px=x0+(x+.5)*cell, py=y0+(y+.5)*cell;
    if(a){const rx=px-cx,ry=py-cy;px=cx+rx*ca-ry*sa;py=cy+rx*sa+ry*ca;}
    samples[k++]=luminanceAt(frame,px,py,rad);
  }
  return samples;
}

function decodeSamples(samples,grid){
  const pilots=pilotEntries(grid), sums=[0,0,0,0], counts=[0,0,0,0];
  for(const [idx,s] of pilots){sums[s]+=samples[idx];counts[s]++;}
  const means=sums.map((v,i)=>v/Math.max(1,counts[i]));
  if(!(means[0]+8<means[1] && means[1]+8<means[2] && means[2]+8<means[3])) return null;

  let pilotErr=0;
  for(const [idx,s] of pilots) pilotErr+=Math.abs(samples[idx]-means[s]);
  pilotErr/=pilots.length;
  const separation=Math.min(means[1]-means[0],means[2]-means[1],means[3]-means[2]);
  const quality=Math.max(0,100-Math.round(pilotErr*2.2)-Math.max(0,25-Math.round(separation)));

  const sym=new Uint8Array(samples.length);
  for(let i=0;i<samples.length;i++){
    let best=0,bd=Infinity;
    for(let s=0;s<4;s++){const d=Math.abs(samples[i]-means[s]);if(d<bd){bd=d;best=s;}}
    sym[i]=best;
  }
  return {bytes:dataSymbolsToBytes(sym,grid),quality,pilotErr,separation};
}

function tryCandidate(frame,grid,opts){
  const decoded=decodeSamples(sampleGrid(frame,grid,opts),grid);
  if(!decoded)return null;
  const parsed=parseFrame(decoded.bytes);
  if(parsed?.bad)return {bad:true,quality:decoded.quality};
  if(parsed)return {parsed,quality:decoded.quality};
  return {quality:decoded.quality};
}

function tryDecode(){
  const frame=captureFrame(); if(!frame)return false;
  const g=+$('gridSize').value;
  const offsets=[0,-0.14,0.14];
  let bestQuality=0, sawBad=false;

  let r=tryCandidate(frame,g,{dx:0,dy:0,scale:1,angle:0});
  if(r?.parsed){setQuality(r.quality,'LOCK');acceptFrame(r.parsed);return true;}
  if(r?.bad)sawBad=true;if(r?.quality)bestQuality=Math.max(bestQuality,r.quality);

  for(const scale of [0.985,1.015]){
    for(const dx of offsets)for(const dy of offsets){
      r=tryCandidate(frame,g,{dx,dy,scale,angle:0});
      if(r?.parsed){setQuality(r.quality,'LOCK');acceptFrame(r.parsed);return true;}
      if(r?.bad)sawBad=true;if(r?.quality)bestQuality=Math.max(bestQuality,r.quality);
    }
  }

  for(const angle of [-0.012,0.012]){
    r=tryCandidate(frame,g,{dx:0,dy:0,scale:1,angle});
    if(r?.parsed){setQuality(r.quality,'LOCK');acceptFrame(r.parsed);return true;}
    if(r?.bad)sawBad=true;if(r?.quality)bestQuality=Math.max(bestQuality,r.quality);
  }

  if(sawBad){rx.errors++;$('rxErrors').textContent=rx.errors;}
  setQuality(bestQuality,bestQuality>55?'CALIBRANDO':'BUSCANDO');
  return false;
}

function setQuality(q,label){
  const el=$('lockQuality'); if(!el)return;
  el.textContent=`${label} · ${q||0}%`;
  el.className='lock '+(q>=70?'good':q>=45?'mid':'');
}

function acceptFrame(p){
  if(rx.id!==null&&rx.id!==p.tid){
    rx={id:p.tid,total:p.total,chunks:new Map(),errors:rx.errors,lastGood:Date.now()};
    log($('rxLog'),'Nueva transferencia detectada; reiniciando buffer.');
  }
  if(rx.id===null){
    rx.id=p.tid;rx.total=p.total;
    log($('rxLog'),`Transferencia ${p.tid.toString(16)} detectada · ${p.total} frames`);
  }
  if(!rx.chunks.has(p.index)){
    rx.chunks.set(p.index,p.chunk);
    $('rxFrames').textContent=rx.chunks.size;$('rxTotal').textContent=rx.total;
    $('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';
    log($('rxLog'),`Frame ${p.index+1}/${p.total} OK`);
  }
  rx.lastGood=Date.now();
  if(rx.chunks.size===rx.total)finishReceive();
}

function finishReceive(){
  const parts=[];for(let i=0;i<rx.total;i++){if(!rx.chunks.has(i))return;parts.push(rx.chunks.get(i))}
  const pkg=concat(...parts), ml=readU16(pkg,0);
  if(ml<=0||ml>pkg.length-2){log($('rxLog'),'Metadata inválida.');return}
  let meta;
  try{meta=JSON.parse(dec.decode(pkg.slice(2,2+ml)))}catch{log($('rxLog'),'No se pudo leer metadata.');return}
  const data=pkg.slice(2+ml,2+ml+meta.size), blob=new Blob([data],{type:meta.type||'application/octet-stream'}), url=URL.createObjectURL(blob);
  const box=$('receivedBox');box.style.display='block';
  box.innerHTML=`<b>✓ Archivo reconstruido</b><br><span class="mono">${escapeHtml(meta.name)}</span><br><span class="small">${fmtBytes(data.length)} · ${escapeHtml(meta.type)}</span><br><br><a class="btn good" style="display:inline-block;text-decoration:none" href="${url}" download="${escapeAttr(meta.name)}">Guardar archivo</a>`;
  log($('rxLog'),`COMPLETO: ${meta.name} · ${fmtBytes(data.length)}`);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function escapeAttr(s){return String(s).replace(/"/g,'')}

async function startCamera(){
  try{
    cameraStream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1280}},audio:false
    });
    $('video').srcObject=cameraStream; await $('video').play();
    $('cameraBtn').disabled=true;$('stopCameraBtn').disabled=false;
    log($('rxLog'),'Cámara activa. Usa Safe Mode: alinea el borde blanco exactamente con el cuadro cyan.');
    scanTimer=setInterval(tryDecode,180);
  }catch(e){
    log($('rxLog'),'Error de cámara: '+e.message);
    alert('No se pudo abrir la cámara. En iPhone/iPad debe ejecutarse desde HTTPS o como PWA instalada.');
  }
}
function stopCamera(){
  if(scanTimer){clearInterval(scanTimer);scanTimer=null}
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
  $('video').srcObject=null;$('cameraBtn').disabled=false;$('stopCameraBtn').disabled=true;setQuality(0,'DETENIDO');
}

$('prepareBtn').onclick=prepare;
$('sendBtn').onclick=startSend;
$('closeStream').onclick=stopSend;
$('cameraBtn').onclick=startCamera;
$('stopCameraBtn').onclick=stopCamera;
$('gridSize').onchange=()=>{$('capacity').textContent=payloadCapacity(+$('gridSize').value)+' B';$('sendBtn').disabled=true;};
$('capacity').textContent=payloadCapacity(+$('gridSize').value)+' B';
$('cameraChip').textContent=navigator.mediaDevices?.getUserMedia?'● Cámara: disponible':'○ Cámara: no disponible';
$('cameraChip').className='chip '+(navigator.mediaDevices?.getUserMedia?'on':'off');
$('wakeChip').textContent='wakeLock'in navigator?'● Wake Lock: disponible':'○ Wake Lock: no disponible';
$('wakeChip').className='chip '+('wakeLock'in navigator?'on':'off');
if('serviceWorker'in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
