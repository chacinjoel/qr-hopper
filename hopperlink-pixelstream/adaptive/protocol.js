import {crc32} from '../src/crc32.js';
import {gridSpec, finderCenters} from '../src/optical2.js';
export const BUILD='adaptive-1.0.0';
export const MAGIC=0x48415031;
export const HEADER_BYTES=40;
export const KIND={DATA:0,PARITY:1,CONTROL:2,PROBE:3};
export const PALETTES=[
 ['#161616','#eeeeee'],
 ['#151921','#f4f7ff','#2c79ff','#ff5a32'],
 ['#171a20','#f5f7ff','#ff3b3b','#45d36b','#376dff','#ffc83a','#c547ff','#35c8d5'],
 ['#11151d','#f8f9ff','#ff334f','#52d878','#3c7cff','#ffd34a','#b94cff','#45c6d5','#ff8a2e','#7b58ff','#8bcf3f','#ff6fae','#41a7ff','#b8d95d','#ffc0e7','#7f94a8'],
 ['#151921','#eeeeee','#3269c7','#e9b136']
];
const definitions=[
 [0,0,'64x96',8,6,3,'Control B/N'],
 [1,1,'64x96',15,6,3,'4 colores · 64×96 · 15/s'],
 [2,2,'64x96',15,8,2,'8 colores · 64×96 · 15/s'],
 [3,3,'64x96',15,10,2,'16 colores · 64×96 · 15/s'],
 [4,4,'64x96',20,6,3,'4 colores alternos · 20/s'],
 [5,1,'72x112',20,6,3,'4 colores · 72×112 · 20/s'],
 [6,2,'72x112',20,8,2,'8 colores · 72×112 · 20/s'],
 [7,2,'84x132',20,8,2,'8 colores · 84×132 · 20/s'],
 [8,3,'84x132',20,10,2,'16 colores · 84×132 · 20/s'],
 [9,0,'64x96',15,6,3,'B/N · 64×96 · 15/s'],
 [10,1,'64x96',25,6,3,'4 colores · 64×96 · 25/s']
];
export function isReservedCell(p,x,y){return finderCenters(p).some(c=>Math.abs(x+.5-c.x)<p.finder/2+2&&Math.abs(y+.5-c.y)<p.finder/2+2);}
export const PROFILES=definitions.map(([id,paletteId,grid,fps,k,r,name])=>{
 const bits=Math.log2(PALETTES[paletteId].length),p={...gridSpec(grid,2),id,paletteId,bits,grid,fps,k,r,name,key:bits<=2?'robust':bits===3?'balanced':'turbo'};
 p.headerRows=14;p.payloadTop=p.top+p.headerRows+p.syncRows+p.calRows;p.payloadBottom=p.bottom-2;
 p.cells=[];p.pilots=[];p.headerCells=[];
 for(let y=p.top;y<p.top+p.headerRows;y++)for(let x=p.left;x<p.right;x++)if(!isReservedCell(p,x,y))p.headerCells.push([x,y]);
 for(let y=p.top+p.headerRows+p.syncRows;y<p.bottom;y++)for(let x=p.left;x<p.right;x++){
  if(isReservedCell(p,x,y))continue;
  if(y<p.payloadTop||y>=p.payloadBottom||x<p.left+2||x>=p.right-2)p.pilots.push([x,y,(x+y)%PALETTES[paletteId].length]);else p.cells.push([x,y]);
 }
 p.payloadCells=p.cells.length;p.payloadBytes=Math.floor(p.cells.length*bits/8);
 if(p.headerCells.length<HEADER_BYTES*8)throw Error('Cabecera sin espacio');return Object.freeze(p);
});
export const CATALOG_HASH=crc32(new TextEncoder().encode(JSON.stringify({definitions,PALETTES,layout:2,header:40,pilotCollar:2,headerRows:14})));
export function profile(id){const p=PROFILES[id];if(!p)throw Error('Perfil desconocido');return p;}
export const bootstrap=PROFILES[0];
export function rgb(p){return PALETTES[p.paletteId].map(h=>{const n=parseInt(h.slice(1),16);return[n>>16,(n>>8)&255,n&255];});}
export function headerBytes(frame,p,sid,seq,total,streamLength){
 const b=new Uint8Array(HEADER_BYTES),v=new DataView(b.buffer);v.setUint32(0,MAGIC);b[4]=1;b[5]=p.id;b[6]=frame.kind;b[7]=frame.round||0;
 v.setUint32(8,sid);v.setUint32(12,seq);v.setUint32(16,total);v.setUint16(20,frame.group||0);b[22]=frame.slot||0;b[23]=p.k;b[24]=p.r;
 v.setUint16(25,frame.payload.length);v.setUint32(27,streamLength);v.setUint32(31,crc32(frame.payload));v.setUint32(35,crc32(b.subarray(0,35)));b[39]=0xa9;return b;
}
export function parseHeader(b){
 if(!(b instanceof Uint8Array)||b.length!==HEADER_BYTES)return null;const v=new DataView(b.buffer,b.byteOffset,b.length);
 if(v.getUint32(0)!==MAGIC||b[4]!==1||b[39]!==0xa9||v.getUint32(35)!==crc32(b.subarray(0,35)))return null;
 const p=PROFILES[b[5]],kind=b[6],len=v.getUint16(25),total=v.getUint32(16),seq=v.getUint32(12),streamLength=v.getUint32(27);
 if(!p||kind>3||b[23]!==p.k||b[24]!==p.r||!len||len>p.payloadBytes||!total||seq>=total||streamLength>256*1024*1024)return null;
 const h={profileId:p.id,sid:v.getUint32(8),kind,round:b[7],seq,total,group:v.getUint16(20),slot:b[22],k:p.k,r:p.r,payloadLen:len,streamLength,crc:v.getUint32(31)};
 if(kind!==KIND.CONTROL&&(len!==p.payloadBytes||h.slot>=p.k+p.r||h.group>=Math.ceil(Math.ceil(streamLength/len)/p.k)))return null;
 if(kind<2&&((kind===0)!==(h.slot<p.k)))return null;return h;
}
export function controlBytes(message){const s=new TextEncoder().encode(JSON.stringify({...message,catalog:CATALOG_HASH}));if(s.length>bootstrap.payloadBytes)throw Error('Control demasiado grande');return s;}
export function readControl(decoded){if(decoded?.header.kind!==2||!decoded.crcOK)return null;try{const c=JSON.parse(new TextDecoder().decode(decoded.payload));if(c.catalog!==CATALOG_HASH||c.sid!==decoded.header.sid||typeof c.op!=='string')return null;if(c.epoch!==undefined&&(!Number.isInteger(c.epoch)||c.epoch<1||c.epoch>65535))return null;if(c.pid!==undefined&&(!Number.isInteger(c.pid)||!PROFILES[c.pid]))return null;if(c.round!==undefined&&(!Number.isInteger(c.round)||c.round<0||c.round>2))return null;if(c.durationMs!==undefined&&(!Number.isFinite(c.durationMs)||c.durationMs<100||c.durationMs>120000))return null;return c;}catch{return null;}}
export function encodeReport(report){const s=JSON.stringify(report);if(s.length>2048)throw Error('Informe demasiado grande');return 'HAC1:'+s+':'+crc32(new TextEncoder().encode(s)).toString(16).padStart(8,'0');}
export function decodeReport(text,sid){
 if(typeof text!=='string'||text.length>2200||!text.startsWith('HAC1:'))return null;
 const cut=text.lastIndexOf(':'),s=text.slice(5,cut);if(crc32(new TextEncoder().encode(s)).toString(16).padStart(8,'0')!==text.slice(cut+1))return null;
 try{const r=JSON.parse(s);if(r.sid!==sid||r.catalog!==CATALOG_HASH||!PROFILES[r.chosen]||r.chosen===0||!PROFILES[r.fallback]||!Number.isInteger(r.epoch)||r.epoch<1||!Number.isInteger(r.fingerprint))return null;return r;}catch{return null;}
}
export function randomBytes(length,seed){const b=new Uint8Array(length);let x=seed>>>0||1;for(let i=0;i<length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;b[i]=x>>>24;}return b;}
export function trialSeed(sid,pid,round){return(sid^Math.imul(pid+1,0x9e3779b1)^Math.imul(round+1,0x85ebca77))>>>0;}
export function fourOpportunitySchedules(t){
 const useful=t.frames.map((f,i)=>({f,i})).filter(o=>o.f.kind===0).sort((a,b)=>a.f.slot-b.f.slot||a.f.group-b.f.group).map(o=>o.i),n=useful.length;
 const shifted=(start,dir)=>Array.from({length:n},(_,i)=>useful[(start+dir*i+n*2)%n]);
 const a=shifted(0,1),b=shifted(Math.floor(n/2),1),c=shifted(Math.floor(n/3),-1),d=shifted((Math.floor(n/3)+Math.floor(n/2))%Math.max(1,n),-1);
 const interleave=(x,y)=>x.flatMap((v,i)=>[v,y[i]]);const parity=t.frames.map((f,i)=>({f,i})).filter(o=>o.f.kind===1).map(o=>o.i);
 return [interleave(a,b),parity,interleave(c,d)].filter(s=>s.length);
}
export {finderCenters};
