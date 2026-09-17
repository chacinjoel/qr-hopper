export const BUILD='qr-fountain-0.2.0-max';
export const MAGIC=[0x48,0x51,0x46,0x31]; // HQF1
export const VERSION=1;
export const HEADER_BYTES=40;
export const MAX_QR_BYTES=2920;
export const PROFILES={
  safe:{key:'safe',label:'Compatibilidad extrema · QR v15 · 8 fps · ECC M · 280 B',blockLen:280,fps:8,codes:1,qrVersion:15,ecLevel:'M'},
  robust:{key:'robust',label:'Robusto · QR v27 · 16 fps · 1.36 KB',blockLen:1360,fps:16,codes:1,qrVersion:27,ecLevel:'L'},
  balanced:{key:'balanced',label:'Balanceado · QR v27 · 24 fps · 1.36 KB',blockLen:1360,fps:24,codes:1,qrVersion:27,ecLevel:'L'},
  turbo:{key:'turbo',label:'Turbo · QR v35 · 24 fps · 2.16 KB',blockLen:2160,fps:24,codes:1,qrVersion:35,ecLevel:'L'},
  max:{key:'max',label:'Máximo físico · QR v40 · 24 fps · 2.86 KB',blockLen:2860,fps:24,codes:1,qrVersion:40,ecLevel:'L'},
  max30:{key:'max30',label:'Máximo 30 · QR v40 · 30 fps · experimental',blockLen:2860,fps:30,codes:1,qrVersion:40,ecLevel:'L'},
  turbo60:{key:'turbo60',label:'Turbo 60 · QR v40 · experimental',blockLen:2860,fps:60,codes:1,qrVersion:40,ecLevel:'L'},
  turbo2:{key:'turbo2',label:'Turbo ×2 · QR v40 · 2 códigos · experimental',blockLen:2860,fps:24,codes:2,qrVersion:40,ecLevel:'L'},
};

const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
export function crc32(bytes){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function u16(v,o,n){new DataView(v.buffer,v.byteOffset,v.byteLength).setUint16(o,n,false);}function u32(v,o,n){new DataView(v.buffer,v.byteOffset,v.byteLength).setUint32(o,n>>>0,false);}function r16(v,o){return new DataView(v.buffer,v.byteOffset,v.byteLength).getUint16(o,false);}function r32(v,o){return new DataView(v.buffer,v.byteOffset,v.byteLength).getUint32(o,false);}

export function packPacket({session,seq,k,blockLen,totalLen,degree,seed,payload,systematic=false,codeIndex=0}){
  if(!(payload instanceof Uint8Array)||payload.length!==blockLen)throw Error('Payload inválido');
  if(blockLen+HEADER_BYTES>MAX_QR_BYTES)throw Error('QR excede el presupuesto binario');
  const out=new Uint8Array(HEADER_BYTES+payload.length);out.set(MAGIC,0);out[4]=VERSION;out[5]=(systematic?1:0)|(codeIndex?2:0);u16(out,6,0x51f0);u32(out,8,session);u32(out,12,seq);u16(out,16,k);u16(out,18,blockLen);u32(out,20,totalLen);out[24]=degree;out[25]=codeIndex&255;u16(out,26,0);u32(out,28,seed);u32(out,32,crc32(payload));u32(out,36,crc32(out.subarray(0,36)));out.set(payload,HEADER_BYTES);return out;
}

export function parsePacket(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<HEADER_BYTES)return null;
  for(let i=0;i<4;i++)if(bytes[i]!==MAGIC[i])return null;
  if(bytes[4]!==VERSION||r16(bytes,6)!==0x51f0)return null;
  if(r32(bytes,36)!==crc32(bytes.subarray(0,36)))return null;
  const session=r32(bytes,8),seq=r32(bytes,12),k=r16(bytes,16),blockLen=r16(bytes,18),totalLen=r32(bytes,20),degree=bytes[24],codeIndex=bytes[25],seed=r32(bytes,28),payloadCrc=r32(bytes,32),flags=bytes[5];
  if(!session||!k||k>65535||blockLen<64||blockLen>2880||totalLen<1||totalLen>256*1024*1024||degree<1||degree>Math.min(k,64)||bytes.length!==HEADER_BYTES+blockLen)return null;
  const payload=bytes.slice(HEADER_BYTES);if(crc32(payload)!==payloadCrc)return null;
  return{session,seq,k,blockLen,totalLen,degree,codeIndex,seed,systematic:!!(flags&1),payload};
}

export function randomSession(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]||1;}
export function profileByKey(key){return PROFILES[key]||PROFILES.safe;}
export function nominalRate(p){return p.blockLen*p.fps*p.codes;}
