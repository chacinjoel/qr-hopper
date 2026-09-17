import {parsePacket} from './protocol.js?v=qf07';
let reader=null;
async function loadReader(){if(reader)return reader;const mod=await import('./vendor/zxing/es/reader/index.js');mod.prepareZXingModule({overrides:{locateFile:path=>new URL('./vendor/zxing/reader/'+path,self.location.href).href}});reader=mod;return reader;}
function crop(src,W,H,x0,y0,w,h){x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));w=Math.max(1,Math.min(W-x0,Math.floor(w)));h=Math.max(1,Math.min(H-y0,Math.floor(h)));const out=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++){const from=((y0+y)*W+x0)*4,to=y*w*4;out.set(src.subarray(from,from+w*4),to);}return new ImageData(out,w,h);}
function packetFromResult(r){const bytes=r.bytes instanceof Uint8Array?r.bytes:new Uint8Array(r.bytes||0),p=parsePacket(bytes);if(!p)return null;return{header:{session:p.session,seq:p.seq,k:p.k,blockLen:p.blockLen,totalLen:p.totalLen,degree:p.degree,codeIndex:p.codeIndex,seed:p.seed,systematic:p.systematic},payload:p.payload.buffer,position:r.position,rotation:r.rotation};}
async function scan(mod,image,{max=1,hard=false,denoise=false,errors=false,pure=false}={}){return mod.readBarcodes(image,{formats:['QRCode'],maxNumberOfSymbols:max,tryHarder:hard,tryRotate:!pure,tryInvert:hard,tryDownscale:false,tryDenoise:denoise,binarizer:'LocalAverage',isPure:pure,returnErrors:errors,textMode:'Plain'});}
self.onmessage=async e=>{const m=e.data;try{
 if(m.type==='init'){const mod=await loadReader();self.postMessage({type:'ready',version:mod.ZXING_WASM_VERSION||'3.1.4'});return;}
 if(m.type!=='decode')return;
 const mod=await loadReader(),rgba=new Uint8ClampedArray(m.rgba),imageData=new ImageData(rgba,m.width,m.height),seen=new Set(),packets=[];
 const rectified=!!m.rectified;
 let rawSymbols=0,invalidPackets=0,hardScans=0;
 const add=results=>{rawSymbols+=results.length;for(const r of results){const p=packetFromResult(r);if(!p){invalidPackets++;continue;}const key=`${p.header.session}:${p.header.seq}`;if(seen.has(key))continue;seen.add(key);packets.push(p);}};
 if(rectified){
   add(await scan(mod,imageData,{max:1,hard:false,pure:true}));
   if(!packets.length)add(await scan(mod,imageData,{max:1,hard:false}));
   if(!packets.length){hardScans++;add(await scan(mod,imageData,{max:1,hard:true,denoise:true,errors:true}));}
 }else{
   add(await scan(mod,imageData,{max:1,hard:false}));
   if(!packets.length){hardScans++;add(await scan(mod,imageData,{max:1,hard:true,denoise:true,errors:true}));}
   if(!packets.length){const W=m.width,H=m.height,side=Math.floor(Math.min(W,H)*.94),x=Math.floor((W-side)/2),y=Math.floor((H-side)/2);hardScans++;add(await scan(mod,crop(rgba,W,H,x,y,side,side),{max:1,hard:true,denoise:true,errors:true}));}
 }
 self.postMessage({type:'decoded',id:m.id,packets,rawSymbols,invalidPackets,hardScans},packets.map(p=>p.payload));
}catch(error){self.postMessage({type:'error',id:m?.id,message:error?.message||String(error)});}};
