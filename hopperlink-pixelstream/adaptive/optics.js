import {CameraTracker as LegacyTracker} from '../src/receiver2.js';
import {crc32} from '../src/crc32.js';
import {PROFILES,bootstrap,profile,PALETTES,rgb,headerBytes,parseHeader,HEADER_BYTES,finderCenters,KIND,readControl} from './protocol.js';

const COLORS=['#ff00ff','#00ffff','#ffff00','#00ff00'];
const renderVisits=new WeakMap();

function crc16(a){let c=0xffff;for(const b of a){c^=b<<8;for(let k=0;k<8;k++)c=c&0x8000?(c<<1)^0x1021:c<<1;c&=65535;}return c;}
function toSymbols(bytes,bits){const out=[];let acc=0,n=0;for(const b of bytes){acc=(acc<<8)|b;n+=8;while(n>=bits){n-=bits;out.push((acc>>n)&((1<<bits)-1));acc&=(1<<n)-1;}}if(n)out.push((acc<<(bits-n))&((1<<bits)-1));return out;}
function symbolsToBytes(symbols,bits,count){const out=new Uint8Array(count);let acc=0,n=0,oi=0;for(const s of symbols){acc=(acc<<bits)|s;n+=bits;while(n>=8&&oi<count){n-=8;out[oi++]=(acc>>n)&255;acc&=(1<<n)-1;}if(oi>=count)break;}return out;}
function nextRound(canvas,frame,p){
 if(!frame||p.sectorCount<=1||frame.kind>1)return frame?.round||0;
 let state=renderVisits.get(canvas);if(!state){state=new Map();renderVisits.set(canvas,state);}
 const key=`${frame.kind}:${frame.group||0}:${frame.slot||0}:${frame.dataIndex??-1}`,n=state.get(key)||0;state.set(key,n+1);return n%p.sectorCount;
}
function paintBytes(cell,cells,bytes,bits,palette){const values=toSymbols(bytes,bits);for(let i=0;i<cells.length;i++){const [x,y]=cells[i];cell(x,y,palette[values[i]??0]);}}

export function render(canvas,frame,p,sid,seq=0,total=1,streamLength=1){
 const scale=10;if(canvas.width!==p.cols*scale||canvas.height!==p.rows*scale){canvas.width=p.cols*scale;canvas.height=p.rows*scale;}
 const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
 const cell=(x,y,c)=>{ctx.fillStyle=c;ctx.fillRect(x*scale,y*scale,scale,scale);};
 if(frame){
  const drawFrame=p.sectorCount>1&&frame.kind<2?{...frame,round:nextRound(canvas,frame,p)}:frame;
  const h=headerBytes(drawFrame,p,sid,seq,total,streamLength);p.headerCells.forEach(([x,y],i)=>cell(x,y,(h[(i%(HEADER_BYTES*8))>>3]>>(7-i%8))&1?'#eeeeee':'#101010'));
  p.pilots.forEach(([x,y,s])=>cell(x,y,PALETTES[p.paletteId][s]));
  if(p.sectorCount>1){
   const round=(drawFrame.round||0)%p.sectorCount;
   for(let physical=0;physical<p.sectorCount;physical++){
    const logical=(physical-round+p.sectorCount)%p.sectorCount,sector=p.sectors[physical],start=logical*sector.dataBytes,data=drawFrame.payload.subarray(start,start+sector.dataBytes),packet=new Uint8Array(sector.dataBytes+2),v=new DataView(packet.buffer);packet.set(data);v.setUint16(sector.dataBytes,crc16(data));paintBytes(cell,sector.cells,packet,p.bits,PALETTES[p.paletteId]);
   }
  }else paintBytes(cell,p.cells,drawFrame.payload,p.bits,PALETTES[p.paletteId]);
 }
 finderCenters(p).forEach((c,i)=>{const size=frame?10:18,x=c.x-size/2,y=c.y-size/2;ctx.fillStyle=COLORS[i];ctx.fillRect(x*scale,y*scale,size*scale,size*scale);ctx.fillStyle='#000';ctx.fillRect((x+3)*scale,(y+3)*scale,(size-6)*scale,(size-6)*scale);ctx.fillStyle='#eee';ctx.fillRect((c.x-1)*scale,(c.y-1)*scale,2*scale,2*scale);});
}

function bilinear(data,W,H,x,y){if(x<0||y<0||x>W-1||y>H-1)return null;const ix=Math.floor(x),iy=Math.floor(y),dx=x-ix,dy=y-iy,out=[0,0,0];for(let j=0;j<2;j++)for(let i=0;i<2;i++){const w=(i?dx:1-dx)*(j?dy:1-dy),o=(Math.min(H-1,iy+j)*W+Math.min(W-1,ix+i))*4;for(let k=0;k<3;k++)out[k]+=w*data[o+k];}return out;}
function sample(data,W,H,map,x,y,multi=true){const p=map(x,y);if(!p)return null;if(!multi)return bilinear(data,W,H,p.x,p.y);const offsets=[[-.14,-.14],[.14,-.14],[-.14,.14],[.14,.14]],out=[0,0,0];for(const [dx,dy] of offsets){const q=map(x+dx,y+dy),c=bilinear(data,W,H,q.x,q.y);if(!c)return null;for(let k=0;k<3;k++)out[k]+=c[k]/4;}return out;}
const lum=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
const bitsToBytes=bits=>{const out=new Uint8Array(Math.floor(bits.length/8));bits.forEach((b,i)=>{if(i<out.length*8)out[i>>3]|=b<<(7-i%8);});return out;};

export class AdaptiveTracker extends LegacyTracker{
 constructor(video,overlay,onQuality,onFrame){super(video,overlay,onQuality,onFrame);this.visibleQuad=null;this.rawQuad=null;this.lastSeen=0;this.lastMedia=-1;this.lastProfile=0;this.expectedProfile=null;this.globalAt=0;this.counter=0;this.partial=new Map();this.stats={capture:0,headers:0,valid:0,crcFailed:0,motion:0,processMs:0,globalScan:0,localTrack:0,sectorsValid:0,sectorsFailed:0,sectorAssemblies:0};this.detectCanvas=document.createElement('canvas');this.detectCtx=this.detectCanvas.getContext('2d',{willReadFrequently:true});}
 setExpectedProfile(id){this.expectedProfile=Number.isInteger(id)&&PROFILES[id]?id:null;}
 start(){if(this.running)return;this.running=true;this.schedule();}
 stop(){this.running=false;cancelAnimationFrame(this.raf);if(this.video.cancelVideoFrameCallback&&this.vfc)this.video.cancelVideoFrameCallback(this.vfc);this.vfc=0;}
 schedule(){if(!this.running)return;if(this.video.requestVideoFrameCallback)this.vfc=this.video.requestVideoFrameCallback((now,meta)=>{this.tick(now,meta.mediaTime);this.schedule();});else this.raf=requestAnimationFrame(now=>{this.tick(now,this.video.currentTime);this.schedule();});}
 tick(now,mediaTime){
  if(!this.running||this.video.readyState<2||mediaTime===this.lastMedia||document.hidden)return;this.lastMedia=mediaTime;
  try{const began=performance.now(),sw=this.video.videoWidth,sh=this.video.videoHeight;if(!sw||!sh)return;
   const p=this.expectedProfile!==null?profile(this.expectedProfile):profile(this.lastProfile),target=Math.max(1280,Math.min(1920,p.cols*10)),W=Math.min(target,sw),H=Math.round(W*sh/sw);if(this.work.width!==W||this.work.height!==H){this.work.width=W;this.work.height=H;this.rawQuad=null;this.visibleQuad=null;}
   this.ctx.drawImage(this.video,0,0,W,H);const img=this.ctx.getImageData(0,0,W,H);this.counter++;let current=null;
   if(this.rawQuad&&now-this.lastSeen<500&&this.counter%8!==0){const local=this.refine(img.data,W,H,this.rawQuad);if(local&&this.geometryScore(local,W,H)>.45){current=local;this.stats.localTrack++;}}
   if(!current){const dw=Math.min(480,W),dh=Math.round(dw*H/W);if(this.detectCanvas.width!==dw||this.detectCanvas.height!==dh){this.detectCanvas.width=dw;this.detectCanvas.height=dh;}this.detectCtx.drawImage(this.work,0,0,dw,dh);const low=this.detectCtx.getImageData(0,0,dw,dh),expected=now-this.lastSeen<500?this.rawQuad?.map(q=>({x:q.x*dw/W,y:q.y*dh/H})):null,found=this.detectBeacons(low.data,dw,dh,expected);this.stats.globalScan++;if(found){const coarse=found.quad.map(q=>({x:q.x*W/dw,y:q.y*H/dh}));current=this.refine(img.data,W,H,coarse);}}
   if(current){const old=this.rawQuad;if(old){const pitch=Math.max(1,Math.hypot(current[1].x-current[0].x,current[1].y-current[0].y)/(p.cols-18));this.stats.motion=current.reduce((s,q,i)=>s+Math.hypot(q.x-old[i].x,q.y-old[i].y),0)/4/pitch;}this.rawQuad=current;this.lastSeen=now;this.visibleQuad=this.smooth(this.visibleQuad,current,.4);}else if(now-this.lastSeen>250){this.rawQuad=null;this.visibleQuad=null;}
   this.stats.capture++;const lock=current?this.geometryScore(current,W,H):0;this.draw(this.visibleQuad,lock);if(current){const decoded=this.decodeAdaptive(img.data,W,H,current);if(decoded)this.onFrame?.(decoded);}this.stats.processMs=performance.now()-began;this.onQuality?.({lock,quad:current,stats:{...this.stats}});
  }catch(e){this.onQuality?.({lock:0,error:e.message,stats:{...this.stats}});}
 }
 refine(data,W,H,q){
  const top=Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y),left=Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y),active=Number.isInteger(this.expectedProfile)&&PROFILES[this.expectedProfile]?profile(this.expectedProfile):profile(this.lastProfile||0),pitch=Math.max(1,(top/Math.max(1,active.cols-18)+left/Math.max(1,active.rows-18))/2),radius=Math.max(7,pitch*(active.finder/2+1)),out=[];
  for(let i=0;i<q.length;i++){const c=q[i];let sx=0,sy=0,n=0;for(let y=Math.max(0,Math.floor(c.y-radius));y<Math.min(H,c.y+radius);y++)for(let x=Math.max(0,Math.floor(c.x-radius));x<Math.min(W,c.x+radius);x++){const o=(y*W+x)*4,r=data[o],g=data[o+1],b=data[o+2],s=i===0?Math.min(r,b)-g:i===1?Math.min(g,b)-r:i===2?Math.min(r,g)-b:g-Math.max(r,b);if(s>90){const w=s-75;sx+=x*w;sy+=y*w;n+=w;}}if(!n)return null;out.push({x:sx/n,y:sy/n});}return out;
 }
 decodeAdaptive(data,W,H,quad){
  const locked=Number.isInteger(this.expectedProfile)&&!!PROFILES[this.expectedProfile],preferred=locked?this.expectedProfile:this.lastProfile,order=(locked?[preferred,0,this.lastProfile]:[preferred,0,...PROFILES.map(p=>p.id)]).filter((id,i,a)=>a.indexOf(id)===i&&PROFILES[id]);
  for(const id of order){const p=profile(id),map=this.mapper(quad,p),values=[];if(!map)continue;let outside=false;for(const [x,y] of p.headerCells){const c=sample(data,W,H,map,x,y,false);if(!c){outside=true;break;}values.push(lum(c));}if(outside)continue;const sorted=[...values].sort((a,b)=>a-b),lo=sorted[Math.floor(sorted.length*.14)],hi=sorted[Math.floor(sorted.length*.86)];if(hi-lo<35)continue;const votes=Array.from({length:HEADER_BYTES*8},()=>[0,0]);values.forEach((v,i)=>votes[i%(HEADER_BYTES*8)][v>(lo+hi)/2?1:0]++);const h=parseHeader(bitsToBytes(votes.map(v=>v[1]>v[0]?1:0)));if(!h||h.profileId!==id)continue;this.stats.headers++;this.lastProfile=id;const out=this.decodeCells(data,W,H,map,p,h);if(!out)return null;let payload=out.payload,crcOK=false;if(p.sectorCount>1&&h.kind<2){payload=this.accumulateSectors(h,p,out.sectorParts);if(!payload)return null;crcOK=crc32(payload)===h.crc;}else{if(!payload)return null;crcOK=crc32(payload)===h.crc;}if(crcOK)this.stats.valid++;else this.stats.crcFailed++;if(!crcOK&&h.kind!==KIND.PROBE)return null;const decoded={header:h,payload,crcOK,quality:out.quality,motion:this.stats.motion,ambiguity:out.ambiguity,symbols:out.symbols};if(h.kind===KIND.CONTROL&&crcOK){const c=readControl(decoded),next=c?.pid??c?.chosen;if(Number.isInteger(next)&&PROFILES[next])this.expectedProfile=next;}return decoded;}return null;
 }
 colorModel(data,W,H,map,p){
  const palette=rgb(p),bins=Array.from({length:4},()=>palette.map(()=>({n:0,sum:[0,0,0],sq:[0,0,0]})));for(const [x,y,s] of p.pilots){const c=sample(data,W,H,map,x,y);if(!c)continue;const bin=(y>=p.rows/2?2:0)+(x>=p.cols/2?1:0),a=bins[bin][s];a.n++;for(let k=0;k<3;k++){a.sum[k]+=c[k];a.sq[k]+=c[k]*c[k];}}const means=bins.map(list=>list.map((a,i)=>({m:a.n?a.sum.map(s=>s/a.n):palette[i],v:a.n?a.sq.map((s,k)=>Math.max(49,s/a.n-(a.sum[k]/a.n)**2)):[100,100,100]})));return(c,x,y)=>{const wx=Math.min(1,Math.max(0,(x-p.cols*.25)/(p.cols*.5))),wy=Math.min(1,Math.max(0,(y-p.rows*.25)/(p.rows*.5))),weights=[(1-wx)*(1-wy),wx*(1-wy),(1-wx)*wy,wx*wy];let best=Infinity,second=Infinity,index=0;palette.forEach((_,s)=>{let dist=0;for(let k=0;k<3;k++){let m=0,v=0;for(let b=0;b<4;b++){m+=weights[b]*means[b][s].m[k];v+=weights[b]*means[b][s].v[k];}dist+=(c[k]-m)**2/Math.max(49,v)+Math.log(Math.max(49,v));}if(dist<best){second=best;best=dist;index=s;}else if(dist<second)second=dist;});return{index,ambiguous:second-best<1.5};};
 }
 decodeCells(data,W,H,map,p,h){
  const classify=this.colorModel(data,W,H,map,p);if(p.sectorCount>1)return this.decodeSectorCells(data,W,H,map,p,h,classify);const bytes=new Uint8Array(h.payloadLen),symbols=[],required=Math.ceil(h.payloadLen*8/p.bits);let bit=0,ambiguous=0;for(let j=0;j<required;j++){const [x,y]=p.cells[j],c=sample(data,W,H,map,x,y);if(!c)return null;const r=classify(c,x,y);if(r.ambiguous)ambiguous++;symbols.push(r.index);for(let k=p.bits-1;k>=0;k--){if(bit<h.payloadLen*8)bytes[bit>>3]|=((r.index>>k)&1)<<(7-bit%8);bit++;}}return {payload:bytes,symbols,ambiguity:ambiguous/Math.max(1,required),quality:1-ambiguous/Math.max(1,required)};
 }
 decodeSectorCells(data,W,H,map,p,h,classify){
  const round=(h.round||0)%p.sectorCount,parts=[],allSymbols=[];let total=0,ambiguous=0;for(let physical=0;physical<p.sectorCount;physical++){const sector=p.sectors[physical],needBytes=sector.dataBytes+2,required=Math.ceil(needBytes*8/p.bits),symbols=[];let localAmbiguous=0,failed=false;for(let j=0;j<required;j++){const cell=sector.cells[j];if(!cell){failed=true;break;}const [x,y]=cell,c=sample(data,W,H,map,x,y);if(!c){failed=true;break;}const r=classify(c,x,y);if(r.ambiguous)localAmbiguous++;symbols.push(r.index);}total+=required;ambiguous+=localAmbiguous;allSymbols.push(...symbols);const bytes=failed?null:symbolsToBytes(symbols,p.bits,needBytes),dataBytes=bytes?.subarray(0,sector.dataBytes),valid=!!bytes&&crc16(dataBytes)===new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(sector.dataBytes),logical=(physical-round+p.sectorCount)%p.sectorCount;parts.push({index:logical,data:valid?dataBytes:null,valid});if(valid)this.stats.sectorsValid++;else this.stats.sectorsFailed++;}const valid=parts.filter(s=>s.valid);let payload=null;if(valid.length===p.sectorCount){payload=new Uint8Array(h.payloadLen);for(const part of valid)payload.set(part.data,part.index*p.sectorBytes);}return {payload,sectorParts:parts,symbols:allSymbols,ambiguity:ambiguous/Math.max(1,total),quality:valid.length/p.sectorCount};
 }
 accumulateSectors(h,p,parts){
  const key=`${h.sid}:${h.profileId}:${h.kind}:${h.group}:${h.slot}:${h.seq}`;let entry=this.partial.get(key);if(!entry){entry={parts:Array(p.sectorCount),t:performance.now()};this.partial.set(key,entry);}entry.t=performance.now();for(const part of parts)if(part.valid&&!entry.parts[part.index])entry.parts[part.index]=part.data.slice();if(entry.parts.filter(Boolean).length===p.sectorCount){const payload=new Uint8Array(h.payloadLen);entry.parts.forEach((data,i)=>payload.set(data,i*p.sectorBytes));this.partial.delete(key);if(crc32(payload)===h.crc){this.stats.sectorAssemblies++;return payload;}return null;}if(this.partial.size>1024){const oldest=this.partial.keys().next().value;this.partial.delete(oldest);}return null;
 }
}

export async function stabilizeTrack(track){const caps=track.getCapabilities?.()||{},settings=track.getSettings?.()||{},advanced=[];for(const key of ['focusMode','exposureMode','whiteBalanceMode'])if(caps[key]?.includes('manual')){const value=key==='focusMode'?'focusDistance':key==='exposureMode'?'exposureTime':'colorTemperature';if(Number.isFinite(settings[value])&&caps[value])advanced.push({[key]:'manual',[value]:settings[value]});}if(advanced.length){try{await track.applyConstraints({advanced});return {locked:true,settings:track.getSettings()};}catch{}}return {locked:false,settings:track.getSettings?.()||{},note:'Controles manuales no disponibles; se valida con ajustes automáticos.'};}
