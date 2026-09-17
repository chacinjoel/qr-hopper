export const LIGHTHOUSE={
  colors:['#ff00ff','#00ffff','#ffff00','#00ff00'],
  stageSize:720,
  beaconCenter:42,
  beaconSize:56,
  qrMin:92,
  qrMax:628,
  qrInset:(92-42)/(678-42)
};

function sampleRGB(data,W,H,x,y){const xx=Math.max(0,Math.min(W-1,Math.round(x))),yy=Math.max(0,Math.min(H-1,Math.round(y))),o=(yy*W+xx)*4;return[data[o],data[o+1],data[o+2]];}
function hueScore(idx,r,g,b){if(idx===0)return Math.min(r,b)-g;if(idx===1)return Math.min(g,b)-r;if(idx===2)return Math.min(r,g)-b;return g-Math.max(r,b);}
function polyArea(q){let s=0;for(let i=0;i<4;i++){const a=q[i],b=q[(i+1)%4];s+=a.x*b.y-b.x*a.y;}return Math.abs(s)/2;}
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
  for(const relaxed of [false,true]){const pts=[];let ok=true;for(let i=0;i<4;i++){const p=findBeacon(data,W,H,i,expected?.[i],relaxed);if(!p){ok=false;break;}pts.push(p);}if(!ok)continue;const g=geometryScore(pts,W,H);if(g>=.45)return{quad:pts,confidence:g,relaxed};}
  return null;
}
function homographyFromQuad(p0,p1,p2,p3){const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x,dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;let g=0,h=0;const det=dx1*dy2-dx2*dy1;if(Math.abs(dx3)>1e-6||Math.abs(dy3)>1e-6){if(Math.abs(det)<1e-9)return null;g=(dx3*dy2-dx2*dy3)/det;h=(dx1*dy3-dx3*dy1)/det;}const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x,c=p0.x,d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y,f=p0.y;return(u,v)=>{const z=g*u+h*v+1;return{x:(a*u+b*v+c)/z,y:(d*u+e*v+f)/z};};}
function bilinear(src,W,H,x,y,out,o){const x0=Math.max(0,Math.min(W-1,Math.floor(x))),y0=Math.max(0,Math.min(H-1,Math.floor(y))),x1=Math.min(W-1,x0+1),y1=Math.min(H-1,y0+1),fx=x-x0,fy=y-y0;for(let c=0;c<3;c++){const a=src[(y0*W+x0)*4+c]*(1-fx)+src[(y0*W+x1)*4+c]*fx,b=src[(y1*W+x0)*4+c]*(1-fx)+src[(y1*W+x1)*4+c]*fx;out[o+c]=Math.round(a*(1-fy)+b*fy);}out[o+3]=255;}
export function rectifyLighthouse(src,W,H,quad,size=900){
  const map=homographyFromQuad(...quad);if(!map)return null;const out=new Uint8ClampedArray(size*size*4),m=LIGHTHOUSE.qrInset,span=1-2*m;
  for(let y=0;y<size;y++){const v=m+span*((y+.5)/size);for(let x=0;x<size;x++){const u=m+span*((x+.5)/size),p=map(u,v);bilinear(src,W,H,p.x,p.y,out,(y*size+x)*4);}}
  return{rgba:out,width:size,height:size};
}
export function drawBeacon(ctx,cx,cy,size,color){ctx.fillStyle=color;ctx.fillRect(cx-size/2,cy-size/2,size,size);const inner=size*.56;ctx.fillStyle='#000';ctx.fillRect(cx-inner/2,cy-inner/2,inner,inner);const core=size*.16;ctx.fillStyle='#fff';ctx.fillRect(cx-core/2,cy-core/2,core,core);}
