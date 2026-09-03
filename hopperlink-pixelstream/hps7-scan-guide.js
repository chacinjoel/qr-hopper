(() => {
'use strict';
const VERSION='0.10.8',$=id=>document.getElementById(id),root=document.documentElement;
function isHps7(){return $('protocolMode')?.value==='hps7';}
function isDual(){const phase=$('phaseStatus')?.textContent||'';return /DUAL/.test(phase)||$('streamShape')?.value==='tall2';}
function ensure(){const panel=$('receiverPanel');if(!panel)return null;let e=$('hps7ScanCoach');if(e)return e;e=document.createElement('div');e.id='hps7ScanCoach';e.className='hps7ScanCoach';e.textContent='ENCUADRA TODO EL MARCO HPS7';panel.appendChild(e);return e;}
function syncLayout(){const h7=isHps7(),dual=h7&&isDual();root.classList.toggle('hps7-scan-precision',h7);root.classList.toggle('hps7-scan-dual',dual);root.classList.toggle('hps7-scan-square',h7&&!dual);const e=ensure();if(e)e.style.display=h7?'block':'none';}
function tick(){syncLayout();if(!isHps7())return;const e=ensure();if(!e)return;const d=window.__hopperOpticalDockV3?.last,b=window.__hopperBinaryTagBridge?.last,s=d?.valid?d:(b?.valid?b:null),dual=isDual();if(!s?.valid){e.textContent=`ENCUADRA TODO EL MARCO · ${dual?'VERTICAL 1:2':'CUADRADO'}`;e.dataset.state='search';return;}const src=String(s.source||s.dock?.source||'TRACK').toUpperCase().replace('TAG-MEMORY','TAG TRACK');if(s.phaseMismatch){e.textContent='HOLD · ROLLING SHUTTER · MANTÉN AMBOS TELÉFONOS QUIETOS';e.dataset.state='hold';return;}if(Number.isFinite(s.motionNorm)&&s.motionNorm>.07){e.textContent='MOVIMIENTO · ESTABILIZA EL ENCUADRE';e.dataset.state='move';return;}if(s.stableForDecode===false||s.held){e.textContent=`${src} · HOLD · CONSERVANDO GEOMETRÍA`;e.dataset.state='hold';return;}e.textContent=`LOCK PRECISION · ${src} · ${s.normalized?'NORM · ':''}NO MUEVAS LOS TELÉFONOS`;e.dataset.state='lock';}
function install(){ensure();syncLayout();$('protocolMode')?.addEventListener('change',syncLayout);$('streamShape')?.addEventListener('change',syncLayout);setInterval(tick,100);tick();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperHPS7ScanGuide={version:VERSION,precisionGuide:true,dualShape:true,opticalDockAware:true};
})();
