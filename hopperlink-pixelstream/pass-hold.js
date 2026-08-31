(() => {
'use strict';
const baseSetInterval=window.setInterval.bind(window);
const baseSetTimeout=window.setTimeout.bind(window);
const $=id=>document.getElementById(id);
let held=null,btn=null;
function ensure(){if(btn)return btn;const row=document.querySelector('#streamOverlay .streamTop .row');if(!row)return null;btn=document.createElement('button');btn.type='button';btn.id='passContinueBtn';btn.className='btn good';btn.style.display='none';row.insertBefore(btn,row.firstChild);btn.addEventListener('click',resume);return btn;}
function phase(t){const e=$('phaseStatus');if(e){e.textContent=t;e.className='chip mid';}}
function show(kind){const b=ensure();if(!b)return;b.style.display='inline-flex';if(kind==='start'){
 b.textContent='Receptor listo · Iniciar transferencia';
 if($('streamBottom'))$('streamBottom').textContent='FRAME 1 retenido. Espera hasta que el receptor muestre “Sesión bloqueada” y 1 frame recibido; luego pulsa Iniciar transferencia.';
 phase('FRAME 1 · ESPERANDO RECEPTOR');
}else{
 b.textContent='Último frame recibido · Continuar';
 if($('streamBottom'))$('streamBottom').textContent='Último DATA retenido. Confirma que el receptor lo contó y pulsa Continuar.';
 phase('ÚLTIMO FRAME · ESPERANDO CONTINUAR');
}}
function hide(){const b=ensure();if(b)b.style.display='none';}
function frameMeta(meta){const m=String(meta||'').match(/Frame\s+(\d+)\/(\d+)/i);return m?{index:+m[1],total:+m[2]}:null;}
function resume(){if(!held)return;const h=held;held=null;hide();h.resumeRequested=true;if($('streamBottom'))$('streamBottom').textContent=h.kind==='start'?'Sesión confirmada. Iniciando transferencia…':'Finalizando último DATA y publicando PASS_END…';phase(h.kind==='start'?'INICIANDO TRANSFERENCIA':'FINALIZANDO PASADA');}
window.setInterval=function(fn,delay,...args){
 if(typeof fn==='function'){
  const src=Function.prototype.toString.call(fn);
  if(src.includes('buildDataPacket(idx,round)')&&src.includes('inEnd')){
   let id;let localHold=false;let resumeRequested=false;let holdKind=null;let startHeld=false;let lastHeld=false;
   const wrapped=(...cb)=>{
    if(localHold&&!resumeRequested)return;
    fn(...cb);
    const meta=$('streamMeta')?.textContent||'';
    const fm=frameMeta(meta);
    if(!localHold&&fm){
      if(!startHeld&&fm.index===1){
        startHeld=true;localHold=true;resumeRequested=false;holdKind='start';
        held={intervalId:id,kind:'start',get resumeRequested(){return resumeRequested},set resumeRequested(v){resumeRequested=v;}};
        show('start');return;
      }
      if(startHeld&&!lastHeld&&fm.index===fm.total){
        lastHeld=true;localHold=true;resumeRequested=false;holdKind='last';
        held={intervalId:id,kind:'last',get resumeRequested(){return resumeRequested},set resumeRequested(v){resumeRequested=v;}};
        show('last');return;
      }
    }
    if(localHold&&resumeRequested){
      if(holdKind==='start'){
        localHold=false;resumeRequested=false;holdKind=null;
        if($('streamBottom'))$('streamBottom').textContent='Transferencia en curso…';
        phase('EMITIENDO');
      }else if(holdKind==='last'&&/^Fin de pasada/i.test(meta)){
        localHold=false;resumeRequested=false;holdKind=null;hide();
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
window.setTimeout=function(fn,delay,...args){const src=typeof fn==='function'?Function.prototype.toString.call(fn):'';if(Number(delay)===120&&src.includes("startCamera('senderAck')")){if($('streamMeta'))$('streamMeta').textContent='PASS_END · esperando detección del receptor…';phase('PASS_END · 4s DE GUARDA');return baseSetTimeout(fn,4000,...args);}return baseSetTimeout(fn,delay,...args);};
$('closeStream')?.addEventListener('click',e=>{if(!held)return;e.preventDefault();e.stopImmediatePropagation();resume();},true);
window.addEventListener('pagehide',()=>{held=null;});
window.__hopperPassHold={version:'0.4.6',active:true,firstFrameHandshake:true};
})();