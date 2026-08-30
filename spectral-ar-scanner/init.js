(function upgradeV3UI(){
 const brand=document.querySelector('.brand strong');if(brand)brand.textContent='SPECTRAL AR · SPATIAL FUSION V3';
 const grid=document.querySelector('.grid');if(grid){
  const addMetric=(mode,label,id,value,smallId,small)=>{if($(id))return;const d=document.createElement('div');d.className='metric';d.dataset.mode=mode;d.innerHTML='<b>'+label+'</b><strong id="'+id+'">'+value+'</strong><small '+(smallId?'id="'+smallId+'"':'')+'>'+small+'</small>';grid.appendChild(d)};
  addMetric('light','CCT ACTUAL','liveCct','—','','temperatura de color estimada');
  addMetric('light','LIGHT QUALITY','liveLqs','—','','score visual instantáneo');
  addMetric('temperature','TEMP AMBIENTE','temp','NO SENSOR','tempState','sensor externo requerido');
  addMetric('temperature','TEMP EN SCAN','tempScan','—','','última calibración');
 }
 const actions=document.querySelector('.actionbar');if(actions&&!$('connectTemp')){const b=document.createElement('button');b.id='connectTemp';b.textContent='♨ TEMP SENSOR';actions.insertBefore(b,actions.children[1]||null)}
 const modes=$('modes');if(modes&&!modes.querySelector('[data-filter="temperature"]')){const b=document.createElement('button');b.dataset.filter='temperature';b.textContent='TEMP';const light=modes.querySelector('[data-filter="light"]');light?.after(b)}
 if(!$('sourceDetail')){const d=document.createElement('div');d.id='sourceDetail';d.className='sourceDetail';d.innerHTML='<div class="detailHead"><div><small id="detailBadge">SCAN</small><h3 id="detailTitle">LIGHT SOURCE</h3></div><button id="detailClose" type="button">×</button></div><div id="detailRows" class="detailRows"></div><div class="detailFoot">CCT, intensidad y calidad se derivan de la cámara y pueden variar con exposición/balance de blancos. No equivale a luxímetro, CRI ni espectrómetro calibrado.</div>';document.body.appendChild(d)}
 const gateText=document.querySelector('#gate p');if(gateText)gateText.textContent='Activa cámara, micrófono y sensores. El wizard calibrará sonido, luz, movimiento, contexto y temperatura cuando exista una fuente real de °C.';
})();
$('start').addEventListener('click',startAll);$('wizAction').addEventListener('click',advanceWizard);$('wizSkip').addEventListener('click',skipStep);$('wizBack').addEventListener('click',goBack);$('rescan').addEventListener('click',()=>openWizard(0));$('toggleSources').addEventListener('click',()=>{state.showSources=!state.showSources;$('toggleSources').textContent='◎ FUENTES '+(state.showSources?'ON':'OFF');if(!state.showSources)sourceLayer.innerHTML=''});$('clearScan').addEventListener('click',()=>{localStorage.removeItem(SCAN_KEY);state.scan=null;updateScanUI();sourceLayer.innerHTML='';notify('Calibración eliminada. El visor continúa en modo de medición en vivo.')});
$('modes').addEventListener('click',e=>{const b=e.target.closest('button[data-filter]');if(!b)return;state.mode=b.dataset.filter;document.querySelectorAll('#modes button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.metric[data-mode]').forEach(m=>m.style.display=state.mode==='all'||m.dataset.mode===state.mode?'block':'none')});
$('connectTemp').addEventListener('click',connectTemperatureSensor);$('detailClose').addEventListener('click',()=>$('sourceDetail').classList.remove('show'));
loadScan();