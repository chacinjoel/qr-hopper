(() => {
'use strict';

const baseSetInterval = window.setInterval.bind(window);
const baseSetTimeout = window.setTimeout.bind(window);
const $ = id => document.getElementById(id);

let heldPass = null;
let continueBtn = null;

function ensureButton(){
  if(continueBtn) return continueBtn;
  const row = document.querySelector('#streamOverlay .streamTop .row');
  if(!row) return null;
  continueBtn = document.createElement('button');
  continueBtn.type = 'button';
  continueBtn.id = 'passContinueBtn';
  continueBtn.className = 'btn good';
  continueBtn.textContent = 'Último frame recibido · Continuar';
  continueBtn.style.display = 'none';
  row.insertBefore(continueBtn, row.firstChild);
  continueBtn.addEventListener('click', continuePass);
  return continueBtn;
}

function setPhaseText(text){
  const el = $('phaseStatus');
  if(el){
    el.textContent = text;
    el.className = 'chip mid';
  }
}

function showHold(){
  const btn = ensureButton();
  if(btn) btn.style.display = 'inline-flex';
  const bottom = $('streamBottom');
  if(bottom) bottom.textContent = 'Último DATA retenido. Comprueba en el receptor que llegó; luego pulsa “Continuar”. No hay límite de tiempo.';
  setPhaseText('ÚLTIMO FRAME · ESPERANDO CONTINUAR');
}

function hideHold(){
  const btn = ensureButton();
  if(btn) btn.style.display = 'none';
}

function isLastDataMeta(meta){
  const m = String(meta || '').match(/Frame\s+(\d+)\/(\d+)/i);
  return !!m && Number(m[1]) === Number(m[2]);
}

function continuePass(){
  if(!heldPass) return;
  const current = heldPass;
  current.active = false;
  hideHold();

  // Completa las repeticiones pendientes del último DATA y avanza hasta que
  // HPS4 dibuje PASS_END. El bucle es pequeño porque repeat=3 actualmente.
  for(let i=0;i<8;i++){
    try{ current.fn(); }catch(e){ break; }
    const meta = $('streamMeta')?.textContent || '';
    if(/^Fin de pasada/i.test(meta)) break;
  }

  heldPass = null;
  const bottom = $('streamBottom');
  if(bottom) bottom.textContent = 'PASS_END visible. El receptor tiene varios segundos para detectarlo; después el emisor abrirá su cámara para leer el NACK.';
  setPhaseText('PASS_END · SINCRONIZANDO');
}

// HPS4 crea un setInterval cuyo callback contiene buildDataPacket(idx,round).
// Lo envolvemos para congelarlo en cuanto aparece por primera vez el último DATA.
window.setInterval = function(fn, delay, ...args){
  if(typeof fn === 'function'){
    const source = Function.prototype.toString.call(fn);
    if(source.includes('buildDataPacket(idx,round)') && source.includes('inEnd')){
      let intervalId;
      const wrapped = (...cbArgs) => {
        if(heldPass?.intervalId === intervalId && heldPass.active) return;
        fn(...cbArgs);
        const meta = $('streamMeta')?.textContent || '';
        if(!heldPass && isLastDataMeta(meta)){
          heldPass = {intervalId, fn: () => fn(...cbArgs), active:true};
          showHold();
        }
      };
      intervalId = baseSetInterval(wrapped, delay, ...args);
      return intervalId;
    }
  }
  return baseSetInterval(fn, delay, ...args);
};

// HPS4 antes cambiaba a cámara 120 ms después de terminar PASS_END. Extendemos
// ese periodo para que PASS_END quede visible varios segundos y sea prácticamente
// imposible perderlo. El NACK ya es persistente en v0.4.1, por lo que puede esperar.
window.setTimeout = function(fn, delay, ...args){
  if(typeof fn === 'function'){
    const source = Function.prototype.toString.call(fn);
    if(Number(delay) === 120 && source.includes("startCamera('senderAck')")){
      const meta = $('streamMeta');
      if(meta) meta.textContent = 'PASS_END · esperando detección del receptor…';
      setPhaseText('PASS_END · 3s DE GUARDA');
      return baseSetTimeout(fn, 3000, ...args);
    }
  }
  return baseSetTimeout(fn, delay, ...args);
};

// Si se pulsa Cerrar mientras estamos reteniendo el último DATA, lo tratamos
// como Continuar para no dejar el protocolo suspendido accidentalmente.
$('closeStream')?.addEventListener('click', e => {
  if(!heldPass) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  continuePass();
}, true);

window.addEventListener('pagehide', () => { heldPass = null; });
window.__hopperPassHold = {version:'0.4.3', active:true};
})();
