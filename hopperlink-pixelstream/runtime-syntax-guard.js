(() => {
'use strict';

// Version-agnostic one-shot guard for the dynamically generated HPS7 core.
const NativeFunction=globalThis.Function;
let armed=true;
function GuardedFunction(...args){
  const i=args.length-1;
  if(armed&&i>=0&&typeof args[i]==='string'&&args[i].includes('hps7-core-v')){
    const bad="else showNack(p.round,suggest);}}}\nfunction controlPayloadNack";
    const good="else showNack(p.round,suggest);}}\nfunction controlPayloadNack";
    if(args[i].includes(bad)){
      args[i]=args[i].replace(bad,good);
      try{globalThis.dispatchEvent(new CustomEvent('hopper:runtime-syntax-fixed',{detail:{version:'generic-v096'}}));}catch{}
    }
    armed=false;
    globalThis.Function=NativeFunction;
  }
  return NativeFunction(...args);
}
try{
  Object.setPrototypeOf(GuardedFunction,NativeFunction);
  GuardedFunction.prototype=NativeFunction.prototype;
  globalThis.Function=GuardedFunction;
}catch(e){console.error('HopperLink runtime syntax guard failed to arm',e);}
globalThis.__hopperRuntimeSyntaxGuard={version:'generic-v096',armed:true};
})();
