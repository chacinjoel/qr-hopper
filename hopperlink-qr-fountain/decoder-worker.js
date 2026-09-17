import {parsePacket} from './protocol.js';
let reader=null;
async function loadReader(){if(reader)return reader;const mod=await import('./vendor/zxing/es/reader/index.js');mod.prepareZXingModule({overrides:{locateFile:path=>new URL('./vendor/zxing/reader/'+path,self.location.href).href}});reader=mod;return reader;}
function crop(src,W,H,x0,y0,w,h){x0=Math.max(0,Math.floor(x0));y0=Math.max(0,Math.floor(y0));w=Math.min(W-x0,Math.floor(w));h=Math.min(H-y0,Math.floor(h));const out=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++){const from=((y0+y)*W+x0)*4,to=y*w*4;out.set(src.subarray(from,from+w*4),to);}return new ImageData(out,w,h);}
function packetFromResult(r){const bytes=r.bytes instanceof Uint8Array?r.bytes:new Uint8Array(r.bytes||0),p=parsePacket(bytes);if(!p)return null;return{header:{session:p.session,seq:p.seq,k:p.k,blockLen:p.blockLen,totalLen:p.totalLen,degree:p.degree,codeIndex:p.codeIndex,seed:p.seed,systematic:p.systematic},payload:p.payload.buffer,position:r.position,rotation:r.rotation};}
async function scan(mod,image,max=2,hard=false){return mod.readBarcodes(image,{formats:['QRCode'],maxNumberOfSymbols:max,tryHarder:hard,tryRotate:true,tryInvert:false,returnErrors:false,textMode:'Plain'});}
self.onmessage=async e=>{const m=e.data;try{
 if(m.type==='init'){const mod=await loadReader();self.postMessage({type:'ready',version:mod.ZXING_WASM_VERSION||'3.1.4'});return;}
 if(m.type!=='decode')return;
 const mod=await loadReader(),rgba=new Uint8ClampedArray(m.rgba),imageData=new ImageData(rgba,m.width,m.height),seen=new Set(),packets=[];
 const add=results=>{for(const r of results){const p=packetFromResult(r);if(!p)continue;const key=`${p.header.session}:${p.header.seq}`;if(seen.has(key))continue;seen.add(key);packets.push(p);}};
 add(await scan(mod,imageData,2,false));
 // Turbo x2 renders one dense QR in each physical half of the display.
 // A crop that overlaps the neighbouring finder pattern can make ZXing reject
 // both symbols. Decode the two non-overlapping display halves independently.
 if(packets.length<2){
   const W=m.width,H=m.height;
   if(W>=H){const cut=Math.floor(W/2);add(await scan(mod,crop(rgba,W,H,0,0,cut,H),1,false));add(await scan(mod,crop(rgba,W,H,cut,0,W-cut,H),1,false));}
   else{const cut=Math.floor(H/2);add(await scan(mod,crop(rgba,W,H,0,0,W,cut),1,false));add(await scan(mod,crop(rgba,W,H,0,cut,W,H-cut),1,false));}
 }
 self.postMessage({type:'decoded',id:m.id,packets,regionFallback:packets.length>0},packets.map(p=>p.payload));
}catch(error){self.postMessage({type:'error',id:m?.id,message:error?.message||String(error)});}};
