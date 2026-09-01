(() => {
'use strict';
const BASE_CHUNK=367,HEADER=28,PILOT_CELLS=32;
const $=id=>document.getElementById(id);
function selectedBits(){const v=$('modulationMode')?.value||'color3';return v==='gray2'?2:v==='color3'?3:4;}
function isDual(){return $('streamShape')?.value==='tall2';}
function rawCapacity(grid,bits){return Math.floor((grid*grid-PILOT_CELLS)*bits/8);}
function payloadCapacity(grid,bits){return rawCapacity(grid,bits)-HEADER;}
function blocksPerLane(grid,bits){return Math.max(1,Math.floor((payloadCapacity(grid,bits)-1)/(BASE_CHUNK+6)));}
function speed(bits){const mode=$('speedMode')?.value||'maxcal';if(mode==='maxcal')return{fps:bits===2?15:bits===3?12:10,repeat:1};if(mode==='compatible')return{fps:8,repeat:2};if(mode==='balanced')return{fps:12,repeat:1};if(mode==='turbo')return{fps:15,repeat:1};if(mode==='optical')return{fps:18,repeat:1};return{fps:12,repeat:1};}
function warmupSeconds(bits,dual){if(bits===2)return dual?.8:0;return bits===3?2:3;}
function fmtTime(sec){if(!Number.isFinite(sec)||sec<0)return'—';const whole=Math.round(sec),m=Math.floor(whole/60),s=whole%60;return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;}
function numTotal(){const n=Number(($('frameCount')?.textContent||'').replace(/[^0-9]/g,''));return Number.isFinite(n)&&n>0?n:0;}
function projection(total,grid,bits,dual){const perLane=blocksPerLane(grid,bits),lanes=dual?2:1,perPhysical=perLane*lanes,sp=speed(bits),streams=Math.ceil(total/perPhysical),dataSec=streams*sp.repeat/sp.fps,warmup=warmupSeconds(bits,dual),bps=perPhysical*BASE_CHUNK*sp.fps/sp.repeat;return{bits,perLane,lanes,perPhysical,streams,fps:sp.fps,repeat:sp.repeat,bps,dataSec,warmup,totalSec:dataSec+warmup};}
function ensurePanel(){let p=$('hps7Projection');if(p)return p;const stats=$('frameCount')?.closest('.stats');if(!stats)return null;p=document.createElement('div');p.id='hps7Projection';p.className='received';p.style.display='none';p.style.margin='12px 0';stats.insertAdjacentElement('afterend',p);return p;}
function render(){
  const panel=ensurePanel();if(!panel)return;const total=numTotal();if(!total){panel.style.display='none';return;}
  const grid=Number($('gridSize')?.value||56),dual=isDual(),sel=selectedBits(),rows=[2,3,4].map(bits=>projection(total,grid,bits,dual)),chosen=rows.find(r=>r.bits===sel);panel.style.display='block';
  panel.innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><b>Proyección HPS7 · transferencia perfecta</b><span class="chip on">${total} bloques · ${dual?'DualLane ×2':'Square'} · Grid ${grid}</span></div>
    <div style="margin-top:10px;padding:12px;border-radius:14px;background:#0b1220;border:1px solid #164e63"><div class="small">Configuración seleccionada</div><div style="font-size:18px;font-weight:900;margin-top:3px">${sel}-bit · ${chosen.streams} streams DATA · ideal ${fmtTime(chosen.totalSec)}</div><div class="small" style="margin-top:4px">${chosen.perLane} bloques/lane × ${chosen.lanes} lane${chosen.lanes>1?'s':''} = ${chosen.perPhysical} bloques/stream físico · ${(chosen.bps/1024).toFixed(1)} KiB/s teóricos</div></div>
    <div class="small" style="margin-top:8px">Todos usan los mismos bloques lógicos. Cambian densidad por stream, cadencia y repeat. El tiempo ideal incluye calibración inicial, pero no pérdidas, NACK, Repair ni tiempo humano.</div>
    <div style="overflow:auto;margin-top:10px"><table style="width:100%;border-collapse:collapse;font-size:12px;text-align:left"><thead><tr><th style="padding:6px">Modo</th><th style="padding:6px">Bloques/stream</th><th style="padding:6px">Streams</th><th style="padding:6px">Cadencia</th><th style="padding:6px">Teórico</th><th style="padding:6px">Ideal total</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.bits===sel?'projectionSelected':''}"><td style="padding:7px">${r.bits}-bit${r.bits===sel?' · seleccionado':''}</td><td style="padding:7px">${r.perPhysical} (${r.perLane}×${r.lanes})</td><td style="padding:7px">${r.streams}</td><td style="padding:7px">${r.fps}/s${r.repeat>1?` · ×${r.repeat}`:''}</td><td style="padding:7px">${(r.bps/1024).toFixed(1)} KiB/s</td><td style="padding:7px">${fmtTime(r.totalSec)}</td></tr>`).join('')}</tbody></table></div>`;
  try{window.dispatchEvent(new CustomEvent('hopper:projection',{detail:{total,grid,layout:dual?'dual-vertical':'square',rows}}));}catch{}
}
function install(){ensurePanel();const fc=$('frameCount');if(fc)new MutationObserver(render).observe(fc,{childList:true,characterData:true,subtree:true});for(const id of ['gridSize','streamShape','modulationMode','speedMode'])$(id)?.addEventListener('change',()=>setTimeout(render,0));$('prepareBtn')?.addEventListener('click',()=>setTimeout(render,100));render();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperProjection={version:'0.9.14',baseChunk:BASE_CHUNK,blocksPerLane,projection};
})();
