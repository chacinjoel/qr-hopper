(() => {
'use strict';
function ensure(){
  const panel=document.getElementById('receiverPanel');if(!panel)return null;
  let e=document.getElementById('binaryTagStatus');if(e)return e;
  e=document.createElement('div');e.id='binaryTagStatus';e.className='lock';e.style.top='46px';e.textContent='TAGS · 0/4';panel.appendChild(e);return e;
}
function motionLabel(s){
  if(!Number.isFinite(s?.motionNorm))return'';
  const p=s.motionNorm;
  return p<.045?' · ESTABLE':p<.10?' · MOVIMIENTO':' · TEMBLOR';
}
function tick(){
  const e=ensure();if(!e)return;const s=window.__hopperBinaryTagBridge?.last;
  if(!s){e.textContent='TAGS · 0/4';e.className='lock';return;}
  if(s.valid){
    e.textContent=`TAGS · 4/4 · IDs OK · ${s.quality||0}%${motionLabel(s)}`;
    e.className='lock '+(s.motionNorm<.10?'good':'mid');
  }else{e.textContent=`TAGS · ${s.found||0}/4 · buscando IDs`;e.className='lock '+((s.found||0)>=3?'mid':'');}
}
function loadRepairReacquisition(){
  if(window.__hopperRepairReacquisition||document.querySelector('script[data-hopper-repair-lock]'))return;
  const s=document.createElement('script');s.src='./repair-reacquisition.js?v=0910';s.dataset.hopperRepairLock='1';s.async=false;document.head.appendChild(s);
}
setInterval(tick,100);tick();loadRepairReacquisition();
})();