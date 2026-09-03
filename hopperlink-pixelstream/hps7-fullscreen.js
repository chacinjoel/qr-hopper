(() => {
'use strict';

const VERSION='0.10.7';
const $=id=>document.getElementById(id);
const root=document.documentElement;
let active=false,nativeFullscreen=false,leaveTimer=0,actionPoll=0;

function isHps7(){return $('protocolMode')?.value==='hps7';}
function overlayVisible(){const e=$('streamOverlay');return!!e&&e.style.display!=='none'&&getComputedStyle(e).display!=='none';}
function nativeElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
function setViewportHeight(){const h=Math.round(window.visualViewport?.height||window.innerHeight||screen.height||800);root.style.setProperty('--hps7-viewport-height',`${Math.max(240,h)}px`);}
function ensureChip(){let c=$('hps7FullscreenChip');if(c)return c;const facts=document.querySelector('.compactFacts');if(!facts)return null;c=document.createElement('span');c.id='hps7FullscreenChip';c.className='chip on';c.textContent='● HPS7 Fullscreen Max';facts.insertBefore(c,facts.firstChild?.nextSibling||null);return c;}
function updateChip(){const c=ensureChip();if(!c)return;c.style.display=isHps7()?'inline-flex':'none';if(!isHps7())return;c.className='chip '+(active?'on':'');c.textContent=active?(nativeElement()?'● HPS7 Fullscreen nativo':'● HPS7 Fullscreen viewport'):'● HPS7 Fullscreen Max';}

function originalActionReady(){const b=$('overlayActionBtn');return!!(b&&b.style.display!=='none'&&!b.disabled&&String(b.textContent||'').trim());}
function ensureActionMirror(){
  let m=$('hps7FullscreenAction');
  if(m)return m;
  const actions=$('streamActions');if(!actions)return null;
  m=document.createElement('button');m.type='button';m.id='hps7FullscreenAction';m.className='btn good';m.dataset.visible='0';m.style.display='none';m.textContent='Iniciar transferencia HPS7';
  m.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    if(!isHps7())return;
    const original=$('overlayActionBtn');
    if(!originalActionReady())return;
    requestNative();
    original.click();
    setTimeout(syncActionMirror,0);
  });
  actions.insertBefore(m,$('closeStream')||null);
  return m;
}
function syncActionMirror(){
  const original=$('overlayActionBtn'),mirror=ensureActionMirror();
  const ready=!!(active&&isHps7()&&overlayVisible()&&originalActionReady());
  root.classList.toggle('hps7-fullscreen-has-action',ready);
  if(!mirror)return;
  mirror.dataset.visible=ready?'1':'0';
  mirror.disabled=!ready;
  mirror.textContent=ready?String(original.textContent||'Continuar HPS7'):'Iniciar transferencia HPS7';
  mirror.setAttribute('aria-hidden',ready?'false':'true');
}
function activateCss(){if(!isHps7())return;clearTimeout(leaveTimer);active=true;setViewportHeight();root.classList.add('hps7-optical-fullscreen');syncActionMirror();updateChip();try{window.dispatchEvent(new CustomEvent('hopper:hps7-fullscreen-state',{detail:{active:true,native:!!nativeElement(),version:VERSION}}));}catch{}}
async function requestNative(){if(!isHps7())return false;activateCss();if(nativeElement()){nativeFullscreen=true;updateChip();return true;}const el=document.documentElement,fn=el.requestFullscreen||el.webkitRequestFullscreen;if(typeof fn!=='function'){nativeFullscreen=false;updateChip();return false;}try{const r=fn.call(el,{navigationUI:'hide'});if(r&&typeof r.then==='function')await r;nativeFullscreen=!!nativeElement();updateChip();return nativeFullscreen;}catch{nativeFullscreen=false;updateChip();return false;}}
async function exitNative(){const fn=document.exitFullscreen||document.webkitExitFullscreen;if(!nativeElement()||typeof fn!=='function')return;try{const r=fn.call(document);if(r&&typeof r.then==='function')await r;}catch{}}
function deactivate({exit=true}={}){clearTimeout(leaveTimer);active=false;root.classList.remove('hps7-optical-fullscreen','hps7-fullscreen-has-action');root.style.removeProperty('--hps7-viewport-height');const m=$('hps7FullscreenAction');if(m){m.dataset.visible='0';m.disabled=true;}updateChip();if(exit)exitNative();try{window.dispatchEvent(new CustomEvent('hopper:hps7-fullscreen-state',{detail:{active:false,native:false,version:VERSION}}));}catch{}}
function scheduleOverlayCheck(){clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{if(isHps7()&&overlayVisible())activateCss();else if(active)deactivate({exit:true});syncActionMirror();},50);}
function gestureTarget(t){return t?.closest?.('#sendBtn,#txRepairBtn,#overlayActionBtn,#hps7FullscreenAction');}
function onGesture(e){if(!isHps7()||!gestureTarget(e.target))return;requestNative();}
function onProtocolChange(){if(isHps7()){updateChip();if(overlayVisible())activateCss();}else if(active)deactivate({exit:true});else updateChip();syncActionMirror();}
function onFullscreenChange(){nativeFullscreen=!!nativeElement();if(!nativeFullscreen&&active&&isHps7()&&overlayVisible())activateCss();updateChip();syncActionMirror();}
function install(){
  ensureChip();ensureActionMirror();updateChip();setViewportHeight();
  document.addEventListener('click',onGesture,true);
  $('protocolMode')?.addEventListener('change',onProtocolChange);
  $('closeStream')?.addEventListener('click',()=>setTimeout(scheduleOverlayCheck,0));
  const overlay=$('streamOverlay'),action=$('overlayActionBtn');
  if(overlay)new MutationObserver(()=>{scheduleOverlayCheck();syncActionMirror();}).observe(overlay,{attributes:true,attributeFilter:['style','class']});
  if(action)new MutationObserver(syncActionMirror).observe(action,{attributes:true,attributeFilter:['style','disabled'],childList:true,characterData:true,subtree:true});
  document.addEventListener('fullscreenchange',onFullscreenChange);document.addEventListener('webkitfullscreenchange',onFullscreenChange);
  window.addEventListener('resize',()=>{if(active)setViewportHeight();syncActionMirror();},{passive:true});
  window.visualViewport?.addEventListener('resize',()=>{if(active)setViewportHeight();syncActionMirror();},{passive:true});
  actionPoll=setInterval(()=>{if(active||overlayVisible())syncActionMirror();},120);
  window.addEventListener('pagehide',()=>{if(actionPoll)clearInterval(actionPoll);deactivate({exit:false});});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperHPS7Fullscreen={version:VERSION,active:()=>active,native:()=>!!nativeElement(),request:requestNative,deactivate,setViewportHeight,maxSurface:true,protocolUnchanged:true,dataRegionUnchanged:true,actionMirror:true};
})();
