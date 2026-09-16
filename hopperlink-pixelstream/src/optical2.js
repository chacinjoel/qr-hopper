import { crc32 } from './crc32.js';

export const PROFILES={
  robust:{id:1,name:'Robusto',bits:2,k:6,r:3,efficiency:.60},
  balanced:{id:2,name:'Balanceado',bits:3,k:8,r:2,efficiency:.72},
  turbo:{id:3,name:'Turbo',bits:4,k:10,r:2,efficiency:.78}
};
export const GRIDS=['64x96','72x112','84x132','96x152','112x176'];
export const HDP={version:2,quiet:2,guard:2,finder:10,discoverySize:18,headerRows:10,syncRows:2,calRows:2,beaconEvery:18,beaconHoldMs:120,discoveryMs:1800};
export const BEACON_COLORS=['#ff00ff','#00ffff','#ffff00','#00ff00'];
const PALETTES={
  2:['#151921','#f4f7ff','#2c79ff','#ff5a32'],
  3:['#171a20','#f5f7ff','#ff3b3b','#45d36b','#376dff','#ffc83a','#c547ff','#35c8d5'],
  4:['#11151d','#f8f9ff','#ff334f','#52d878','#3c7cff','#ffd34a','#b94cff','#45c6d5','#ff8a2e','#7b58ff','#8bcf3f','#ff6fae','#41a7ff','#b8d95d','#ffc0e7','#7f94a8']
};
function parseHex(h){const n=parseInt(h.slice(1),16);return[(n>>16)&255,(n>>8)&255,n&255];}
export function getPalette(bits){return PALETTES[bits].map(parseHex);}
export function chooseProfile(mode){if(PROFILES[mode])return {...PROFILES[mode],key:mode};return {...PROFILES.robust,key:'robust'};}
export function finderPositions(p){const m=p.quiet+p.guard,f=p.finder;return [[m,m],[p.cols-m-f,m],[p.cols-m-f,p.rows-m-f],[m,p.rows-m-f]];}
export function finderCenters(p){return finderPositions(p).map(([x,y])=>({x:x+p.finder/2,y:y+p.finder/2}));}
export function isReservedCell(p,x,y){for(const [fx,fy] of finderPositions(p)){if(x>=fx&&x<fx+p.finder&&y>=fy&&y<fy+p.finder)return true;}return false;}
export function gridSpec(grid,bits){const [cols,rows]=grid.split('x').map(Number),quiet=HDP.quiet,guard=HDP.guard,finder=HDP.finder,headerRows=HDP.headerRows,syncRows=HDP.syncRows,calRows=HDP.calRows,left=quiet+guard,right=cols-quiet-guard,top=quiet+guard,bottom=rows-quiet-guard,payloadTop=top+headerRows+syncRows+calRows,payloadBottom=bottom;let payloadCells=0;const base={cols,rows,quiet,guard,finder};for(let y=payloadTop;y<payloadBottom;y++)for(let x=left;x<right;x++)if(!isReservedCell(base,x,y))payloadCells++;return{...base,headerRows,syncRows,calRows,left,right,top,bottom,payloadTop,payloadBottom,payloadCells,payloadBytes:Math.max(64,Math.floor(payloadCells*bits/8)-48)};}
export function resolveProfile(mode,grid){const p=chooseProfile(mode),spec=gridSpec(grid,p.bits);return {...p,...spec,payloadBytes:spec.payloadBytes};}
function writeU32(a,o,v){new DataView(a.buffer).setUint32(o,v>>>0);}function writeU16(a,o,v){new DataView(a.buffer).setUint16(o,v&65535);}
export function buildHeader(frame,transport,p,seq,total){const h=new Uint8Array(38);h.set([0x48,0x44,0x50,0x32],0);h[4]=HDP.version;h[5]=p.id;h[6]=p.bits;h[7]=frame.kind;writeU32(h,8,seq);writeU32(h,12,total);writeU16(h,16,frame.group);h[18]=frame.slot;h[19]=transport.k;h[20]=transport.r;writeU32(h,21,transport.streamLength);writeU16(h,25,frame.payload.length);h[27]=p.cols;h[28]=p.rows;writeU32(h,29,crc32(frame.payload));h[33]=p.finder;h[34]=p.quiet;h[35]=p.guard;h[36]=HDP.version;h[37]=0xD4;return h;}
function bytesToBits(bytes){const out=[];for(const b of bytes)for(let i=7;i>=0;i--)out.push((b>>i)&1);return out;}
function symbolValues(bytes,bitsPer){const out=[];let buf=0,n=0;for(const b of bytes){buf=(buf<<8)|b;n+=8;while(n>=bitsPer){n-=bitsPer;out.push((buf>>n)&((1<<bitsPer)-1));buf&=(1<<n)-1;}}if(n)out.push((buf<<(bitsPer-n))&((1<<bitsPer)-1));return out;}
function drawGlyph(cell,cx,cy,size,idx,phase){const half=Math.floor(size/2),white=phase%2?'#ffffff':'#d9d9d9';if(idx===0){for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)cell(cx+x,cy+y,white);}else if(idx===1){for(let x=-3;x<=3;x++){cell(cx+x,cy-1,white);cell(cx+x,cy,white);cell(cx+x,cy+1,white);}}else if(idx===2){for(let y=-3;y<=3;y++){cell(cx-1,cy+y,white);cell(cx,cy+y,white);cell(cx+1,cy+y,white);}}else{for(let i=-3;i<=3;i++){cell(cx+i,cy,white);cell(cx,cy+i,white);}}}
function drawBeacon(cell,p,idx,discovery=false,phase=0){const centers=finderCenters(p),c=centers[idx],size=discovery?HDP.discoverySize:p.finder,x0=Math.round(c.x-size/2),y0=Math.round(c.y-size/2),color=BEACON_COLORS[idx];for(let y=0;y<size;y++)for(let x=0;x<size;x++)cell(x0+x,y0+y,color);const moat=Math.max(2,Math.floor(size*.22));for(let y=moat;y<size-moat;y++)for(let x=moat;x<size-moat;x++)cell(x0+x,y0+y,'#000000');drawGlyph(cell,Math.round(c.x),Math.round(c.y),size,idx,phase);}
function makeCanvas(canvas,p){const ctx=canvas.getContext('2d',{alpha:false});canvas.width=p.cols*10;canvas.height=p.rows*10;const cw=canvas.width/p.cols,ch=canvas.height/p.rows;const cell=(x,y,c)=>{if(x<0||y<0||x>=p.cols||y>=p.rows)return;ctx.fillStyle=c;ctx.fillRect(Math.floor(x*cw),Math.floor(y*ch),Math.ceil(cw+1),Math.ceil(ch+1));};ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);return{ctx,cell};}
export function renderDiscoveryFrame(canvas,p,phase=0){const {cell}=makeCanvas(canvas,p);for(let i=0;i<4;i++)drawBeacon(cell,p,i,true,phase);const cx=Math.floor(p.cols/2),cy=Math.floor(p.rows/2),on=phase%2===0;for(let d=-5;d<=5;d++){cell(cx+d,cy,on?'#fff':'#333');cell(cx,cy+d,on?'#fff':'#333');}return{phase};}
export function renderOpticalFrame(canvas,frame,transport,p,seq,total){const {cell}=makeCanvas(canvas,p),header=buildHeader(frame,transport,p,seq,total),hb=bytesToBits(header);let hi=0;for(let y=p.top;y<p.top+p.headerRows;y++)for(let x=p.left;x<p.right;x++){if(isReservedCell(p,x,y))continue;cell(x,y,hb[hi%hb.length]?'#fff':'#050505');hi++;}const syncY=p.top+p.headerRows;for(let y=syncY;y<syncY+p.syncRows;y++)for(let x=p.left;x<p.right;x++){if(isReservedCell(p,x,y))continue;cell(x,y,((x+y+seq)&1)?'#fff':'#000');}const palette=PALETTES[p.bits],calY=syncY+p.syncRows;for(let y=calY;y<calY+p.calRows;y++)for(let x=p.left;x<p.right;x++){if(isReservedCell(p,x,y))continue;cell(x,y,palette[(x-p.left)%palette.length]);}const vals=symbolValues(frame.payload,p.bits);let vi=0;for(let y=p.payloadTop;y<p.payloadBottom;y++)for(let x=p.left;x<p.right;x++){if(isReservedCell(p,x,y))continue;cell(x,y,palette[vi<vals.length?vals[vi]:0]);vi++;}for(let i=0;i<4;i++)drawBeacon(cell,p,i,false,seq);return{header,payloadCrc:crc32(frame.payload)};}
export function nearestPalette(rgb,palette){let best=0,bd=Infinity;for(let i=0;i<palette.length;i++){const p=palette[i],d=(rgb[0]-p[0])**2+(rgb[1]-p[1])**2+(rgb[2]-p[2])**2;if(d<bd){bd=d;best=i;}}return best;}
