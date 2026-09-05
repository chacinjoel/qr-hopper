'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
require(path.join(root,'anchor-scan.js'));require(path.join(root,'src/hopper-one-runtime.js'));
const A=global.HopperAnchorScan,I=global.__hopperLinkOneInternals;
const eq=(a,b,m)=>assert.deepEqual(a,b,m);
let cases=0;
for(let a=0;a<A.VARIANTS.length;a++)for(let b=0;b<a;b++)assert(A.popcount(A.VARIANTS[a].code^A.VARIANTS[b].code)>=9);
assert.equal(A.CODES.length,4,'Actual HPS7 reference codebook');
function dataSource(mode){const m=I.resolveMode(mode),file=Uint8Array.from({length:m.chunkBytes*3},(_,i)=>(i*31+17)&255);
 const blocks=I.splitBlocks(file,m.chunkBytes),meta={bits:m.bits,size:file.length,fileCrc:I.crc32(file),sha256:crypto.createHash('sha256').update(file).digest('hex'),name:'prueba-'+mode+'-ñ.bin',type:'application/octet-stream',lastModified:0};
 return {m,file,blocks,meta,session:9388433};}
function hellos(s,override=null){const bytes=I.compactHello(override||s.meta),n=Math.ceil(bytes.length/I.CONTROL_CHUNK);return Array.from({length:n},(_,j)=>I.makePacket({type:I.TYPE.HELLO,flags:I.CONTROL_FLAG|((s.m.bits-2)<<4),lane:j%3,session:s.session,sequence:20+j,sourceCount:3,chunkSize:s.m.chunkBytes,symbol:(n<<16)|j,aux:I.crc32(bytes),payload:bytes.slice(j*I.CONTROL_CHUNK,(j+1)*I.CONTROL_CHUNK),mode:'robust2'}));}
function packets(s){return s.blocks.map((payload,lane)=>I.makePacket({type:I.TYPE.SYSTEMATIC,lane,session:s.session,sequence:lane+1,sourceCount:3,chunkSize:s.m.chunkBytes,symbol:lane,payload,mode:s.m.id}));}
function draw(raws,hide=[],damage=false){const lanes=raws.map(raw=>{const mode=I.modeByBits(raw[7]&15);return {symbols:I.opticalSymbols(raw),palette:mode.palette};});
 const f=A.framePixels(lanes);for(const corner of hide){const [ox,oy]=A.ORIGINS[corner];for(let y=oy;y<oy+A.TAG;y++)for(let x=ox;x<ox+A.TAG;x++){let p=(y*A.W+x)*4;f.data[p]=f.data[p+1]=f.data[p+2]=250;}}
 if(damage)for(let y=45;y<50;y++)for(let x=20;x<50;x++){const p=(y*A.W+x)*4;f.data[p]=f.data[p+1]=f.data[p+2]=137;}
 return f;}
function warp(src,quad,opt={}){
 const width=opt.w||720,height=opt.h||1280,data=new Uint8ClampedArray(width*height*4);
 const h=A.homography(quad.map((p,i)=>({u:p[0]/width,v:p[1]/height,x:[0,1,1,0][i],y:[0,0,1,1][i]})));
 let seed=4201;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const q=A.project(h,x/width,y/height),o=(y*width+x)*4;data[o+3]=255;
  if(q.x<0||q.x>=1||q.y<0||q.y>=1){data[o]=42+((x>>4)%8)*13;data[o+1]=60;data[o+2]=65;continue;}
  const xx=Math.min(src.width-1,Math.floor(q.x*src.width)),yy=Math.min(src.height-1,Math.floor(q.y*src.height)),p=(yy*src.width+xx)*4;
  for(let c=0;c<3;c++){let v=src.data[p+c];if(opt.noise)v=v*(.62+.30*y/height)+[14,7,17][c]+(random()-.5)*16;data[o+c]=v;}
 }
 if(opt.blur){const d=data.slice();for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++)for(let c=0;c<3;c++){const p=(y*width+x)*4+c;data[p]=(d[p]*4+d[p-4]+d[p+4]+d[p-width*4]+d[p+width*4])/8;}}
 return {width,height,data};
}
function scan(label,im,raws,expect=3,scanner=new A.Scanner(),time=1000){const r=I.scanAnchorFrame(scanner,im,time),valid=r.items.filter(i=>i.decoded);cases++;console.log(label,{refs:r.markers,valid:valid.length,ms:r.processingMs.toFixed(1),strategy:r.strategy});assert.equal(valid.length,expect,label);for(const item of valid){const p=item.decoded.packet;assert.equal(p.session,9388433);assert(Buffer.from(p.payload).equals(Buffer.from(I.parsePacket(raws[item.lane]).payload)),label+' byte-exact');}return r;}
const quad=[[163,70],[571,105],[597,1191],[120,1235]];
for(const mode of A.MODES){
 const s=dataSource(mode),raws=packets(s),parts=hellos(s),small=parts[0];
 const copy=(raw,lane)=>{const p=I.parsePacket(raw);return I.makePacket({...p,lane,payload:p.payload,mode:'robust2'});};
 const controls=[0,1,2].map((lane)=>copy(parts[lane%parts.length],lane));
 let meta=null;
 for(let offset=0;offset<parts.length;offset+=3){
   const batch=[0,1,2].map(lane=>copy(parts[(offset+lane)%parts.length],lane));
   const clean=scan(mode+'/HELLO-gray/'+offset,warp(draw(batch),quad),batch);
   for(const i of clean.items)meta=I.acceptControlHello(i.decoded.packet)||meta;
 }
 assert(meta);assert.equal(meta.name,s.meta.name);assert.equal(meta.bits,s.m.bits);
 scan(mode+'/control-exposure-blur',warp(draw(controls),quad,{noise:true,blur:true}),controls);
 scan(mode+'/one-global-corner-hidden',warp(draw(controls,[1]),quad,{noise:true}),controls);
 const tinyQuad=quad.map(([x,y])=>[360+(x-360)*.36,650+(y-650)*.36]);
 scan(mode+'/coarse-HELLO-small-projection',warp(draw(controls),tinyQuad),controls);
 scan(mode+'/DATA',warp(draw(raws),quad),raws);
 const output=scan(mode+'/DATA-exposure',warp(draw(raws),quad,{noise:true}),raws);
 const dec=I.createFountainDecoder(3,s.m.chunkBytes);for(const i of output.items)dec.addSystematic(i.decoded.packet.symbol,i.decoded.packet.payload);
 assert(dec.complete);assert(Buffer.concat(dec.blocks().map(Buffer.from)).equals(Buffer.from(s.file)));
 const fec=I.controlEncode(small),capacity=fec.length-1,damaged=fec.slice();
 // Twenty independent 1-bit codeword errors, after interleaving.
 for(let j=0;j<20;j++)damaged[((j*5)*157)%capacity]^=1<<(j%8);
 const fixed=I.controlDecode(damaged);assert(fixed);assert.equal(fixed.corrected,20);assert(Buffer.from(fixed.packet.payload).equals(Buffer.from(I.parsePacket(small).payload)));
 const bad=fec.slice();bad[0]^=3;assert.equal(I.controlDecode(bad),null,'double-bit header damage rejected');
 const large={...s.meta,name:'á'.repeat(200)+'.bin'};const fragmented=hellos(s,large);assert(fragmented.length>1);
 let result=null;for(const raw of fragmented.slice().reverse())result=I.acceptControlHello(I.parsePacket(raw))||result;
 assert.equal(result.name,large.name,'out-of-order metadata retains full UTF-8 name');
}
const s=dataSource('adaptive3'),raws=packets(s),scanner=new A.Scanner();
for(let j=0;j<8;j++){const q=quad.map(([x,y],i)=>[x+Math.sin(j)*14+(i%2?j:-j),y+Math.cos(j)*8]);scan('handheld/'+j,warp(draw(raws),q),raws,3,scanner,1000+j*75);}
const blank={width:720,height:1280,data:new Uint8ClampedArray(720*1280*4)};
scan('blank / no stale geometry',blank,raws,0,scanner,1680);
scan('reacquire',warp(draw(raws),quad),raws,3,scanner,1740);
scan('two references / reject',warp(draw(raws,[0,1]),quad),raws,0);
const corrupt=I.scanAnchorFrame(new A.Scanner(),warp(draw(raws,[],true),quad),1900);assert(corrupt.items.filter(i=>i.decoded).length<3,'corrupt data not declared complete');
console.log(JSON.stringify({version:I.VERSION,cases,scope:'synthetic pixel-to-HELLO and packet reconstruction; not physical phones'}));
