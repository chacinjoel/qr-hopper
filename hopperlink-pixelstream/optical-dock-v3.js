(() => {
'use strict';

const KEYS=['tl','tr','bl','br'];
const priorGetImageData=CanvasRenderingContext2D.prototype.getImageData;
const priorPutImageData=CanvasRenderingContext2D.prototype.putImageData;
const media=navigator.mediaDevices;
const nativeGetUserMedia=media?.getUserMedia?media.getUserMedia.bind(media):null;

// Fixed calibration constellation. It never depends on the receiver UI mode.
const TOP_TARGETS=[
 [26,26,26],[92,92,92],[164,164,164],[236,236,236],
 [173,24,12],[12,173,28],[12,42,173],[173,12,121]
];
const BOTTOM_TARGETS=[
 [87,12,6],[6,87,14],[6,21,87],[87,6,61],
 [52,52,52],[116,116,116],[188,188,188],[220,220,220]
];
const PHASE_X=[.425,.475,.525,.575],PHASE_TOP_Y=.071,PHASE_BOTTOM_Y=.929;

let dockMemory=null,contourCandidate=null,lastStableImage=null,lastStableBridge=null,lastStableTs=0,heldFrames=0;
let lastCalibration=null,phaseSeq=0,activeTrack=null,lastExposureTs=0,lastExposure=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function luma(d,p){return(d[p]+d[p+1]+d[p+2])/3;}
function percentile(a,f){if(!a.length)return 0;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor(s.length*f)))];}
function bilerp(q,u,v){const a={x:q.tl.x*(1-u)+q.tr.x*u,y:q.tl.y*(1-u)+q.tr.y*u},b={x:q.bl.x*(1-u)+q.br.x*u,y:q.bl.y*(1-u)+q.br.y*u};return{x:a.x*(1-v)+b.x*v,y:a.y*(1-v)+b.y*v};}
function sampleRGB(d,w,h,x,y,rad=1){x=Math.round(x);y=Math.round(y);const rs=[],gs=[],bs=[];for(let yy=Math.max(0,y-rad);yy<=Math.min(h-1,y+rad);yy++)for(let xx=Math.max(0,x-rad);xx<=Math.min(w-1,x+rad);xx++){const p=(yy*w+xx)*4;rs.push(d[p]);gs.push(d[p+1]);bs.push(d[p+2]);}rs.sort((a,b)=>a-b);gs.sort((a,b)=>a-b);bs.sort((a,b)=>a-b);const m=Math.floor(rs.length/2);return[rs[m]||0,gs[m]||0,bs[m]||0];}
function darkThreshold(d,w,h){const vals=[],step=Math.max(8,Math.floor(Math.min(w,h)/72));for(let y=step>>1;y<h;y+=step)for(let x=step>>1;x<w;x+=step)vals.push(luma(d,(y*w+x)*4));const p10=percentile(vals,.10),p50=percentile(vals,.50);return clamp(p10+(p50-p10)*.34,16,150);}
function quadLengths(q){return{top:Math.hypot(q.tr.x-q.tl.x,q.tr.y-q.tl.y),bottom:Math.hypot(q.br.x-q.bl.x,q.br.y-q.bl.y),left:Math.hypot(q.bl.x-q.tl.x,q.bl.y-q.tl.y),right:Math.hypot(q.br.x-q.tr.x,q.br.y-q.tr.y)};}
function shapeScore(q){const s=quadLengths(q),width=(s.top+s.bottom)/2,height=(s.left+s.right)/2,r=width/Math.max(1,height);const sq=Math.exp(-Math.abs(Math.log(Math.max(.01,r/1.0)))*2.4),dual=Math.exp(-Math.abs(Math.log(Math.max(.01,r/.5)))*2.4);return{ratio:r,score:Math.max(sq,dual),kind:dual>sq?'dual':'square'};}
function contourGeometryOK(q,w,h){if(!q)return false;const s=quadLengths(q),minDim=Math.min(w,h),width=(s.top+s.bottom)/2,height=(s.left+s.right)/2;if(Math.min(s.top,s.bottom,s.left,s.right)<minDim*.25)return false;const diag1=Math.hypot(q.br.x-q.tl.x,q.br.y-q.tl.y),diag2=Math.hypot(q.bl.x-q.tr.x,q.bl.y-q.tr.y);if(Math.min(diag1,diag2)/Math.max(diag1,diag2)<.58)return false;const sh=shapeScore(q);return width>minDim*.26&&height>minDim*.26&&sh.ratio>.27&&sh.ratio<1.55&&sh.score>.30;}

function findContour(img,w,h){
  const d=img.data,thr=darkThreshold(d,w,h),stride=Math.max(3,Math.floor(Math.min(w,h)/230)),gw=Math.ceil(w/stride),gh=Math.ceil(h/stride),mask=new Uint8Array(gw*gh);
  for(let gy=0;gy<gh;gy++){const y=Math.min(h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(w-1,gx*stride+(stride>>1));mask[gy*gw+gx]=luma(d,(y*w+x)*4)<=thr?1:0;}}
  const seen=new Uint8Array(mask.length),candidates=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1,minS=1e9,maxS=-1e9,minD=1e9,maxD=-1e9,pTL=null,pTR=null,pBL=null,pBR=null;
    while(stack.length){const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);const sum=cx+cy,dif=cx-cy;if(sum<minS){minS=sum;pTL={x:cx,y:cy};}if(sum>maxS){maxS=sum;pBR={x:cx,y:cy};}if(dif>maxD){maxD=dif;pTR={x:cx,y:cy};}if(dif<minD){minD=dif;pBL={x:cx,y:cy};}for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]){seen[ni]=1;stack.push(ni);}}}
    if(count<60)continue;const bw=(maxX-minX+1)*stride,bh=(maxY-minY+1)*stride,long=Math.max(bw,bh)/Math.min(w,h),boxCells=(maxX-minX+1)*(maxY-minY+1),fill=count/Math.max(1,boxCells);if(long<.30||long>1.60||fill>.62)continue;
    const cv=p=>({x:clamp((p.x+.5)*stride,0,w-1),y:clamp((p.y+.5)*stride,0,h-1)}),quad={tl:cv(pTL),tr:cv(pTR),bl:cv(pBL),br:cv(pBR)};if(!contourGeometryOK(quad,w,h))continue;
    const sides=quadLengths(quad),balance=Math.min(sides.top,sides.bottom)/Math.max(sides.top,sides.bottom)*Math.min(sides.left,sides.right)/Math.max(sides.left,sides.right),shape=shapeScore(quad),score=count*(.5+balance)*(1-Math.min(.82,fill))*(.45+.55*shape.score);candidates.push({quad,score,count,fill,threshold:thr,shape});
  }
  candidates.sort((a,b)=>b.score-a.score);return candidates[0]||null;
}
function markersFromContour(c){if(!c?.quad)return null;const q=c.quad;return{tl:bilerp(q,.06,.06),tr:bilerp(q,.94,.06),bl:bilerp(q,.06,.94),br:bilerp(q,.94,.94)};}
function smoothMarkers(oldM,newM,a){if(!oldM)return newM;const out={};for(const k of KEYS)out[k]={x:oldM[k].x*(1-a)+newM[k].x*a,y:oldM[k].y*(1-a)+newM[k].y*a};return out;}
function markerMotion(a,b){if(!a||!b)return 0;let s=0;for(const k of KEYS)s+=Math.hypot(a[k].x-b[k].x,a[k].y-b[k].y);return s/4;}
function stagePoint(markers,nx,ny){const u=(nx-.06)/.88,v=(ny-.06)/.88;return bilerp(markers,u,v);}
function extrapolate(mem,now){const dt=now-mem.ts;if(dt>520)return null;const scale=dt/Math.max(1,mem.sampleDt||33),out={};for(const k of KEYS)out[k]={x:mem.markers[k].x+(mem.vx||0)*scale,y:mem.markers[k].y+(mem.vy||0)*scale};return out;}
function cloneBridge(b){if(!b)return null;const markers=b.markers?Object.fromEntries(KEYS.map(k=>[k,b.markers[k]?{x:b.markers[k].x,y:b.markers[k].y}:null])):null;return{...b,markers,decoded:Array.isArray(b.decoded)?b.decoded.slice():[]};}

function solve4(A,b){const M=A.map((r,i)=>r.slice().concat([b[i]]));for(let c=0;c<4;c++){let p=c;for(let r=c+1;r<4;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;if(Math.abs(M[p][c])<1e-8)return null;[M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let j=c;j<=4;j++)M[c][j]/=d;for(let r=0;r<4;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=4;j++)M[r][j]-=f*M[c][j];}}return M.map(r=>r[4]);}
function fitAffine(obs,target){if(!obs||obs.length<4||obs.length!==target.length)return null;const xtx=Array.from({length:4},()=>new Array(4).fill(0)),xty=[new Array(4).fill(0),new Array(4).fill(0),new Array(4).fill(0)];for(let i=0;i<obs.length;i++){const x=[obs[i][0]/255,obs[i][1]/255,obs[i][2]/255,1],y=[target[i][0]/255,target[i][1]/255,target[i][2]/255];for(let a=0;a<4;a++){for(let b=0;b<4;b++)xtx[a][b]+=x[a]*x[b];for(let ch=0;ch<3;ch++)xty[ch][a]+=x[a]*y[ch];}}for(let i=0;i<4;i++)xtx[i][i]+=0.002;const rows=xty.map(y=>solve4(xtx,y));if(rows.some(r=>!r))return null;let err=0;for(let i=0;i<obs.length;i++){const x=[obs[i][0]/255,obs[i][1]/255,obs[i][2]/255,1];for(let ch=0;ch<3;ch++){const pred=rows[ch].reduce((s,v,j)=>s+v*x[j],0),tar=target[i][ch]/255;err+=(pred-tar)*(pred-tar);}}const rms=Math.sqrt(err/(obs.length*3));return rms<.22?{rows,rms}:null;}
function applyModel(rgb,model){if(!model)return rgb;const x=[rgb[0]/255,rgb[1]/255,rgb[2]/255,1],o=[0,0,0];for(let ch=0;ch<3;ch++)o[ch]=clamp(model.rows[ch].reduce((s,v,j)=>s+v*x[j],0)*255,0,255);return o;}

function railSamples(img,w,h,markers){const top=[],bottom=[];for(let i=0;i<8;i++){const x=.205+i*(.59/7),pt=stagePoint(markers,x,.095),pb=stagePoint(markers,x,.905);top.push(sampleRGB(img.data,w,h,pt.x,pt.y,1));bottom.push(sampleRGB(img.data,w,h,pb.x,pb.y,1));}const all=top.concat(bottom),lum=all.map(v=>(v[0]+v[1]+v[2])/3),lo=percentile(lum,.10),hi=percentile(lum,.90),clippedHigh=lum.filter(v=>v>248).length/lum.length,clippedLow=lum.filter(v=>v<5).length/lum.length;const topModel=fitAffine(top,TOP_TARGETS),bottomModel=fitAffine(bottom,BOTTOM_TARGETS),allModel=fitAffine(all,TOP_TARGETS.concat(BOTTOM_TARGETS));return{top,bottom,contrast:hi-lo,highlight:hi,shadow:lo,clippedHigh,clippedLow,topModel,bottomModel,allModel,modelOK:!!(topModel&&bottomModel&&allModel),rms:allModel?.rms??null};}
function normalizeSamples(samples,lane=-1){const cal=lastCalibration;if(!cal?.modelOK||!samples)return samples;const model=lane===0?cal.topModel:lane===1?cal.bottomModel:cal.allModel;if(!model)return samples;for(let i=0;i<samples.length;i+=3){const o=applyModel([samples[i],samples[i+1],samples[i+2]],model);samples[i]=o[0];samples[i+1]=o[1];samples[i+2]=o[2];}return samples;}

function phaseAt(img,w,h,markers,y){const vals=PHASE_X.map(x=>{const p=stagePoint(markers,x,y);return(sampleRGB(img.data,w,h,p.x,p.y,1)[0]+sampleRGB(img.data,w,h,p.x,p.y,1)[1]+sampleRGB(img.data,w,h,p.x,p.y,1)[2])/3;});let best=0;for(let i=1;i<vals.length;i++)if(vals[i]>vals[best])best=i;const sorted=vals.slice().sort((a,b)=>b-a);return sorted[0]-sorted[1]>=28?{phase:best,margin:sorted[0]-sorted[1],values:vals}:null;}
function phaseCheck(img,w,h,markers){const top=phaseAt(img,w,h,markers,PHASE_TOP_Y),bottom=phaseAt(img,w,h,markers,PHASE_BOTTOM_Y),known=!!(top&&bottom),mismatch=known&&top.phase!==bottom.phase;return{top,bottom,known,mismatch,phase:known&&!mismatch?top.phase:null};}

async function maybeTuneExposure(rails,now){if(!activeTrack||now-lastExposureTs<700||!rails)return;lastExposureTs=now;try{const cap=activeTrack.getCapabilities?.()||{},range=cap.exposureCompensation;if(!range||!Number.isFinite(range.min)||!Number.isFinite(range.max))return;const settings=activeTrack.getSettings?.()||{},step=Math.max(.08,Number(range.step)||.1),current=Number.isFinite(settings.exposureCompensation)?settings.exposureCompensation:(Number.isFinite(lastExposure)?lastExposure:-.5);let desired=current;if(rails.clippedHigh>.06||rails.highlight>242)desired=current-step;else if(rails.highlight<158&&rails.contrast<125)desired=current+step;desired=clamp(desired,Math.max(range.min,-1.2),Math.min(range.max,.3));if(Math.abs(desired-current)<step*.55)return;await activeTrack.applyConstraints({advanced:[{exposureCompensation:desired}]});lastExposure=desired;window.dispatchEvent(new CustomEvent('hopper:adaptive-exposure',{detail:{ev:desired,highlight:rails.highlight,contrast:rails.contrast}}));}catch{}
}

function acceptContour(contourMarkers,w,h,now){if(!contourMarkers)return null;const minDim=Math.min(w,h);if(dockMemory){const d=markerMotion(contourMarkers,dockMemory.markers),side=Math.max(1,Math.hypot(dockMemory.markers.tr.x-dockMemory.markers.tl.x,dockMemory.markers.tr.y-dockMemory.markers.tl.y));if(d<side*.13){contourCandidate=null;return contourMarkers;}const same=contourCandidate&&markerMotion(contourMarkers,contourCandidate.markers)<minDim*.045;contourCandidate={markers:contourMarkers,count:same?contourCandidate.count+1:1,ts:now};return contourCandidate.count>=3?contourMarkers:null;}
  const same=contourCandidate&&now-contourCandidate.ts<260&&markerMotion(contourMarkers,contourCandidate.markers)<minDim*.045;contourCandidate={markers:contourMarkers,count:same?contourCandidate.count+1:1,ts:now};return contourCandidate.count>=2?contourMarkers:null;
}

function analyze(img,w,h){
  const now=performance.now(),bridge=window.__hopperBinaryTagBridge?.last||null,contour=findContour(img,w,h),rawContour=markersFromContour(contour),acceptedContour=acceptContour(rawContour,w,h,now);let markers=null,source='none',quality=0;
  if(bridge?.valid&&bridge.markers){markers=bridge.markers;source=bridge.reused?'tag-memory':'tags';quality=bridge.quality||92;if(acceptedContour){const d=markerMotion(markers,acceptedContour);if(d<Math.min(w,h)*.10)markers=smoothMarkers(markers,acceptedContour,.08);}}
  else if(acceptedContour){markers=acceptedContour;source='contour';quality=76;}
  else if(dockMemory){markers=extrapolate(dockMemory,now);if(markers){source='track';quality=clamp(Math.round(80-(now-dockMemory.ts)/14),46,78);}}
  if(!markers)return{ts:now,valid:false,source:rawContour?'contour-candidate':'search',quality:0,contour:!!contour,stableForDecode:false};

  const previous=dockMemory?.markers||null,motionPx=markerMotion(markers,previous),side=Math.max(1,(Math.hypot(markers.tr.x-markers.tl.x,markers.tr.y-markers.tl.y)+Math.hypot(markers.bl.x-markers.tl.x,markers.bl.y-markers.tl.y))/2),motionNorm=motionPx/side,alpha=source==='contour'?.28:motionNorm>.045?.55:.32;markers=previous?smoothMarkers(previous,markers,alpha):markers;
  const dt=dockMemory?Math.max(1,now-dockMemory.ts):33,dx=dockMemory?(markers.tl.x-dockMemory.markers.tl.x):0,dy=dockMemory?(markers.tl.y-dockMemory.markers.tl.y):0;dockMemory={markers,ts:now,vx:dx,vy:dy,sampleDt:dt};

  const rails=railSamples(img,w,h,markers),phase=phaseCheck(img,w,h,markers);lastCalibration=rails;maybeTuneExposure(rails,now);
  const motionBad=motionNorm>.085,photoBad=rails.contrast<26||rails.clippedHigh>.55,phaseBad=phase.mismatch,stableForDecode=!motionBad&&!photoBad&&!phaseBad;
  quality=clamp(Math.round(quality-Math.min(18,motionNorm*150)-(photoBad?12:0)-(phaseBad?22:0)-(rails.modelOK?0:8)),30,100);
  return{ts:now,valid:true,source,markers,quality,contour:!!contour,motionPx,motionNorm,rails:{contrast:rails.contrast,highlight:rails.highlight,shadow:rails.shadow,clippedHigh:rails.clippedHigh,clippedLow:rails.clippedLow,rms:rails.rms,modelOK:rails.modelOK},phase,phaseKnown:phase.known,phaseMismatch:phase.mismatch,stableForDecode,photometricOK:!photoBad,normalized:rails.modelOK,exposureEV:lastExposure};
}

function rgbCss(c){return`rgb(${c[0]},${c[1]},${c[2]})`;}
function renderRail(host,arr){host.innerHTML='';for(const c of arr){const s=document.createElement('i');s.style.background=rgbCss(c);host.appendChild(s);}}
function renderDock(){
  const frame=document.querySelector('.pixelFrame');if(!frame||frame.querySelector('.opticalDockV3'))return;const root=document.createElement('div');root.className='opticalDockV3';root.setAttribute('aria-hidden','true');for(const pos of ['top','right','bottom','left']){const a=document.createElement('div');a.className='dockAnchor dock-'+pos;a.innerHTML='<i></i><i></i><i></i>';root.appendChild(a);}const rt=document.createElement('div'),rb=document.createElement('div');rt.className='photoRail rail-top';rb.className='photoRail rail-bottom';renderRail(rt,TOP_TARGETS);renderRail(rb,BOTTOM_TARGETS);root.appendChild(rt);root.appendChild(rb);for(const pos of ['top','bottom']){const b=document.createElement('div');b.className='phaseBeacon phase-'+pos;for(let i=0;i<4;i++)b.appendChild(document.createElement('i'));root.appendChild(b);}frame.appendChild(root);setPhase(0);
}
function setPhase(n){phaseSeq=((Number(n)||0)%4+4)%4;document.querySelectorAll('.phaseBeacon').forEach(b=>Array.from(b.children).forEach((c,i)=>c.classList.toggle('on',i===phaseSeq)));}
function advancePhase(){setPhase((phaseSeq+1)&3);return phaseSeq;}

if(nativeGetUserMedia){media.getUserMedia=async function(...args){const stream=await nativeGetUserMedia(...args);try{activeTrack=stream.getVideoTracks?.()[0]||null;lastExposure=Number(activeTrack?.getSettings?.().exposureCompensation);if(!Number.isFinite(lastExposure))lastExposure=null;}catch{activeTrack=null;}return stream;};}

CanvasRenderingContext2D.prototype.putImageData=function(img,dx,dy,...rest){if(this.canvas?.id==='pixelCanvas')advancePhase();return priorPutImageData.call(this,img,dx,dy,...rest);};
CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const img=priorGetImageData.apply(this,args);if(this.canvas?.id!=='capture')return img;
  try{
    const now=performance.now(),last=analyze(img,this.canvas.width,this.canvas.height);window.__hopperOpticalDockV3.last=last;let currentBridge=window.__hopperBinaryTagBridge?.last||null;
    if(window.__hopperBinaryTagBridge){const b=currentBridge||{};if(last.valid&&(!b.valid||last.source==='contour'||last.source==='track'))window.__hopperBinaryTagBridge.last={...b,...last,found:last.source==='contour'?4:(b.found||0),decoded:b.decoded||[]};else if(b.valid)window.__hopperBinaryTagBridge.last={...b,dock:last,stableForDecode:last.stableForDecode,rails:last.rails,phase:last.phase,phaseMismatch:last.phaseMismatch,normalized:last.normalized,exposureEV:last.exposureEV};currentBridge=window.__hopperBinaryTagBridge.last;}
    if(last.valid&&last.stableForDecode){lastStableImage=img;lastStableBridge=cloneBridge(currentBridge);lastStableTs=now;heldFrames=0;return img;}
    if(last.valid&&!last.stableForDecode&&lastStableImage&&now-lastStableTs<240&&lastStableImage.width===img.width&&lastStableImage.height===img.height){heldFrames++;last.held=true;last.heldFrames=heldFrames;if(window.__hopperBinaryTagBridge&&lastStableBridge)window.__hopperBinaryTagBridge.last=cloneBridge(lastStableBridge);return lastStableImage;}
  }catch{}
  return img;
};

function install(){renderDock();window.addEventListener('hopper:runtime-ready',renderDock);}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperOpticalDockV3={version:'0.9.17',active:true,last:null,contourLock:true,geometryHysteresis:true,temporalTracking:true,universalPhotometricRails:true,adaptiveExposure:true,phaseBeacons:true,rollingShutterGate:true,laneNormalization:true,findContour,markersFromContour,analyze,normalizeSamples,setPhase,advancePhase,topTargets:TOP_TARGETS,bottomTargets:BOTTOM_TARGETS};
})();
