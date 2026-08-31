(() => {
'use strict';

const $ = id => document.getElementById(id);
let running = false;

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function ensureOverlay(){
  let o=$('repairPrerollOverlay');
  if(o)return o;
  o=document.createElement('div');
  o.id='repairPrerollOverlay';
  o.style.cssText='position:fixed;inset:0;z-index:120;background:#020617;display:none;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:24px;color:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
  o.innerHTML='<div id="repairPrerollLabel" style="font-size:clamp(18px,4vw,28px);font-weight:800;margin-bottom:16px">Preparando reparación</div><div id="repairPrerollCount" style="font-size:clamp(84px,26vw,180px);font-weight:900;line-height:1">3</div><div id="repairPrerollHint" style="margin-top:18px;max-width:560px;color:#cbd5e1;font-size:14px">Suelta el teléfono y apunta la cámara receptora al centro de la pantalla. Aún no se está enviando ningún frame.</div>';
  document.body.appendChild(o);
  return o;
}

function setPhase(text,kind='mid'){
  const e=$('phaseStatus');
  if(!e)return;
  e.textContent=text;
  e.className='chip '+kind;
}

async function runPreroll(original,event){
  if(running)return;
  running=true;
  const btn=$('txRepairBtn');
  if(btn)btn.disabled=true;
  const o=ensureOverlay(),count=$('repairPrerollCount'),label=$('repairPrerollLabel'),hint=$('repairPrerollHint');
  o.style.display='flex';
  document.body.style.overflow='hidden';
  setPhase('EMISOR · PREPARANDO REPARACIÓN','mid');

  const sendLog=$('sendLog');
  if(sendLog){const t=new Date().toLocaleTimeString();sendLog.textContent=`[${t}] Pre-roll de reparación iniciado · 3 segundos sin DATA.\n`+sendLog.textContent.slice(0,7000);}

  label.textContent='Preparando reparación';
  hint.textContent='Suelta el teléfono y apunta la cámara receptora al centro de la pantalla. Aún no se está enviando ningún frame.';
  for(const n of [3,2,1]){
    count.textContent=String(n);
    navigator.vibrate?.(n===1?60:25);
    await sleep(1000);
  }

  count.textContent='LISTO';
  count.style.fontSize='clamp(54px,16vw,110px)';
  label.textContent='Cámara estable';
  hint.textContent='La reparación comienza ahora.';
  navigator.vibrate?.(80);
  await sleep(450);

  o.style.display='none';
  document.body.style.overflow='';
  count.style.fontSize='clamp(84px,26vw,180px)';
  running=false;
  if(btn)btn.disabled=false;
  setPhase('EMISOR · INICIANDO REPARACIÓN','on');
  original?.call(btn,event);
}

function install(){
  const btn=$('txRepairBtn');
  if(!btn||btn.dataset.prerollInstalled==='1')return;
  const original=btn.onclick;
  btn.onclick=function(e){
    e?.preventDefault?.();
    runPreroll(original,e);
  };
  btn.dataset.prerollInstalled='1';
}

install();
window.__hopperRepairPreroll={version:'0.5.2',active:true,seconds:3,settleMs:450};
})();
