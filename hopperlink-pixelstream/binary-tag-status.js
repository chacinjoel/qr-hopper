(() => {
'use strict';
function ensure(){
  const panel=document.getElementById('receiverPanel');if(!panel)return null;
  let e=document.getElementById('binaryTagStatus');if(e)return e;
  e=document.createElement('div');e.id='binaryTagStatus';e.className='lock';e.style.top='46px';e.textContent='DOCK · BUSCANDO';panel.appendChild(e);return e;
}
function motionLabel(s){if(!Number.isFinite(s?.motionNorm))return'';const p=s.motionNorm;return p<.025?' · ESTABLE':p<.065?' · MOVIMIENTO':' · TEMBLOR';}
function sourceLabel(s){const x=s?.source||s?.dock?.source;if(x==='tags')return'TAGS';if(x==='tag-memory')return'TAGS TRACK';if(x==='contour')return'CONTORNO';if(x==='track')return'TRACK';return'TAGS';}
function tick(){
  const e=ensure();if(!e)return;const b=window.__hopperBinaryTagBridge?.last,d=window.__hopperOpticalDockV2?.last,s=d?.valid?d:b;
  if(!s){e.textContent='DOCK · BUSCANDO';e.className='lock';return;}
  if(s.valid){const gate=s.stableForDecode===false?' · FRAME HOLD':'',photo=s.photometricOK===false?' · LUZ BAJA':'',src=sourceLabel(s);e.textContent=`DOCK · ${src} · ${s.quality||0}%${motionLabel(s)}${gate}${photo}`;e.className='lock '+(s.stableForDecode!==false&&s.motionNorm<.07?'good':'mid');}
  else{const found=b?.found||0;e.textContent=`DOCK · ${found}/4 TAGS · buscando contorno`;e.className='lock '+(found>=3?'mid':'');}
}
setInterval(tick,100);tick();
window.__hopperBinaryTagStatus={version:'0.9.16',opticalDockV2:true,legacyRepairAutoload:false};
})();
