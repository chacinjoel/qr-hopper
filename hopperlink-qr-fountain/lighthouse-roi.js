export const LIGHTHOUSE={
  colors:['#ff00ff','#00ffff','#ffff00','#00ff00'],
  beaconSize:56,
  single:{
    width:720,height:720,
    beacons:[{x:42,y:42},{x:678,y:42},{x:678,y:678},{x:42,y:678}],
    qrRects:[{x:92,y:92,w:536,h:536}]
  },
  dual:{
    width:720,height:1280,
    beacons:[{x:42,y:42},{x:678,y:42},{x:678,y:1238},{x:42,y:1238}],
    qrRects:[{x:100,y:92,w:520,h:520},{x:100,y:668,w:520,h:520}]
  }
};
export function layoutForCodes(codes=1){return codes>1?LIGHTHOUSE.dual:LIGHTHOUSE.single;}

function sampleRGB(data,W,H,x,y){const xx=Math.max(0,Math.min(W-1,Math.round(x))),yy=Math.max(0,Math.min(H-1,Math.round(y))),o=(yy*W+xx)*4;return[data[o],data[o+1],data[o+2]];}
function hueScore(idx,r,g,b){if(idx===0)return Math.min(r,b)-g;if(idx===1)return Math.min(g,b)-r;if(idx===2)return Math.min(r,g)-b;return g-Math.max(r,b);}
function polyArea(q){let s=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];s+=a.x*b.y-b.x*a.y;}return Math.abs(s)/2;}
function quadAspect(q){const[tl,tr,br,bl]=q,top=Math.hypot(tr.x-tl.x,tr.y-tl.y),bottom=Math.hypot(br.x-bl.x,br.y-bl.y),left=Math.hypot(bl.x-tl.x,bl.y-tl.y),right=Math.hypot(br.x-tr.x,br.y-tr.y);return((top+bottom)/2)/Math.max(1,(left+right)/2);}
function geometryScore(q,W,H){if(!q||q.length!==4)return 0;const area=polyArea(q);if(area<W*H*.012)return 0;const[tl,tr,br,bl]=q,top=Math.hypot(tr.x-tl.x,tr.y-tl.y),bottom=Math.hypot(br.x-bl.x,br.y-bl.y),left=Math.hypot(bl.x-tl.x,bl.y-tl.y),right=Math.hypot(br.x-tr.x,br.y-tr.y);if(Math.min(top,bottom,left,right)<Math.min(W,H)*.07)return 0;const sym=Math.min(top,bottom)/Math.max(top,bottom)*Math.min(left,right)/Math.max(left,right);return Math.min(1,.58+.42*sym);}
function findBeacon(data,W,H,idx,expected,relaxed=false){
  const gw=Math.min(260,Math.max(150,Math.round(W*.44))),gh=Math.max(100,Math.round(gw*H/W)),mask=new Uint8Array(gw*gh),weights=new Uint8Array(gw*gh),thr=relaxed?46:72,brightMin=relaxed?80:115;
  for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){const x=(gx+.5)/gw*W,y=(gy+.5)/gh*H,[r,g,b]=sampleRGB(data,W,H,x,y),s=hueScore(idx,r,g,b),bright=Math.max(r,g,b);if(s>thr&&bright>brightMin){const i=gy*gw+gx;mask[i]=1;weights[i]=Math.min(255,Math.round(s));}}
  const seen=new Uint8Array(mask.length);let best=null,bestScore=-1;
  for(let i=0;i<mask.length;i++){if(!mask[i]||seen[i])continue;const stack=[i];seen[i]=1;let count=0,minX=gw,maxX=0,minY=gh,maxY=0,sx=0,sy=0,sw=0;
    while(stack.length){const n=stack.pop(),x=n%gw,y=Math.floor(n/gw),w=weights[n]+1;count++;sx+=(x+.5)*w;sy+=(y+.5)*w;sw+=w;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=gw||yy>=gh)continue;const j=yy*gw+xx;if(mask[j]&&!seen[j]){seen[j]=1;stack.push(j);}}}
    if(count<8)continue;const bw=maxX-minX+1,bh=maxY-minY+1,density=count/(bw*bh),square=Math.min(bw,bh)/Math.max(bw,bh);if(bw<3||bh<3||density<.14||square<.32)continue;const px=sx/sw/gw*W,py=sy/sw/gh*H;let score=count*density*(.55+.45*square);if(expected){const d=Math.hypot(px-expected.x,py-expected.y),diag=Math.hypot(W,H);score*=Math.exp(-d/(diag*.16));}if(score>bestScore){bestScore=score;best={x:px,y:py};}}
  return best;
}
export function detectLighthouse(data,W,H,expected=null){
  for(const relaxed of [false,true]){const pts=[];let ok=true;for(let i=0;i<4;i++){const p=findBeacon(data,W,H,i,expected?.[i],relaxed);if(!p){ok=false;break;}pts.push(p);}if(!ok)continue;const g=geometryScore(pts,W,H);if(g>=.45){const aspect=quadAspect(pts);return{quad:pts,confidence:g,relaxed,aspect,codes:(aspect<.75||aspect>1.45)?2:1};}}
  return null;
}
function homographyFromQuad(p0,p1,p2,p3){const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;let g=0,h=0;const det=dx1*dy2-dx2*dy1;if(Math.abs(dx3)>1e-6||Math.abs(dy3)>1e-6){if(Math.abs(det)<1e-9)return null;g=(dx3*dy2-dx2*dy3)/det;h=(dx1*dy3-dx3*dy1)/det;}const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x,c=p0.x,d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y,f=p0.y;return(u,v)=>{const z=g*u+h*v+1;return{x:(a*u+b*v+c)/z,y:(d*u+e*v+f)/z};};}
function sampleNearest(src,W,H,x,y,out,o){const xx=Math.max(0,Math.min(W-1,Math.round(x))),yy=Math.max(0,Math.min(H-1,Math.round(y))),i=(yy*W+xx)*4;out[o]=src[i];out[o+1]=src[i+1];out[o+2]=src[i+2];out[o+3]=255;}
function rectifyRect(src,W,H,map,rect,layout,size){
  const [tl,tr,,bl]=layout.beacons,bx0=tl.x,bx1=tr.x,by0=tl.y,by1=bl.y;
  const u0=(rect.x-bx0)/(bx1-bx0),u1=(rect.x+rect.w-bx0)/(bx1-bx0),v0=(rect.y-by0)/(by1-by0),v1=(rect.y+rect.h-by0)/(by1-by0);
  const out=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++){const v=v0+(v1-v0)*((y+.5)/size);for(let x=0;x<size;x++){const u=u0+(u1-u0)*((x+.5)/size),p=map(u,v);sampleNearest(src,W,H,p.x,p.y,out,(y*size+x)*4);}}
  return{rgba:out,width:size,height:size};
}
export function rectifyQrRegions(src,W,H,quad,codes=1,size=null){
  const layout=layoutForCodes(codes),map=homographyFromQuad(...quad);if(!map)return[];
  const side=size|| (codes>1?720:900);
  return layout.qrRects.map((rect,index)=>({...rectifyRect(src,W,H,map,rect,layout,side),index,codes}));
}
export function rectifyLighthouse(src,W,H,quad,size=900){return rectifyQrRegions(src,W,H,quad,1,size)[0]||null;}
export function drawBeacon(ctx,cx,cy,size,color){ctx.fillStyle=color;ctx.fillRect(cx-size/2,cy-size/2,size,size);const inner=size*.56;ctx.fillStyle='#000';ctx.fillRect(cx-inner/2,cy-inner/2,inner,inner);const core=size*.16;ctx.fillStyle='#fff';ctx.fillRect(cx-core/2,cy-core/2,core,core);}
