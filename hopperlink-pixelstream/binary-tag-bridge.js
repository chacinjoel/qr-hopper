(() => {
'use strict';

const TAGS={
  tl:[0,0,1,1,0, 0,1,1,0,0, 1,1,1,0,0, 0,1,0,0,0, 0,1,0,1,1],
  tr:[0,0,0,0,0, 1,1,1,0,0, 1,1,1,0,1, 1,1,1,0,1, 1,0,1,1,1],
  bl:[0,1,1,1,1, 1,0,0,0,1, 0,1,0,1,0, 1,0,0,1,1, 0,1,0,0,1],
  br:[0,1,1,0,0, 0,0,1,0,1, 1,0,1,0,1, 1,1,1,1,1, 1,1,1,0,1]
};
const KEYS=['tl','tr','bl','br'];
const CANON={tl:[0,214,214],tr:[214,0,214],bl:[214,214,0],br:[0,214,100]};
const nativeGetImageData=CanvasRenderingContext2D.prototype.getImageData;
let memory=null;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function luma(d,p){return(d[p]+d[p+1]+d[p+2])/3;}
function rot5(bits,k){let a=bits.slice();for(let r=0;r<k;r++){const n=new Array(25);for(let y=0;y<5;y++)for(let x=0;x<5;x++)n[x*5+(4-y)]=a[y*5+x];a=n;}return a;}
const VARIANTS=[];for(const key of KEYS)for(let r=0;r<4;r++)VARIANTS.push({key,rot:r,bits:rot5(TAGS[key],r)});
function hamming(a,b){let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return n;}

function renderTags(){
  for(const key of KEYS){
    const host=document.querySelector('.f-'+key);if(!host)continue;
    host.innerHTML='';
    const c=document.createElement('canvas');c.className='fid-tag-canvas';c.width=90;c.height=90;c.dataset.tagId=key;
    const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,90,90);
    // 9x9: quiet zone blanca de 1 celda + marker 7x7 con borde negro + código 5x5.
    const cell=10;for(let y=1;y<=7;y++)for(let x=1;x<=7;x++){
      let black=x===1||x===7||y===1||y===7;
      if(x>=2&&x<=6&&y>=2&&y<=6)black=!!TAGS[key][(y-2)*5+(x-2)];
      ctx.fillStyle=black?'#050505':'#f8f8f8';ctx.fillRect(x*cell,y*cell,cell,cell);
    }
    host.appendChild(c);
  }
}

function percentile(a,f){const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.max(0,Math.floor(s.length*f)))]||0;}
function darkThreshold(d,w,h){const vals=[],step=Math.max(7,Math.floor(Math.min(w,h)/80));for(let y=step>>1;y<h;y+=step)for(let x=step>>1;x<w;x+=step)vals.push(luma(d,(y*w+x)*4));const p12=percentile(vals,.12),p50=percentile(vals,.50);return clamp(p12+(p50-p12)*.30,20,135);}
function bilerp(q,u,v){const a={x:q.tl.x*(1-u)+q.tr.x*u,y:q.tl.y*(1-u)+q.tr.y*u},b={x:q.bl.x*(1-u)+q.br.x*u,y:q.bl.y*(1-u)+q.br.y*u};return{x:a.x*(1-v)+b.x*v,y:a.y*(1-v)+b.y*v};}
function sampleLum(d,w,h,x,y,rad=1){x=Math.round(x);y=Math.round(y);let s=0,n=0;for(let yy=Math.max(0,y-rad);yy<=Math.min(h-1,y+rad);yy++)for(let xx=Math.max(0,x-rad);xx<=Math.min(w-1,x+rad);xx++){s+=luma(d,(yy*w+xx)*4);n++;}return s/Math.max(1,n);}

function decodeTag(d,w,h,c){
  const q=c.quad,vals=[];for(let y=0;y<7;y++)for(let x=0;x<7;x++){const p=bilerp(q,(x+.5)/7,(y+.5)/7);vals.push(sampleLum(d,w,h,p.x,p.y,1));}
  const lo=percentile(vals,.20),hi=percentile(vals,.80);if(hi-lo<34)return null;const t=lo+(hi-lo)*.48,bits=vals.map(v=>v<t?1:0);
  let borderErr=0;for(let y=0;y<7;y++)for(let x=0;x<7;x++)if(x===0||x===6||y===0||y===6){if(bits[y*7+x]!==1)borderErr++;}
  if(borderErr>6)return null;const inner=[];for(let y=1;y<=5;y++)for(let x=1;x<=5;x++)inner.push(bits[y*7+x]);
  let best=null,second=99;for(const v of VARIANTS){const e=hamming(inner,v.bits);if(!best||e<best.err){second=best?best.err:second;best={key:v.key,rot:v.rot,err:e};}else if(e<second)second=e;}
  if(!best||best.err>6||second-best.err<2)return null;
  return{...best,borderErr,contrast:hi-lo,score:100-best.err*9-borderErr*5+Math.min(25,(hi-lo)/4)};
}

function findTags(img,w,h){
  const d=img.data,thr=darkThreshold(d,w,h),stride=Math.max(2,Math.floor(Math.min(w,h)/260)),gw=Math.ceil(w/stride),gh=Math.ceil(h/stride),mask=new Uint8Array(gw*gh);
  for(let gy=0;gy<gh;gy++){const y=Math.min(h-1,gy*stride+(stride>>1));for(let gx=0;gx<gw;gx++){const x=Math.min(w-1,gx*stride+(stride>>1));mask[gy*gw+gx]=luma(d,(y*w+x)*4)<=thr?1:0;}}
  const seen=new Uint8Array(mask.length),found={};
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    let minS=1e9,maxS=-1e9,minD=1e9,maxD=-1e9,pTL=null,pTR=null,pBL=null,pBR=null;
    while(stack.length){const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);const s=cx+cy,dd=cx-cy;if(s<minS){minS=s;pTL={x:cx,y:cy};}if(s>maxS){maxS=s;pBR={x:cx,y:cy};}if(dd>maxD){maxD=dd;pTR={x:cx,y:cy};}if(dd<minD){minD=dd;pBL={x:cx,y:cy};}
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]){seen[ni]=1;stack.push(ni);}}
    }
    if(count<18)continue;const bw=(maxX-minX+1)*stride,bh=(maxY-minY+1)*stride,rel=Math.max(bw,bh)/Math.min(w,h),aspect=bw/Math.max(1,bh);if(rel<.035||rel>.18||aspect<.52||aspect>1.92)continue;
    const cv=p=>({x:clamp((p.x+.5)*stride,0,w-1),y:clamp((p.y+.5)*stride,0,h-1)}),quad={tl:cv(pTL),tr:cv(pTR),bl:cv(pBL),br:cv(pBR)};
    const c={quad,cx:(quad.tl.x+quad.tr.x+quad.bl.x+quad.br.x)/4,cy:(quad.tl.y+quad.tr.y+quad.bl.y+quad.br.y)/4,size:(bw+bh)/2,count};const dec=decodeTag(d,w,h,c);if(!dec)continue;c.dec=dec;c.score=dec.score+Math.min(20,count/5);
    if(!found[dec.key]||c.score>found[dec.key].score)found[dec.key]=c;
  }
  return found;
}

function predict(markers,key){if(key==='br')return{x:markers.tr.x+markers.bl.x-markers.tl.x,y:markers.tr.y+markers.bl.y-markers.tl.y};if(key==='bl')return{x:markers.tl.x+markers.br.x-markers.tr.x,y:markers.tl.y+markers.br.y-markers.tr.y};if(key==='tr')return{x:markers.tl.x+markers.br.x-markers.bl.x,y:markers.tl.y+markers.br.y-markers.bl.y};if(key==='tl')return{x:markers.tr.x+markers.bl.x-markers.br.x,y:markers.tr.y+markers.bl.y-markers.br.y};return null;}
function geometryOK(m,w,h){if(!KEYS.every(k=>m[k]))return false;if(!(m.tl.x<m.tr.x&&m.bl.x<m.br.x&&m.tl.y<m.bl.y&&m.tr.y<m.br.y))return false;const top=Math.hypot(m.tr.x-m.tl.x,m.tr.y-m.tl.y),bot=Math.hypot(m.br.x-m.bl.x,m.br.y-m.bl.y),left=Math.hypot(m.bl.x-m.tl.x,m.bl.y-m.tl.y),right=Math.hypot(m.br.x-m.tr.x,m.br.y-m.tr.y),minDim=Math.min(w,h);if(Math.min(top,bot,left,right)<minDim*.28)return false;const d1=Math.hypot(m.br.x-m.tl.x,m.br.y-m.tl.y),d2=Math.hypot(m.bl.x-m.tr.x,m.bl.y-m.tr.y);return Math.min(d1,d2)/Math.max(d1,d2)>.68;}
function paintSynthetic(d,w,h,m,size,key){const rgb=CANON[key],half=Math.max(8,size*.57),x0=Math.round(m.x-half),x1=Math.round(m.x+half),y0=Math.round(m.y-half),y1=Math.round(m.y+half),cx0=m.x-half*.34,cx1=m.x+half*.34,cy0=m.y-half*.34,cy1=m.y+half*.34;for(let y=Math.max(0,y0);y<=Math.min(h-1,y1);y++)for(let x=Math.max(0,x0);x<=Math.min(w-1,x1);x++){const p=(y*w+x)*4;if(x>=cx0&&x<=cx1&&y>=cy0&&y<=cy1){d[p]=4;d[p+1]=4;d[p+2]=4;}else{d[p]=rgb[0];d[p+1]=rgb[1];d[p+2]=rgb[2];}}}

function process(img,w,h){
  const tags=findTags(img,w,h),markers={},sizes=[];for(const k of KEYS)if(tags[k]){markers[k]={x:tags[k].cx,y:tags[k].cy};sizes.push(tags[k].size);}
  let visible=KEYS.filter(k=>markers[k]).length;
  if(visible===3){const miss=KEYS.find(k=>!markers[k]),p=predict(markers,miss);if(p){markers[miss]=p;visible=4;}}
  if(visible<4&&memory&&performance.now()-memory.ts<850){const present=KEYS.filter(k=>markers[k]&&memory.markers[k]);if(present.length>=2){let dx=0,dy=0;for(const k of present){dx+=markers[k].x-memory.markers[k].x;dy+=markers[k].y-memory.markers[k].y;}dx/=present.length;dy/=present.length;for(const k of KEYS)if(!markers[k])markers[k]={x:memory.markers[k].x+dx,y:memory.markers[k].y+dy};visible=4;}}
  if(visible<4||!geometryOK(markers,w,h)){window.__hopperBinaryTagBridge.last={ts:performance.now(),found:Math.min(4,visible),valid:false};return img;}
  const avgSize=sizes.length?sizes.reduce((a,b)=>a+b,0)/sizes.length:(memory?.size||Math.min(w,h)*.09);memory={markers,size:avgSize,ts:performance.now()};
  for(const k of KEYS)paintSynthetic(img.data,w,h,markers[k],avgSize,k);
  const errs=KEYS.filter(k=>tags[k]).map(k=>tags[k].dec.err+tags[k].dec.borderErr),quality=clamp(Math.round(100-(errs.length?errs.reduce((a,b)=>a+b,0)/errs.length*4:15)),45,100);
  window.__hopperBinaryTagBridge.last={ts:performance.now(),found:4,valid:true,markers,quality,decoded:KEYS.filter(k=>!!tags[k])};
  return img;
}

CanvasRenderingContext2D.prototype.getImageData=function(...args){const img=nativeGetImageData.apply(this,args);if(this.canvas?.id!=='capture')return img;try{return process(img,this.canvas.width,this.canvas.height);}catch{return img;}};

document.readyState==='loading'?document.addEventListener('DOMContentLoaded',renderTags,{once:true}):renderTags();
window.__hopperBinaryTagBridge={version:'0.8.0',active:true,last:null,tagIds:KEYS.slice(),geometry:'DATA 12%-88%'};
})();
