(() => {
'use strict';
const $=id=>document.getElementById(id);
const state={ready:false,wrapped:false,reported:false,startedAt:performance.now()};

function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent('hopper:'+name,{detail}));}catch{}}
function log(msg){const e=$('sendLog');if(!e)return;const t=new Date().toLocaleTimeString();e.textContent=`[${t}] STABILITY · ${msg}\n`+e.textContent.slice(0,9000);}
function phase(text,kind='mid'){const e=$('phaseStatus');if(e){e.textContent=text;e.className='chip '+kind;}}
function nextFrame(){return new Promise(resolve=>requestAnimationFrame(()=>resolve()));}

function validateRuntime(){
  const issues=[];
  if(!window.__hopperRuntime)issues.push('runtime metadata missing');
  for(const id of ['prepareBtn','sendBtn','cameraBtn','overlayActionBtn','txRepairBtn']){
    const el=$(id);if(!el)issues.push(`${id} missing`);else if(typeof el.onclick!=='function')issues.push(`${id}.onclick missing`);
  }
  return issues;
}
function reportRuntimeError(message,source='runtime'){
  const text=String(message||'Error desconocido');
  if(!state.reported){state.reported=true;log(`${source}: ${text}`);}
  state.ready=false;window.__hopperRuntimeReady=false;
  const prep=$('prepareBtn');if(prep)prep.disabled=true;
  phase('ERROR HPS7 · RECARGAR','off');
  emit('runtime-error',{message:text,source});
}
function wrapPrepare(){
  if(state.wrapped)return true;
  const btn=$('prepareBtn'),original=btn?.onclick;
  if(!btn||typeof original!=='function'){reportRuntimeError('El handler de Preparar HPS7 no fue instalado.','prepare-bind');return false;}
  state.wrapped=true;
  btn.onclick=async function(ev){
    if(window.__hopperPrepareBusy)return;
    const file=$('fileInput')?.files?.[0];
    if(!file)return original.call(this,ev);
    window.__hopperPrepareBusy=true;btn.disabled=true;
    emit('prepare-start',{name:file.name,size:file.size});
    const started=performance.now();let success=false,errorMessage='';
    try{
      await nextFrame();
      await original.call(this,ev);
      await nextFrame();
      const total=Number(($('frameCount')?.textContent||'').replace(/[^0-9]/g,''));
      success=!$('sendBtn')?.disabled&&Number.isFinite(total)&&total>0;
      if(!success)errorMessage='Preparar terminó sin generar bloques HPS7 ni habilitar HELLO.';
    }catch(err){
      errorMessage=err?.message||String(err);log(`prepare exception: ${errorMessage}`);
    }finally{
      window.__hopperPrepareBusy=false;if(state.ready)btn.disabled=false;
    }
    if(success){
      emit('prepare-complete',{name:file.name,size:file.size,total:Number(($('frameCount')?.textContent||'').replace(/[^0-9]/g,'')),elapsedMs:performance.now()-started});
    }else{
      emit('prepare-error',{message:errorMessage||'No se pudo preparar HPS7.',name:file.name,size:file.size,elapsedMs:performance.now()-started});
    }
  };
  return true;
}
function onRuntimeReady(){
  const issues=validateRuntime();
  if(issues.length){reportRuntimeError(issues.join(' · '),'runtime-validation');return;}
  state.ready=true;state.reported=false;window.__hopperRuntimeReady=true;
  if(!wrapPrepare())return;
  const prep=$('prepareBtn');if(prep)prep.disabled=false;
  log(`Runtime validado · ${window.__hopperRuntime?.version||'?'} · Preparar protegido.`);
  emit('stability-ready',{runtime:window.__hopperRuntime||null,elapsedMs:performance.now()-state.startedAt});
}
function installPhaseWatch(){
  const p=$('phaseStatus');if(!p)return;
  new MutationObserver(()=>{const text=p.textContent||'';if(/ERROR DUAL LANE|ERROR MANUAL MAX|ERROR HPS7/i.test(text)&&!state.ready)reportRuntimeError(text,'phase');}).observe(p,{childList:true,characterData:true,subtree:true});
}

window.addEventListener('hopper:runtime-ready',onRuntimeReady);
window.addEventListener('error',e=>{const msg=e?.message||'JavaScript error';log(`window.error: ${msg}`);emit('js-error',{message:msg,filename:e?.filename||'',line:e?.lineno||0,column:e?.colno||0});});
window.addEventListener('unhandledrejection',e=>{const reason=e?.reason?.message||String(e?.reason||'Unhandled promise rejection');log(`unhandledrejection: ${reason}`);emit('js-error',{message:reason,type:'unhandledrejection'});});

function install(){
  installPhaseWatch();
  const prep=$('prepareBtn');if(prep&&!state.ready){prep.disabled=true;prep.textContent='Inicializando HPS7…';}
  if(window.__hopperRuntimeReady)onRuntimeReady();
  setTimeout(()=>{if(!state.ready){const text=$('phaseStatus')?.textContent||'';if(!/ERROR/i.test(text))reportRuntimeError('El runtime no terminó de iniciar en 12 segundos. Recarga esta versión.','startup-timeout');}},12000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperRuntimeStability={version:'0.9.15',state,validateRuntime,wrapPrepare};
})();
