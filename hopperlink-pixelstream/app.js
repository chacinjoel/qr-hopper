(() => {
'use strict';
const $=id=>document.getElementById(id);
const enc=new TextEncoder(), dec=new TextDecoder();
const LEVELS=[28,96,166,238];
const MAGIC=[0x48,0x50,0x53,0x31]; // HPS1
let prepared=null, timer=null, wakeLock=null, cameraStream=null, scanTimer=null;
let rx={id:null,total:null,chunks:new Map(),errors:0,lastGood:0};

function log(el,msg){ const t=new Date().toLocaleTimeString(); el.textContent=`[${t}] ${msg}\n`+el.textContent.slice(0,5500); }
function fmtBytes(n){ if(n<1024)return n+' B'; if(n<1048576)return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(2)+' MB'; }
function u32(n){return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]}
function readU32(a,o){return ((a[o]<<24)>>>0)|(a[o+1]<<16)|(a[o+2]<<8)|a[o+3]}
function u16(n){return [(n>>>8)&255,n&255]}
function readU16(a,o){return (a[o]<<8)|a[o+1]}
const crcTable=(()=>{let t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0}return t})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length}return o}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]>>>0}

function frameCapacity(grid){return Math.floor(grid*grid*2/8)}
function payloadCapacity(grid){return frameCapacity(grid)-22}
function makeFrame(tid,index,total,chunk,grid){
  const header=new Uint8Array(22); header.set(MAGIC,0); header[4]=1; header[5]=grid;
  header.set(u32(tid),6);header.set(u32(index),10);header.set(u32(total),14);header.set(u16(chunk.length),18);header.set(u16(0),20);
  const crc=crc32(chunk); const crcBytes=new Uint8Array(u32(crc));
  const raw=concat(header,crcBytes,chunk); // 26 actually? header 22 + crc 4 -> header total 26
  return raw;
}
function payloadCapacity2(grid){return frameCapacity(grid)-26}

function bytesToSymbols(bytes,totalSymbols){const out=new Uint8Array(totalSymbols);let p=0;for(const b of bytes){out[p++]=(b>>6)&3;out[p++]=(b>>4)&3;out[p++]=(b>>2)&3;out[p++]=b&3}while(p<totalSymbols)out[p++]=0;return out}
function symbolsToBytes(sym){const n=Math.floor(sym.length/4),out=new Uint8Array(n);for(let i=0;i<n;i++)out[i]=(sym[i*4]<<6)|(sym[i*4+1]<<4)|(sym[i*4+2]<<2)|sym[i*4+3];return out}

function renderFrame(raw,grid){
  const c=$('pixelCanvas'); c.width=grid;c.height=grid; const ctx=c.getContext('2d',{alpha:false});
  const sym=bytesToSymbols(raw,grid*grid); const img=ctx.createImageData(grid,grid);
  for(let i=0;i<sym.length;i++){const v=LEVELS[sym[i]],p=i*4;img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255}ctx.putImageData(img,0,0);
}

async function prepare(){
  const f=$('fileInput').files[0]; if(!f){alert('Selecciona un archivo.');return}
  const grid=+$('gridSize').value, cap=payloadCapacity2(grid); if(cap<32){alert('Grid demasiado pequeño.');return}
  const fileBytes=new Uint8Array(await f.arrayBuffer());
  const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));
  if(meta.length>65535){alert('Metadata demasiado grande.');return}
  const packageBytes=concat(new Uint8Array(u16(meta.length)),meta,fileBytes);
  const total=Math.ceil(packageBytes.length/cap), tid=randomId(), frames=[];
  for(let i=0;i<total;i++){const chunk=packageBytes.slice(i*cap,Math.min(packageBytes.length,(i+1)*cap));frames.push(makeFrame(tid,i,total,chunk,grid))}
  prepared={f,grid,cap,tid,total,frames};
  $('fileSize').textContent=fmtBytes(f.size);$('frameCount').textContent=total;$('capacity').textContent=cap+' B';$('sendBtn').disabled=false;
  log($('sendLog'),`Preparado ${f.name} · ${fmtBytes(f.size)} · ${total} frames · transfer ${tid.toString(16)}`);
}

async function startSend(){
  if(!prepared)return; const fps=+$('fps').value, repeat=+$('repeat').value; let i=0,r=0;
  $('streamOverlay').style.display='flex'; try{if('wakeLock'in navigator){wakeLock=await navigator.wakeLock.request('screen')}}catch{}
  const tick=()=>{const fr=prepared.frames[i];renderFrame(fr,prepared.grid);$('streamMeta').textContent=`Frame ${i+1}/${prepared.total} · ${prepared.cap} B payload · ${fps} FPS`;r++;if(r>=repeat){r=0;i=(i+1)%prepared.total}};
  tick(); timer=setInterval(tick,1000/fps);
}
function stopSend(){if(timer){clearInterval(timer);timer=null}$('streamOverlay').style.display='none'; if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null}}

function parseFrame(bytes){
  if(bytes.length<26)return null;for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;if(bytes[4]!==1)return null;
  const grid=bytes[5],tid=readU32(bytes,6)>>>0,index=readU32(bytes,10)>>>0,total=readU32(bytes,14)>>>0,len=readU16(bytes,18); const expected=readU32(bytes,22)>>>0;
  if(total===0||index>=total||len>bytes.length-26)return null; const chunk=bytes.slice(26,26+len);if(crc32(chunk)!==expected)return {bad:true};return {grid,tid,index,total,chunk};
}

function sampleGridFromVideo(grid){
  const v=$('video'), c=$('capture'); if(!v.videoWidth)return null;
  const w=v.clientWidth,h=v.clientHeight; c.width=w;c.height=h; const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.drawImage(v,0,0,w,h);
  // El usuario alinea el borde blanco exterior con la guía cyan. El grid real ocupa
  // 94.4% del shell (2.8% de quiet-zone por lado), así que muestreamos solo su interior.
  const shellSide=Math.min(w,h)*0.82, side=shellSide*0.944, x0=(w-side)/2, y0=(h-side)/2;
  const cell=side/grid, samples=new Float32Array(grid*grid); let idx=0;
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    const cx=x0+(x+.5)*cell, cy=y0+(y+.5)*cell, rad=Math.max(1,Math.floor(cell*.10));
    const sx=Math.max(0,Math.floor(cx-rad)), sy=Math.max(0,Math.floor(cy-rad));
    const sw=Math.max(1,Math.min(w-sx,rad*2+1)), sh=Math.max(1,Math.min(h-sy,rad*2+1));
    const d=ctx.getImageData(sx,sy,sw,sh).data; let sum=0,n=0;
    for(let p=0;p<d.length;p+=4){sum+=(d[p]+d[p+1]+d[p+2])/3;n++} samples[idx++]=sum/Math.max(1,n);
  }
  // Normalización robusta por frame: compensa exposición/ganancia de cámaras distintas.
  const sorted=Array.from(samples).sort((a,b)=>a-b);
  const lo=sorted[Math.floor(sorted.length*0.02)], hi=sorted[Math.floor(sorted.length*0.98)];
  if(!(hi>lo+18)) return null;
  const sym=new Uint8Array(samples.length);
  for(let i=0;i<samples.length;i++){
    const norm=Math.max(0,Math.min(255,(samples[i]-lo)*255/(hi-lo)));
    let best=0,bd=1e9;for(let k=0;k<4;k++){const dd=Math.abs(norm-LEVELS[k]);if(dd<bd){bd=dd;best=k}}sym[i]=best;
  }
  return symbolsToBytes(sym);
}

function tryDecode(){
  const candidates=[+$('gridSize').value,48,40,56,32].filter((x,i,a)=>a.indexOf(x)===i);
  for(const g of candidates){try{const b=sampleGridFromVideo(g);if(!b)continue;const p=parseFrame(b);if(p?.bad){rx.errors++;$('rxErrors').textContent=rx.errors;continue}if(p){acceptFrame(p);return true}}catch(e){}}
  return false;
}
function acceptFrame(p){
  if(rx.id!==null&&rx.id!==p.tid){rx={id:p.tid,total:p.total,chunks:new Map(),errors:rx.errors,lastGood:Date.now()};log($('rxLog'),'Nueva transferencia detectada; reiniciando buffer.')} if(rx.id===null){rx.id=p.tid;rx.total=p.total;log($('rxLog'),`Transferencia ${p.tid.toString(16)} detectada · ${p.total} frames`)}
  if(!rx.chunks.has(p.index)){rx.chunks.set(p.index,p.chunk);$('rxFrames').textContent=rx.chunks.size;$('rxTotal').textContent=rx.total;$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';log($('rxLog'),`Frame ${p.index+1}/${p.total} OK`)} rx.lastGood=Date.now(); if(rx.chunks.size===rx.total)finishReceive();
}
function finishReceive(){
  const parts=[];for(let i=0;i<rx.total;i++){if(!rx.chunks.has(i))return;parts.push(rx.chunks.get(i))}const pkg=concat(...parts);const ml=readU16(pkg,0); if(ml<=0||ml>pkg.length-2){log($('rxLog'),'Metadata inválida.');return}
  let meta;try{meta=JSON.parse(dec.decode(pkg.slice(2,2+ml)))}catch{log($('rxLog'),'No se pudo leer metadata.');return}const data=pkg.slice(2+ml,2+ml+meta.size);const blob=new Blob([data],{type:meta.type||'application/octet-stream'});const url=URL.createObjectURL(blob);
  const box=$('receivedBox');box.style.display='block';box.innerHTML=`<b>✓ Archivo reconstruido</b><br><span class="mono">${escapeHtml(meta.name)}</span><br><span class="small">${fmtBytes(data.length)} · ${escapeHtml(meta.type)}</span><br><br><a class="btn good" style="display:inline-block;text-decoration:none" href="${url}" download="${escapeAttr(meta.name)}">Guardar archivo</a>`;log($('rxLog'),`COMPLETO: ${meta.name} · ${fmtBytes(data.length)}`);
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}function escapeAttr(s){return String(s).replace(/"/g,'')}

async function startCamera(){
  try{cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:1280}},audio:false});$('video').srcObject=cameraStream;await $('video').play();$('cameraBtn').disabled=true;$('stopCameraBtn').disabled=false;log($('rxLog'),'Cámara activa. Alinea el PixelStream.');scanTimer=setInterval(tryDecode,120)}catch(e){log($('rxLog'),'Error de cámara: '+e.message);alert('No se pudo abrir la cámara. En iPhone/iPad debe ejecutarse desde HTTPS o como PWA instalada.')}
}
function stopCamera(){if(scanTimer){clearInterval(scanTimer);scanTimer=null}if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}$('video').srcObject=null;$('cameraBtn').disabled=false;$('stopCameraBtn').disabled=true}

$('prepareBtn').onclick=prepare;$('sendBtn').onclick=startSend;$('closeStream').onclick=stopSend;$('cameraBtn').onclick=startCamera;$('stopCameraBtn').onclick=stopCamera;
$('gridSize').onchange=()=>{$('capacity').textContent=payloadCapacity2(+$('gridSize').value)+' B';$('sendBtn').disabled=true};
$('capacity').textContent=payloadCapacity2(+$('gridSize').value)+' B';
$('cameraChip').textContent=navigator.mediaDevices?.getUserMedia?'● Cámara: disponible':'○ Cámara: no disponible';$('cameraChip').className='chip '+(navigator.mediaDevices?.getUserMedia?'on':'off');
$('wakeChip').textContent='wakeLock'in navigator?'● Wake Lock: disponible':'○ Wake Lock: no disponible';$('wakeChip').className='chip '+('wakeLock'in navigator?'on':'off');
if('serviceWorker'in navigator && location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
