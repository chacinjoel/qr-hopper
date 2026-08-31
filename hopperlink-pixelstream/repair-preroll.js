(() => {
'use strict';

const $ = id => document.getElementById(id);
const nativeSetInterval = window.setInterval.bind(window);
const nativeClearInterval = window.clearInterval.bind(window);
const nativeSetTimeout = window.setTimeout.bind(window);
let running = false;

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

function install(){
  const btn=$('txRepairBtn');
  if(!btn||btn.dataset.firstFrameLockInstalled==='1')return;
  const original=btn.onclick;

  btn.onclick=function(e){
    e?.preventDefault?.();
    if(running)return;
    running=true;
    btn.disabled=true;

    // HPS5 sendRepair() llama sendPass(), y sendPass() hace:
    // 1) tick() inmediatamente -> dibuja el primer DATA de reparación.
    // 2) setInterval(tick, ...) -> empieza a avanzar por los frames.
    // Interceptamos SOLO esa próxima creación de intervalo. El primer tick se
    // dibuja normalmente, pero los ticks siguientes quedan bloqueados 3 s.
    const originalSetInterval=window.setInterval;
    let intercepted=false;
    let holdUntil=0;
    let countdownTimer=null;

    window.setInterval=function(fn,delay,...args){
      if(!intercepted && typeof fn==='function'){
        intercepted=true;
        holdUntil=performance.now()+3000;
        const wrapped=(...cbArgs)=>{
          if(performance.now()<holdUntil)return;
          fn(...cbArgs);
        };
        const id=nativeSetInterval(wrapped,delay,...args);
        // Restaurar inmediatamente: no alteramos otros intervalos de la app.
        window.setInterval=originalSetInterval;
        return id;
      }
      return originalSetInterval(fn,delay,...args);
    };

    setPhase('EMISOR · FIJANDO PRIMER FRAME DE REPARACIÓN','mid');
    log('Repair First-Frame Lock: el primer frame quedará fijo 3 segundos antes de avanzar.');

    try{
      original?.call(btn,e);
    }catch(err){
      window.setInterval=originalSetInterval;
      running=false;
      btn.disabled=false;
      throw err;
    }

    // Si por cualquier motivo HPS5 no creó el intervalo esperado, restauramos.
    nativeSetTimeout(()=>{window.setInterval=originalSetInterval;},0);

    const started=performance.now();
    const updateCountdown=()=>{
      const remaining=Math.max(0,3000-(performance.now()-started));
      const sec=Math.max(1,Math.ceil(remaining/1000));
      const meta=$('streamMeta');
      const bottom=$('streamBottom');
      if(remaining>0){
        if(meta)meta.textContent=`REPARACIÓN · primer frame fijo · ${sec}s`;
        if(bottom)bottom.textContent='Mantén la cámara receptora apuntando al patrón. HPS5 no avanzará al siguiente frame hasta terminar esta estabilización.';
      }else{
        if(countdownTimer){nativeClearInterval(countdownTimer);countdownTimer=null;}
        if(meta)meta.textContent='REPARACIÓN · transmisión activa';
        if(bottom)bottom.textContent='Primer frame asegurado. Continuando con los demás frames faltantes…';
        setPhase('EMISOR · REPARANDO','on');
        log('Primer frame de reparación liberado después de 3 s; continúa la secuencia normal.');
        running=false;
        btn.disabled=false;
      }
    };
    updateCountdown();
    countdownTimer=nativeSetInterval(updateCountdown,100);
  };

  btn.dataset.firstFrameLockInstalled='1';
}

install();
window.__hopperRepairPreroll={version:'0.5.3',active:true,mode:'first-frame-lock',holdMs:3000};
})();
