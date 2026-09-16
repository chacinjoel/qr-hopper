import { encodeParity } from './gf256.js';

const te=new TextEncoder(),td=new TextDecoder();
const COMPRESSED_EXT=/\.(zip|gz|7z|rar|jpg|jpeg|png|webp|heic|mp3|aac|m4a|mp4|mov|mkv|webm|pdf|apk|ipa)$/i;
export function humanBytes(n){if(!Number.isFinite(n))return '—';const u=['B','KB','MB','GB'];let i=0,v=n;while(v>=1024&&i<u.length-1){v/=1024;i++;}return `${v.toFixed(v>=100||i===0?0:v>=10?1:2)} ${u[i]}`;}
export function entropy(bytes){if(!bytes.length)return 0;const counts=new Uint32Array(256);const step=Math.max(1,Math.floor(bytes.length/131072));let n=0;for(let i=0;i<bytes.length;i+=step){counts[bytes[i]]++;n++;}let h=0;for(const c of counts)if(c){const p=c/n;h-=p*Math.log2(p);}return h;}
async function sha256Hex(bytes){const hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function gzip(bytes){if(!('CompressionStream' in globalThis))return null;const cs=new CompressionStream('gzip');const writer=cs.writable.getWriter();writer.write(bytes);writer.close();return new Uint8Array(await new Response(cs.readable).arrayBuffer());}
export async function gunzip(bytes){if(!('DecompressionStream' in globalThis))throw new Error('Este navegador no soporta DecompressionStream');const ds=new DecompressionStream('gzip');const writer=ds.writable.getWriter();writer.write(bytes);writer.close();return new Uint8Array(await new Response(ds.readable).arrayBuffer());}
export async function packFile(file){const original=new Uint8Array(await file.arrayBuffer()),h=entropy(original);let payload=original,codec='raw';if(!COMPRESSED_EXT.test(file.name)&&h<7.94){const gz=await gzip(original);if(gz&&gz.length<original.length*0.985){payload=gz;codec='gzip';}}const meta={v:2,name:file.name,type:file.type||'application/octet-stream',size:original.length,codec,packedSize:payload.length,sha256:await sha256Hex(original),entropy:+h.toFixed(4),createdAt:new Date().toISOString()};const m=te.encode(JSON.stringify(meta));const out=new Uint8Array(8+m.length+payload.length);out.set([0x48,0x58,0x53,0x32],0);new DataView(out.buffer).setUint32(4,m.length);out.set(m,8);out.set(payload,8+m.length);return {stream:out,meta,originalBytes:original.length,packedBytes:payload.length};}
export function unpackEnvelope(bytes){if(bytes[0]!==0x48||bytes[1]!==0x58||bytes[2]!==0x53||bytes[3]!==0x32)throw new Error('SuperStream inválido');const ml=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(4);const meta=JSON.parse(td.decode(bytes.slice(8,8+ml)));return {meta,payload:bytes.slice(8+ml)};}
export async function restoreFile(stream){const {meta,payload}=unpackEnvelope(stream);const data=meta.codec==='gzip'?await gunzip(payload):payload;const sha=await sha256Hex(data);if(sha!==meta.sha256)throw new Error('SHA-256 no coincide');return {meta,data};}

// Every FEC group always emits all k systematic blocks, including zero-padding
// blocks in the last partial group. This gives the decoder k independent
// equations even when the final group contains fewer than k real data blocks.
export function buildTransport(stream,profile){
  const blockLen=profile.payloadBytes,k=profile.k,r=profile.r;
  const dataCount=Math.ceil(stream.length/blockLen),groupCount=Math.ceil(dataCount/k),frames=[];
  for(let g=0;g<groupCount;g++){
    const blocks=[];
    for(let i=0;i<k;i++){
      const idx=g*k+i,b=new Uint8Array(blockLen);
      if(idx<dataCount)b.set(stream.slice(idx*blockLen,Math.min(stream.length,(idx+1)*blockLen)));
      blocks.push(b);
    }
    const parity=encodeParity(blocks,r);
    for(let i=0;i<k;i++){
      const idx=g*k+i;
      frames.push({group:g,slot:i,kind:0,dataIndex:idx<dataCount?idx:0xffffffff,padding:idx>=dataCount,payload:blocks[i]});
    }
    for(let p=0;p<r;p++)frames.push({group:g,slot:k+p,kind:1,dataIndex:0xffffffff,padding:false,payload:parity[p]});
  }
  return {frames,dataCount,groupCount,streamLength:stream.length,blockLen,k,r};
}

function gcd(a,b){while(b){const t=a%b;a=b;b=t;}return a;}
function strideFor(n,pass){if(n<=1)return 1;let s=Math.max(1,Math.floor(n/2)+(pass*2+1));while(gcd(s,n)!==1)s++;return s;}

// Slot-major interleaving spreads a short camera/lock outage across different
// FEC groups instead of destroying several consecutive symbols in one group.
// Rescue schedules repeat systematic blocks only, using a different group walk.
export function buildFrameSchedule(transport,{dataOnly=false,pass=0}={}){
  const {frames,k,r,groupCount}=transport;
  const byKey=new Map(frames.map((f,i)=>[`${f.group}:${f.slot}`,i]));
  const maxSlot=dataOnly?k:k+r,slots=Array.from({length:maxSlot},(_,i)=>i);
  if(pass&1)slots.reverse();
  const stride=strideFor(groupCount,pass),start=groupCount?((pass*3+1)%groupCount):0,groups=[];
  for(let j=0;j<groupCount;j++)groups.push((start+j*stride)%groupCount);
  if(pass%3===2)groups.reverse();
  const schedule=[];
  for(const slot of slots)for(const g of groups){const idx=byKey.get(`${g}:${slot}`);if(idx!==undefined)schedule.push(idx);}
  return schedule;
}
