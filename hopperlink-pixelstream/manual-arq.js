(() => {
'use strict';

const nativeSetTimeout = window.setTimeout.bind(window);
const nativeClearTimeout = window.clearTimeout.bind(window);
let pendingNackEnd = null;
let pendingRepair = null;
let nackToken = null;
let repairToken = null;

const $ = id => document.getElementById(id);

function setPhase(text, cls='mid') {
  const el = $('phaseStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'chip ' + cls;
}

function showNackControl() {
  const btn = $('nackContinueBtn');
  if (btn) btn.style.display = 'inline-flex';
  const hint = $('streamBottom');
  if (hint) hint.textContent = 'NACK en espera manual. Déjalo visible hasta que el emisor confirme que lo leyó; luego pulsa “NACK leído · continuar”.';
  setPhase('NACK · ESPERANDO CIERRE MANUAL', 'mid');
}

function hideNackControl() {
  const btn = $('nackContinueBtn');
  if (btn) btn.style.display = 'none';
}

function showRepairControl() {
  const btn = $('repairStartBtn');
  if (btn) btn.style.display = 'inline-flex';
  setPhase('NACK RECIBIDO · REPARACIÓN MANUAL', 'mid');
  const log = $('sendLog');
  if (log) {
    const t = new Date().toLocaleTimeString();
    log.textContent = `[${t}] NACK recibido. Espera a que el receptor cierre su NACK y vuelva a cámara; luego pulsa “Iniciar reparación”.\n` + log.textContent.slice(0,6000);
  }
}

function hideRepairControl() {
  const btn = $('repairStartBtn');
  if (btn) btn.style.display = 'none';
}

function runPendingNackEnd() {
  if (!pendingNackEnd) return;
  const fn = pendingNackEnd;
  pendingNackEnd = null;
  nackToken = null;
  hideNackControl();
  fn();
}

function runPendingRepair() {
  if (!pendingRepair) return;
  const fn = pendingRepair;
  pendingRepair = null;
  repairToken = null;
  hideRepairControl();
  setPhase('INICIANDO REPARACIÓN', 'on');
  fn();
}

window.setTimeout = function(fn, delay, ...args) {
  const ms = Number(delay) || 0;
  const source = typeof fn === 'function' ? Function.prototype.toString.call(fn) : '';
  const meta = $('streamMeta')?.textContent || '';

  // HPS4 v0.4 termina el NACK automáticamente a los 6000 ms.
  // Interceptamos únicamente ese cierre cuando el overlay está mostrando NACK.
  if (typeof fn === 'function' && ms === 6000 && meta.startsWith('NACK') && source.includes('stopTransmit(true)')) {
    pendingNackEnd = () => fn(...args);
    nackToken = { __hopperManualTimeout: true, kind: 'nack' };
    showNackControl();
    return nackToken;
  }

  // El emisor antes arrancaba la reparación por temporizador. Lo convertimos
  // en un paso manual para que el receptor tenga tiempo de cerrar NACK y volver a cámara.
  if (typeof fn === 'function' && source.includes('emitIndices(missing')) {
    pendingRepair = () => fn(...args);
    repairToken = { __hopperManualTimeout: true, kind: 'repair' };
    showRepairControl();
    return repairToken;
  }

  return nativeSetTimeout(fn, ms, ...args);
};

window.clearTimeout = function(token) {
  if (token?.__hopperManualTimeout) {
    if (token.kind === 'nack') {
      pendingNackEnd = null;
      nackToken = null;
      hideNackControl();
    } else if (token.kind === 'repair') {
      pendingRepair = null;
      repairToken = null;
      hideRepairControl();
    }
    return;
  }
  return nativeClearTimeout(token);
};

$('nackContinueBtn')?.addEventListener('click', runPendingNackEnd);
$('repairStartBtn')?.addEventListener('click', runPendingRepair);

// Si el usuario pulsa el botón genérico Cerrar mientras el NACK está retenido,
// interpretamos la acción como “NACK leído · continuar” para no romper el flujo ARQ.
$('closeStream')?.addEventListener('click', e => {
  if (!pendingNackEnd) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  runPendingNackEnd();
}, true);

window.addEventListener('pagehide', () => {
  pendingNackEnd = null;
  pendingRepair = null;
});
})();
