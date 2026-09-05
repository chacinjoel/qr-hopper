'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
require(path.join(root,'anchor-scan.js'));
require(path.join(root,'src/hopper-one-runtime.js'));
const A=global.HopperAnchorScan,I=global.__hopperLinkOneInternals;
let assertions=0,cases=0;const times=[];
const check=(v,msg)=>{assert(v,msg);assertions++;};
check(A.VARIANTS.length===144,'36 tags, each with 4 distinguishable rotations');
for(let a=0;a<A.VARIANTS.length;a++)for(let b=0;b<a;b++)
 check(A.popcount(A.VARIANTS[a].code^A.VARIANTS[b].code)>=8,'coded IDs must have d_min >=8');
function rng(seed){let x=seed;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const sourceW=840,sourceH=1280;
function makeSource(mode, type=I.TYPE.SYSTEMATIC, occluded=[], corrupt=false) {
 const m=I.resolveMode(mode),rgba=new Uint8ClampedArray(sourceW*sourceH*4);rgba.fill(255);
 const payloads=[];
 for(let lane=0;lane<3;lane++){
   const payload=type===I.TYPE.HELLO?new TextEncoder().encode(JSON.stringify({name:'capture-'+mode+'.bin',mode,size:31,protocol:3})):
      Uint8Array.from({length:m.chunkBytes},(_,i)=>(i*29+lane*37)&255);
   payloads.push(payload);
   const packet=I.makePacket({type,lane,session:20260904,sequence:lane+1,sourceCount:3,symbol:lane,payload,mode});
   const symbols=I.rawToSymbols(packet,60,36,mode);
   if(corrupt)symbols[840]^=1; // Interior data, not pilots or metadata.
   const f=A.framePixels(symbols,mode,lane,m.palette);
   for(const corner of occluded){const [ox,oy]=A.ORIGINS[corner];for(let y=oy;y<oy+7;y++)for(let x=ox;x<ox+7;x++){const p=(y*A.W+x)*4;f.data[p]=f.data[p+1]=f.data[p+2]=255;}}
   for(let y=0;y<400;y++)for(let x=0;x<840;x++){
     const a=(((y/10)|0)*A.W+((x/10)|0))*4,b=((y+20+lane*420)*sourceW+x)*4;
     rgba[b]=f.data[a];rgba[b+1]=f.data[a+1];rgba[b+2]=f.data[a+2];
   }
 }
 return {width:sourceW,height:sourceH,data:rgba,payloads};
}
function warp(src,quad,opts={}){
 const w=opts.w||960,h=opts.h||1440,rgba=new Uint8ClampedArray(w*h*4),rand=rng(1300);
 const hh=A.homography(quad.map((p,i)=>({u:p[0]/w,v:p[1]/h,x:[0,1,1,0][i],y:[0,0,1,1][i]})));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p=A.project(hh,x/w,y/h),sx=p.x*(src.width-1),sy=p.y*(src.height-1),o=(y*w+x)*4;
   rgba[o+3]=255;
   if(sx<0||sy<0||sx>=src.width-1||sy>=src.height-1){
     // Deterministic non-marker clutter with multiple luminances/colors.
     rgba[o]=80+((x>>4)+(y>>5))%60;rgba[o+1]=75+(x>>3)%42;rgba[o+2]=92+(y>>4)%44;continue;
   }
   const xx=Math.floor(sx),yy=Math.floor(sy),fx=sx-xx,fy=sy-yy,a=(yy*src.width+xx)*4;
   for(let c=0;c<3;c++){
     let value=(src.data[a+c]*(1-fx)+src.data[a+4+c]*fx)*(1-fy)+(src.data[a+src.width*4+c]*(1-fx)+src.data[a+src.width*4+4+c]*fx)*fy;
     if(opts.noise)value=value*(.68+.25*y/h)+[12,4,17][c]+(rand()-.5)*18;
     rgba[o+c]=Math.max(0,Math.min(255,value));
   }
 }
 return {width:w,height:h,data:rgba};
}
function blur(im,passes=1){
 let data=im.data;
 for(let pass=0;pass<passes;pass++){
   const out=data.slice(),w=im.width,h=im.height;
   for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++)for(let c=0;c<3;c++){
     const p=(y*w+x)*4+c;
     out[p]=(data[p]*4+(data[p-4]+data[p+4]+data[p-w*4]+data[p+w*4])*2+data[p-w*4-4]+data[p-w*4+4]+data[p+w*4-4]+data[p+w*4+4])/16;
   }
   data=out;
 }
 return {...im,data};
}
function rotateImage(im){const w=im.height,h=im.width,data=new Uint8ClampedArray(w*h*4);for(let y=0;y<im.height;y++)for(let x=0;x<im.width;x++){const a=(y*im.width+x)*4,b=(x*w+im.height-1-y)*4;data.set(im.data.subarray(a,a+4),b);}return{width:w,height:h,data};}
function testImage(label, im, source, scanner=new A.Scanner(), time=1000, expected=3){
 const r=I.scanAnchorFrame(scanner,im,time),valid=r.items.filter(i=>i.decoded);
 times.push(r.processingMs);cases++;
 check(valid.length===expected,`${label}: expected ${expected} valid payloads, got ${valid.length}, markers=${r.markers}`);
 for(const item of valid){check(item.decoded.packet.modeId===item.modeId,label+' coded mode agrees with CRC header');
   check(Buffer.from(item.decoded.packet.payload).equals(Buffer.from(source.payloads[item.lane])),label+' exact byte-for-byte payload');}
 console.log(label+': '+valid.length+'/3 CRC; '+r.markers+' anchors; '+r.strategy+'; '+r.processingMs.toFixed(1)+' ms');
 return r;
}
const quad=[[205,110],[810,182],[775,1315],[140,1250]];
for(const mode of A.MODES){
 const source=makeSource(mode),base=warp(source,quad),disturbed=blur(warp(source,quad,{noise:true}));
 testImage(mode+'/perspective',base,source);
 testImage(mode+'/noise-exposure-blur',disturbed,source);
 testImage(mode+'/rotate90',rotateImage(base),source);
 testImage(mode+'/one-marker-hidden',warp(makeSource(mode,I.TYPE.SYSTEMATIC,[0]),quad),source);
 testImage(mode+'/insufficient-anchors-rejected',warp(makeSource(mode,I.TYPE.SYSTEMATIC,[1,3]),quad),source,new A.Scanner(),1000,0);
 const hello=makeSource(mode,I.TYPE.HELLO);
 const h=testImage(mode+'/HELLO',blur(warp(hello,quad,{noise:true})),hello);
 for(const i of h.items)check(JSON.parse(new TextDecoder().decode(i.decoded.packet.payload)).name==='capture-'+mode+'.bin','HELLO name and mode decoded');
 // Pure, shared production fountain decoder reconstructs these 3 transmitted blocks.
 const decoder=I.createFountainDecoder(3,I.resolveMode(mode).chunkBytes);
 const r=I.scanAnchorFrame(new A.Scanner(),base,1200);
 for(const item of r.items)decoder.addSystematic(item.lane,item.decoded.packet.payload);
 check(decoder.complete,'full file reconstruction');
 check(I.crc32(Uint8Array.from(decoder.blocks().flatMap(b=>Array.from(b))))===I.crc32(Uint8Array.from(source.payloads.flatMap(b=>Array.from(b)))),'full file CRC32 exact');
 // Good tags cannot turn damaged data into a successful reception.
 const damaged=warp(makeSource(mode,I.TYPE.SYSTEMATIC,[],true),quad);
 testImage(mode+'/damaged-payload',damaged,source,new A.Scanner(),1300,0);
}
const source=makeSource('adaptive3'),scanner=new A.Scanner();
let roiCount=0;
for(let frame=0;frame<12;frame++){
 const dx=Math.sin(frame*1.4)*28,dy=Math.cos(frame*1.6)*15,tilt=Math.sin(frame*.9)*13;
 const q=quad.map(([x,y],i)=>[x+dx,y+dy+(i===0||i===3?-tilt:tilt)]);
 const r=testImage('hand-jitter/'+frame,warp(source,q,{noise:true}),source,scanner,2000+frame*80);
 if(r.strategy==='roi')roiCount++;
}
check(roiCount>0,'tracked ROI path actually exercised');
const blank={width:960,height:1440,data:new Uint8ClampedArray(960*1440*4).fill(120)};
testImage('blank-after-lock',blank,source,scanner,3100,0);
check(scanner.last.length===0,'no stale coordinates or invented anchors reused');
testImage('reacquire-next-frame',warp(source,quad),source,scanner,3180);
const rand=rng(37),noise=blank.data.slice();for(let p=0;p<noise.length;p+=4){noise[p]=rand()*255;noise[p+1]=rand()*255;noise[p+2]=rand()*255;noise[p+3]=255;}
testImage('noise-only-reject',{...blank,data:noise},source,new A.Scanner(),3200,0);
const runtime=fs.readFileSync(path.join(root,'src/hopper-one-runtime.js'),'utf8');
check(!runtime.includes('currentTime - app.trackedAt < 1800'),'remove stale homographies');
check(runtime.includes('requestVideoFrameCallback'),'schedule actual camera frames');
check(runtime.includes('data.epoch !== app.scanEpoch'),'ignore late worker sessions');
const sorted=times.slice().sort((a,b)=>a-b);
console.log(JSON.stringify({version:I.VERSION,cases,assertions,roiFrames:roiCount,medianMs:sorted[sorted.length>>1],p95Ms:sorted[Math.floor(sorted.length*.95)],scope:'synthetic screen-to-camera transforms on CI hardware, NOT physical-phone performance'}));
