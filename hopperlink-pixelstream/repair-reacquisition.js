(() => {
'use strict';

// Repair Reacquisition Stage v1
// Manual ARQ helper: after a valid NACK, show a static optical target using
// exactly the selected Square/DualLane geometry and modulation BEFORE any real
// repair DATA is emitted. The receiver can reacquire tags/homography/focus/
// exposure without sacrificing missing blocks.

const $=id=>document.getElementById(id);
let installed=false,targetActive=false,starting=false,originalRepair=null,observer=null,startBtn=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function selectedBits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function tallSelected(){return $('streamShape')?.value==='tall2';}
function palette(bits){
  if(bits===2)return [[26,26,26],[92,92,92],[164,164,164],[236,236,236]];
  const bases=[[1,.14,.07],[.07,1,.16],[.07,.24,1],[1,.07,.70]];
  const levels=bits===3?[.58,.94]:[.48,.64,.80,.96],out=[];
  for(const s of levels)for(const b of bases)out.push(b.map(v=>Math.round(clamp(v*s*255,0,255))));
  return out;
}
function setPhase(text,kind='mid'){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip '+kind;}}
function log(msg){const e=$('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] REPAIR LOCK · ${msg}\n`+e.textContent.slice(0,9000);}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:'+name,{detail}));}catch{}}

function renderTarget(){
  const c=$('pixelCanvas');if(!c)return;
  const bits=selectedBits(),tall=tallSelected(),grid=56,rows=tall?112:56,pal=palette(bits),n=pal.length;
  document.documentElement.classList.toggle('stream-tall',tall);
  c.width=grid;c.height=rows;
  const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(grid,rows),d=img.data;

  // Large macro-cells stabilize exposure/WB. Each lane gets a slightly shifted
  // pattern so top/bottom remain visually distinct while preserving palette.
  for(let y=0;y<rows;y++)for(let x=0;x<grid;x++){
    const lane=tall&&y>=56?1:0,ly=y%56,bx=Math.floor(x/7),by=Math.floor(ly/7);
    const sym=(by*8+bx+lane*3)%n,rgb=pal[sym],p=(y*grid+x)*4;
    d[p]=rgb[0];d[p+1]=rgb[1];d[p+2]=rgb[2];d[p+3]=255;
  }

  // A thin neutral cross in the center of each lane gives autofocus a strong
  // luminance edge but is deliberately not an HPS7 packet.
  const laneCount=tall?2:1;
  for(let lane=0;lane<laneCount;lane++){
    const yBase=lane*56,cy=yBase+28;
    for(let x=4;x<52;x++){
      let p=(cy*grid+x)*4;d[p]=220;d[p+1]=220;d[p+2]=220;
    }
    for(let y=yBase+5;y<yBase+51;y++){
      let p=(y*grid+28)*4;d[p]=220;d[p+1]=220;d[p+2]=220;
    }
  }
  ctx.putImageData(img,0,0);
  return {bits,tall};
}

function ensureStartButton(){
  if(startBtn?.isConnected)return startBtn;
  const top=document.querySelector('.streamTop .row')||document.querySelector('.streamTop');
  if(!top)return null;
  startBtn=document.createElement('button');
  startBtn.id='repairReacquireStart';
  startBtn.className='btn good';
  startBtn.textContent='Receptor listo · Iniciar Repair';
  startBtn.style.display='none';
  startBtn.addEventListener('click',async()=>{
    if(starting||!targetActive||typeof originalRepair!=='function')return;
    starting=true;startBtn.disabled=true;
    const bits=selectedBits(),tall=tallSelected();
    setPhase(`EMISOR · REPAIR START · ${bits}-BIT ${tall?'DUAL':''}`,'on');
    const b=$('streamBottom');if(b)b.textContent='LOCK adquirido. El DATA real comienza ahora; ningún bloque faltante se usó para enfocar.';
    log(`Receptor confirmado · iniciando Repair real ${bits}-bit · ${tall?'DualLane':'Square'}.`);
    emit('repair-reacquired',{bits,layout:tall?'dual-vertical':'square'});
    targetActive=false;
    startBtn.style.display='none';
    startBtn.disabled=false;
    // Preserve the target for two repaints so the first real DATA transition is
    // clean and synchronized with the display refresh.
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{originalRepair.call($('txRepairBtn'));}
    finally{starting=false;}
  });
  top.prepend(startBtn);
  return startBtn;
}

function showTarget(){
  if(targetActive||starting)return;
  const repair=$('txRepairBtn');
  if(!repair||getComputedStyle(repair).display==='none')return;
  const overlay=$('streamOverlay');if(!overlay)return;
  const info=renderTarget();
  targetActive=true;
  overlay.style.display='flex';document.body.style.overflow='hidden';
  const meta=$('streamMeta'),bottom=$('streamBottom');
  if(meta)meta.textContent=`REPAIR TARGET · ${info.bits}-bit · ${info.tall?'DUAL ×2':'SQUARE'}`;
  if(bottom)bottom.textContent='Vuelve el receptor a cámara y espera TAGS 4/4 / LOCK. Cuando esté estable, pulsa “Receptor listo · Iniciar Repair”.';
  const btn=ensureStartButton();if(btn){btn.style.display='inline-flex';btn.disabled=false;}
  setPhase(`EMISOR · REPAIR TARGET · ESPERANDO LOCK`,'mid');
  log(`Target estático mostrado · ${info.bits}-bit · ${info.tall?'DualLane':'Square'} · sin DATA válido.`);
  emit('repair-target',{bits:info.bits,layout:info.tall?'dual-vertical':'square'});
}

function resetTarget(){targetActive=false;starting=false;if(startBtn)startBtn.style.display='none';}

function install(){
  if(installed)return;
  const repair=$('txRepairBtn');if(!repair||typeof repair.onclick!=='function')return;
  installed=true;originalRepair=repair.onclick;

  // Keep the original button as a fallback but normally the user starts Repair
  // from the full-screen reacquisition target.
  observer=new MutationObserver(()=>{
    if(getComputedStyle(repair).display!=='none')queueMicrotask(showTarget);
    else if(!starting)resetTarget();
  });
  observer.observe(repair,{attributes:true,attributeFilter:['style','class']});

  // Catch the case where NACK became ready immediately before installation.
  if(getComputedStyle(repair).display!=='none')queueMicrotask(showTarget);

  window.addEventListener('pagehide',resetTarget);
  log('Repair Reacquisition Stage instalado.');
}

window.addEventListener('hopper:runtime-ready',()=>setTimeout(install,0),{once:true});
// Fallback in case the runtime event fired before this module was evaluated.
setTimeout(install,700);
window.__hopperRepairReacquisition={version:'1.0',active:true,mode:'static-target-before-real-repair'};
})();
