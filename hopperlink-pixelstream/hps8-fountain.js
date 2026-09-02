(() => {
'use strict';

const VERSION='0.10.0';
function xorInto(a,b){const n=Math.min(a.length,b.length);for(let i=0;i<n;i++)a[i]^=b[i];return a;}
function xorshift(seed){let x=(seed>>>0)||0x6d2b79f5;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};}
function degreeFor(seed,count){if(count<=1)return 1;const next=xorshift((seed^0x9e3779b9)>>>0),r=next()/0x100000000;let d=r<.20?1:r<.55?2:r<.78?3:r<.92?4:5;return Math.max(1,Math.min(count,d));}
function indicesForSeed(seed,count,forcedDegree=0){if(count<=0)return[];const next=xorshift((seed^(count*0x45d9f3b))>>>0),degree=Math.max(1,Math.min(count,forcedDegree||degreeFor(seed,count))),set=new Set();while(set.size<degree)set.add(next()%count);return Array.from(set);}
function makeParity(blocks,seed,forcedDegree=0){if(!blocks?.length)throw new Error('PhotonFountain: no source blocks');const chunk=blocks[0].length,indices=indicesForSeed(seed,blocks.length,forcedDegree),data=new Uint8Array(chunk);for(const i of indices)xorInto(data,blocks[i]);return{seed:seed>>>0,degree:indices.length,indices,data};}

function createDecoder(count,chunkSize,onKnown=null){
  const known=new Array(count).fill(null),equations=new Map(),byIndex=Array.from({length:count},()=>new Set());let solved=0,eqSeq=1,queue=[],propagating=false;
  const clone=a=>a instanceof Uint8Array?a.slice():new Uint8Array(a);
  function removeEquation(id){const e=equations.get(id);if(!e)return;for(const i of e.unknown)byIndex[i].delete(id);equations.delete(id);}
  function registerEquation(indices,data){const unknown=[] , reduced=clone(data);for(const idx of indices){if(idx<0||idx>=count)return false;if(known[idx])xorInto(reduced,known[idx]);else if(!unknown.includes(idx))unknown.push(idx);}if(!unknown.length)return false;if(unknown.length===1)return addKnown(unknown[0],reduced);const id=eqSeq++,e={id,unknown:new Set(unknown),data:reduced};equations.set(id,e);for(const i of unknown)byIndex[i].add(id);return true;}
  function propagate(){if(propagating)return;propagating=true;try{while(queue.length){const idx=queue.shift(),value=known[idx],ids=Array.from(byIndex[idx]);byIndex[idx].clear();for(const id of ids){const e=equations.get(id);if(!e||!e.unknown.has(idx))continue;xorInto(e.data,value);e.unknown.delete(idx);if(!e.unknown.size){removeEquation(id);continue;}if(e.unknown.size===1){const only=e.unknown.values().next().value,data=e.data.slice();removeEquation(id);addKnown(only,data);}}}}finally{propagating=false;}}
  function addKnown(index,data){if(index<0||index>=count||known[index])return false;const v=clone(data);if(v.length!==chunkSize)throw new Error(`PhotonFountain: block ${index} size ${v.length} != ${chunkSize}`);known[index]=v;solved++;queue.push(index);try{onKnown?.(index,v,solved,count);}catch{}propagate();return true;}
  function addSystematic(index,data){return addKnown(index,data);}
  function addParity(seed,data,forcedDegree=0){const idx=indicesForSeed(seed,count,forcedDegree);return registerEquation(idx,data);}
  function addEquation(indices,data){return registerEquation(indices,data);}
  function missingIndices(){const out=[];for(let i=0;i<count;i++)if(!known[i])out.push(i);return out;}
  function snapshot(){return{known:solved,total:count,missing:count-solved,equations:equations.size,complete:solved===count};}
  function blocks(){return known.map(v=>v?.slice()||null);}
  return{addSystematic,addParity,addEquation,missingIndices,snapshot,blocks,get knownCount(){return solved;},get complete(){return solved===count;}};
}

function hash32(v,seed){let x=(v^seed)>>>0;x=Math.imul(x^(x>>>16),0x45d9f3b);x=Math.imul(x^(x>>>16),0x45d9f3b);return(x^(x>>>16))>>>0;}
function makeBloom(indices,bytes=16,k=3){const out=new Uint8Array(Math.max(4,bytes)),bits=out.length*8;for(const idx of indices)for(let j=0;j<k;j++){const h=hash32(idx>>>0,(0x9e3779b9+Math.imul(j+1,0x7f4a7c15))>>>0)%bits;out[h>>3]|=1<<(h&7);}return out;}
function bloomHas(index,bloom,k=3){const bits=bloom.length*8;for(let j=0;j<k;j++){const h=hash32(index>>>0,(0x9e3779b9+Math.imul(j+1,0x7f4a7c15))>>>0)%bits;if(!(bloom[h>>3]&(1<<(h&7))))return false;}return true;}
function candidatesFromBloom(count,bloom,k=3){const out=[];for(let i=0;i<count;i++)if(bloomHas(i,bloom,k))out.push(i);return out;}

window.__hopperHPS8Fountain={version:VERSION,xorshift,degreeFor,indicesForSeed,makeParity,createDecoder,makeBloom,bloomHas,candidatesFromBloom,xorInto};
})();
