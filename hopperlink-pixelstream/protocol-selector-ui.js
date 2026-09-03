(() => {
'use strict';
const VERSION='0.10.11';
const $=id=>document.getElementById(id);
function ensureAckWake(){if(document.querySelector('script[data-hps8-ack-wake]')||window.__hopperHPS8AckWake)return;const s=document.createElement('script');s.src='./hps8-ack-wake.js?v=1011';s.dataset.hps8AckWake='1';s.async=true;s.onerror=()=>console.error('No se pudo cargar HPS8 ACK Wake');document.head.appendChild(s);}
function install(){
  const select=$('protocolMode'),h7=$('protocolHps7'),h8=$('protocolHps8'),note=$('protocolChoiceNote');
  if(!select||!h7||!h8)return;
  const buttons=[h7,h8];
  function sync(){
    const mode=select.value==='hps7'?'hps7':'hps8';
    for(const b of buttons){const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');}
    if(note)note.textContent=mode==='hps7'
      ?'HPS7 Fullscreen Precision activo · ruta estable con Repair manual y Optical Dock persistente.'
      :'HPS8 PhotonFountain activo · Sonic PLL + ACK Wake fallback + Auto-Repair experimental.';
    document.documentElement.dataset.protocolMode=mode;
    if(mode==='hps8')ensureAckWake();
  }
  function choose(mode){
    if(select.value===mode){sync();return;}
    select.value=mode;
    select.dispatchEvent(new Event('change',{bubbles:true}));
    select.dispatchEvent(new Event('input',{bubbles:true}));
    sync();
  }
  h7.addEventListener('click',()=>choose('hps7'));
  h8.addEventListener('click',()=>choose('hps8'));
  select.addEventListener('change',sync);
  ensureAckWake();
  sync();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperProtocolSelectorUI={version:VERSION,explicitCards:true,modes:['hps7','hps8'],ackWakeLoader:true};
})();
