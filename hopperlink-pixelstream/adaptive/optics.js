import {CameraTracker as LegacyTracker} from '../src/receiver2.js';
import {crc32} from '../src/crc32.js';
import {PROFILES,bootstrap,profile,PALETTES,rgb,headerBytes,parseHeader,HEADER_BYTES,finderCenters,KIND} from './protocol.js';
const COLORS=['#ff00ff','#00ffff','#ffff00','#00ff00'];
export function render(canvas,frame,p,sid,seq=0,total=1,streamLength=1){
 const scale=10;if(canvas.width!==p.cols*scale||canvas.height!==p.rows*scale){canvas.width=p.cols*scale;canvas.height=p.rows*scale;}
 const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
 const cell=(x,y,c)=>{ctx.fillStyle=c;ctx.fillRect(x*scale,y*scale,scale,scale);};
 if(frame){
  const h=headerBytes(frame,p,sid,seq,total,streamLength);p.headerCells.forEach(([x,y],i)=>cell(x,y,(h[(i%(HEADER_BYTES*8))>>3]>>(7-i%8))&1?'#eeeeee':'#101010'));
  p.pilots.forEach(([x,y,s])=>cell(x,y,PALETTES[p.paletteId][s]));
  let bi=0;for(const [x,y] of p.cells){let v=0;for(let j=0;j<p.bits;j++){v=(v<<1)|((frame.payload[bi>>3]||0)>>(7-bi%8)&1);bi++;}cell(x,y,PALETTES[p.paletteId][v]);}
 }
 // Same Lighthouse corner convention. Constant pilots, no brightness flashing.
 finderCenters(p).forEach((c,i)=>{const size=frame?10:18,x=c.x-size/2,y=c.y-size/2;ctx.fillStyle=COLORS[i];ctx.fillRect(x*scale,y*scale,size*scale,size*scale);ctx.fillStyle='#000';ctx.fillRect((x+3)*scale,(y+3)*scale,(size-6)*scale,(size-6)*scale);ctx.fillStyle='#eee';ctx.fillRect((c.x-1)*scale,(c.y-1)*scale,2*scale,2*scale);});
}
function bilinear(data,W,H,x,y){
 if(x<0||y<0||x>W-1||y>H-1)return null;const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,out=[0,0,0];
 for(let j=0;j<2;j++)for(let i=0;i<2;i++){const w=(i?dx:1-dx)*(j?dy:1-dy),o=(Math.min(H-1,iy+j)*W+Math.min(W-1,ix+i))*4;for(let k=0;k<3;k++)out[k]+=w*data[o+k];}return out;
}
function sample(data,W,H,map,x,y,multi=true){
 const p=map(x,y);if(!p)return null;
 if(!multi)return bilinear(data,W,H,p.x,p.y);
 const offsets=[[-.14,-.14],[.14,-.14],[-.14,.14],[.14,.14]],out=[0,0,0];
 for(const [dx,dy] of offsets){const q=map(x+dx,y+dy),c=bilinear(data,W,H,q.x,q.y);if(!c)return null;for(let k=0;k<3;k++)out[k]+=c[k]/4;}return out;
}
const lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
const bitsToBytes=bits=>{const out=new Uint8Array(Math.floor(bits.length/8));bits.forEach((b,i)=>{if(i<out.length*8)out[i>>3]|=b<<(7-i%8);});return out;};
export class AdaptiveTracker extends LegacyTracker{
 constructor(video,overlay,onQuality,onFrame){super(video,overlay,onQuality,onFrame);this.visibleQuad=null;this.rawQuad=null;this.lastSeen=0;this.lastMedia=-1;this.lastProfile=0;this.globalAt=0;this.counter=0;this.stats={capture:0,headers:0,valid:0,crcFailed:0,motion:0,processMs:0};this.detectCanvas=document.createElement('canvas');this.detectCtx=this.detectCanvas.getContext('2d',{willReadFrequently:true});}
 start(){if(this.running)return;this.running=true;this.schedule();}
 stop(){this.running=false;cancelAnimationFrame(this.raf);if(this.video.cancelVideoFrameCallback&&this.vfc)this.video.cancelVideoFrameCallback(this.vfc);this.vfc=0;}
 schedule(){if(!this.running)return;if(this.video.requestVideoFrameCallback)this.vfc=this.video.requestVideoFrameCallback((now,meta)=>{this.tick(now,meta.mediaTime);this.schedule();});else this.raf=requestAnimationFrame(now=>{this.tick(now,this.video.currentTime);this.schedule();});}
 tick(now,mediaTime){
  if(!this.running||this.video.readyState<2||mediaTime===this.lastMedia||document.hidden)return;this.lastMedia=mediaTime;
  try{const began=performance.now(),sw=this.video.videoWidth,sh=this.video.videoHeight;if(!sw||!sh)return;
   const W=Math.min(1280,sw),H=Math.round(W*sh/sw);if(this.work.width!==W||this.work.height!==H){this.work.width=W;this.work.height=H;this.rawQuad=null;}
   this.ctx.drawImage(this.video,0,0,W,H);const img=this.ctx.getImageData(0,0,W,H);
   const dw=Math.min(480,W),dh=Math.round(dw*H/W);if(this.detectCanvas.width!==dw||this.detectCanvas.height!==dh){this.detectCanvas.width=dw;this.detectCanvas.height=dh;}
   this.detectCtx.drawImage(this.work,0,0,dw,dh);const low=this.detectCtx.getImageData(0,0,dw,dh),expected=now-this.lastSeen<500?this.rawQuad?.map(q=>({x:q.x*dw/W,y:q.y*dh/H})):null;
   const found=this.detectBeacons(low.data,dw,dh,expected);let current=null;
   if(found){current=found.quad.map(q=>({x:q.x*W/dw,y:q.y*H/dh}));current=this.refine(img.data,W,H,current);const old=this.rawQuad;
    if(old){const pitch=Math.max(1,Math.hypot(current[1].x-current[0].x,current[1].y-current[0].y)/(profile(this.lastProfile).cols-18));this.stats.motion=current.reduce((s,p,i)=>s+Math.hypot(p.x-old[i].x,p.y-old[i].y),0)/4/pitch;}
    this.rawQuad=current;this.lastSeen=now;this.visibleQuad=this.smooth(this.visibleQuad,current,.4);
   }else if(now-this.lastSeen>250){this.rawQuad=null;this.visibleQuad=null;}
   this.stats.capture++;const lock=current?this.geometryScore(current,W,H):0;this.draw(this.visibleQuad,lock);
   if(current){const decoded=this.decodeAdaptive(img.data,W,H,current);if(decoded)this.onFrame?.(decoded);}
   this.stats.processMs=performance.now()-began;this.onQuality?.({lock,quad:current,stats:{...this.stats}});
  }catch(e){this.onQuality?.({lock:0,error:e.message,stats:{...this.stats}});}
 }
 refine(data,W,H,q){
  const size=Math.min(Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y),Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y));
  const radius=Math.max(7,size*.12);
  return q.map((c,i)=>{let sx=0,sy=0,n=0;for(let y=Math.max(0,Math.floor(c.y-radius));y<Math.min(H,c.y+radius);y++)for(let x=Math.max(0,Math.floor(c.x-radius));x<Math.min(W,c.x+radius);x++){
   const o=(y*W+x)*4,r=data[o],g=data[o+1],b=data[o+2],s=i===0?Math.min(r,b)-g:i===1?Math.min(g,b)-r:i===2?Math.min(r,g)-b:g-Math.max(r,b);
   if(s>90){const w=s-75;sx+=x*w;sy+=y*w;n+=w;}
  }return n?{x:sx/n,y:sy/n}:c;});
 }
 decodeAdaptive(data,W,H,quad){
  const order=[this.lastProfile,0,...PROFILES.map(p=>p.id)].filter((id,i,a)=>a.indexOf(id)===i);
  for(const id of order){const p=profile(id),map=this.mapper(quad,p),values=[];
   if(!map)continue;let outside=false;
   for(const [x,y] of p.headerCells){const c=sample(data,W,H,map,x,y,false);if(!c){outside=true;break;}values.push(lum(c));}if(outside)continue;
   const sorted=[...values].sort((a,b)=>a-b),lo=sorted[Math.floor(sorted.length*.14)],hi=sorted[Math.floor(sorted.length*.86)];if(hi-lo<35)continue;
   const votes=Array.from({length:HEADER_BYTES*8},()=>[0,0]);values.forEach((v,i)=>votes[i%(HEADER_BYTES*8)][v>(lo+hi)/2?1:0]++);
   const h=parseHeader(bitsToBytes(votes.map(v=>v[1]>v[0]?1:0)));if(!h||h.profileId!==id)continue;this.stats.headers++;this.lastProfile=id;
   const out=this.decodeCells(data,W,H,map,p,h);if(!out)return null;
   const crcOK=crc32(out.payload)===h.crc;if(crcOK)this.stats.valid++;else this.stats.crcFailed++;
   if(!crcOK&&h.kind!==KIND.PROBE)return null;
   return {header:h,payload:out.payload,crcOK,quality:out.quality,motion:this.stats.motion,ambiguity:out.ambiguity,symbols:out.symbols};
  }return null;
 }
 decodeCells(data,W,H,map,p,h){
  const palette=rgb(p),bins=Array.from({length:4},()=>palette.map(()=>({n:0,sum:[0,0,0],sq:[0,0,0]})));
  for(const [x,y,s] of p.pilots){const c=sample(data,W,H,map,x,y);if(!c)continue;const bin=(y>=p.rows/2?2:0)+(x>=p.cols/2?1:0),a=bins[bin][s];a.n++;for(let k=0;k<3;k++){a.sum[k]+=c[k];a.sq[k]+=c[k]*c[k];}}
  const means=bins.map(list=>list.map((a,i)=>({m:a.n?a.sum.map(s=>s/a.n):palette[i],v:a.n?a.sq.map((s,k)=>Math.max(49,s/a.n-(a.sum[k]/a.n)**2)):[100,100,100]})));
  const bytes=new Uint8Array(h.payloadLen),symbols=[],required=Math.ceil(h.payloadLen*8/p.bits);let bit=0,ambiguous=0;
  for(let j=0;j<required;j++){const [x,y]=p.cells[j],c=sample(data,W,H,map,x,y);if(!c)return null;const wx=Math.min(1,Math.max(0,(x-p.cols*.25)/(p.cols*.5))),wy=Math.min(1,Math.max(0,(y-p.rows*.25)/(p.rows*.5))),weights=[(1-wx)*(1-wy),wx*(1-wy),(1-wx)*wy,wx*wy];let best=Infinity,second=Infinity,index=0;
   palette.forEach((_,s)=>{let dist=0;for(let k=0;k<3;k++){let m=0,v=0;for(let b=0;b<4;b++){m+=weights[b]*means[b][s].m[k];v+=weights[b]*means[b][s].v[k];}dist+=(c[k]-m)**2/Math.max(49,v)+Math.log(Math.max(49,v));}if(dist<best){second=best;best=dist;index=s;}else if(dist<second)second=dist;});
   if(second-best<1.5)ambiguous++;symbols.push(index);for(let k=p.bits-1;k>=0;k--){if(bit<h.payloadLen*8)bytes[bit>>3]|=((index>>k)&1)<<(7-bit%8);bit++;}
  }
  return {payload:bytes,symbols,ambiguity:ambiguous/Math.max(1,required),quality:1-ambiguous/Math.max(1,required)};
 }
}
export async function stabilizeTrack(track){
 const caps=track.getCapabilities?.()||{},settings=track.getSettings?.()||{},advanced=[];
 for(const key of ['focusMode','exposureMode','whiteBalanceMode'])if(caps[key]?.includes('manual')){
  const value=key==='focusMode'?'focusDistance':key==='exposureMode'?'exposureTime':'colorTemperature';
  if(Number.isFinite(settings[value])&&caps[value])advanced.push({[key]:'manual',[value]:settings[value]});
 }
 if(advanced.length){try{await track.applyConstraints({advanced});return {locked:true,settings:track.getSettings()};}catch{}}
 return {locked:false,settings:track.getSettings?.()||{},note:'Controles manuales no disponibles; se valida con ajustes automáticos.'};
}
