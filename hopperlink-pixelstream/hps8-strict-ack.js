(() => {
'use strict';
const S=window.__hopperHPS8Sonic;
if(!S){console.error('HPS8 Strict ACK: Sonic modem missing');return;}
const VERSION='0.10.12';
const nativeStart=S.startListener.bind(S);
let accepted=0,rejected=0;
function emit(name,detail={}){try{window.dispatchEvent(new CustomEvent(`hopper:hps8-${name}`,{detail:{...detail,version:VERSION}}));}catch{}}
function validAck(msg){
  if(!msg||msg.type!==S.type.ACK)return false;
  if(msg.ok!==true||msg.headerOnly===true||msg.earlyAck===true)return false;
  const p=msg.payload;
  return !!p&&p.length===1&&p[0]===1;
}
S.startListener=async function(onMessage){
  return nativeStart(msg=>{
    if(msg?.type===S.type.ACK){
      if(!validAck(msg)){
        rejected++;
        emit('ack-rejected',{reason:msg?.headerOnly?'HEADER_ONLY':'CRC_OR_PAYLOAD',headerOnly:!!msg?.headerOnly,earlyAck:!!msg?.earlyAck,session:msg?.session??null});
        return;
      }
      accepted++;
      msg.strictAck=true;
      emit('ack-validated',{session:msg.session,profile:msg.profile||null,crcVerified:true});
    }
    try{onMessage?.(msg);}catch(e){console.error(e);}
  });
};
S.strictAckOnly=true;
S.strictAckVersion=VERSION;
window.__hopperHPS8StrictAck={version:VERSION,active:true,fullCrcRequired:true,headerOnlyRejected:true,startLockCannotStartData:true,ackPayload:[1],state:()=>({accepted,rejected})};
})();
