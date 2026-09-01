(() => {
'use strict';

// v1.2 · Clean Repair Target + dynamic repetition budget.
// n = max(1, floor(1500 / missing)). No NACK/PASS_END between internal cycles.
const REPAIR_BUDGET=1500;
const nativeFetch=window.fetch.bind(window);
let repairPolicyArmed=true;
function repairCycles(missing){return missing>0?Math.max(1,Math.floor(REPAIR_BUDGET/missing)):1;}
function patchManualRuntimeSource(text){
  let out=text;
  const replacements=[
    ['function repairPasses(n){return n>0&&n<=500?3:1;}','function repairPasses(n){return n>0?Math.max(1,Math.floor(1500/n)):1;}'],
    ["missing<=500?' · CLOSING BURST ×3':''","repairPasses(missing)>1?` · REPAIR BURST ×${repairPasses(missing)}`:''"],
    ['closingBurst:missing>0&&missing<=500,cycles:missing>0&&missing<=500?3:1','closingBurst:repairPasses(missing)>1,cycles:repairPasses(missing)'],
    ['Closing Burst ≤500 ×3 sin NACK intermedio.','Repair Burst dinámico · n=floor(1500/faltantes) · sin NACK intermedio.']
  ];
  for(const [from,to] of replacements){
    if(!out.includes(from))throw new Error(`Repair policy patch missing: ${from}`);
    out=out.replace(from,to);
  }
  return out;
}
window.fetch=async function(input,init){
  const url=typeof input==='string'?input:(input?.url||'');
  const response=await nativeFetch(input,init);
  if(!repairPolicyArmed||!url.includes('hps7-manual-max.js'))return response;
  const text=await response.text(),patched=patchManualRuntimeSource(text);
  repairPolicyArmed=false;window.fetch=nativeFetch;
  try{window.dispatchEvent(new CustomEvent('hopper:repair-policy-ready',{detail:{budget:REPAIR_BUDGET,formula:'max(1,floor(1500/missing))'}}));}catch{}
  return new Response(patched,{status:response.status,statusText:response.statusText,headers:response.headers});
};
window.__hopperRepairCyclePolicy={version:'0.9.12',budget:REPAIR_BUDGET,formula:'max(1,floor(1500/missing))'};

const $=id=>document.getElementById(id);
let installed=false,targetActive=false,starting=false,originalRepair=null,observer=null,startBtn=null,lastPlan=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function selectedBits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function tallSelected(){return $('streamShape')?.value==='tall2';}
function palette(bits){
  if(bits===2)return [[26,26,26],[92,92,92],[164,164,164],[236,236,236]];
  const bases=[[1,.14,.07],[.07,1,.16],[.07,.24,1],[1,.07,.70]],levels=bits===3?[.58,.94]:[.48,.64,.80,.96],out=[];
  for(const s of levels)for(const b of bases)out.push(b.map(v=>Math.round(clamp(v*s*255,0,255))));
  return out;
}
function setPhase(text,kind='mid'){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip '+kind;}}
function log(msg){const e=$('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] REPAIR LOCK · ${msg}\n`+e.textContent.slice(0,9000);}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:'+name,{detail}));}catch{}}

function ensureCleanStyle(){
  if($('repairTargetCleanStyle'))return;
  const s=document.createElement('style');s.id='repairTargetCleanStyle';s.textContent=`
    html.repair-target-clean #streamOverlay .streamTop,
    html.repair-target-clean #streamOverlay .streamBottom{display:none!important}
    html.repair-target-clean #streamOverlay{padding:0!important}
    #repairReacquireStart{
      position:fixed!important;left:50%!important;bottom:max(8px,env(safe-area-inset-bottom))!important;
      transform:translateX(-50%)!important;z-index:90!important;display:none;
      min-height:42px!important;padding:9px 16px!important;border-radius:12px!important;
      white-space:nowrap!important;font-size:13px!important;box-shadow:0 5px 18px rgba(0,0,0,.42)!important
    }
  `;document.head.appendChild(s);
}
function renderTarget(){
  const c=$('pixelCanvas');if(!c)return null;
  const bits=selectedBits(),tall=tallSelected(),grid=56,rows=tall?112:56,pal=palette(bits),n=pal.length;
  document.documentElement.classList.toggle('stream-tall',tall);c.width=grid;c.height=rows;
  const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(grid,rows),d=img.data;
  for(let y=0;y<rows;y++)for(let x=0;x<grid;x++){
    const lane=tall&&y>=56?1:0,ly=y%56,bx=Math.floor(x/7),by=Math.floor(ly/7),sym=(by*8+bx+lane*3)%n,rgb=pal[sym],p=(y*grid+x)*4;
    d[p]=rgb[0];d[p+1]=rgb[1];d[p+2]=rgb[2];d[p+3]=255;
  }
  for(let lane=0;lane<(tall?2:1);lane++){
    const yBase=lane*56,cy=yBase+28;
    for(let x=4;x<52;x++){const p=(cy*grid+x)*4;d[p]=220;d[p+1]=220;d[p+2]=220;}
    for(let y=yBase+5;y<yBase+51;y++){const p=(y*grid+28)*4;d[p]=220;d[p+1]=220;d[p+2]=220;}
  }
  ctx.putImageData(img,0,0);return{bits,tall};
}
function ensureStartButton(){
  if(startBtn?.isConnected)return startBtn;
  const overlay=$('streamOverlay');if(!overlay)return null;
  startBtn=document.createElement('button');startBtn.id='repairReacquireStart';startBtn.className='btn good';startBtn.textContent='Iniciar Repair';startBtn.style.display='none';
  startBtn.addEventListener('click',async()=>{
    if(starting||!targetActive||typeof originalRepair!=='function')return;
    starting=true;startBtn.disabled=true;const bits=selectedBits(),tall=tallSelected();
    setPhase(`EMISOR · REPAIR START · ${bits}-BIT ${tall?'DUAL':''}`,'on');
    log(`Receptor confirmado · iniciando Repair ${lastPlan?`×${lastPlan.cycles} · `:''}${bits}-bit · ${tall?'DualLane':'Square'}.`);
    emit('repair-reacquired',{bits,layout:tall?'dual-vertical':'square',...lastPlan});
    targetActive=false;document.documentElement.classList.remove('repair-target-clean');startBtn.style.display='none';startBtn.disabled=false;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{originalRepair.call($('txRepairBtn'));}finally{starting=false;}
  });
  overlay.appendChild(startBtn);return startBtn;
}
function showTarget(){
  if(targetActive||starting)return;
  const repair=$('txRepairBtn'),overlay=$('streamOverlay');if(!repair||!overlay||getComputedStyle(repair).display==='none')return;
  const info=renderTarget();if(!info)return;
  targetActive=true;ensureCleanStyle();document.documentElement.classList.add('repair-target-clean');overlay.style.display='flex';document.body.style.overflow='hidden';
  const btn=ensureStartButton();if(btn){btn.textContent=lastPlan?.cycles>1?`Iniciar Repair ×${lastPlan.cycles}`:'Iniciar Repair';btn.style.display='inline-flex';btn.disabled=false;}
  setPhase('EMISOR · REPAIR TARGET · ESPERANDO LOCK','mid');
  log(`Target limpio · ${info.bits}-bit · ${info.tall?'DualLane':'Square'} · sin datos válidos${lastPlan?` · ${lastPlan.missing} faltantes → ${lastPlan.cycles} ciclos`:''}.`);
  emit('repair-target',{bits:info.bits,layout:info.tall?'dual-vertical':'square',...lastPlan});
}
function resetTarget(){targetActive=false;starting=false;document.documentElement.classList.remove('repair-target-clean');if(startBtn)startBtn.style.display='none';}
function install(){
  if(installed)return;const repair=$('txRepairBtn');if(!repair||typeof repair.onclick!=='function')return;
  installed=true;originalRepair=repair.onclick;ensureCleanStyle();
  observer=new MutationObserver(()=>{if(getComputedStyle(repair).display!=='none')queueMicrotask(showTarget);else if(!starting)resetTarget();});
  observer.observe(repair,{attributes:true,attributeFilter:['style','class']});
  if(getComputedStyle(repair).display!=='none')queueMicrotask(showTarget);
  window.addEventListener('pagehide',resetTarget);log('Repair Reacquisition limpio instalado · presupuesto dinámico 1500.');
}
window.addEventListener('hopper:nack',e=>{const missing=Number(e.detail?.missing||0);if(missing>0)lastPlan={missing,cycles:repairCycles(missing),budget:REPAIR_BUDGET};});
window.addEventListener('hopper:runtime-ready',()=>setTimeout(install,0),{once:true});setTimeout(install,700);
window.__hopperRepairReacquisition={version:'1.2',active:true,mode:'clean-static-target-before-real-repair',repairBudget:REPAIR_BUDGET,repairCycles};
})();
