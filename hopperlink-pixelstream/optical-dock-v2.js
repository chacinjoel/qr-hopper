(() => {
'use strict';

const KEYS=['tl','tr','bl','br'];
const priorGetImageData=CanvasRenderingContext2D.prototype.getImageData;
let dockMemory=null,lastSignature=null,lastSignatureTs=0,stableFrames=0,lastStableImage=null,lastStableBridge=null,lastStableTs=0,heldFrames=0;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function luma(d,p){return(d[p]+d[p+1]+d[p+2])/3;}
function percentile(a,f){if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor(s.length*f)))];}
function bilerp(q,u,v){const a={x:q.tl.x*(1-u)+q.tr.x*u,y:q.tl.y*(1-u)+q.tr.y*u},b={x:q.bl.x*(1-u)+q.br.x*u,y:q.bl.y*(1-u)+q.br.y*u};return{x:a.x*(1-v)+b.x*v,y:a.y*(1-v)+b.y*v};}
function sampleRGB(d,w,h,x,y,rad=1){x=Math.round(x);y=Math.round(y);const rs=[],gs=[],bs=[];for(let yy=Math.max(0,y-rad);yy<=Math.min(h-1,y+rad);yy++)for(let xx=Math.max(0,x-rad);xx<=Math.min(w-1,x+rad);xx++){const p=(yy*w+xx)*4;rs.push(d[p]);gs.push(d[p+1]);bs.push(d[p+2]);}rs.sort((a,b)=>a-b);gs.sort((a,b)=>a-b);bs.sort((a,b)=>a-b);const m=Math.floor(rs.length/2);return[rs[m]||0,gs[m]||0,bs[m]||0];}
function darkThreshold(d,w,h){const vals=[],step=Math.max(8,Math.floor(Math.min(w,h)/72));for(let y=step>>1;y<h;y+=step)for(let x=step>>1;x<w;x+=step)vals.push(luma(d,(y*w+x)*4));const p10=percentile(vals,.10),p50=percentile(vals,.50);return clamp(p10+(p50-p10)*.34,18,142);}
function quadLengths(q){return{top:Math.hypot(q.tr.x-q.tl.x,q.tr.y-q.tl.y),bottom:Math.hypot(q.br.x-q.bl.x,q.br.y-q.bl.y),left:Math.hypot(q.bl.x-q.tl.x,q.bl.y-q.tl.y),right:Math.hypot(q.br.x-q.tr.x,q.br.y-q.tr.y)};}
function contourGeometryOK(q,w,h){if(!q)return false;const s=quadLengths(q),minDim=Math.min(w,h),width=(s.top+s.bottom)/2,height=(s.left+s.right)/2;if(Math.min(s.top,s.bottom,s.left,s.right)<minDim*.25)return false;const diag1=Math.hypot(q.br.x-q.tl.x,q.br.y-q.tl.y),diag2=Math.hypot(q.bl.x-q.tr.x,q.bl.y-q.tr.y);if(Math.min(diag1,diag2)/Math.max(diag1,diag2)<.58)return false;const ratio=width/Math.max(1,height);return ratio>.34&&ratio<2.9;}

function findContour(img,w,h){
  const d=img.data,thr=darkThreshold(d,w,h),stride=Math.max(3,Math.floor(Math.min(w,h)/230)),gw=Math.ceil(w/stride),gh=Math.ceil(h/stride),mask=new Uint8Array(gw*gh);
  for(let gy=0;gy<gh;gy++){const y=Math.min(h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(w-1,gx*stride+(stride>>1));mask[gy*gw+gx]=luma(d,(y*w+x)*4)<=thr?1:0;}}
  const seen=new Uint8Array(mask.length),candidates=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1,minS=1e9,maxS=-1e9,minD=1e9,maxD=-1e9,pTL=null,pTR=null,pBL=null,pBR=null;
    while(stack.length){const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);const sum=cx+cy,dif=cx-cy;if(sum<minS){minS=sum;pTL={x:cx,y:cy};}if(sum>maxS){maxS=sum;pBR={x:cx,y:cy};}if(dif>maxD){maxD=dif;pTR={x:cx,y:cy};}if(dif<minD){minD=dif;pBL={x:cx,y:cy};}for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]){seen[ni]=1;stack.push(ni);}}}
    if(count<60)continue;const bw=(maxX-minX+1)*stride,bh=(maxY-minY+1)*stride,long=Math.max(bw,bh)/Math.min(w,h),aspect=bw/Math.max(1,bh),boxCells=(maxX-minX+1)*(maxY-minY+1),fill=count/Math.max(1,boxCells);if(long<.30||long>1.55||aspect<.32||aspect>3.1||fill>.58)continue;
    const cv=p=>({x:clamp((p.x+.5)*stride,0,w-1),y:clamp((p.y+.5)*stride,0,h-1)}),quad={tl:cv(pTL),tr:cv(pTR),bl:cv(pBL),br:cv(pBR)};if(!contourGeometryOK(quad,w,h))continue;
    const sides=quadLengths(quad),balance=Math.min(sides.top,sides.bottom)/Math.max(sides.top,sides.bottom)*Math.min(sides.left,sides.right)/Math.max(sides.left,sides.right),score=count*(.5+balance)*(1-Math.min(.8,fill));candidates.push({quad,score,count,fill,threshold:thr});
  }
  candidates.sort((a,b)=>b.score-a.score);return candidates[0]||null;
}
function markersFromContour(c){if(!c?.quad)return null;const q=c.quad;return{tl:bilerp(q,.06,.06),tr:bilerp(q,.94,.06),bl:bilerp(q,.06,.94),br:bilerp(q,.94,.94)};}
function smoothMarkers(oldM,newM,a){if(!oldM)return newM;const out={};for(const k of KEYS)out[k]={x:oldM[k].x*(1-a)+newM[k].x*a,y:oldM[k].y*(1-a)+newM[k].y*a};return out;}
function markerMotion(a,b){if(!a||!b)return 0;let s=0;for(const k of KEYS)s+=Math.hypot(a[k].x-b[k].x,a[k].y-b[k].y);return s/4;}
function stagePoint(markers,nx,ny){const u=(nx-.06)/.88,v=(ny-.06)/.88;return bilerp(markers,u,v);}
function photometricRails(img,w,h,markers){const d=img.data,top=[],bottom=[];for(let i=0;i<8;i++){const x=.22+i*(.56/7),pt=stagePoint(markers,x,.095),pb=stagePoint(markers,x,.905);top.push(sampleRGB(d,w,h,pt.x,pt.y,1));bottom.push(sampleRGB(d,w,h,pb.x,pb.y,1));}const lum=a=>a.map(v=>(v[0]+v[1]+v[2])/3),tl=lum(top),bl=lum(bottom),all=tl.concat(bl),lo=percentile(all,.12),hi=percentile(all,.88),topMed=percentile(tl,.5),bottomMed=percentile(bl,.5),clipped=all.filter(v=>v<6||v>249).length/all.length;return{top,bottom,contrast:hi-lo,topMedian:topMed,bottomMedian:bottomMed,skew:Math.abs(topMed-bottomMed),clipped};}
function frameSignature(img,w,h,markers){const d=img.data,out=[];for(const ny of [.18,.31,.44,.56,.69,.82])for(const nx of [.20,.35,.50,.65,.80]){const p=stagePoint(markers,nx,ny);const rgb=sampleRGB(d,w,h,p.x,p.y,0);out.push((rgb[0]+rgb[1]+rgb[2])/3);}return out;}
function signatureDelta(a,b){if(!a||!b||a.length!==b.length)return Infinity;let s=0;for(let i=0;i<a.length;i++)s+=Math.abs(a[i]-b[i]);return s/a.length;}
function extrapolate(mem,now){const dt=now-mem.ts;if(dt>420)return null;const scale=dt/Math.max(1,mem.sampleDt||33),out={};for(const k of KEYS)out[k]={x:mem.markers[k].x+(mem.vx||0)*scale,y:mem.markers[k].y+(mem.vy||0)*scale};return out;}
function cloneBridge(b){if(!b)return null;const markers=b.markers?Object.fromEntries(KEYS.map(k=>[k,b.markers[k]?{x:b.markers[k].x,y:b.markers[k].y}:null])):null;return{...b,markers,decoded:Array.isArray(b.decoded)?b.decoded.slice():[]};}

function analyze(img,w,h){
  const now=performance.now(),bridge=window.__hopperBinaryTagBridge?.last||null,contour=findContour(img,w,h),contourMarkers=markersFromContour(contour);let markers=null,source='none',quality=0;
  if(bridge?.valid&&bridge.markers){markers=bridge.markers;source=bridge.reused?'tag-memory':'tags';quality=bridge.quality||90;if(contourMarkers){const d=markerMotion(markers,contourMarkers);if(d<Math.min(w,h)*.12)markers=smoothMarkers(markers,contourMarkers,.10);}}
  else if(contourMarkers){markers=contourMarkers;source='contour';quality=72;}
  else if(dockMemory){markers=extrapolate(dockMemory,now);if(markers){source='track';quality=clamp(Math.round(78-(now-dockMemory.ts)/12),48,76);}}
  if(!markers)return{ts:now,valid:false,source:'search',quality:0,contour:!!contour,stableForDecode:false};

  const previous=dockMemory?.markers||null,motionPx=markerMotion(markers,previous),side=Math.max(1,(Math.hypot(markers.tr.x-markers.tl.x,markers.tr.y-markers.tl.y)+Math.hypot(markers.bl.x-markers.tl.x,markers.bl.y-markers.tl.y))/2),motionNorm=motionPx/side,alpha=source==='contour'?.32:motionNorm>.04?.58:.34;markers=previous?smoothMarkers(previous,markers,alpha):markers;
  const dt=dockMemory?Math.max(1,now-dockMemory.ts):33,dx=dockMemory?(markers.tl.x-dockMemory.markers.tl.x):0,dy=dockMemory?(markers.tl.y-dockMemory.markers.tl.y):0;dockMemory={markers,ts:now,vx:dx,vy:dy,sampleDt:dt};

  const rails=photometricRails(img,w,h,markers),sig=frameSignature(img,w,h,markers),delta=signatureDelta(sig,lastSignature),recent=now-lastSignatureTs<180,transition=recent&&delta>19;stableFrames=transition?0:stableFrames+1;lastSignature=sig;lastSignatureTs=now;
  const motionBad=motionNorm>.075,photoBad=rails.contrast<18||rails.clipped>.72,stableForDecode=stableFrames>=1&&!transition&&!motionBad&&!photoBad;
  quality=clamp(Math.round(quality-Math.min(18,motionNorm*160)-Math.min(12,rails.skew/12)-(photoBad?12:0)),35,100);
  return{ts:now,valid:true,source,markers,quality,contour:!!contour,motionPx,motionNorm,rails,frameDelta:Number.isFinite(delta)?delta:null,stableFrames,stableForDecode,transition,photometricOK:!photoBad};
}

function dockPalette(){const v=document.getElementById('modulationMode')?.value||'color3';if(v==='gray2')return['#080808','#414141','#787878','#b1b1b1','#ededed','#9a9a9a','#555','#fff'];if(v==='color4')return['#4a0b05','#754015','#176f1e','#43a24a','#0c245f','#284ac8','#77105a','#bf318c'];return['#5b0d06','#df2410','#075d12','#21e13b','#0b2168','#244fe0','#670947','#df1897'];}
function renderDock(){
  const frame=document.querySelector('.pixelFrame');if(!frame||frame.querySelector('.opticalDockV2'))return;const root=document.createElement('div');root.className='opticalDockV2';root.setAttribute('aria-hidden','true');for(const pos of ['top','right','bottom','left']){const a=document.createElement('div');a.className='dockAnchor dock-'+pos;a.innerHTML='<i></i><i></i><i></i>';root.appendChild(a);}for(const pos of ['top','bottom']){const r=document.createElement('div');r.className='photoRail rail-'+pos;root.appendChild(r);}frame.appendChild(root);updateRails();}
function updateRails(){const p=dockPalette();document.querySelectorAll('.photoRail').forEach((r,ri)=>{r.innerHTML='';const arr=ri?p.slice().reverse():p;for(const c of arr){const s=document.createElement('i');s.style.background=c;r.appendChild(s);}});}

CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const img=priorGetImageData.apply(this,args);if(this.canvas?.id!=='capture')return img;
  try{
    const now=performance.now(),last=analyze(img,this.canvas.width,this.canvas.height);window.__hopperOpticalDockV2.last=last;let currentBridge=window.__hopperBinaryTagBridge?.last||null;
    if(window.__hopperBinaryTagBridge){const b=currentBridge||{};if(last.valid&&(!b.valid||last.source==='contour'||last.source==='track'))window.__hopperBinaryTagBridge.last={...b,...last,found:b.found||0,decoded:b.decoded||[]};else if(b.valid)window.__hopperBinaryTagBridge.last={...b,dock:last,stableForDecode:last.stableForDecode,frameDelta:last.frameDelta,rails:last.rails,photometricOK:last.photometricOK};currentBridge=window.__hopperBinaryTagBridge.last;}
    if(last.valid&&last.stableForDecode){lastStableImage=img;lastStableBridge=cloneBridge(currentBridge);lastStableTs=now;heldFrames=0;return img;}
    if(last.valid&&!last.stableForDecode&&lastStableImage&&now-lastStableTs<220&&lastStableImage.width===img.width&&lastStableImage.height===img.height){heldFrames++;last.held=true;last.heldFrames=heldFrames;if(window.__hopperBinaryTagBridge&&lastStableBridge)window.__hopperBinaryTagBridge.last=cloneBridge(lastStableBridge);return lastStableImage;}
  }catch{}
  return img;
};

function install(){renderDock();for(const id of ['modulationMode','streamShape'])document.getElementById(id)?.addEventListener('change',updateRails);window.addEventListener('hopper:runtime-ready',()=>{renderDock();updateRails();});}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperOpticalDockV2={version:'0.9.16',active:true,last:null,contourLock:true,temporalTracking:true,photometricRails:true,stableFrameGate:true,frameFreezeOnTransition:true,findContour,markersFromContour,analyze};
})();
