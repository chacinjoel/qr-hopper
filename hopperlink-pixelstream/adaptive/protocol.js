import {crc32} from '../src/crc32.js?v=rxfix2';
import {buildFrameSchedule} from '../src/superstream.js?v=rxfix2';
import {gridSpec, finderCenters} from '../src/optical2.js?v=rxfix2';

export const BUILD='adaptive-2.0.2-rxfix2';
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

// id, palette, grid, symbols/s, RS k, RS r, label, recoverable spatial sectors.
// IDs 7/8/10 are intentionally the throughput candidates used by the existing
// full calibration plan, so the negotiation state machine does not need a new
// backwards-incompatible profile selector.
const definitions=[
 [0,0,'64x96',8,6,3,'Control B/N',1],
 [1,1,'64x96',15,6,3,'4 colores · 64×96 · 15/s',1],
 [2,2,'64x96',15,8,2,'8 colores · 64×96 · 15/s',1],
 [3,3,'64x96',15,10,2,'16 colores · 64×96 · 15/s',1],
 [4,4,'64x96',20,6,3,'4 colores alternos · 20/s',1],
 [5,1,'72x112',20,6,3,'4 colores · 72×112 · 20/s',1],
 [6,2,'72x112',20,8,2,'8 colores · 72×112 · 20/s',1],
 [7,3,'112x176',30,12,2,'16 colores · 112×176 · 30/s · 8 sectores',8],
 [8,2,'128x200',30,12,2,'8 colores · 128×200 · 30/s · 8 sectores',8],
 [9,0,'64x96',15,6,3,'B/N · 64×96 · 15/s',1],
 [10,3,'128x200',30,14,2,'16 colores · 128×200 · 30/s · 8 sectores',8]
];

export function isReservedCell(p,x,y){return finderCenters(p).some(c=>Math.abs(x+.5-c.x)<p.finder/2+2&&Math.abs(y+.5-c.y)<p.finder/2+2);}

function buildSpatialSectors(p,count){
 if(count<=1)return [{cells:p.cells,dataBytes:p.payloadBytes,offset:0}];
 const columns=4,rows=Math.ceil(count/columns),sets=Array.from({length:count},()=>[]);
 const width=Math.max(1,p.right-p.left),height=Math.max(1,p.payloadBottom-p.payloadTop);
 for(const cell of p.cells){
  const [x,y]=cell,bx=Math.min(columns-1,Math.max(0,Math.floor((x-p.left)/width*columns))),by=Math.min(rows-1,Math.max(0,Math.floor((y-p.payloadTop)/height*rows))),i=Math.min(count-1,by*columns+bx);sets[i].push(cell);
 }
 // Every physical region must be able to carry every logical sector because
 // repetitions rotate sectors spatially. Use the smallest capacity to keep
 // the mapping symmetric and deterministic.
 const bytes=Math.min(...sets.map(cells=>Math.floor(cells.length*p.bits/8)-2));
 if(bytes<32)throw Error('Sector óptico demasiado pequeño');
 return sets.map((cells,i)=>({cells,dataBytes:bytes,offset:i*bytes}));
}

export const PROFILES=definitions.map(([id,paletteId,grid,fps,k,r,name,sectorCount=1])=>{
 const bits=Math.log2(PALETTES[paletteId].length),p={...gridSpec(grid,2),id,paletteId,bits,grid,fps,k,r,name,sectorCount,key:bits<=2?'robust':bits===3?'balanced':'turbo'};
 p.headerRows=14;p.payloadTop=p.top+p.headerRows+p.syncRows+p.calRows;p.payloadBottom=p.bottom-2;
 p.cells=[];p.pilots=[];p.headerCells=[];
 for(let y=p.top;y<p.top+p.headerRows;y++)for(let x=p.left;x<p.right;x++)if(!isReservedCell(p,x,y))p.headerCells.push([x,y]);
 for(let y=p.top+p.headerRows+p.syncRows;y<p.bottom;y++)for(let x=p.left;x<p.right;x++){
  if(isReservedCell(p,x,y))continue;
  if(y<p.payloadTop||y>=p.payloadBottom||x<p.left+2||x>=p.right-2)p.pilots.push([x,y,(x+y)%PALETTES[paletteId].length]);else p.cells.push([x,y]);
 }
 p.payloadCells=p.cells.length;p.payloadBytes=Math.floor(p.cells.length*bits/8);
 p.sectors=buildSpatialSectors(p,sectorCount);p.sectorBytes=p.sectors[0].dataBytes;
 if(sectorCount>1)p.payloadBytes=p.sectors.reduce((n,s)=>n+s.dataBytes,0);
 if(p.headerCells.length<HEADER_BYTES*8)throw Error('Cabecera sin espacio');
 return Object.freeze(p);
});

export const CATALOG_HASH=crc32(new TextEncoder().encode(JSON.stringify({definitions,PALETTES,layout:3,header:40,pilotCollar:2,headerRows:14,sectorCrc16:true,earlyParity:true})));
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
export function decodeReport(text,sid){if(typeof text!=='string'||text.length>2200||!text.startsWith('HAC1:'))return null;const cut=text.lastIndexOf(':'),s=text.slice(5,cut);if(crc32(new TextEncoder().encode(s)).toString(16).padStart(8,'0')!==text.slice(cut+1))return null;try{const r=JSON.parse(s);if(r.sid!==sid||r.catalog!==CATALOG_HASH||!PROFILES[r.chosen]||r.chosen===0||!PROFILES[r.fallback]||!Number.isInteger(r.epoch)||r.epoch<1||!Number.isInteger(r.fingerprint))return null;return r;}catch{return null;}}
export function randomBytes(length,seed){const b=new Uint8Array(length);let x=seed>>>0||1;for(let i=0;i<length;i++){x^=x<<13;x^=x>>>17;x^=x<<5;b[i]=x>>>24;}return b;}
export function trialSeed(sid,pid,round){return(sid^Math.imul(pid+1,0x9e3779b1)^Math.imul(round+1,0x85ebca77))>>>0;}

// Progressive redundancy: the first schedule contains every systematic block
// once plus parity, so FEC is available immediately. Three offset systematic
// passes are only consumed if COMPLETE has not stopped the sender yet.
export function fourOpportunitySchedules(t){
 return [
  buildFrameSchedule(t,{pass:0}),
  buildFrameSchedule(t,{dataOnly:true,pass:1}),
  buildFrameSchedule(t,{dataOnly:true,pass:2}),
  buildFrameSchedule(t,{dataOnly:true,pass:3})
 ].filter(s=>s.length);
}

export {finderCenters};
