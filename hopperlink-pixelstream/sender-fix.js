(() => {
'use strict';
const $ = id => document.getElementById(id);
const LEVELS=[26,92,164,236];
const MAGIC=[0x48,0x50,0x53,0x33];
const VERSION=3, PILOT_CELLS=32;
const SPEED_PROFILES={
  slow:{label:'Lenta',mult:1,fps:3,repeat:3,uniqueFps:1},
  normal:{label:'Normal',mult:2,fps:6,repeat:3,uniqueFps:2},
  fast:{label:'Rápida',mult:4,fps:12,repeat:3,uniqueFps:4}
};
let tx=null, txTimer=null, txWake=null;
const enc=new TextEncoder();
function log(msg){const el=$('sendLog');if(!el)return;const t=new Date().toLocaleTimeString();el.textContent=`[${t}] ${msg}\n`+el.textContent.slice(0,5500);}
function fmtBytes(n){if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(2)+' MB';}
function u32(n){return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]}
function u16(n){return [(n>>>8)&255,n&255]}
function concat(...arrs){const n=arrs.reduce((s,a)=>s+a.length,0),o=new Uint8Array(n);let p=0;for(const a of arrs){o.set(a,p);p+=a.length}return o;}
function randomId(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]>>>0;}
const crcTable=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c>>>0}return t})();
function crc32(bytes){let c=0xFFFFFFFF;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}
function pilotEntries(grid){const out=[];const add=(row,colStart,p)=>{for(let i=0;i<8;i++)out.push([row*grid+colStart+i,p[i]])};add(0,0,[0,1,2,3,0,1,2,3]);add(0,grid-8,[3,2,1,0,3,2,1,0]);add(grid-1,0,[1,3,0,2,1,3,0,2]);add(grid-1,grid-8,[2,0,3,1,2,0,3,1]);return out;}
function pilotMap(grid){return new Map(pilotEntries(grid));}
function rawCapacity(grid){return Math.floor((grid*grid-PILOT_CELLS)*2/8);}
function payloadCapacity(grid){return rawCapacity(grid)-26;}
function makeFrame(tid,index,total,chunk,grid){const h=new Uint8Array(22);h.set(MAGIC,0);h[4]=VERSION;h[5]=grid;h.set(u32(tid),6);h.set(u32(index),10);h.set(u32(total),14);h.set(u16(chunk.length),18);h.set(u16(0),20);return concat(h,new Uint8Array(u32(crc32(chunk))),chunk);}
function rawToGridSymbols(raw,grid){const total=grid*grid,out=new Uint8Array(total),pilots=pilotMap(grid);for(const [idx,s] of pilots)out[idx]=s;let bp=0,shift=6;for(let i=0;i<total;i++){if(pilots.has(i))continue;if(bp<raw.length){out[i]=(raw[bp]>>shift)&3;shift-=2;if(shift<0){shift=6;bp++;}}else out[i]=0;}return out;}
function renderFrame(raw,grid){const c=$('pixelCanvas');if(!c)throw new Error('Canvas del emisor no encontrado');const ctx=c.getContext('2d',{alpha:false});if(!ctx)throw new Error('Canvas 2D no disponible');c.width=grid;c.height=grid;const sym=rawToGridSymbols(raw,grid),img=ctx.createImageData(grid,grid);for(let i=0;i<sym.length;i++){const v=LEVELS[sym[i]],p=i*4;img.data[p]=v;img.data[p+1]=v;img.data[p+2]=v;img.data[p+3]=255;}ctx.putImageData(img,0,0);}
function speedProfile(){return SPEED_PROFILES[$('speedMode')?.value]||SPEED_PROFILES.slow;}
async function prepareSafe(){
 try{
  stopSafe(false);
  const f=$('fileInput')?.files?.[0];if(!f){alert('Selecciona un archivo.');return;}
  const grid=Number($('gridSize')?.value||32),cap=payloadCapacity(grid);if(cap<32)throw new Error('Grid demasiado pequeño');
  const fileBytes=new Uint8Array(await f.arrayBuffer());
  const meta=enc.encode(JSON.stringify({name:f.name,type:f.type||'application/octet-stream',size:f.size,lastModified:f.lastModified}));
  const pkg=concat(new Uint8Array(u16(meta.length)),meta,fileBytes),total=Math.ceil(pkg.length/cap),tid=randomId(),frames=new Array(total);
  for(let i=0;i<total;i++){const chunk=pkg.slice(i*cap,Math.min(pkg.length,(i+1)*cap));frames[i]=makeFrame(tid,i,total,chunk,grid);}
  tx={f,grid,cap,total,tid,frames};
  $('fileSize').textContent=fmtBytes(f.size);$('frameCount').textContent=total;$('capacity').textContent=cap+' B';$('sendBtn').disabled=false;
  const sp=speedProfile();log(`Preparado correctamente · ${f.name} · ${total} frames · ${sp.label} ${sp.mult}×`);
 }catch(e){tx=null;$('sendBtn').disabled=true;log('ERROR preparando: '+(e?.message||e));alert('No se pudo preparar PixelStream: '+(e?.message||e));}
}
function startSafe(){
 try{
  if(!tx){log('No hay una transferencia preparada.');return;}
  if(txTimer){clearInterval(txTimer);txTimer=null;}
  const overlay=$('streamOverlay');if(!overlay)throw new Error('Overlay de transmisión no encontrado');
  const sp=speedProfile();let i=0,r=0;
  const tick=()=>{renderFrame(tx.frames[i],tx.grid);const m=$('streamMeta');if(m)m.textContent=`Frame ${i+1}/${tx.total} · ${sp.label} ${sp.mult}× · ${sp.uniqueFps} frame${sp.uniqueFps===1?'':'s'} nuevo${sp.uniqueFps===1?'':'s'}/s`;r++;if(r>=sp.repeat){r=0;i=(i+1)%tx.total;}};
  overlay.style.display='flex';document.body.style.overflow='hidden';
  tick();
  txTimer=setInterval(()=>{try{tick();}catch(e){log('ERROR durante emisión: '+(e?.message||e));stopSafe();}},Math.max(30,Math.round(1000/sp.fps)));
  log(`EMITIENDO · ${sp.label} ${sp.mult}× · primer frame renderizado`);
  if(navigator.wakeLock?.request){navigator.wakeLock.request('screen').then(lock=>{txWake=lock;}).catch(()=>log('Wake Lock no disponible; la transmisión continúa.'));}
 }catch(e){log('ERROR al emitir: '+(e?.message||e));alert('Error al iniciar PixelStream: '+(e?.message||e));}
}
function stopSafe(hide=true){if(txTimer){clearInterval(txTimer);txTimer=null;}if(hide&&$('streamOverlay'))$('streamOverlay').style.display='none';document.body.style.overflow='';if(txWake){Promise.resolve(txWake.release?.()).catch(()=>{});txWake=null;}}
const prep=$('prepareBtn'),send=$('sendBtn'),close=$('closeStream');
if(prep)prep.onclick=prepareSafe;
if(send)send.onclick=startSafe;
if(close)close.onclick=()=>stopSafe(true);
window.addEventListener('pagehide',()=>stopSafe(false));
log('Emisor fail-safe v0.3.2 cargado.');
})();
