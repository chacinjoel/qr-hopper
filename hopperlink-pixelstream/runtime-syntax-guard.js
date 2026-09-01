(() => {
'use strict';

// HopperLink v0.9.1 · standalone one-shot guard for the dynamically generated HPS7 core.
// Loaded before acoustic-control.js and hps7-runtime.js so WebKit cannot depend on a cached
// acoustic module to repair the known extra-brace sequence produced by the v0.9.0 runtime patch.
const NativeFunction = globalThis.Function;
let armed = true;

function GuardedFunction(...args){
  const i = args.length - 1;
  if (armed && i >= 0 && typeof args[i] === 'string' && args[i].includes('hps7-core-v090.js')) {
    const bad = "else showNack(p.round,suggest);}}}\nfunction controlPayloadNack";
    const good = "else showNack(p.round,suggest);}}\nfunction controlPayloadNack";
    if (args[i].includes(bad)) {
      args[i] = args[i].replace(bad, good);
      try { globalThis.dispatchEvent(new CustomEvent('hopper:runtime-syntax-fixed',{detail:{version:'0.9.1'}})); } catch {}
    }
    armed = false;
    globalThis.Function = NativeFunction;
  }
  return NativeFunction(...args);
}

try {
  Object.setPrototypeOf(GuardedFunction, NativeFunction);
  GuardedFunction.prototype = NativeFunction.prototype;
  globalThis.Function = GuardedFunction;
} catch (e) {
  console.error('HopperLink runtime syntax guard failed to arm', e);
}

globalThis.__hopperRuntimeSyntaxGuard = {version:'0.9.1', armed:true};
})();
