import {packPacket} from './protocol.js?v=qf08';
function xorshift(x){x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;}
function seedFor(session,seq,codeIndex=0){let x=(session^Math.imul((seq+1)>>>0,0x9e3779b1)^Math.imul(codeIndex+1,0x85ebca6b))>>>0;return xorshift(x||1)||1;}
const degreeCache=new Map();
function degreeCdf(k){let hit=degreeCache.get(k);if(hit)return hit;const max=Math.min(k,64),rho=new Float64Array(max+1),tau=new Float64Array(max+1);rho[1]=1/k;for(let d=2;d<=max;d++)rho[d]=1/(d*(d-1));const delta=.5,c=.1,R=c*Math.log(Math.max(2,k/delta))*Math.sqrt(k),m=Math.max(1,Math.min(max,Math.floor(k/Math.max(1,R))));for(let d=1;d<m;d++)tau[d]=R/(d*k);tau[m]=R*Math.log(Math.max(1.000001,R/delta))/k;let z=0;for(let d=1;d<=max;d++)z+=rho[d]+tau[d];const cdf=new Float64Array(max+1);let sum=0;for(let d=1;d<=max;d++){sum+=(rho[d]+tau[d])/z;cdf[d]=sum;}cdf[max]=1;degreeCache.set(k,cdf);return cdf;}
function degreeFrom(seed,k){const cdf=degreeCdf(k),u=(seed>>>0)/4294967296;for(let d=1;d<cdf.length;d++)if(u<=cdf[d])return d;return cdf.length-1;}
export function chooseIndices(k,degree,seed){const out=[],seen=new Set();let x=seed>>>0||1;while(out.length<degree){x=xorshift(x);const i=x%k;if(!seen.has(i)){seen.add(i);out.push(i);}}return out;}
function xorInto(dst,src){for(let i=0;i<dst.length;i++)dst[i]^=src[i];}

// 4 direct source blocks + 1 fountain repair. This keeps Fountain rateless
// protection while guaranteeing an immediate decoding ripple on real cameras.
const GROUP=5,SYSTEMATIC=4;
export function framePlan(seq,k){
  const pos=seq%GROUP;
  if(pos<SYSTEMATIC){
    const ordinal=Math.floor(seq/GROUP)*SYSTEMATIC+pos;
    return{systematic:true,index:ordinal%k};
  }
  return{systematic:false,index:-1};
}

export class FountainEncoder{
 constructor(stream,blockLen,session){if(!(stream instanceof Uint8Array))throw Error('stream');this.stream=stream;this.blockLen=blockLen;this.session=session>>>0||1;this.k=Math.ceil(stream.length/blockLen);this.blocks=Array.from({length:this.k},(_,i)=>{const b=new Uint8Array(blockLen);b.set(stream.subarray(i*blockLen,Math.min(stream.length,(i+1)*blockLen)));return b;});}
 frame(seq,codeIndex=0){
   seq>>>=0;
   const plan=framePlan(seq,this.k);
   if(plan.systematic){
     const index=plan.index,payload=this.blocks[index].slice(),seed=index>>>0,degree=1;
     return packPacket({session:this.session,seq,k:this.k,blockLen:this.blockLen,totalLen:this.stream.length,degree,seed,payload,systematic:true,codeIndex});
   }
   const seed=seedFor(this.session,seq,codeIndex),degree=degreeFrom(seed,this.k),indices=chooseIndices(this.k,degree,seed),payload=new Uint8Array(this.blockLen);
   for(const i of indices)xorInto(payload,this.blocks[i]);
   return packPacket({session:this.session,seq,k:this.k,blockLen:this.blockLen,totalLen:this.stream.length,degree,seed,payload,systematic:false,codeIndex});
 }
}
export class FountainDecoder{
 constructor(header){this.session=header.session;this.k=header.k;this.blockLen=header.blockLen;this.totalLen=header.totalLen;this.solved=new Map();this.equations=[];this.seen=new Set();this.redundant=0;this.received=0;this.started=performance.now?.()??Date.now();}
 compatible(h){return h.session===this.session&&h.k===this.k&&h.blockLen===this.blockLen&&h.totalLen===this.totalLen;}
 reduce(indices,data){const left=[];for(const i of indices){const b=this.solved.get(i);if(b)xorInto(data,b);else left.push(i);}return left;}
 solve(index,data){if(this.solved.has(index))return false;this.solved.set(index,data);const queue=[index];while(queue.length){const solvedIndex=queue.shift(),solvedData=this.solved.get(solvedIndex);for(let e=this.equations.length-1;e>=0;e--){const q=this.equations[e],pos=q.indices.indexOf(solvedIndex);if(pos<0)continue;xorInto(q.data,solvedData);q.indices.splice(pos,1);if(q.indices.length===0){this.equations.splice(e,1);this.redundant++;}else if(q.indices.length===1){const [next]=q.indices,d=q.data;this.equations.splice(e,1);if(!this.solved.has(next)){this.solved.set(next,d);queue.push(next);}}}}return true;}
 ingest(packet){if(!this.compatible(packet)||this.seen.has(packet.seq))return this.progress();this.seen.add(packet.seq);this.received++;let indices=packet.systematic?[packet.seed%this.k]:chooseIndices(this.k,packet.degree,packet.seed),data=packet.payload.slice();indices=this.reduce(indices,data);if(indices.length===0){this.redundant++;return this.progress();}if(indices.length===1)this.solve(indices[0],data);else this.equations.push({indices,data});return this.progress();}
 progress(){return{solved:this.solved.size,k:this.k,ratio:this.solved.size/this.k,received:this.received,redundant:this.redundant,equations:this.equations.length,complete:this.solved.size===this.k};}
 assemble(){if(this.solved.size!==this.k)throw Error('Faltan bloques');const out=new Uint8Array(this.k*this.blockLen);for(let i=0;i<this.k;i++)out.set(this.solved.get(i),i*this.blockLen);return out.slice(0,this.totalLen);}
}
