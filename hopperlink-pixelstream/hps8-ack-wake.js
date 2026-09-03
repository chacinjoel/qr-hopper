(() => {
'use strict';
const VERSION='0.10.11',$=id=>document.getElementById(id);
let wakeTimer=null,lastStartAt=0,lastProfile='—',fallbackStarts=0;
function isHps8(){return $('protocolMode')?.value==='hps8';}
function senderHello(){const p=$('phaseStatus')?.textContent||'',o=$('streamOverlay'),b=$('overlayActionBtn');return isHps8()&&/EMISOR\s*·\s*HPS8\s*HELLO/i.test(p)&&o&&getComputedStyle(o).display!=='none'&&b&&!b.disabled&&b.style.display!=='none';}
function overlay(text,kind=''){let e=$('sonicOverlayDiag'),o=$('streamOverlay');if(!o)return;if(!e){e=document.createElement('div');e.id='sonicOverlayDiag';e.style.cssText='position:absolute;left:12px;top:max(52px,calc(env(safe-area-inset-top) + 42px));z-index:75;padding:7px 9px;border-radius:10px;background:rgba(2,6,23,.84);border:1px solid rgba(103,232,249,.42);color:#dbeafe;font:800 10px ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none';o.appendChild(e);}e.textContent=text;e.dataset.kind=kind;}
function chip(){let e=$('hps8AckWakeChip');if(e)return e;const facts=document.querySelector('.compactFacts');if(!facts)return null;e=document.createElement('span');e.id='hps8AckWakeChip';e.className='chip';e.style.display='none';facts.insertBefore(e,$('phaseStatus')||null);return e;}
function showChip(text,kind='on'){const e=chip();if(!e)return;e.style.display=isHps8()?'inline-flex':'none';e.className='chip '+kind;e.textContent=text;}
function cancelPending(reason=''){if(wakeTimer){clearTimeout(wakeTimer);wakeTimer=null;}if(reason==='ACK')showChip('ACK CRC/HEADER ✓','on');}
function triggerFallback(){wakeTimer=null;if(!senderHello())return;const b=$('overlayActionBtn');fallbackStarts++;showChip(`ACK WAKE ✓ · ${lastProfile}`,'on');overlay(`SONIC · ACK WAKE ✓ · ${lastProfile} START LOCK → DATA`,'ok');try{window.dispatchEvent(new CustomEvent('hopper:hps8-ack-wake',{detail:{profile:lastProfile,fallbackStarts,version:VERSION}}));}catch{}b.click();}
function armFromStart(d={}){if(!senderHello())return;if(!(d.pllDecoder||d.slotDecoder))return;const now=performance.now();if(now-lastStartAt<180)return;lastStartAt=now;lastProfile=String(d.profile||'—').toUpperCase();cancelPending();showChip(`ACK WAKE · ${lastProfile}…`,'mid');overlay(`SONIC · PEER START ✓ · ${lastProfile} · esperando ACK/header…`,'signal');wakeTimer=setTimeout(triggerFallback,420);}
window.addEventListener('hopper:hps8-sonic-frame-stage',e=>{const d=e.detail||{};if(d.stage==='START_LOCK'||d.stage==='CLOCK_LOCK')armFromStart(d);if(d.stage==='HEADER_OK'&&senderHello()){cancelPending('ACK');}});
window.addEventListener('hopper:hps8-sonic-early-ack',()=>cancelPending('ACK'));
window.addEventListener('hopper:hps8-sonic-rx',e=>{if(e.detail?.type===window.__hopperHPS8Sonic?.type?.ACK)cancelPending('ACK');});
window.addEventListener('hopper:hps8-data-start',()=>cancelPending());
$('protocolMode')?.addEventListener('change',()=>{cancelPending();const e=chip();if(e)e.style.display=isHps8()?'inline-flex':'none';});
chip();
window.__hopperHPS8AckWake={version:VERSION,active:true,startLockWake:true,delayMs:420,validatedControlsStillRequired:true,state:()=>({lastProfile,fallbackStarts,pending:!!wakeTimer})};
})();
