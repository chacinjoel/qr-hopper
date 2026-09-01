(() => {
'use strict';

const $=id=>document.getElementById(id);
const nativeSetTimeout=window.setTimeout.bind(window);

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function palette(bits){
  if(bits===2)return[[26,26,26],[92,92,92],[164,164,164],[236,236,236]];
  const bases=[[1,.14,.07],[.07,1,.16],[.07,.24,1],[1,.07,.70]];
  const lev=bits===3?[.58,.94]:[.48,.64,.80,.96],out=[];
  for(const s of lev)for(const b of bases)out.push(b.map(v=>Math.round(clamp(v*s*255,0,255))));
  return out;
}
function selectedBits(){
  const v=$('modulationMode')?.value||'auto4';
  return v==='gray2'?2:v==='color3'?3:4;
}
function renderTraining(bits){
  const c=$('pixelCanvas');if(!c)return;
  const grid=56,pal=palette(bits),n=pal.length;
  c.width=grid;c.height=grid;
  const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(grid,grid);
  // Bloques grandes 7x7: cada símbolo aparece en una región amplia y repetida.
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
    const bx=Math.floor(x/7),by=Math.floor(y/7),sym=(by*8+bx)%n,rgb=pal[sym],p=(y*grid+x)*4;
    img.data[p]=rgb[0];img.data[p+1]=rgb[1];img.data[p+2]=rgb[2];img.data[p+3]=255;
  }
  ctx.putImageData(img,0,0);
}
function log(msg){const el=$('sendLog');if(!el)return;const t=new Date().toLocaleTimeString();el.textContent=`[${t}] ${msg}\n`+el.textContent.slice(0,9000);}
function setPhase(text){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip mid';}}
function sleep(ms){return new Promise(r=>nativeSetTimeout(r,ms));}

function install(){
  const btn=$('overlayActionBtn');
  if(!btn||btn.dataset.colorWarmup==='1')return;
  const original=btn.onclick;
  btn.onclick=async function(e){
    const meta=$('streamMeta')?.textContent||'';
    if(!/^HPS7 HELLO/i.test(meta)){
      return original?.call(btn,e);
    }
    e?.preventDefault?.();
    btn.disabled=true;
    const bits=selectedBits();
    const bottom=$('streamBottom');
    const sm=$('streamMeta');
    setPhase(`EMISOR · CALIBRANDO COLOR ${bits}-BIT`);
    log(`Color Warm-up ${bits}-bit iniciado · 4 s antes del primer DATA.`);
    for(let sec=4;sec>=1;sec--){
      renderTraining(bits);
      if(sm)sm.textContent=`COLOR TRAINING · ${bits}-bit · ${sec}s`;
      if(bottom)bottom.textContent='Mantén el receptor apuntando. La cámara está estabilizando exposición y balance de blancos sobre la paleta real.';
      await sleep(1000);
    }
    // Extendemos solo la primera espera corta del DATA para que el primer paquete real quede fijo.
    const origSetTimeout=window.setTimeout;
    let caught=false;
    window.setTimeout=function(fn,delay,...args){
      const ms=Number(delay)||0;
      if(!caught&&typeof fn==='function'&&ms>=40&&ms<=140){
        caught=true;
        window.setTimeout=origSetTimeout;
        return origSetTimeout(fn,1500,...args);
      }
      return origSetTimeout(fn,delay,...args);
    };
    if(sm)sm.textContent='COLOR LOCK · iniciando primer DATA';
    if(bottom)bottom.textContent='El primer DATA real quedará fijo ~1.5 s antes de que comience la secuencia.';
    setPhase(`EMISOR · COLOR LOCK ${bits}-BIT`);
    try{ original?.call(btn,e); }
    finally{ nativeSetTimeout(()=>{window.setTimeout=origSetTimeout;},0); btn.disabled=false; }
  };
  btn.dataset.colorWarmup='1';
}

install();
window.__hopperColorWarmup={version:'0.7.2',active:true,warmupMs:4000,firstDataHoldMs:1500};
})();