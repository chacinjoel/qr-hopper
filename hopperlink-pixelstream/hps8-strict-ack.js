(() => {
'use strict';
const S=window.__hopperHPS8Sonic;
if(!S){console.error('HPS8 Optical Proof ACK: Sonic modem missing');return;}

const VERSION='0.10.13';
const MARKER=0xA8,PROOF_VERSION=1,PROOF_BYTES=8;
const nativeStart=S.startListener.bind(S),nativeSend=S.send.bind(S);
const enc=new TextEncoder();
let accepted=0,rejected=0,proofTx=0,proofMismatch=0,identityMissing=0;

function $(id){return document.getElementById(id);}
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-${name}`,{detail:{...detail,version:VERSION}}));}catch{}}
function numericText(id){const m=(($(id)?.textContent)||'').match(/\d+/g);return m?.length?Number(m[m.length-1]):0;}
function localOpticalIdentity(){
  const file=$('fileInput')?.files?.[0]||null;
  if(file){
    const sourceCount=numericText('frameCount');
    if(file.name&&sourceCount>0)return{name:file.name,sourceCount,source:'sender-prepared'};
  }
  const name=(($('hps8FileName')?.textContent)||'').trim();
  const fountain=(($('hps8Fountain')?.textContent)||'').match(/(\d+)\s*\/\s*(\d+)/);
  const sourceCount=fountain?Number(fountain[2]):0;
  if(name&&name!=='Sin transferencia'&&name!=='Esperando archivo HPS8'&&sourceCount>0)return{name,sourceCount,source:'receiver-optical-lock'};
  return null;
}
function fallbackDigest(bytes){
  let a=0x811c9dc5>>>0,b=0x9e3779b9>>>0;
  for(const x of bytes){a=Math.imul((a^x)>>>0,0x01000193)>>>0;b=(Math.imul((b+x)>>>0,0x85ebca6b)^(b>>>13))>>>0;}
  return Uint8Array.from([(a>>>24)&255,(a>>>16)&255,(a>>>8)&255,a&255,(b>>>24)&255,(b>>>16)&255,(b>>>8)&255,b&255]);
}
async function proofFor(session,identity){
  const canonical=`HPS8|OPTICAL-ACK|${PROOF_VERSION}|${session>>>0}|${identity.sourceCount>>>0}|${identity.name}`;
  const bytes=enc.encode(canonical);
  try{
    if(globalThis.crypto?.subtle){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));return d.slice(0,PROOF_BYTES);}
  }catch{}
  return fallbackDigest(bytes).slice(0,PROOF_BYTES);
}
function makePayload(proof){const out=new Uint8Array(2+PROOF_BYTES);out[0]=MARKER;out[1]=PROOF_VERSION;out.set(proof,2);return out;}
function equalBytes(a,b){if(!a||!b||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0;}
function fullCrcAck(msg){return !!msg&&msg.type===S.type.ACK&&msg.ok===true&&msg.headerOnly!==true&&msg.earlyAck!==true;}

S.send=async function(type,session,payload,opts={}){
  if(type!==S.type.ACK)return nativeSend(type,session,payload,opts);
  const identity=localOpticalIdentity();
  if(!identity){identityMissing++;emit('ack-proof-tx-blocked',{session,reason:'NO_OPTICAL_IDENTITY'});throw new Error('ACK bloqueado: todavía no existe identidad del HELLO óptico');}
  const proof=await proofFor(session,identity),bound=makePayload(proof);proofTx++;
  emit('ack-proof-tx',{session,sourceCount:identity.sourceCount,name:identity.name,source:identity.source,proofBytes:PROOF_BYTES});
  return nativeSend(type,session,bound,{...opts,label:'ACK OPTICAL PROOF'});
};

S.startListener=async function(onMessage){
  return nativeStart(async msg=>{
    if(msg?.type===S.type.ACK){
      if(!fullCrcAck(msg)){
        rejected++;
        emit('ack-rejected',{reason:msg?.headerOnly?'HEADER_ONLY':'NO_FULL_CRC',headerOnly:!!msg?.headerOnly,earlyAck:!!msg?.earlyAck,session:msg?.session??null});
        return;
      }
      const p=msg.payload,identity=localOpticalIdentity();
      if(!identity){identityMissing++;rejected++;emit('ack-rejected',{reason:'NO_LOCAL_OPTICAL_IDENTITY',session:msg.session});return;}
      if(!p||p.length!==2+PROOF_BYTES||p[0]!==MARKER||p[1]!==PROOF_VERSION){rejected++;emit('ack-rejected',{reason:'BAD_PROOF_FORMAT',session:msg.session,payloadLength:p?.length??0});return;}
      const expected=await proofFor(msg.session,identity),actual=p.slice(2);
      if(!equalBytes(expected,actual)){
        proofMismatch++;rejected++;
        emit('ack-rejected',{reason:'OPTICAL_PROOF_MISMATCH',session:msg.session,sourceCount:identity.sourceCount,name:identity.name});
        return;
      }
      accepted++;msg.strictAck=true;msg.opticalProofAck=true;msg.proofVersion=PROOF_VERSION;
      emit('ack-validated',{session:msg.session,profile:msg.profile||null,crcVerified:true,opticalProof:true,sourceCount:identity.sourceCount,name:identity.name});
    }
    try{onMessage?.(msg);}catch(e){console.error(e);}
  });
};

S.strictAckOnly=true;
S.strictAckVersion=VERSION;
S.opticalProofAck=true;
window.__hopperHPS8StrictAck={
  version:VERSION,active:true,fullCrcRequired:true,headerOnlyRejected:true,startLockCannotStartData:true,
  opticalProofRequired:true,proofBytes:PROOF_BYTES,proofVersion:PROOF_VERSION,proofFor,localOpticalIdentity,
  state:()=>({accepted,rejected,proofTx,proofMismatch,identityMissing})
};
})();