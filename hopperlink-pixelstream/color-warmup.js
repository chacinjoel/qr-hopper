(() => {
'use strict';

const $=id=>document.getElementById(id);
const nativeSetTimeout=window.setTimeout.bind(window);
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function palette(bits){if(bits===2)return[[26,26,26],[92,92,92],[164,164,164],[236,236,236]];const bases=[[1,.14,.07],[.07,1,.16],[.07,.24,1],[1,.07,.70]],lev=bits===3?[.58,.94]:[.48,.64,.80,.96],out=[];for(const s of lev)for(const b of bases)out.push(b.map(v=>Math.round(clamp(v*s*255,0,255))));return out;}
function selectedBits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function tallSelected(){return $('streamShape')?.value==='tall2';}
function renderTraining(bits){const c=$('pixelCanvas');if(!c)return;const grid=56,tall=tallSelected(),rows=tall?112:56,pal=palette(bits),n=pal.length;document.documentElement.classList.toggle('stream-tall',tall);c.width=grid;c.height=rows;const ctx=c.getContext('2d',{alpha:false}),img=ctx.createImageData(grid,rows);for(let y=0;y<rows;y++)for(let x=0;x<grid;x++){const ly=y%56,bx=Math.floor(x/7),by=Math.floor(ly/7),sym=(by*8+bx)%n,rgb=pal[sym],p=(y*grid+x)*4;img.data[p]=rgb[0];img.data[p+1]=rgb[1];img.data[p+2]=rgb[2];img.data[p+3]=255;}ctx.putImageData(img,0,0);}
function log(msg){const el=$('sendLog');if(!el)return;const t=new Date().toLocaleTimeString();el.textContent=`[${t}] ${msg}\n`+el.textContent.slice(0,9000);}
function setPhase(text){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip mid';}}
function sleep(ms){return new Promise(r=>nativeSetTimeout(r,ms));}

function install(){
  const btn=$('overlayActionBtn');if(!btn||btn.dataset.colorWarmup==='1')return;const original=btn.onclick;
  btn.onclick=async function(e){
    const meta=$('streamMeta')?.textContent||'';if(!/^HPS7 HELLO/i.test(meta))return original?.call(btn,e);
    e?.preventDefault?.();btn.disabled=true;const bits=selectedBits(),tall=tallSelected(),bottom=$('streamBottom'),sm=$('streamMeta');
    if(bits===2){if(tall){setPhase('EMISOR · GEOMETRY LOCK DUAL');log('2-bit DualLane: 0.8s de transición geométrica antes de DATA.');renderTraining(2);if(sm)sm.textContent='DUAL LANE TRAINING · 2-bit · 0.8s';if(bottom)bottom.textContent='Dos grids 56×56 apilados. La cámara reajusta la geometría sin reducir el tamaño de celda.';await sleep(800);}else log('2-bit gris Square: sin warm-up.');try{original?.call(btn,e);}finally{btn.disabled=false;}return;}
    const secs=bits===3?2:3;setPhase(`EMISOR · CALIBRANDO COLOR ${bits}-BIT`);log(`Warm-up ${bits}-bit · ${secs}s · ${tall?'DualLane vertical':'Square'}.`);
    for(let sec=secs;sec>=1;sec--){renderTraining(bits);if(sm)sm.textContent=`COLOR TRAINING · ${bits}-bit · ${tall?'DUAL ×2 · ':''}${sec}s`;if(bottom)bottom.textContent=tall?'Calibrando color y geometría sobre dos lanes 56×56 simultáneos.':'Exposición y balance de blancos estabilizándose sobre la paleta real.';await sleep(1000);}
    if(sm)sm.textContent=`COLOR LOCK · ${bits}-bit · ${tall?'DUAL ×2':'SQUARE'}`;if(bottom)bottom.textContent='Calibración lista. Iniciando DATA.';setPhase(`EMISOR · COLOR LOCK ${bits}-BIT`);
    try{original?.call(btn,e);}finally{btn.disabled=false;}
  };
  btn.dataset.colorWarmup='1';
}
install();
window.__hopperColorWarmup={version:'0.9.9',active:true,warmupMs:{2:800,3:2000,4:3000},dualLane:true};
})();
