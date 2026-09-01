(() => {
'use strict';
function ensure(){
  const panel=document.getElementById('receiverPanel');if(!panel)return null;
  let e=document.getElementById('binaryTagStatus');if(e)return e;
  e=document.createElement('div');e.id='binaryTagStatus';e.className='lock';e.style.top='46px';e.textContent='TAGS · 0/4';panel.appendChild(e);return e;
}
function tick(){
  const e=ensure();if(!e)return;const s=window.__hopperBinaryTagBridge?.last;
  if(!s){e.textContent='TAGS · 0/4';e.className='lock';return;}
  if(s.valid){e.textContent=`TAGS · 4/4 · IDs OK · ${s.quality||0}%`;e.className='lock good';}
  else{e.textContent=`TAGS · ${s.found||0}/4 · buscando IDs`;e.className='lock '+((s.found||0)>=3?'mid':'');}
}
setInterval(tick,120);tick();
})();
