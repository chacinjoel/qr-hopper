/* H7 Static Guide 1.5.1. Four shared HPS7 binary-tag-bridge corner codes.
 * Derived from qr-hopper HPS7's TAGS at c63815037ccf4d3aaa08bc03b964012b6cc44bcf.
 * Enlarged 2x tags, exact single-raster three-lane geometry, same-frame projective fitting.
 * This is not wire-compatible with the old HPS7 application. No image mutation in RX.
 */
(function(root) {
  'use strict';
  const CODES = [26840820,32606280,20785154,17257878];
  const MODES = ['robust2','adaptive3','turbo4'];
  const W=92,H=166,DX=16,DY=22,COLS=60,ROWS=36,TAG=14;
  const LANE_Y=[22,65,108];
  const ORIGINS=[[2,2],[76,2],[76,150],[2,150]]; // canonical TL,TR,BR,BL
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function rotate(code) {
    let out=0;
    for(let y=0;y<5;y++) for(let x=0;x<5;x++)
      out|=((code>>>(24-(y*5+x)))&1)<<(24-(x*5+4-y));
    return out;
  }
  function popcount(v) {v-=v>>>1&0x55555555;v=(v&0x33333333)+(v>>>2&0x33333333);return ((v+(v>>>4)&0x0f0f0f0f)*0x01010101)>>>24;}
  const VARIANTS=[];
  CODES.forEach((code,id)=>{for(let r=0;r<4;r++){VARIANTS.push({id,r,code});code=rotate(code);}});
  function framePixels(lanes) {
    if(!Array.isArray(lanes)||lanes.length!==3)throw new Error('H7 dock needs three payload lanes');
    const data=new Uint8ClampedArray(W*H*4);data.fill(250);
    for(let p=3;p<data.length;p+=4)data[p]=255;
    const pixel=(x,y,rgb)=>{const p=(y*W+x)*4;data[p]=rgb[0];data[p+1]=rgb[1];data[p+2]=rgb[2];};
    lanes.forEach(({symbols,palette},lane)=>{
      if(symbols.length!==COLS*ROWS)throw new Error('Invalid payload grid');
      for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)pixel(DX+x,LANE_Y[lane]+y,palette[symbols[y*COLS+x]]);
    });
    ORIGINS.forEach(([ox,oy],corner)=>{
      const code=CODES[corner];
      for(let y=0;y<7;y++)for(let x=0;x<7;x++){
        const white=x>0&&x<6&&y>0&&y<6&&((code>>>(24-((y-1)*5+x-1)))&1);
        for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++)pixel(ox+x*2+xx,oy+y*2+yy,white?[250,250,250]:[5,5,5]);
      }
    });
    return {width:W,height:H,data};
  }
  function solve(A,b) {
    const n=b.length,M=A.map((row,i)=>Array.from(row).concat(b[i]));
    for(let c=0;c<n;c++){
      let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
      if(Math.abs(M[p][c])<1e-10)return null;
      [M[c],M[p]]=[M[p],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;
      for(let r=0;r<n;r++)if(r!==c){const v=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=v*M[c][j];}
    }
    return M.map(row=>row[n]);
  }
  function homography(points) {
    if(points.length<4)return null;
    const A=Array.from({length:8},()=>new Float64Array(8)),b=new Float64Array(8);
    for(const {u,v,x,y} of points){
      for(const [row,val] of [[ [u,v,1,0,0,0,-u*x,-v*x],x ],[[0,0,0,u,v,1,-u*y,-v*y],y]])
        for(let i=0;i<8;i++){b[i]+=row[i]*val;for(let j=0;j<8;j++)A[i][j]+=row[i]*row[j];}
    }
    return solve(A,b);
  }
  function project(h,u,v){const z=h[6]*u+h[7]*v+1;return{x:(h[0]*u+h[1]*v+h[2])/z,y:(h[3]*u+h[4]*v+h[5])/z};}
  function quadMap(q){return homography(q.map((p,i)=>({u:[0,1,1,0][i],v:[0,0,1,1][i],x:p.x,y:p.y})));}
  function grayAt(g,w,h,x,y) {
    if(x<0||y<0||x>=w-1||y>=h-1)return 255;
    const xx=Math.floor(x),yy=Math.floor(y),fx=x-xx,fy=y-yy,p=yy*w+xx;
    return (g[p]*(1-fx)+g[p+1]*fx)*(1-fy)+(g[p+w]*(1-fx)+g[p+w+1]*fx)*fy;
  }
  function hull(points) {
    points.sort((a,b)=>a.x-b.x||a.y-b.y);
    const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    const lower=[],upper=[];
    for(const p of points){while(lower.length>=2&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p);}
    for(let i=points.length-1;i>=0;i--){const p=points[i];while(upper.length>=2&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p);}
    lower.pop();upper.pop();return lower.concat(upper);
  }
  function reduceHull(points) {
    const q=hull(points);
    if(q.length<4)return null;
    while(q.length>4){
      let best=Infinity,index=0;
      for(let i=0;i<q.length;i++){
        const a=q[(i+q.length-1)%q.length],b=q[i],c=q[(i+1)%q.length];
        const area=Math.abs((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x));
        if(area<best){best=area;index=i;}
      }
      q.splice(index,1);
    }
    const lengths=q.map((p,i)=>Math.hypot(p.x-q[(i+1)%4].x,p.y-q[(i+1)%4].y));
    if(Math.min(...lengths)<6||Math.max(...lengths)/Math.min(...lengths)>3.4)return null;
    // Canonical array is clockwise in image coordinates; rotation is decoded from the tag.
    const area=q.reduce((s,p,i)=>s+p.x*q[(i+1)%4].y-p.y*q[(i+1)%4].x,0);
    if(area<0)q.reverse();
    let start=0;for(let i=1;i<4;i++)if(q[i].x+q[i].y<q[start].x+q[start].y)start=i;
    return q.slice(start).concat(q.slice(0,start));
  }
  function refineQuad(q,g,w,h) {
    // Fit real black->white edge gradients instead of corners of a coarse mask.
    const lines=[];
    for(let e=0;e<4;e++){
      const a=q[e],b=q[(e+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
      const nx=dy/len,ny=-dx/len,points=[];
      const radius=clamp(len/7*.9,2,5);
      for(let k=0;k<20;k++){
        const t=.13+.74*k/19,x=a.x+dx*t,y=a.y+dy*t;
        let best=-Infinity,at=0;
        for(let d=-radius;d<=radius;d+=.25){
          const gradient=grayAt(g,w,h,x+nx*(d+.6),y+ny*(d+.6))-grayAt(g,w,h,x+nx*(d-.6),y+ny*(d-.6));
          if(gradient>best){best=gradient;at=d;}
        }
        if(best>8)points.push({x:x+nx*at,y:y+ny*at});
      }
      if(points.length<6)return q;
      const mx=points.reduce((s,p)=>s+p.x,0)/points.length,my=points.reduce((s,p)=>s+p.y,0)/points.length;
      let xx=0,xy=0,yy=0;for(const p of points){xx+=(p.x-mx)**2;xy+=(p.x-mx)*(p.y-my);yy+=(p.y-my)**2;}
      const angle=.5*Math.atan2(2*xy,xx-yy),aa=-Math.sin(angle),bb=Math.cos(angle);
      lines.push({a:aa,b:bb,c:aa*mx+bb*my});
    }
    const out=[];
    for(let i=0;i<4;i++){
      const a=lines[(i+3)%4],b=lines[i],d=a.a*b.b-b.a*a.b;if(Math.abs(d)<.08)return q;
      const p={x:(a.c*b.b-b.c*a.b)/d,y:(a.a*b.c-b.a*a.c)/d};
      if(Math.hypot(p.x-q[i].x,p.y-q[i].y)>9)return q;out.push(p);
    }
    return out;
  }
  function decodeTag(q,g,w,h) {
    const hq=quadMap(q);if(!hq)return null;
    const vals=[];
    for(let y=0;y<7;y++)for(let x=0;x<7;x++){
      const p=project(hq,(x+.5)/7,(y+.5)/7);vals.push(grayAt(g,w,h,p.x,p.y));
    }
    const sorted=vals.slice().sort((a,b)=>a-b),lo=sorted[8],hi=sorted[42],contrast=hi-lo;
    if(contrast<24)return null;
    const threshold=(lo+hi)*.5;
    let borderErrors=0,code=0;
    for(let y=0;y<7;y++)for(let x=0;x<7;x++){
      const bit=vals[y*7+x]>threshold?1:0;
      if(x===0||x===6||y===0||y===6)borderErrors+=bit;
      else code=(code<<1)|bit;
    }
    if(borderErrors>7)return null;
    let best=null,second=99;
    for(const v of VARIANTS){const e=popcount(code^v.code);if(!best||e<best.errors){second=best?best.errors:99;best={...v,errors:e};}else second=Math.min(second,e);}
    if(best.errors>5||second-best.errors<1)return null;
    // White quiet zone is not data; reject accidental squares inside the payload.
    let quiet=0;
    for(const t of [.2,.5,.8])for(const [u,v] of [[t,-.09],[t,1.09],[-.09,t],[1.09,t]]){
      const p=project(hq,u,v);if(grayAt(g,w,h,p.x,p.y)>threshold)quiet++;
    }
    if(quiet<5)return null;
    const corners=q.map((_,k)=>q[(k+best.r)%4]);
    return {id:best.id,rotation:best.r,errors:best.errors,borderErrors,contrast,corners,score:contrast-25*best.errors};
  }
  class Scanner {
    constructor(){this.reset();}
    reset(){this.last=[];this.lastAt=0;this.frame=0;this.lastSize='';this.lastQuads=new Map();}
    prepare(image) {
      const sw=image.width,sh=image.height,scale=Math.min(1,1280/Math.max(sw,sh)),w=Math.round(sw*scale),h=Math.round(sh*scale);
      if(!this.buffers||this.buffers.w!==w||this.buffers.h!==h) this.buffers={w,h,g:new Uint8Array(w*h),sum:new Uint32Array((w+1)*(h+1)),mask:new Uint8Array(w*h),seen:new Uint8Array(w*h),queue:new Int32Array(w*h)};
      const {g,sum,mask}=this.buffers,rgba=image.data;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const xx=Math.min(sw-1,Math.floor((x+.5)*sw/w)),yy=Math.min(sh-1,Math.floor((y+.5)*sh/h)),p=(yy*sw+xx)*4;
        g[y*w+x]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
      }
      const pitch=w+1;sum.fill(0,0,pitch);
      for(let y=0;y<h;y++){let row=0;for(let x=0;x<w;x++){row+=g[y*w+x];sum[(y+1)*pitch+x+1]=sum[y*pitch+x+1]+row;}}
      const radius=15;
      for(let y=0;y<h;y++){
        const ya=Math.max(0,y-radius),yb=Math.min(h,y+radius+1);
        for(let x=0;x<w;x++){
          const xa=Math.max(0,x-radius),xb=Math.min(w,x+radius+1);
          const mean=(sum[yb*pitch+xb]-sum[yb*pitch+xa]-sum[ya*pitch+xb]+sum[ya*pitch+xa])/((xb-xa)*(yb-ya));
          mask[y*w+x]=g[y*w+x]<mean-5?1:0;
        }
      }
      return {g,mask,w,h,sw,sh,scaleX:sw/w,scaleY:sh/h};
    }
    components(f,regions) {
      const {g,mask,w,h}=f,{seen,queue}=this.buffers,out=[];seen.fill(0);
      let tested=0;
      for(const region of regions){
        const x0=clamp(Math.floor(region.x0),1,w-2),x1=clamp(Math.ceil(region.x1),1,w-2),y0=clamp(Math.floor(region.y0),1,h-2),y1=clamp(Math.ceil(region.y1),1,h-2);
        for(let sy=y0;sy<=y1;sy++)for(let sx=x0;sx<=x1;sx++){
          const seed=sy*w+sx;if(seen[seed]||!mask[seed])continue;
          let head=0,tail=1,minX=sx,maxX=sx,minY=sy,maxY=sy;queue[0]=seed;seen[seed]=1;
          const boundary=[];
          while(head<tail){
            const p=queue[head++],y=(p/w)|0,x=p-y*w;
            minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
            let edge=false;
            for(let dir=0;dir<4;dir++){
              const nx=x+(dir===0?-1:dir===1?1:0),ny=y+(dir===2?-1:dir===3?1:0);
              if(nx<x0||nx>x1||ny<y0||ny>y1){edge=true;continue;}
              const ni=ny*w+nx;
              if(!mask[ni]){edge=true;continue;}if(!seen[ni]){seen[ni]=1;queue[tail++]=ni;}
            }
            if(edge)boundary.push({x,y});
          }
          const bw=maxX-minX+1,bh=maxY-minY+1,fill=tail/(bw*bh);
          if(bw<7||bh<7||bw>Math.min(w,h)*.28||bh>Math.min(w,h)*.28||bw/bh<.30||bw/bh>3.2||fill<.08||fill>.98)continue;
          if(minX<=x0||minY<=y0||maxX>=x1||maxY>=y1)continue;
          if(++tested>900)return out;
          let q=reduceHull(boundary);if(!q)continue;
          // Coarse corners are only proposals; real gradient refinement precedes sampling.
          q=refineQuad(q,g,w,h);
          const d=decodeTag(q,g,w,h);if(!d)continue;
          const found=out.find(m=>m.id===d.id);
          if(!found)out.push(d);else if(d.score>found.score)Object.assign(found,d);
        }
      }
      return out;
    }
    lanes(markers,f) {
      // HPS7's four corner identities describe ONE dock, not twelve tiny per-lane tags.
      // Previous coordinates only narrow search windows; geometry below is from this frame.
      if(markers.length<2)return [];
      if(markers.length===2){
        const a=ORIGINS[markers[0].id],b=ORIGINS[markers[1].id];
        const canonicalDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);
        if(canonicalDistance<70)return [];
      }
      const points=[];
      for(const m of markers){const [ox,oy]=ORIGINS[m.id];m.corners.forEach((p,i)=>points.push({
        u:(ox+[0,TAG,TAG,0][i])/W,v:(oy+[0,0,TAG,TAG][i])/H,x:p.x/f.w,y:p.y/f.h}));}
      const hh=homography(points);if(!hh)return [];
      const errors=points.map(p=>{const v=project(hh,p.u,p.v);return Math.hypot((v.x-p.x)*f.w,(v.y-p.y)*f.h);});
      const rms=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length);
      if(rms>(markers.length>=3?4.5:6.5))return [];
      const map=(u,v)=>{const p=project(hh,u,v);return{x:p.x*f.sw,y:p.y*f.sh};};
      const items=[];
      for(let lane=0;lane<3;lane++){
        const y=LANE_Y[lane];
        const quad={tl:map(DX/W,y/H),tr:map((DX+COLS)/W,y/H),br:map((DX+COLS)/W,(y+ROWS)/H),bl:map(DX/W,(y+ROWS)/H)};
        if(Object.values(quad).some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=f.sw||p.y>=f.sh))continue;
        const cellPx=Math.min(Math.hypot(quad.tr.x-quad.tl.x,quad.tr.y-quad.tl.y)/COLS,Math.hypot(quad.bl.x-quad.tl.x,quad.bl.y-quad.tl.y)/ROWS);
        if(cellPx<0.60)continue; // Real-camera guide acquisition tolerates blur/downsampling.
        const old=this.lastQuads.get(lane),motionCells=old?Math.hypot(quad.tl.x-old.tl.x,quad.tl.y-old.tl.y)/cellPx:0;
        this.lastQuads.set(lane,quad);
        items.push({quad,lane,modeId:null,bits:null,exact:true,source:'hps7-shared-dock',anchorCount:markers.length,reprojection:rms,cellPx,motionCells,score:100-rms*15});
      }
      return items;
    }
    detect(image,now=performance.now()) {
      const started=performance.now();this.frame++;
      const f=this.prepare(image),size=f.w+'x'+f.h;
      if(size!==this.lastSize){this.last=[];this.lastSize=size;}
      let markers=[],strategy='full';
      if(this.last.length>=3&&now-this.lastAt<280&&this.frame%8!==0){
        const regions=this.last.map(m=>{
          const xs=m.corners.map(p=>p.x),ys=m.corners.map(p=>p.y),pad=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))*1.1;
          return{x0:Math.min(...xs)-pad,x1:Math.max(...xs)+pad,y0:Math.min(...ys)-pad,y1:Math.max(...ys)+pad};
        });
        // Overlapping windows must be merged BEFORE flood fill; otherwise a clipped
        // component in one ROI marks pixels seen and destroys its neighbor's tag.
        let changed=true;
        while(changed){changed=false;
          outer:for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++){
            const a=regions[i],b=regions[j];
            if(a.x0<=b.x1&&a.x1>=b.x0&&a.y0<=b.y1&&a.y1>=b.y0){
              regions[i]={x0:Math.min(a.x0,b.x0),x1:Math.max(a.x1,b.x1),y0:Math.min(a.y0,b.y0),y1:Math.max(a.y1,b.y1)};
              regions.splice(j,1);changed=true;break outer;
            }
          }
        }
        markers=this.components(f,regions);strategy='roi';
      }
      // Same-frame full reacquisition, never stale coordinates painted as a fresh lock.
      if(strategy==='full'||markers.length<3){
        markers=this.components(f,[{x0:1,y0:1,x1:f.w-2,y1:f.h-2}]);strategy='full';
      }
      this.last=markers;this.lastAt=now;
      const items=this.lanes(markers,f);
      return {items,markers:markers.length,strategy,scanMs:performance.now()-started};
    }
  }
  root.HopperAnchorScan={VERSION:'1.5.1',W,H,DX,DY,LANE_Y,COLS,ROWS,TAG,ORIGINS,MODES,CODES,VARIANTS,rotate,popcount,framePixels,Scanner,homography,project,decodeTag,refineQuad};
})(typeof globalThis!=='undefined'?globalThis:this);
