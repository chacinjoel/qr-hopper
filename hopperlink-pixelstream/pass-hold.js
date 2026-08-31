(() => {
'use strict';
const baseSetInterval=window.setInterval.bind(window);
const baseClearInterval=window.clearInterval.bind(window);
const baseSetTimeout=window.setTimeout.bind(window);
const $=id=>document.getElementById(id);
let held=null,btn=null;
function ensure(){if(btn)return btn;const row=document.querySelector('#streamOverlay .streamTop .row');if(!row)return null;btn=document.createElement('button');btn.type='button';btn.id='passContinueBtn';btn.className='btn good';btn.textContent='Último frame recibido · Continuar';btn.style.display='none';row.insertBefore(btn,row.firstChild);btn.addEventListener('click',resume);return btn;}
function phase(t){const e=$('phaseStatus');if(e){e.textContent=t;e.className='chip mid';}}
function show(){const b=ensure();if(b)b.style.display='inline-flex';if($('streamBottom'))$('streamBottom').textContent='Último DATA retenido. Confirma que el receptor lo contó y pulsa Continuar.';phase('ÚLTIMO FRAME · ESPERANDO CONTINUAR');}
function hide(){const b=ensure();if(b)b.style.display='none';}
function last(meta){const m=String(meta||'').match(/Frame\s+(\d+)\/(\d+)/i);return !!m&&+m[1]===+m[2];}
function resume(){if(!held)return;const h=held;held=null;hide();h.active=false;
  // Reanudar el MISMO intervalo; no ejecutar el callback a mano. Esto preserva
  // exactamente el estado interno pos/rep/inEnd de HPS4 y garantiza PASS_END.
  h.resumeRequested=true;
  if($('streamBottom'))$('streamBottom').textContent='Finalizando último DATA y publicando PASS_END…';phase('FINALIZANDO PASADA');
}
window.setInterval=function(fn,delay,...args){
 if(typeof fn==='function'){
  const src=Function.prototype.toString.call(fn);
  if(src.includes('buildDataPacket(idx,round)')&&src.includes('inEnd')){
   let id;let localHold=false;let resumeRequested=false;
   const wrapped=(...cb)=>{
    if(localHold&&!resumeRequested)return;
    fn(...cb);
    const meta=$('streamMeta')?.textContent||'';
    if(!localHold&&last(meta)){
      localHold=true;resumeRequested=false;
      held={intervalId:id,active:true,get resumeRequested(){return resumeRequested},set resumeRequested(v){resumeRequested=v;},};
      show();return;
    }
    if(localHold&&resumeRequested){
      // Dejar correr ticks hasta que el motor cambie a Fin de pasada.
      if(/^Fin de pasada/i.test(meta)){
        localHold=false;resumeRequested=false;hide();
        if($('streamBottom'))$('streamBottom').textContent='PASS_END visible. El receptor debe detectarlo y generar NACK/COMPLETE.';
        phase('PASS_END · SINCRONIZANDO');
      }
    }
   };
   id=baseSetInterval(wrapped,delay,...args);return id;
  }
 }
 return baseSetInterval(fn,delay,...args);
};
// El cambio a cámara del emisor se retrasa 4 s DESPUÉS de que HPS4 ya esté en PASS_END.
window.setTimeout=function(fn,delay,...args){const src=typeof fn==='function'?Function.prototype.toString.call(fn):'';if(Number(delay)===120&&src.includes("startCamera('senderAck')")){if($('streamMeta'))$('streamMeta').textContent='PASS_END · esperando detección del receptor…';phase('PASS_END · 4s DE GUARDA');return baseSetTimeout(fn,4000,...args);}return baseSetTimeout(fn,delay,...args);};
$('closeStream')?.addEventListener('click',e=>{if(!held)return;e.preventDefault();e.stopImmediatePropagation();resume();},true);
window.addEventListener('pagehide',()=>{held=null;});
window.__hopperPassHold={version:'0.4.4',active:true};
})();