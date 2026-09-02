(() => {
'use strict';
function ensure(){
  const panel=document.getElementById('receiverPanel');if(!panel)return null;
  let e=document.getElementById('binaryTagStatus');if(e)return e;
  e=document.createElement('div');e.id='binaryTagStatus';e.className='lock';e.style.top='46px';e.textContent='DOCK · BUSCANDO';panel.appendChild(e);return e;
}
function motionLabel(s){if(!Number.isFinite(s?.motionNorm))return'';const p=s.motionNorm;return p<.025?' · ESTABLE':p<.07?' · MOVIMIENTO':' · TEMBLOR';}
function sourceLabel(s){const x=s?.source||s?.dock?.source;if(x==='tags')return'TAGS';if(x==='tag-memory')return'TAGS TRACK';if(x==='contour')return'CONTORNO';if(x==='track')return'TRACK';if(x==='contour-candidate')return'CONTORNO…';return'BUSCANDO';}
function phaseLabel(s){if(s?.phaseMismatch)return' · ROLLING';if(s?.phaseKnown&&Number.isFinite(s?.phase?.phase))return` · PH${s.phase.phase}`;return'';}
function exposureLabel(s){return Number.isFinite(s?.exposureEV)?` · EV ${s.exposureEV>0?'+':''}${s.exposureEV.toFixed(1)}`:'';}
function tick(){
  const e=ensure();if(!e)return;const b=window.__hopperBinaryTagBridge?.last,d=window.__hopperOpticalDockV3?.last,s=d?.valid?d:b;
  if(!s){e.textContent='DOCK · BUSCANDO';e.className='lock';return;}
  if(s.valid){
    const gate=s.stableForDecode===false?' · HOLD':'',photo=s.photometricOK===false?' · LUZ':'',norm=s.normalized?' · NORM':'',src=sourceLabel(s);
    e.textContent=`DOCK · ${src} · ${s.quality||0}%${motionLabel(s)}${phaseLabel(s)}${norm}${exposureLabel(s)}${gate}${photo}`;
    e.className='lock '+(s.stableForDecode!==false&&(!Number.isFinite(s.motionNorm)||s.motionNorm<.075)?'good':'mid');
  }else{const found=b?.found||0;e.textContent=`DOCK · ${found}/4 TAGS · ${sourceLabel(s)}`;e.className='lock '+(found>=3?'mid':'');}
}
setInterval(tick,100);tick();
window.__hopperBinaryTagStatus={version:'0.9.17',opticalDockV3:true,legacyRepairAutoload:false};
})();
