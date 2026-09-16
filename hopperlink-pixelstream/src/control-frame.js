import { crc32 } from './crc32.js';
// Existing HDP optics carry a small control payload as kind=2; DATA (0), parity
// (1), and their bit layouts remain unchanged. New readers intercept kind=2.
const te=new TextEncoder(),td=new TextDecoder();
export function controlFrame(transport, state) {
  const text=te.encode(JSON.stringify({v:1,...state}));
  if(text.length+6>transport.blockLen)throw new Error('Mensaje de control demasiado grande.');
  const payload=new Uint8Array(transport.blockLen);payload.set([72,88,67,49]);
  new DataView(payload.buffer).setUint16(4,text.length);payload.set(text,6);
  return{kind:2,group:0,slot:0,payload};
}
export function parseControl(decoded) {
  const b=decoded?.payload;
  if(decoded?.header?.kind!==2||!(b instanceof Uint8Array)||b.length<6||crc32(b)!==decoded.header.crc||
    b[0]!==72||b[1]!==88||b[2]!==67||b[3]!==49)return null;
  const len=new DataView(b.buffer,b.byteOffset,b.byteLength).getUint16(4);if(len>b.length-6)return null;
  try{const c=JSON.parse(td.decode(b.subarray(6,6+len)));
    if(c.v!==1||!Number.isInteger(c.linkId)||c.linkId<=0||c.linkId>0xffffffff||!Number.isInteger(c.window)||c.window<1||c.window>10||
      !Number.isInteger(c.streamLength)||c.streamLength<=0||c.streamLength>256*1024*1024||!Number.isInteger(c.blockLen)||c.blockLen<64||c.blockLen>65535||
      !Number.isInteger(c.k)||c.k<1||c.k>16||!Number.isInteger(c.r)||c.r<0||c.r>20||c.action!=='feedback')return null;
    return c;
  }catch{return null;}
}
