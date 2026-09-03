(() => {
'use strict';

const VERSION='0.10.5';
const $=id=>document.getElementById(id);
const root=document.documentElement;
let active=false,nativeFullscreen=false,leaveTimer=0;

function isHps7(){return $('protocolMode')?.value==='hps7';}
function overlayVisible(){const e=$('streamOverlay');return!!e&&e.style.display!=='none'&&getComputedStyle(e).display!=='none';}
function nativeElement(){return document.fullscreenElement||document.webkitFullscreenElement||null;}
function setViewportHeight(){const h=Math.round(window.visualViewport?.height||window.innerHeight||screen.height||800);root.style.setProperty('--hps7-viewport-height',`${Math.max(240,h)}px`);}
function ensureChip(){let c=$('hps7FullscreenChip');if(c)return c;const facts=document.querySelector('.compactFacts');if(!facts)return null;c=document.createElement('span');c.id='hps7FullscreenChip';c.className='chip on';c.textContent='● HPS7 Fullscreen Max';facts.insertBefore(c,facts.firstChild?.nextSibling||null);return c;}
function updateChip(){const c=ensureChip();if(!c)return;c.style.display=isHps7()?'inline-flex':'none';if(!isHps7())return;c.className='chip '+(active?'on':'');c.textContent=active?(nativeElement()?'● HPS7 Fullscreen nativo':'● HPS7 Fullscreen viewport'):'● HPS7 Fullscreen Max';}
function updateActionClass(){const b=$('overlayActionBtn');const has=active&&overlayVisible()&&b&&b.style.display!=='none'&&!b.disabled;root.classList.toggle('hps7-fullscreen-has-action',!!has);}
function activateCss(){if(!isHps7())return;clearTimeout(leaveTimer);active=true;setViewportHeight();root.classList.add('hps7-optical-fullscreen');updateActionClass();updateChip();try{window.dispatchEvent(new CustomEvent('hopper:hps7-fullscreen-state',{detail:{active:true,native:!!nativeElement(),version:VERSION}}));}catch{}}
async function requestNative(){if(!isHps7())return false;activateCss();if(nativeElement()){nativeFullscreen=true;updateChip();return true;}const el=document.documentElement,fn=el.requestFullscreen||el.webkitRequestFullscreen;if(typeof fn!=='function'){nativeFullscreen=false;updateChip();return false;}try{const r=fn.call(el,{navigationUI:'hide'});if(r&&typeof r.then==='function')await r;nativeFullscreen=!!nativeElement();updateChip();return nativeFullscreen;}catch{nativeFullscreen=false;updateChip();return false;}}
async function exitNative(){const fn=document.exitFullscreen||document.webkitExitFullscreen;if(!nativeElement()||typeof fn!=='function')return;try{const r=fn.call(document);if(r&&typeof r.then==='function')await r;}catch{}}
function deactivate({exit=true}={}){clearTimeout(leaveTimer);active=false;root.classList.remove('hps7-optical-fullscreen','hps7-fullscreen-has-action');root.style.removeProperty('--hps7-viewport-height');updateChip();if(exit)exitNative();try{window.dispatchEvent(new CustomEvent('hopper:hps7-fullscreen-state',{detail:{active:false,native:false,version:VERSION}}));}catch{}}
function scheduleOverlayCheck(){clearTimeout(leaveTimer);leaveTimer=setTimeout(()=>{if(isHps7()&&overlayVisible())activateCss();else if(active)deactivate({exit:true});},70);}
function gestureTarget(t){return t?.closest?.('#sendBtn,#txRepairBtn,#overlayActionBtn');}
function onGesture(e){if(!isHps7()||!gestureTarget(e.target))return;/* Must be invoked inside the user's gesture for mobile Fullscreen API. */requestNative();}
function onProtocolChange(){if(isHps7()){updateChip();if(overlayVisible())activateCss();}else if(active)deactivate({exit:true});else updateChip();}
function onFullscreenChange(){nativeFullscreen=!!nativeElement();if(!nativeFullscreen&&active&&isHps7()&&overlayVisible())activateCss();updateChip();}
function install(){
  ensureChip();updateChip();setViewportHeight();
  document.addEventListener('click',onGesture,true);
  $('protocolMode')?.addEventListener('change',onProtocolChange);
  $('closeStream')?.addEventListener('click',()=>setTimeout(scheduleOverlayCheck,0));
  const overlay=$('streamOverlay'),action=$('overlayActionBtn');
  if(overlay)new MutationObserver(scheduleOverlayCheck).observe(overlay,{attributes:true,attributeFilter:['style','class']});
  if(action)new MutationObserver(()=>{updateActionClass();}).observe(action,{attributes:true,attributeFilter:['style','disabled'],childList:true,characterData:true,subtree:true});
  document.addEventListener('fullscreenchange',onFullscreenChange);document.addEventListener('webkitfullscreenchange',onFullscreenChange);
  window.addEventListener('resize',()=>{if(active)setViewportHeight();},{passive:true});
  window.visualViewport?.addEventListener('resize',()=>{if(active)setViewportHeight();},{passive:true});
  window.addEventListener('pagehide',()=>deactivate({exit:false}));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperHPS7Fullscreen={version:VERSION,active:()=>active,native:()=>!!nativeElement(),request:requestNative,deactivate,setViewportHeight,maxSurface:true,protocolUnchanged:true,dataRegionUnchanged:true};
})();
