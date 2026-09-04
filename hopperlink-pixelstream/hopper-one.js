(() => {
'use strict';
const MANIFEST='./hopper-one.runtime.json?v=1202';
const fatal=error=>{
  console.error('HopperLink ONE boot failed',error);
  const host=document.getElementById('engineStatus');
  if(host){host.className='status-pill error';host.innerHTML='<b></b> MOTOR NO INICIADO';}
  const log=document.getElementById('flightLog');
  if(log)log.textContent='Error cargando HopperCore ONE: '+(error?.message||String(error));
};
const digest=async bytes=>{
  if(!crypto?.subtle)return null;
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash),value=>value.toString(16).padStart(2,'0')).join('');
};
const decodeBase64=text=>{
  const binary=atob(text.replace(/\s+/g,'')),bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
};
const gunzip=async bytes=>{
  if(typeof DecompressionStream!=='function')throw new Error('Este navegador no ofrece DecompressionStream para iniciar HopperCore ONE.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
(async()=>{
  const response=await fetch(MANIFEST,{cache:'no-store'});
  if(!response.ok)throw new Error(`Runtime manifest ${response.status}`);
  const manifest=await response.json(),pieces=[];
  for(const path of manifest.parts){
    const part=await fetch(`${path}?v=${manifest.build}`,{cache:'no-store'});
    if(!part.ok)throw new Error(`Runtime bundle ${path} ${part.status}`);
    pieces.push((await part.text()).trim());
  }
  const sourceBytes=await gunzip(decodeBase64(pieces.join('')));
  if(sourceBytes.length!==manifest.bytes)throw new Error(`Runtime bytes ${sourceBytes.length} != ${manifest.bytes}`);
  const actual=await digest(sourceBytes);
  if(actual&&actual!==manifest.sha256)throw new Error('Runtime SHA-256 mismatch');
  const source=new TextDecoder().decode(sourceBytes);
  if(source.length!==manifest.length)throw new Error(`Runtime length ${source.length} != ${manifest.length}`);
  (0,eval)(source+'\n//# sourceURL=hopper-one-runtime-v1200.js');
})().catch(fatal);
})();
