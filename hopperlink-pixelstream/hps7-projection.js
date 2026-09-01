(() => {
'use strict';

// v0.9.13 · HPS7 perfect-transfer projection.
// Uses the actual HPS7 logical-block count produced by Prepare HPS7 and converts
// it into physical DATA streams for 2/3/4-bit under the selected grid/layout.

const BASE_CHUNK=367,HEADER=28,PILOT_CELLS=32;
const $=id=>document.getElementById(id);

function selectedBits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function isDual(){return $('streamShape')?.value==='tall2';}
function rawCapacity(grid,bits){return Math.floor((grid*grid-PILOT_CELLS)*bits/8);}
function payloadCapacity(grid,bits){return rawCapacity(grid,bits)-HEADER;}
function blocksPerLane(grid,bits){return Math.max(1,Math.floor((payloadCapacity(grid,bits)-1)/(BASE_CHUNK+6)));}
function fpsFor(bits){
  const mode=$('speedMode')?.value||'maxcal';
  if(mode==='maxcal')return bits===2?15:bits===3?12:10;
  if(mode==='compatible')return 8;
  if(mode==='balanced')return 12;
  if(mode==='turbo')return 15;
  if(mode==='optical')return 18;
  return 12;
}
function warmupSeconds(bits,dual){if(bits===2)return dual?.8:0;return bits===3?2:3;}
function fmtTime(sec){
  if(!Number.isFinite(sec)||sec<0)return'—';
  const whole=Math.round(sec),m=Math.floor(whole/60),s=whole%60;
  return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}
function numTotal(){const n=Number(($('frameCount')?.textContent||'').replace(/[^0-9]/g,''));return Number.isFinite(n)&&n>0?n:0;}
function projection(total,grid,bits,dual){
  const perLane=blocksPerLane(grid,bits),lanes=dual?2:1,perPhysical=perLane*lanes;
  const streams=Math.ceil(total/perPhysical),fps=fpsFor(bits),dataSec=streams/fps,warmup=warmupSeconds(bits,dual);
  return{bits,perLane,lanes,perPhysical,streams,fps,dataSec,warmup,totalSec:dataSec+warmup};
}
function ensurePanel(){
  let p=$('hps7Projection');if(p)return p;
  const stats=$('frameCount')?.closest('.stats');if(!stats)return null;
  p=document.createElement('div');p.id='hps7Projection';p.className='received';p.style.display='none';p.style.margin='12px 0';
  stats.insertAdjacentElement('afterend',p);return p;
}
function render(){
  const panel=ensurePanel();if(!panel)return;
  const total=numTotal();if(!total){panel.style.display='none';return;}
  const grid=Number($('gridSize')?.value||56),dual=isDual(),sel=selectedBits();
  const rows=[2,3,4].map(bits=>projection(total,grid,bits,dual));
  panel.style.display='block';
  panel.innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
      <b>Proyección HPS7 · transferencia perfecta</b>
      <span class="chip on">${total} bloques lógicos · ${dual?'DualLane ×2':'Square'} · Grid ${grid}</span>
    </div>
    <div class="small" style="margin-top:6px">Los bloques lógicos son iguales en los tres modelos. Lo que cambia es cuántos bloques caben en cada stream físico. Tiempo ideal = streams físicos ÷ fps + calibración inicial; no incluye pérdidas, NACK, Repair ni tiempo humano.</div>
    <div style="overflow:auto;margin-top:10px">
      <table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left">
        <thead><tr><th style="padding:6px">Modo</th><th style="padding:6px">Bloques/stream</th><th style="padding:6px">Streams DATA</th><th style="padding:6px">Cadencia</th><th style="padding:6px">DATA ideal</th><th style="padding:6px">Ideal + calibración</th></tr></thead>
        <tbody>${rows.map(r=>`<tr${r.bits===sel?' style="font-weight:800"':''}><td style="padding:6px">${r.bits}-bit${r.bits===sel?' · seleccionado':''}</td><td style="padding:6px">${r.perPhysical} (${r.perLane}×${r.lanes})</td><td style="padding:6px">${r.streams}</td><td style="padding:6px">${r.fps} img/s</td><td style="padding:6px">${fmtTime(r.dataSec)}</td><td style="padding:6px">${fmtTime(r.totalSec)}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  try{window.dispatchEvent(new CustomEvent('hopper:projection',{detail:{total,grid,layout:dual?'dual-vertical':'square',rows}}));}catch{}
}

function install(){
  ensurePanel();
  const fc=$('frameCount');if(fc)new MutationObserver(render).observe(fc,{childList:true,characterData:true,subtree:true});
  for(const id of ['gridSize','streamShape','modulationMode','speedMode'])$(id)?.addEventListener('change',()=>setTimeout(render,0));
  $('prepareBtn')?.addEventListener('click',()=>setTimeout(render,80));
  render();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperProjection={version:'0.9.13',baseChunk:BASE_CHUNK,blocksPerLane,projection};
})();
