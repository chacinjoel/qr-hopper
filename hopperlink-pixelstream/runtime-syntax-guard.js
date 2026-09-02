(() => {
'use strict';

// One-shot guard for the dynamically generated HPS7 core.
// Besides the legacy brace repair, v0.9.17 injects lane-specific photometric
// normalization at the narrow sampleGridRGB boundary (not over the full frame).
const NativeFunction=globalThis.Function;
let armed=true;
function GuardedFunction(...args){
  const i=args.length-1;
  if(armed&&i>=0&&typeof args[i]==='string'&&args[i].includes('hps7-core-v')){
    const bad="else showNack(p.round,suggest);}}}\nfunction controlPayloadNack";
    const good="else showNack(p.round,suggest);}}\nfunction controlPayloadNack";
    let syntaxFixed=false,normalizerInjected=false;
    if(args[i].includes(bad)){args[i]=args[i].replace(bad,good);syntaxFixed=true;}

    const re=/function sampleGridRGB\(frame,grid,H,lane=-1\)\{([\s\S]*?)return out;\}/;
    if(re.test(args[i])){
      args[i]=args[i].replace(re,(m,inner)=>`function sampleGridRGB(frame,grid,H,lane=-1){${inner}return globalThis.__hopperOpticalDockV3?.normalizeSamples?globalThis.__hopperOpticalDockV3.normalizeSamples(out,lane):out;}`);
      normalizerInjected=true;
    }
    try{globalThis.dispatchEvent(new CustomEvent('hopper:runtime-syntax-fixed',{detail:{version:'v0917',syntaxFixed,normalizerInjected}}));}catch{}
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
globalThis.__hopperRuntimeSyntaxGuard={version:'v0917',armed:true,photometricNormalizer:true};
})();
