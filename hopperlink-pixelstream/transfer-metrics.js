(() => {
'use strict';
const $=id=>document.getElementById(id);
let startedAt=0,lastCount=0,lastTs=0,emaRate=0,timer=null,done=false;
function fmt(sec){if(!Number.isFinite(sec)||sec<0)return '—';sec=Math.round(sec);const m=Math.floor(sec/60),s=sec%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}
function reset(){startedAt=0;lastCount=0;lastTs=0;emaRate=0;done=false;if($('rxElapsed'))$('rxElapsed').textContent='—';if($('rxEta'))$('rxEta').textContent='—';if($('rxRate'))$('rxRate').textContent='—';}
function update(){
 const count=Number($('rxFrames')?.textContent||0),total=Number($('rxTotal')?.textContent||0),now=performance.now();
 if(!count||!total||!Number.isFinite(total)){if(!count)reset();return;}
 if(!startedAt){startedAt=now;lastTs=now;lastCount=count;emaRate=0;}
 const elapsed=(now-startedAt)/1000;
 if(count>lastCount&&now>lastTs){const inst=(count-lastCount)/((now-lastTs)/1000);emaRate=emaRate?emaRate*0.68+inst*0.32:inst;lastCount=count;lastTs=now;}
 const avg=count/Math.max(elapsed,0.25);const rate=emaRate||avg;
 if($('rxElapsed'))$('rxElapsed').textContent=fmt(elapsed);
 if($('rxRate'))$('rxRate').textContent=rate>0?`${rate.toFixed(rate<10?1:0)} fr/s`:'—';
 if(count>=total){done=true;if($('rxEta'))$('rxEta').textContent='0s';}
 else if($('rxEta'))$('rxEta').textContent=rate>0?`≈ ${fmt((total-count)/rate)}`:'Calculando…';
}
const target=$('rxFrames');
if(target){new MutationObserver(update).observe(target,{childList:true,characterData:true,subtree:true});}
const total=$('rxTotal');
if(total){new MutationObserver(update).observe(total,{childList:true,characterData:true,subtree:true});}
const cam=$('cameraBtn');if(cam)cam.addEventListener('click',()=>{reset();if(timer)clearInterval(timer);timer=setInterval(update,500);},{capture:true});
const stop=$('stopCameraBtn');if(stop)stop.addEventListener('click',()=>{if(timer){clearInterval(timer);timer=null;}},{capture:true});
timer=setInterval(update,500);
window.addEventListener('pagehide',()=>{if(timer)clearInterval(timer);});
})();
