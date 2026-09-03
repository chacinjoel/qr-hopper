(() => {
'use strict';
const VERSION='0.10.12',$=id=>document.getElementById(id);
let lastProfile='—',observedStarts=0;
function isHps8(){return $('protocolMode')?.value==='hps8';}
function chip(){let e=$('hps8AckWakeChip');if(e)return e;const facts=document.querySelector('.compactFacts');if(!facts)return null;e=document.createElement('span');e.id='hps8AckWakeChip';e.className='chip';e.style.display='none';facts.insertBefore(e,$('phaseStatus')||null);return e;}
function show(text,kind='mid'){const e=chip();if(!e)return;e.style.display=isHps8()?'inline-flex':'none';e.className='chip '+kind;e.textContent=text;}
window.addEventListener('hopper:hps8-sonic-frame-stage',e=>{const d=e.detail||{};if(d.stage==='START_LOCK'||d.stage==='CLOCK_LOCK'){observedStarts++;lastProfile=String(d.profile||'—').toUpperCase();show(`PEER AUDIO · ${lastProfile} · esperando ACK CRC`,'mid');}});
window.addEventListener('hopper:hps8-ack-validated',e=>{lastProfile=String(e.detail?.profile||lastProfile).toUpperCase();show(`ACK CRC ✓ · ${lastProfile}`,'on');});
window.addEventListener('hopper:hps8-ack-rejected',()=>show('ACK descartado · sin CRC completo','mid'));
$('protocolMode')?.addEventListener('change',()=>{const e=chip();if(e)e.style.display=isHps8()?'inline-flex':'none';});
chip();
window.__hopperHPS8AckWake={version:VERSION,active:false,startLockWake:false,autoStartFromStart:false,diagnosticOnly:true,strictAckOnly:true,state:()=>({lastProfile,observedStarts})};
})();
