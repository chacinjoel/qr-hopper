(() => {
'use strict';
const $=id=>document.getElementById(id);
const BASE=367,HEADER=28,PILOT=32;
let lastStep=1;

function bits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function dual(){return $('streamShape')?.value==='tall2';}
function fpsFor(b){const m=$('speedMode')?.value||'maxcal';if(m==='maxcal')return b===2?15:b===3?12:10;if(m==='compatible')return 8;if(m==='balanced')return 12;if(m==='turbo')return 15;if(m==='optical')return 18;return 12;}
function repeatFor(){return ($('speedMode')?.value||'maxcal')==='compatible'?2:1;}
function payload(grid,b){return Math.floor((grid*grid-PILOT)*b/8)-HEADER;}
function blocksLane(grid,b){return Math.max(1,Math.floor((payload(grid,b)-1)/(BASE+6)));}
function fmt(sec){sec=Math.max(0,Math.round(sec));const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}

function setCoach(title,detail,step=lastStep){
  lastStep=step;const t=$('flowCoachTitle'),d=$('flowCoachDetail');if(t)t.textContent=title;if(d)d.textContent=detail;
  document.querySelectorAll('.flowStep').forEach((e,i)=>{const n=i+1;e.classList.toggle('active',n===step);e.classList.toggle('done',n<step);});
}
function syncHints(){
  const b=bits(),grid=Number($('gridSize')?.value||56),lanes=dual()?2:1,perLane=blocksLane(grid,b),perPhysical=perLane*lanes,fps=fpsFor(b),repeat=repeatFor(),bps=perPhysical*BASE*fps/repeat,six=6*1024*1024/Math.max(1,bps);
  const sp=$('speedHint'),mp=$('modulationHint'),lp=$('layoutHint'),tp=$('throughputHint');
  if(sp)sp.textContent=`${$('speedMode')?.selectedOptions?.[0]?.textContent||'Velocidad'} · ${fps} streams/s · repeat ${repeat}.`;
  if(mp)mp.textContent=`${b}-bit · ${1<<b} símbolos · ${perLane} bloques/lane × ${lanes} lane${lanes>1?'s':''} = ${perPhysical} bloques/stream físico.`;
  if(lp)lp.textContent=dual()?`DualLane · 2 grids ${grid}×${grid} simultáneos · misma escala física por celda.`:`Square · 1 grid ${grid}×${grid} · ${perPhysical} bloques/stream físico.`;
  if(tp)tp.textContent=`Teórico perfecto: ${(bps/1024).toFixed(1)} KiB/s · 6 MiB ≈ ${fmt(six)} · antes de pérdidas/NACK/Repair.`;
}
function syncMainButtons(){
  const prep=$('prepareBtn'),send=$('sendBtn');if(!prep||!send)return;
  const ready=!send.disabled;
  prep.textContent=ready?'Repreparar':'Preparar HPS7';prep.classList.toggle('action-secondary',ready);prep.classList.toggle('primary',!ready);
  send.style.display=ready?'inline-flex':'none';send.classList.add('grow');
}
function syncOpticalActions(){
  const phase=$('phaseStatus')?.textContent||'',finish=$('finishRepairBtn');if(!finish)return;
  const active=/EMISOR · REPAIR(?! TARGET)/i.test(phase);finish.style.display=active?'inline-flex':'none';
}
function installDocks(){
  const sender=$('senderActionDock');if(sender){for(const id of ['prepareBtn','sendBtn','txRepairBtn']){const b=$(id);if(b&&!sender.contains(b))sender.appendChild(b);}}
  const receiver=$('receiverActionDock');if(receiver){for(const id of ['cameraBtn','stopCameraBtn']){const b=$(id);if(b&&!receiver.contains(b))receiver.appendChild(b);}}
}
function installFinishRepair(){
  const dock=$('streamActions');if(!dock||$('finishRepairBtn'))return;
  const b=document.createElement('button');b.id='finishRepairBtn';b.className='btn good';b.textContent='Finalizar ronda';b.style.display='none';b.title='Úsalo si el receptor ya llegó a 0 faltantes; el emisor saltará al PASS_END en cuanto el runtime lo permita.';
  b.onclick=()=>{window.__hopperFinishRepairEarly=true;b.disabled=true;b.textContent='Finalizando…';setTimeout(()=>{b.disabled=false;b.textContent='Finalizar ronda';},1500);};dock.insertBefore(b,$('closeStream')||null);
}
function observe(){
  const phase=$('phaseStatus');if(phase)new MutationObserver(()=>{syncOpticalActions();const s=phase.textContent||'';if(/PREPARADO/.test(s))setCoach('Ahora inicia la cámara del receptor','Cuando esté lista, vuelve al emisor y pulsa “Mostrar HELLO”.',2);else if(/HELLO/.test(s))setCoach('Alinea el HELLO con la cámara receptora','Espera a que el receptor confirme que la sesión quedó bloqueada antes de iniciar DATA.',2);else if(/DATA|SENDING/.test(s))setCoach('Transferencia DATA en curso','Mantén ambos teléfonos quietos y el rectángulo completo dentro de cámara.',3);else if(/PASS_END/.test(s))setCoach('Ronda terminada','El receptor calculará si falta información. Si hay NACK, léelo desde el emisor.',4);else if(/REPAIR TARGET/.test(s))setCoach('Recupera LOCK antes del Repair','Vuelve el receptor a cámara, espera TAGS 4/4 / LOCK y pulsa el único botón inferior.',4);else if(/REPAIR/.test(s))setCoach('Repair en curso','Si el receptor llega a 0 faltantes antes de terminar los ciclos, puedes pulsar “Finalizar ronda”.',4);else if(/DONE|COMPLET/.test(s))setCoach('Transferencia completada','Verifica el CRC y descarga el archivo reconstruido.',5);}).observe(phase,{childList:true,characterData:true,subtree:true});
  const send=$('sendBtn');if(send)new MutationObserver(syncMainButtons).observe(send,{attributes:true,attributeFilter:['disabled','style','class']});
}

window.addEventListener('hopper:hello',()=>setCoach('Sesión sincronizada','La siguiente fase es DATA. Ya no necesitas tocar el receptor mientras conserve LOCK.',3));
window.addEventListener('hopper:nack',e=>{const m=e.detail?.missing,c=e.detail?.cycles;setCoach(`NACK recibido · ${m} faltantes`,c>1?`El Repair hará ${c} ciclos internos antes del siguiente PASS_END.`:'Se hará una pasada de Repair antes del siguiente PASS_END.',4);});
window.addEventListener('hopper:repair-target',e=>setCoach('Target de Repair listo',`Mantén el target fijo hasta que el receptor muestre LOCK. Plan: ${e.detail?.cycles||1} ciclo(s).`,4));
window.addEventListener('hopper:complete',()=>setCoach('✓ Archivo reconstruido y verificado','CRC confirmado. La transferencia terminó correctamente.',5));
window.addEventListener('hopper:passend',()=>{window.__hopperFinishRepairEarly=false;syncOpticalActions();});

function install(){
  installDocks();installFinishRepair();syncHints();syncMainButtons();syncOpticalActions();observe();
  for(const id of ['gridSize','streamShape','modulationMode','speedMode'])$(id)?.addEventListener('change',()=>setTimeout(syncHints,0));
  $('prepareBtn')?.addEventListener('click',()=>setTimeout(()=>{syncHints();syncMainButtons();},120));
  setCoach('Prepara la transferencia','Selecciona el archivo y configura Grid, formato, modulación y velocidad. HPS7 calculará los streams físicos antes de empezar.',1);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperPremiumFlow={version:'0.9.14',guided:true,bottomDocks:true,dualAwareHints:true,earlyRepairFinish:true};
})();
