(() => {
'use strict';
const VERSION='0.10.6';
const $=id=>document.getElementById(id);
function install(){
  const select=$('protocolMode'),h7=$('protocolHps7'),h8=$('protocolHps8'),note=$('protocolChoiceNote');
  if(!select||!h7||!h8)return;
  const buttons=[h7,h8];
  function sync(){
    const mode=select.value==='hps7'?'hps7':'hps8';
    for(const b of buttons){const active=b.dataset.mode===mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active?'true':'false');}
    if(note)note.textContent=mode==='hps7'
      ?'HPS7 Fullscreen Max activo · ruta estable con Repair manual y máxima superficie óptica.'
      :'HPS8 PhotonFountain activo · Fountain/FEC + Sonic8 Robust + Auto-Repair experimental.';
    document.documentElement.dataset.protocolMode=mode;
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
  sync();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperProtocolSelectorUI={version:VERSION,explicitCards:true,modes:['hps7','hps8']};
})();
