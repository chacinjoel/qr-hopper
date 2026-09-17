import {FountainEncoder} from './fountain.js?v=qf02';
let writer=null,encoder=null,qrVersion=40;
async function loadWriter(){if(writer)return writer;const mod=await import('./vendor/zxing/es/writer/index.js');mod.prepareZXingModule({overrides:{locateFile:path=>new URL('./vendor/zxing/writer/'+path,self.location.href).href}});writer=mod;return writer;}
self.onmessage=async e=>{const m=e.data;try{
 if(m.type==='init'){const mod=await loadWriter();encoder=new FountainEncoder(new Uint8Array(m.stream),m.blockLen,m.session);qrVersion=m.qrVersion||40;self.postMessage({type:'ready',k:encoder.k,version:mod.ZXING_WASM_VERSION||'3.1.4'});return;}
 if(m.type==='render'){if(!encoder)throw Error('Worker sin inicializar');const packet=encoder.frame(m.seq,m.codeIndex||0),mod=await loadWriter();const out=await mod.writeBarcode(packet,{format:'QRCode',scale:1,addQuietZones:true,options:`version=${qrVersion},ecLevel=L,dataMask=0`});if(out.error)throw Error(out.error);const data=out.symbol.data;self.postMessage({type:'frame',seq:m.seq,codeIndex:m.codeIndex||0,width:out.symbol.width,height:out.symbol.height,data:data.buffer},[data.buffer]);}
}catch(error){self.postMessage({type:'error',message:error?.message||String(error),seq:m?.seq});}};
