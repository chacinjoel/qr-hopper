(() => {
'use strict';

// HPS5 Fiducial Filter v0.5.1
// Preprocesa SOLO el canvas de cámara. Valida los marcadores por color + forma
// cuadrada + centro oscuro, y neutraliza falsos positivos como botones verdes.

const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
const KEYS = ['tl','tr','bl','br'];
const CANON = [
  [0,220,220],   // cyan
  [220,0,220],   // magenta
  [220,220,0],   // amarillo
  [0,220,102]    // verde
];
const TARGETS = [
  [.03,.485,.485],
  [.485,.03,.485],
  [.485,.485,.03],
  [.03,.68,.29]
];

function colorClass(r,g,b){
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), ch=mx-mn, sum=r+g+b;
  if(mx<42 || sum<92 || ch<18 || ch/Math.max(1,mx)<0.13) return -1;
  const nr=r/sum, ng=g/sum, nb=b/sum;
  let best=-1, bs=99, second=99;
  for(let i=0;i<4;i++){
    const t=TARGETS[i];
    const d=Math.hypot(nr-t[0],ng-t[1],nb-t[2]);
    if(d<bs){second=bs;bs=d;best=i;}
    else if(d<second) second=d;
  }
  if(bs<0.20 || (bs<0.27 && second-bs>0.012)) return best;
  return -1;
}

function darkCenterScore(data,w,h,x0,y0,x1,y1){
  const cx0=Math.max(0,Math.floor(x0+(x1-x0)*0.30));
  const cy0=Math.max(0,Math.floor(y0+(y1-y0)*0.30));
  const cx1=Math.min(w-1,Math.ceil(x0+(x1-x0)*0.70));
  const cy1=Math.min(h-1,Math.ceil(y0+(y1-y0)*0.70));
  const sx=Math.max(1,Math.floor((cx1-cx0+1)/8));
  const sy=Math.max(1,Math.floor((cy1-cy0+1)/8));
  let n=0,dark=0,sum=0;
  for(let y=cy0;y<=cy1;y+=sy){
    for(let x=cx0;x<=cx1;x+=sx){
      const p=(y*w+x)*4,v=(data[p]+data[p+1]+data[p+2])/3;
      n++;sum+=v;if(v<105)dark++;
    }
  }
  if(!n)return 0;
  const darkRatio=dark/n,avg=sum/n;
  return Math.max(darkRatio, Math.max(0,(130-avg)/130));
}

function rewriteRegion(data,w,h,comp,keep){
  const pad=2;
  const x0=Math.max(0,comp.x0-pad), y0=Math.max(0,comp.y0-pad);
  const x1=Math.min(w-1,comp.x1+pad), y1=Math.min(h-1,comp.y1+pad);
  for(let y=y0;y<=y1;y++){
    for(let x=x0;x<=x1;x++){
      const p=(y*w+x)*4, cls=colorClass(data[p],data[p+1],data[p+2]);
      if(cls!==comp.type)continue;
      if(keep){
        const c=CANON[comp.type];data[p]=c[0];data[p+1]=c[1];data[p+2]=c[2];
      }else{
        const v=Math.round((data[p]+data[p+1]+data[p+2])/3);
        data[p]=v;data[p+1]=v;data[p+2]=v;
      }
    }
  }
}

function filterFiducials(img,w,h){
  const d=img.data;
  const stride=Math.max(2,Math.floor(Math.min(w,h)/180));
  const gw=Math.ceil(w/stride), gh=Math.ceil(h/stride);
  const mask=new Int8Array(gw*gh);mask.fill(-1);
  for(let gy=0;gy<gh;gy++){
    const y=Math.min(h-1,gy*stride+(stride>>1));
    for(let gx=0;gx<gw;gx++){
      const x=Math.min(w-1,gx*stride+(stride>>1)),p=(y*w+x)*4;
      mask[gy*gw+gx]=colorClass(d[p],d[p+1],d[p+2]);
    }
  }

  const seen=new Uint8Array(mask.length), comps=[];
  for(let i=0;i<mask.length;i++){
    const type=mask[i];if(type<0||seen[i])continue;
    const stack=[i];seen[i]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    while(stack.length){
      const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;
      count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;
        if(nx<0||ny<0||nx>=gw||ny>=gh)continue;
        const ni=ny*gw+nx;if(!seen[ni]&&mask[ni]===type){seen[ni]=1;stack.push(ni);}
      }
    }
    if(count<4)continue;
    const x0=Math.max(0,minX*stride),y0=Math.max(0,minY*stride);
    const x1=Math.min(w-1,(maxX+1)*stride-1),y1=Math.min(h-1,(maxY+1)*stride-1);
    const cw=x1-x0+1,ch=y1-y0+1,aspect=cw/Math.max(1,ch);
    const minDim=Math.min(w,h), rel=Math.max(cw,ch)/minDim;
    const center=darkCenterScore(d,w,h,x0,y0,x1,y1);
    const square=Math.max(0,1-Math.abs(Math.log(Math.max(.01,aspect))));
    const validShape=aspect>=0.52&&aspect<=1.92&&rel>=0.025&&rel<=0.30&&center>=0.18;
    const score=(validShape?100:0)+square*18+center*35+Math.min(20,count/3);
    comps.push({type,count,x0,y0,x1,y1,cx:(x0+x1)/2,cy:(y0+y1)/2,aspect,center,score,validShape});
  }

  // Conserva varias candidatas por color; luego exige orden geométrico TL/TR/BL/BR.
  const byType=[[],[],[],[]];
  for(const c of comps)if(c.validShape)byType[c.type].push(c);
  for(const a of byType)a.sort((a,b)=>b.score-a.score);
  const lists=byType.map(a=>a.slice(0,4));
  let bestSet=null,bestScore=-1e9;
  if(lists.every(a=>a.length)){
    for(const tl of lists[0])for(const tr of lists[1])for(const bl of lists[2])for(const br of lists[3]){
      const topY=(tl.cy+tr.cy)/2,bottomY=(bl.cy+br.cy)/2,leftX=(tl.cx+bl.cx)/2,rightX=(tr.cx+br.cx)/2;
      if(!(tl.cx<tr.cx&&bl.cx<br.cx&&tl.cy<bl.cy&&tr.cy<br.cy))continue;
      const width=(Math.hypot(tr.cx-tl.cx,tr.cy-tl.cy)+Math.hypot(br.cx-bl.cx,br.cy-bl.cy))/2;
      const height=(Math.hypot(bl.cx-tl.cx,bl.cy-tl.cy)+Math.hypot(br.cx-tr.cx,br.cy-tr.cy))/2;
      if(width<Math.min(w,h)*.10||height<Math.min(w,h)*.10)continue;
      const ratio=width/Math.max(1,height);if(ratio<.40||ratio>2.5)continue;
      const diag1=Math.hypot(br.cx-tl.cx,br.cy-tl.cy),diag2=Math.hypot(bl.cx-tr.cx,bl.cy-tr.cy);
      const diagBalance=Math.min(diag1,diag2)/Math.max(diag1,diag2);
      const parallelPenalty=Math.abs((tl.cy+tr.cy)-(bl.cy+br.cy))*0.01+Math.abs((tl.cx+bl.cx)-(tr.cx+br.cx))*0.01;
      const score=tl.score+tr.score+bl.score+br.score+diagBalance*80-parallelPenalty;
      if(score>bestScore){bestScore=score;bestSet=[tl,tr,bl,br];}
    }
  }

  const keep=new Set(bestSet||[]);
  for(const c of comps)rewriteRegion(d,w,h,c,keep.has(c));
  return img;
}

CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const img=nativeGetImageData.apply(this,args);
  if(this.canvas?.id!=='capture')return img;
  try{return filterFiducials(img,this.canvas.width,this.canvas.height);}catch{return img;}
};

window.__hopperFiducialFilter={version:'0.5.1',active:true,shapeAware:true,geometryAware:true};
})();