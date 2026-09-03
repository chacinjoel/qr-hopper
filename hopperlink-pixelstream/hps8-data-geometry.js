(() => {
'use strict';
const VERSION='0.10.15',KEYS=['tl','tr','bl','br'];
const priorGet=CanvasRenderingContext2D.prototype.getImageData;
let forced=0,stableDual=0,lastRatio=null,lastSource='—';
function $(id){return document.getElementById(id);}
function isHps8(){return $('protocolMode')?.value==='hps8';}
function receiverLocked(){const p=$('phaseStatus')?.textContent||'',f=$('hps8Fountain')?.textContent||'';return /RECEPTOR\s*·\s*HPS8\s*LOCK/i.test(p)&&/\d+\s*\/\s*\d+/.test(f);}
function ratioOf(m){if(!m||!KEYS.every(k=>m[k]))return null;const top=Math.hypot(m.tr.x-m.tl.x,m.tr.y-m.tl.y),bot=Math.hypot(m.br.x-m.bl.x,m.br.y-m.bl.y),left=Math.hypot(m.bl.x-m.tl.x,m.bl.y-m.tl.y),right=Math.hypot(m.br.x-m.tr.x,m.br.y-m.tr.y),w=(top+bot)/2,h=(left+right)/2;return h>0?w/h:null;}
function chip(){let e=$('hps8DataGeomChip');if(e)return e;const facts=document.querySelector('.compactFacts');if(!facts)return null;e=document.createElement('span');e.id='hps8DataGeomChip';e.className='chip';e.style.display='none';facts.insertBefore(e,$('phaseStatus')||null);return e;}
function show(text,kind='mid'){const e=chip();if(!e)return;e.style.display=isHps8()?'inline-flex':'none';e.className='chip '+kind;e.textContent=text;}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-${name}`,{detail:{...detail,version:VERSION}}));}catch{}}
CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const img=priorGet.apply(this,args);
  if(this.canvas?.id!=='capture'||!isHps8()||!receiverLocked())return img;
  try{
    const d=window.__hopperOpticalDockV3?.last,b=window.__hopperBinaryTagBridge?.last;
    if(!d?.valid||!d.markers)return img;
    const r=ratioOf(d.markers);lastRatio=r;lastSource=d.source||'dock';
    const dual=Number.isFinite(r)&&r>=.30&&r<=.72;
    if(dual&&d.stableForDecode!==false){
      stableDual++;
      if(window.__hopperBinaryTagBridge){window.__hopperBinaryTagBridge.last={...(b||{}),...d,found:4,valid:true,markers:d.markers,quality:d.quality||b?.quality||82,stableForDecode:true,dock:d,hps8DualGeometry:true};forced++;}
      show(`DATA GEOM 1:2 ✓ · r=${r.toFixed(2)}`,'on');
      if(stableDual===1||stableDual%30===0)emit('data-geometry-lock',{ratio:r,source:lastSource,forced,stableDual});
    }else{
      stableDual=0;
      show(`WAIT DATA 1:2 · r=${Number.isFinite(r)?r.toFixed(2):'—'}`,'mid');
      emit('data-geometry-wait',{ratio:r,source:lastSource,stable:d.stableForDecode!==false});
    }
  }catch{}
  return img;
};
window.addEventListener('hopper:hps8-data-geometry-prime',()=>show('DATA GEOM · PRELOCK 1:2…','mid'));
window.addEventListener('hopper:hps8-data-start',()=>show('DATA GEOM · esperando receptor 1:2','mid'));
$('protocolMode')?.addEventListener('change',()=>{const e=chip();if(e)e.style.display=isHps8()?'inline-flex':'none';});
chip();
window.__hopperHPS8DataGeometry={version:VERSION,active:true,opticalDockPriority:true,dualRatioMin:.30,dualRatioMax:.72,sameFrameBridge:true,state:()=>({forced,stableDual,lastRatio,lastSource})};
})();