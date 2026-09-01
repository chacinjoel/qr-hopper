(() => {
'use strict';

const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
const CANON = {tl:[0,214,214],tr:[214,0,214],bl:[214,214,0],br:[0,214,100]};

function luma(d,p){return(d[p]+d[p+1]+d[p+2])/3;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

function sampleThreshold(d,w,h){
  const vals=[],step=Math.max(8,Math.floor(Math.min(w,h)/72));
  for(let y=step>>1;y<h;y+=step)for(let x=step>>1;x<w;x+=step){const p=(y*w+x)*4;vals.push(luma(d,p));}
  vals.sort((a,b)=>a-b);
  const q=f=>vals[Math.min(vals.length-1,Math.max(0,Math.floor(vals.length*f)))]||0;
  const p08=q(.08),p50=q(.50),p92=q(.92);
  return{dark:clamp(p08+(p50-p08)*.30,16,112),contrast:p92-p08};
}

function ringStats(d,w,h,c){
  const bw=c.x1-c.x0+1,bh=c.y1-c.y0+1;
  const ox0=clamp(Math.round(c.cx-bw*1.40),0,w-1),ox1=clamp(Math.round(c.cx+bw*1.40),0,w-1);
  const oy0=clamp(Math.round(c.cy-bh*1.40),0,h-1),oy1=clamp(Math.round(c.cy+bh*1.40),0,h-1);
  const sx=Math.max(1,Math.floor((ox1-ox0+1)/20)),sy=Math.max(1,Math.floor((oy1-oy0+1)/20));
  let center=0,cn=0,ring=0,rn=0;
  for(let y=oy0;y<=oy1;y+=sy)for(let x=ox0;x<=ox1;x+=sx){
    const p=(y*w+x)*4,v=luma(d,p),nx=Math.abs(x-c.cx)/(bw*.5),ny=Math.abs(y-c.cy)/(bh*.5);
    if(nx<=1&&ny<=1){center+=v;cn++;}else if(nx<=2.25&&ny<=2.25){ring+=v;rn++;}
  }
  return{center:cn?center/cn:255,ring:rn?ring/rn:0,outer:{x0:ox0,x1:ox1,y0:oy0,y1:oy1}};
}

function candidateScore(d,w,h,c,st){
  const bw=c.x1-c.x0+1,bh=c.y1-c.y0+1,aspect=bw/Math.max(1,bh),rel=Math.max(bw,bh)/Math.min(w,h);
  if(aspect<.55||aspect>1.82||rel<.022||rel>.17)return null;
  const rs=ringStats(d,w,h,c),contrast=(rs.ring-rs.center)/Math.max(24,rs.ring);
  if(contrast<.13)return null;
  const nx=(c.cx-w*.5)/(w*.5),ny=(c.cy-h*.5)/(h*.5),radial=Math.hypot(nx,ny);
  /* DATA vive en el centro de la tarjeta; un fiducial real debe estar claramente fuera. */
  if(radial<.20)return null;
  const square=Math.exp(-Math.abs(Math.log(aspect))*2.0),sizeScore=clamp((rel-.022)/.09,0,1);
  c.outer=rs.outer;c.contrast=contrast;c.rel=rel;c.radial=radial;
  c.score=square*42+clamp(contrast,0,1)*92+sizeScore*38+Math.min(55,c.count/2.2)+Math.min(28,radial*24)+(st.contrast>55?10:0);
  return c;
}

function chooseSet(cands,w,h){
  let best=null,bestScore=-1e9;const n=Math.min(cands.length,14),minDim=Math.min(w,h);
  for(let a=0;a<n-3;a++)for(let b=a+1;b<n-2;b++)for(let c=b+1;c<n-1;c++)for(let d=c+1;d<n;d++){
    const pts=[cands[a],cands[b],cands[c],cands[d]];
    pts.sort((u,v)=>u.cy-v.cy);
    const top=pts.slice(0,2).sort((u,v)=>u.cx-v.cx),bot=pts.slice(2).sort((u,v)=>u.cx-v.cx);
    const tl=top[0],tr=top[1],bl=bot[0],br=bot[1];
    if(!(tl.cx<tr.cx&&bl.cx<br.cx&&tl.cy<bl.cy&&tr.cy<br.cy))continue;
    const topW=Math.hypot(tr.cx-tl.cx,tr.cy-tl.cy),botW=Math.hypot(br.cx-bl.cx,br.cy-bl.cy);
    const leftH=Math.hypot(bl.cx-tl.cx,bl.cy-tl.cy),rightH=Math.hypot(br.cx-tr.cx,br.cy-tr.cy);
    const width=(topW+botW)/2,height=(leftH+rightH)/2;
    /* La tarjeta debe ocupar una región sustancial del frame de cámara. */
    if(width<minDim*.22||height<minDim*.22||width>Math.max(w,h)*.95||height>Math.max(w,h)*.95)continue;
    const ratio=width/Math.max(1,height);if(ratio<.48||ratio>2.10)continue;
    const d1=Math.hypot(br.cx-tl.cx,br.cy-tl.cy),d2=Math.hypot(bl.cx-tr.cx,bl.cy-tr.cy);
    const diag=Math.min(d1,d2)/Math.max(d1,d2),side=Math.min(topW,botW)/Math.max(topW,botW)*Math.min(leftH,rightH)/Math.max(leftH,rightH);
    const sizes=pts.map(q=>Math.sqrt((q.x1-q.x0+1)*(q.y1-q.y0+1))),sizeBal=Math.min(...sizes)/Math.max(...sizes);
    const cx=(tl.cx+tr.cx+bl.cx+br.cx)/4,cy=(tl.cy+tr.cy+bl.cy+br.cy)/4,centerOffset=Math.hypot((cx-w*.5)/(w*.5),(cy-h*.5)/(h*.5));
    if(centerOffset>.78)continue;
    const cornerSpread=(tl.radial+tr.radial+bl.radial+br.radial)/4;
    const score=pts.reduce((s,q)=>s+q.score,0)+diag*130+side*90+sizeBal*65+cornerSpread*35-centerOffset*35;
    if(score>bestScore){bestScore=score;best={tl,tr,bl,br,score};}
  }
  return best;
}

function canonicalize(d,w,h,c,key){
  const rgb=CANON[key],o=c.outer;
  for(let y=o.y0;y<=o.y1;y++)for(let x=o.x0;x<=o.x1;x++){
    const p=(y*w+x)*4,v=luma(d,p);
    /* Mantiene intacto el núcleo negro del bullseye; colorea solo sus anillos claros. */
    if(x>=c.x0&&x<=c.x1&&y>=c.y0&&y<=c.y1)continue;
    if(v<34)continue;
    d[p]=rgb[0];d[p+1]=rgb[1];d[p+2]=rgb[2];
  }
}

function process(img,w,h){
  const d=img.data,st=sampleThreshold(d,w,h),stride=Math.max(2,Math.floor(Math.min(w,h)/230));
  const gw=Math.ceil(w/stride),gh=Math.ceil(h/stride),mask=new Uint8Array(gw*gh);
  for(let gy=0;gy<gh;gy++){
    const y=Math.min(h-1,gy*stride+(stride>>1));
    for(let gx=0;gx<gw;gx++){
      const x=Math.min(w-1,gx*stride+(stride>>1)),p=(y*w+x)*4;
      mask[gy*gw+gx]=luma(d,p)<=st.dark?1:0;
    }
  }
  const seen=new Uint8Array(mask.length),cands=[];
  for(let i=0;i<mask.length;i++){
    if(!mask[i]||seen[i])continue;
    const stack=[i];seen[i]=1;let count=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
    while(stack.length){
      const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;
      count++;minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;const nx=cx+dx,ny=cy+dy;
        if(nx<0||ny<0||nx>=gw||ny>=gh)continue;const ni=ny*gw+nx;
        if(!seen[ni]&&mask[ni]){seen[ni]=1;stack.push(ni);}
      }
    }
    if(count<8)continue;
    const x0=minX*stride,y0=minY*stride,x1=Math.min(w-1,(maxX+1)*stride-1),y1=Math.min(h-1,(maxY+1)*stride-1);
    const cand=candidateScore(d,w,h,{x0,y0,x1,y1,cx:(x0+x1)/2,cy:(y0+y1)/2,count},st);
    if(cand)cands.push(cand);
  }
  cands.sort((a,b)=>b.score-a.score);
  const set=chooseSet(cands,w,h);if(!set)return img;
  canonicalize(d,w,h,set.tl,'tl');canonicalize(d,w,h,set.tr,'tr');canonicalize(d,w,h,set.bl,'bl');canonicalize(d,w,h,set.br,'br');
  return img;
}

CanvasRenderingContext2D.prototype.getImageData=function(...args){
  const img=nativeGetImageData.apply(this,args);
  if(this.canvas?.id!=='capture')return img;
  try{return process(img,this.canvas.width,this.canvas.height);}catch{return img;}
};

window.__hopperCornerGeometryGuard={version:'0.7.5',active:true,brightnessInvariant:true,stageAware:true,centralDataRejection:true};
})();
