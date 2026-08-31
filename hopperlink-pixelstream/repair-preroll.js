(() => {
'use strict';

const $ = id => document.getElementById(id);
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
const nativeSetTimeout = window.setTimeout.bind(window);
const nativePutImageData = CanvasRenderingContext2D.prototype.putImageData;

let running = false;
let captureActive = false;
let replaying = false;
let totalPasses = 1;
let capturedFrames = [];
let capturedHashes = new Set();

function setPhase(text,kind='mid'){
  const e=$('phaseStatus');
  if(!e)return;
  e.textContent=text;
  e.className='chip '+kind;
}

function log(msg){
  const el=$('sendLog');
  if(!el)return;
  const t=new Date().toLocaleTimeString();
  el.textContent=`[${t}] ${msg}\n`+el.textContent.slice(0,7000);
}

function sleep(ms){return new Promise(r=>nativeSetTimeout(r,ms));}

function parseMissingCount(){
  const text=$('txRepairBtn')?.textContent||'';
  const m=text.match(/\((\d+)\)/);
  return m?Number(m[1]):0;
}

function choosePasses(missing){
  if(missing>0&&missing<=100)return 3;
  if(missing<=300)return 2;
  return 1;
}

// Los ecos son copias de seguridad, no la pasada principal. Se transmiten
// más rápido, pero cada frame permanece >1 ciclo del scanner (~90 ms).
function echoPeriod(){
  const mode=$('speedMode')?.value||'slow';
  if(mode==='ultra')return 140;
  if(mode==='fast')return 180;
  if(mode==='normal')return 200;
  return 220;
}

function imageHash(img){
  const d=img.data;
  let h=2166136261>>>0;
  for(let i=0;i<d.length;i+=4){
    h^=d[i];h=Math.imul(h,16777619);
    h^=d[i+1];h=Math.imul(h,16777619);
    h^=d[i+2];h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function cloneImage(ctx,img){
  const out=ctx.createImageData(img.width,img.height);
  out.data.set(img.data);
  return out;
}

async function replayBurst(passEnd){
  replaying=true;
  captureActive=false;
  const action=$('overlayActionBtn');
  const oldDisplay=action?.style.display||'';
  if(action){action.style.display='none';action.disabled=true;}

  const period=echoPeriod();
  const meta=$('streamMeta');
  const bottom=$('streamBottom');
  const savedMeta=passEnd.meta;

  log(`Repair Burst: ${capturedFrames.length} frame(s) únicos · ${totalPasses} pasada(s) totales · eco ${period} ms/frame.`);
  setPhase(`EMISOR · REPAIR BURST ${totalPasses}×`,'on');

  for(let pass=2;pass<=totalPasses;pass++){
    for(let i=0;i<capturedFrames.length;i++){
      const f=capturedFrames[i];
      nativePutImageData.call(passEnd.ctx,f.img,f.dx,f.dy);
      if(meta)meta.textContent=`REPAIR BURST · eco ${pass}/${totalPasses} · ${i+1}/${capturedFrames.length}`;
      if(bottom)bottom.textContent='Repetición interna de frames faltantes. El receptor sigue en cámara; no cambies de rol todavía.';
      await sleep(period);
    }
  }

  nativePutImageData.call(passEnd.ctx,passEnd.img,passEnd.dx,passEnd.dy);
  if(meta)meta.textContent=savedMeta;
  if(bottom)bottom.textContent='Repair Burst terminado. Ahora sí: espera a que el receptor muestre NACK o COMPLETE.';
  if(action){action.disabled=false;action.style.display=oldDisplay||'inline-flex';}
  setPhase('EMISOR · PASS_END','mid');
  log('Repair Burst finalizado; PASS_END publicado una sola vez.');

  capturedFrames=[];
  capturedHashes.clear();
  replaying=false;
  running=false;
}

CanvasRenderingContext2D.prototype.putImageData=function(img,dx,dy,...rest){
  if(this.canvas?.id!=='pixelCanvas'||!captureActive||replaying){
    return nativePutImageData.call(this,img,dx,dy,...rest);
  }

  const meta=$('streamMeta')?.textContent||'';

  // HPS5 abre el overlay PASS_END antes de dibujarlo. Retenemos ese dibujo,
  // hacemos los ecos internos y solo después dejamos visible PASS_END.
  if(/^PASS_END/i.test(meta)){
    const endImg=cloneImage(this,img);
    if(totalPasses>1&&capturedFrames.length){
      replayBurst({ctx:this,img:endImg,dx,dy,meta});
      return;
    }
    captureActive=false;
    running=false;
    capturedFrames=[];
    capturedHashes.clear();
    return nativePutImageData.call(this,img,dx,dy,...rest);
  }

  // Capturamos una sola copia de cada DATA distinto; HPS5 ya repite cada frame
  // varias veces en la pasada principal, así que no guardamos duplicados.
  const h=imageHash(img);
  if(!capturedHashes.has(h)){
    capturedHashes.add(h);
    capturedFrames.push({img:cloneImage(this,img),dx,dy});
  }
  return nativePutImageData.call(this,img,dx,dy,...rest);
};

function install(){
  const btn=$('txRepairBtn');
  if(!btn||btn.dataset.repairBurstInstalled==='1')return;
  const original=btn.onclick;

  btn.onclick=function(e){
    e?.preventDefault?.();
    if(running)return;

    const missing=parseMissingCount();
    totalPasses=choosePasses(missing);
    running=true;
    captureActive=true;
    replaying=false;
    capturedFrames=[];
    capturedHashes.clear();
    btn.disabled=true;

    // First Repair Frame Lock: HPS5 dibuja el primer DATA inmediatamente y
    // crea después su intervalo. Solo bloqueamos ese próximo intervalo 3 s.
    const originalSetInterval=window.setInterval;
    let intercepted=false;
    let holdUntil=0;
    let countdownTimer=null;

    window.setInterval=function(fn,delay,...args){
      if(!intercepted&&typeof fn==='function'){
        intercepted=true;
        holdUntil=performance.now()+3000;
        const wrapped=(...cbArgs)=>{
          if(performance.now()<holdUntil)return;
          fn(...cbArgs);
        };
        const id=nativeSetInterval(wrapped,delay,...args);
        window.setInterval=originalSetInterval;
        return id;
      }
      return originalSetInterval(fn,delay,...args);
    };

    setPhase('EMISOR · FIJANDO PRIMER FRAME DE REPARACIÓN','mid');
    log(`Repair First-Frame Lock: 3 s · ${missing} faltante(s) · plan ${totalPasses} pasada(s).`);

    try{
      original?.call(btn,e);
    }catch(err){
      window.setInterval=originalSetInterval;
      captureActive=false;
      running=false;
      btn.disabled=false;
      throw err;
    }

    nativeSetTimeout(()=>{window.setInterval=originalSetInterval;},0);

    const started=performance.now();
    const updateCountdown=()=>{
      const remaining=Math.max(0,3000-(performance.now()-started));
      const sec=Math.max(1,Math.ceil(remaining/1000));
      const meta=$('streamMeta');
      const bottom=$('streamBottom');
      if(remaining>0){
        if(meta)meta.textContent=`REPARACIÓN · primer frame fijo · ${sec}s`;
        if(bottom)bottom.textContent=`Cámara estabilizando sobre un DATA válido. Después HPS5 hará ${totalPasses} pasada(s) internas antes de PASS_END.`;
      }else{
        if(countdownTimer){nativeClearInterval(countdownTimer);countdownTimer=null;}
        if(meta)meta.textContent='REPARACIÓN · pasada principal';
        if(bottom)bottom.textContent=totalPasses>1?'Primera pasada activa; luego vendrán ecos rápidos sin cambiar de rol.':'Primer frame asegurado. Continuando reparación normal…';
        setPhase('EMISOR · REPARANDO','on');
        log('Primer frame liberado; continúa la pasada principal de reparación.');
      }
    };
    updateCountdown();
    countdownTimer=nativeSetInterval(updateCountdown,100);
  };

  btn.dataset.repairBurstInstalled='1';
}

install();
window.__hopperRepairPreroll={version:'0.5.5',active:true,mode:'adaptive-repair-burst',firstFrameHoldMs:3000,passes:{lte100:3,lte300:2,gt300:1}};
})();
