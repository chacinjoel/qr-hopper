(() => {
'use strict';

const S=window.__hopperHPS8Sonic,F=window.__hopperHPS8Fountain;
if(!S||!F){console.error('HPS8 diagnostics dependencies missing');return;}
const $=id=>document.getElementById(id);
const DTYPE={PING:5,PONG:6,EXACT:7};
const nativeSend=S.send.bind(S),nativeStart=S.startListener.bind(S),nativeStop=S.stopListener.bind(S);
const state={session:null,listener:false,lastTx:'—',lastRx:'—',validRx:0,exactTx:0,exactRx:0,autoRepairTx:0,e2ePass:0,armed:false,requestAt:0,preMissing:null,lastMissing:null,lastExact:null,retries:0,ping:null,result:'NO PROBADO',note:'Inicia HPS8 y espera LOCK para probar el canal físico.'};
let retryTimer=null,pingTimer=null;

function num(id){const n=Number((($(id)?.textContent)||'').replace(/[^0-9]/g,''));return Number.isFinite(n)?n:0;}
function role(){const p=$('phaseStatus')?.textContent||'';return /RECEPTOR/.test(p)?'RECEPTOR':/EMISOR/.test(p)?'EMISOR':'—';}
function typeName(t){if(t===S.type.ACK)return'ACK';if(t===S.type.PROGRESS)return'PROGRESS';if(t===S.type.BLOOM)return'BLOOM';if(t===S.type.COMPLETE)return'COMPLETE';if(t===DTYPE.PING)return'PING';if(t===DTYPE.PONG)return'PONG';if(t===DTYPE.EXACT)return'EXACT-NACK';return`TYPE ${t}`;}
function setText(id,v){const e=$(id);if(e&&e.textContent!==String(v))e.textContent=String(v);}
function render(){
  setText('sonicDiagRole',role());setText('sonicDiagSession',state.session==null?'—':`0x${(state.session>>>0).toString(16)}`);
  setText('sonicDiagListener',state.listener?'ACTIVO':'—');setText('sonicDiagLastTx',state.lastTx);setText('sonicDiagLastRx',state.lastRx);
  setText('sonicDiagValid',state.validRx);setText('sonicDiagExact',`${state.exactRx} RX / ${state.exactTx} TX`);setText('sonicDiagRepairTx',state.autoRepairTx);
  setText('sonicDiagResult',state.result);setText('sonicDiagNote',state.note);
  const b=$('sonicPingTest');if(b)b.disabled=!state.session||role()!=='RECEPTOR'||!!state.ping;
  const a=$('autoRepairArm');if(a){a.disabled=!state.session||role()!=='RECEPTOR';a.textContent=state.armed?'Prueba Auto-Repair armada ✓':'Armar prueba Auto-Repair';}
}
function putVar(out,n){n>>>=0;while(n>=128){out.push((n&127)|128);n>>>=7;}out.push(n);}
function getVar(a,st){let n=0,s=0;while(st.p<a.length&&s<=28){const b=a[st.p++];n|=(b&127)<<s;if(!(b&128))return n>>>0;s+=7;}throw new Error('varint');}
function encodeExact(actualMissing,ids){const sorted=Array.from(new Set(ids)).sort((a,b)=>a-b),out=[(actualMissing>>>8)&255,actualMissing&255];putVar(out,sorted.length);let prev=-1;for(const idx of sorted){putVar(out,idx-prev-1);prev=idx;}return new Uint8Array(out);}
function decodeExact(p){if(!p||p.length<3)return null;const actualMissing=(p[0]<<8)|p[1],st={p:2},n=getVar(p,st),ids=[];let prev=-1;for(let i=0;i<n;i++){const idx=prev+1+getVar(p,st);ids.push(idx);prev=idx;}return{actualMissing,ids};}
function currentMissing(){return num('rxMissing');}
function currentTotal(){return num('rxTotal');}
function markRequest(label,payload,session,missing,candidates,retryExact=false){state.session=session;state.requestAt=performance.now();state.preMissing=currentMissing()||missing;state.lastMissing=state.preMissing;state.lastExact=retryExact?{label,payload,session,missing,candidates}:null;state.retries=0;state.result=state.armed?'PRUEBA E2E EN CURSO':'AUTO-REPAIR EN CURSO';state.note=`Solicitud ${label}: déficit ${state.preMissing}. Esperando que Lane A reduzca el déficit.`;render();if(retryExact)scheduleRetry();}
function scheduleRetry(){clearTimeout(retryTimer);if(!state.lastExact)return;retryTimer=setTimeout(async()=>{const nowMissing=currentMissing();if(!state.requestAt||nowMissing<state.preMissing)return;if(state.retries>=2){state.result='AUTO-REPAIR NO CONFIRMADO';state.note='Sonic envió la solicitud pero el déficit no bajó tras 3 intentos. Fountain continúa; revisa RX/TX Sonic y Lane A.';render();return;}state.retries++;state.note=`Sin avance tras Auto-Repair · reintento acústico ${state.retries}/2…`;render();try{await nativeSend(DTYPE.EXACT,state.lastExact.session,state.lastExact.payload,{repeats:2,label:`EXACT RETRY ${state.retries}`});scheduleRetry();}catch(e){state.note=`Reintento Sonic falló: ${e.message}`;render();}},12000);}

S.send=async function(type,session,payload,opts={}){
  state.session=session;state.lastTx=typeName(type);render();
  if(type===S.type.BLOOM){
    const p=S.parseBloom(payload),total=currentTotal();
    if(p&&total>0){
      const candidates=F.candidatesFromBloom(total,p.bloom,3);
      if(p.missing<=12&&candidates.length>0&&candidates.length<=28){
        const exact=encodeExact(p.missing,candidates);
        if(exact.length<=64){state.exactTx++;state.lastTx=`EXACT ${p.missing}→${candidates.length}`;markRequest('EXACT-NACK',exact,session,p.missing,candidates,true);return nativeSend(DTYPE.EXACT,session,exact,{...opts,repeats:2,label:`EXACT ${p.missing}`});}
      }
      markRequest('BLOOM',payload,session,p.missing,candidates,false);
    }
  }
  return nativeSend(type,session,payload,opts);
};

S.startListener=async function(onMessage){
  return nativeStart(async msg=>{
    state.session=msg.session;state.lastRx=typeName(msg.type);render();
    if(msg.type===DTYPE.PING){
      const payload=msg.payload?.slice?.()||new Uint8Array(0);state.note='PING físico recibido. Preparando PONG…';render();
      setTimeout(()=>nativeSend(DTYPE.PONG,msg.session,payload,{repeats:1,label:'DIAG PONG'}).catch(()=>{}),3000);return;
    }
    if(msg.type===DTYPE.PONG){
      if(state.ping&&msg.session===state.ping.session){clearTimeout(pingTimer);state.result='SONIC IDA/VUELTA ✓';state.note='PING llegó al otro teléfono y PONG regresó con CRC Sonic válido.';state.ping=null;render();nativeStop();}
      return;
    }
    if(msg.type===DTYPE.EXACT){
      let e=null;try{e=decodeExact(msg.payload);}catch{}if(!e)return;
      state.exactRx++;state.lastRx=`EXACT ${e.actualMissing}→${e.ids.length}`;state.note=`EXACT-NACK recibido: ${e.ids.length} candidato(s). Entregando a Auto-Repair de HPS8.`;render();
      const bloom=F.makeBloom(e.ids,16,3),synthetic={...msg,type:S.type.BLOOM,payload:S.bloomPayload(e.actualMissing,bloom)};
      try{onMessage?.(synthetic);}catch(err){console.error(err);}return;
    }
    try{onMessage?.(msg);}catch(err){console.error(err);}
  });
};

const originalStop=S.stopListener;
S.stopListener=function(){state.listener=false;render();return originalStop.call(S);};
window.addEventListener('hopper:hps8-sonic-listener-ready',e=>{state.listener=true;state.note=`Mic DSP activo · ${e.detail?.sampleRate||'—'} Hz · ${((e.detail?.frequencies||[])[0]||18000)/1000}-${(((e.detail?.frequencies||[]).slice(-1)[0])||19500)/1000} kHz`;render();});
window.addEventListener('hopper:hps8-sonic-tx',e=>{state.session=e.detail?.session??state.session;state.lastTx=typeName(e.detail?.type);render();});
window.addEventListener('hopper:hps8-sonic-rx',e=>{state.session=e.detail?.session??state.session;state.lastRx=`${typeName(e.detail?.type)} · CRC OK`;state.validRx++;render();});

function watchMeta(){const m=$('streamMeta');if(!m)return;new MutationObserver(()=>{const t=m.textContent||'';const x=t.match(/AUTO-REPAIR\s+(\d+)/i);if(x){state.autoRepairTx++;state.result=state.armed?'LANE A AUTO-REPAIR ✓':'AUTO-REPAIR TX';state.note=`El emisor está retransmitiendo sistemáticamente el bloque ${x[1]} por Lane A.`;render();}}).observe(m,{childList:true,characterData:true,subtree:true});}
function enforceTrueCompletion(){
  const f=$('hps8Fountain'),p=$('hps8Percent'),bar=$('hps8FileBar');if(!f||!p)return;const m=(f.textContent||'').match(/(\d+)\s*\/\s*(\d+)/);if(!m)return;const known=Number(m[1]),total=Number(m[2]),complete=/HPS8 COMPLETE|CRC verificado|Receptor confirmó CRC/i.test(($('phaseStatus')?.textContent||'')+' '+($('hps8ProgressStatus')?.textContent||''));if(total>0&&known<total&&!complete){if(p.textContent==='100%')p.textContent='99.9%';if(bar&&parseFloat(bar.style.width)>=100)bar.style.width='99.9%';if($('hps8ProgressStatus')&&known===total-1)$('hps8ProgressStatus').textContent='Último bloque pendiente · verificando / Auto-Repair';}
}
function watchMissing(){const e=$('rxMissing');if(!e)return;new MutationObserver(()=>{const n=currentMissing();if(state.lastMissing==null)state.lastMissing=n;if(state.requestAt&&state.preMissing!=null&&n<state.preMissing){clearTimeout(retryTimer);state.e2ePass++;state.result='AUTO-REPAIR E2E ✓';state.note=`Déficit bajó ${state.preMissing} → ${n} después de la solicitud Sonic. Control acústico + Lane A confirmados físicamente.`;state.requestAt=0;state.preMissing=n;state.lastExact=null;state.armed=false;}state.lastMissing=n;enforceTrueCompletion();render();}).observe(e,{childList:true,characterData:true,subtree:true});}
async function pingTest(){
  if(!state.session||role()!=='RECEPTOR')return;const nonce=crypto.getRandomValues(new Uint32Array(1))[0]>>>0,payload=new Uint8Array([(nonce>>>24)&255,(nonce>>>16)&255,(nonce>>>8)&255,nonce&255]);state.ping={session:state.session,nonce};state.result='PROBANDO SONIC…';state.note='Enviando PING near-ultrasonic; luego el receptor abrirá micrófono para esperar PONG.';render();try{await nativeSend(DTYPE.PING,state.session,payload,{repeats:1,label:'DIAG PING'});await S.startListener(()=>{});pingTimer=setTimeout(()=>{if(!state.ping)return;state.result='SONIC SIN RESPUESTA';state.note='No regresó PONG válido. Revisa permisos, volumen, distancia y si el emisor muestra SONIC ESCUCHANDO.';state.ping=null;render();nativeStop();},10000);}catch(e){state.result='SONIC TEST ERROR';state.note=e.message;state.ping=null;render();}
}
function armAutoRepair(){state.armed=true;state.result='PRUEBA AUTO-REPAIR ARMADA';state.note='Esperando un STALL real. Cuando HPS8 genere Bloom/EXACT, solo aprobará si después disminuye rxMissing.';render();}
function install(){
  $('sonicPingTest')?.addEventListener('click',pingTest);$('autoRepairArm')?.addEventListener('click',armAutoRepair);watchMeta();watchMissing();
  const p=$('hps8Percent'),f=$('hps8Fountain');if(p)new MutationObserver(enforceTrueCompletion).observe(p,{childList:true,characterData:true,subtree:true});if(f)new MutationObserver(enforceTrueCompletion).observe(f,{childList:true,characterData:true,subtree:true});
  setInterval(()=>{enforceTrueCompletion();render();},500);render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
window.__hopperHPS8Diagnostics={version:'0.10.1',active:true,pingPong:true,exactNack:true,endToEndAutoRepair:true,trueCompletionGuard:true,encodeExact,decodeExact,state};
})();
