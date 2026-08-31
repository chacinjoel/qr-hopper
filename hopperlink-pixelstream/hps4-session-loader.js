(() => {
'use strict';

const $ = id => document.getElementById(id);

function log(msg){
  const el = $('rxLog');
  if(!el) return;
  const t = new Date().toLocaleTimeString();
  el.textContent = `[${t}] ${msg}\n` + el.textContent.slice(0,6000);
}

async function boot(){
  const res = await fetch('./hps4.js?v=044core', {cache:'no-store'});
  if(!res.ok) throw new Error(`No se pudo cargar HPS4 core (${res.status})`);
  let code = await res.text();

  const oldParse = "function parsePacket(bytes){if(bytes.length<28)return null;for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;if(bytes[4]!==VERSION)return null;const type=bytes[5],grid=bytes[6],session=readU32(bytes,8),round=readU16(bytes,12),index=readU32(bytes,14),total=readU32(bytes,18),len=readU16(bytes,22),expected=readU32(bytes,24);if(len>bytes.length-28)return null;const payload=bytes.slice(28,28+len);if(crc32(payload)!==expected)return{bad:true};return{type,grid,session,round,index,total,payload}}";
  const newParse = "function parsePacket(bytes){if(bytes.length<28)return null;for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;if(bytes[4]!==VERSION||bytes[7]!==0)return null;const type=bytes[5],grid=bytes[6],session=readU32(bytes,8),round=readU16(bytes,12),index=readU32(bytes,14),total=readU32(bytes,18),len=readU16(bytes,22),expected=readU32(bytes,24);if(type!==TYPE.DATA&&type!==TYPE.PASS_END&&type!==TYPE.CONTROL)return null;if(grid!==32&&grid!==40&&grid!==48&&grid!==56)return null;if(session===0||total===0||round>4095||len>bytes.length-28||len>payloadCapacity(grid))return null;if(type===TYPE.DATA&&index>=total)return null;if(type===TYPE.CONTROL&&index>=total)return null;if(type===TYPE.PASS_END&&index>total)return null;const payload=bytes.slice(28,28+len);if(crc32(payload)!==expected)return{bad:true};return{type,grid,session,round,index,total,payload}}";

  const oldAccept = "function acceptData(p){if(rx.session!==null&&rx.session!==p.session)resetReceiver(p.session,p.total);if(rx.session===null)resetReceiver(p.session,p.total);if(!rx.chunks.has(p.index)){rx.chunks.set(p.index,p.payload);$('rxFrames').textContent=rx.chunks.size;$('rxTotal').textContent=rx.total;$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';if($('rxMissing'))$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);updateMetrics()}setPhase(`RECIBIENDO · ronda ${p.round+1}`,'on')}";
  const newAccept = "function acceptData(p){if(rx.session===null){resetReceiver(p.session,p.total);rlog(`Sesión bloqueada: ${p.session.toString(16)} · ${p.total} frames.`)}else if(rx.session!==p.session){rx.errors++;$('rxErrors').textContent=rx.errors;rx.foreignSeen=(rx.foreignSeen||0)+1;if(rx.foreignSeen<=2)rlog('Frame con sessionId inconsistente ignorado; la transferencia activa se conserva.');return}else if(p.total!==rx.total){rx.errors++;$('rxErrors').textContent=rx.errors;return}if(!rx.chunks.has(p.index)){rx.chunks.set(p.index,p.payload);$('rxFrames').textContent=rx.chunks.size;$('rxTotal').textContent=rx.total;$('rxBar').style.width=((rx.chunks.size/rx.total)*100).toFixed(1)+'%';if($('rxMissing'))$('rxMissing').textContent=Math.max(0,rx.total-rx.chunks.size);updateMetrics()}setPhase(`RECIBIENDO · ronda ${p.round+1}`,'on')}";

  if(!code.includes(oldParse)) throw new Error('No se encontró parsePacket esperado; no se aplicó Session Guard.');
  if(!code.includes(oldAccept)) throw new Error('No se encontró acceptData esperado; no se aplicó Session Guard.');

  code = code.replace(oldParse, newParse).replace(oldAccept, newAccept);
  new Function(code)();
  window.__hopperSessionGuard = {version:'0.4.4', active:true};
  log('Session Guard v0.4.4 activo: una lectura dudosa ya no puede reiniciar el archivo.');
}

boot().catch(err => {
  console.error(err);
  log('ERROR Session Guard: ' + (err?.message || err));
  alert('No se pudo iniciar HPS4 Session Guard: ' + (err?.message || err));
});
})();
