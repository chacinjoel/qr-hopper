(() => {
'use strict';

// v0.9.11 · Tiered Repair Cycle Policy
// 1–99 missing  -> 10 internal Repair cycles
// 100–499      -> 3 internal Repair cycles
// 500+         -> 1 Repair cycle
// No intermediate NACK/PASS_END occurs inside the internal cycles.
const nativeFetch=window.fetch.bind(window);
let armed=true;

function patchManualRuntimeSource(text){
  let out=text;
  const replacements=[
    [
      'function repairPasses(n){return n>0&&n<=500?3:1;}',
      'function repairPasses(n){return n>0&&n<100?10:n>0&&n<500?3:1;}'
    ],
    [
      "missing<=500?' · CLOSING BURST ×3':''",
      "missing>0&&missing<100?' · CLOSING BURST ×10':missing>0&&missing<500?' · CLOSING BURST ×3':''"
    ],
    [
      'closingBurst:missing>0&&missing<=500,cycles:missing>0&&missing<=500?3:1',
      'closingBurst:missing>0&&missing<500,cycles:missing>0&&missing<100?10:missing>0&&missing<500?3:1'
    ],
    [
      'Closing Burst ≤500 ×3 sin NACK intermedio.',
      'Repair Burst <100 ×10 · 100–499 ×3 · sin NACK intermedio.'
    ]
  ];
  for(const [from,to] of replacements){
    if(!out.includes(from))throw new Error(`Repair policy patch missing: ${from}`);
    out=out.replace(from,to);
  }
  return out;
}

window.fetch=async function(input,init){
  const url=typeof input==='string'?input:(input?.url||'');
  const response=await nativeFetch(input,init);
  if(!armed||!url.includes('hps7-manual-max.js'))return response;
  const text=await response.text();
  const patched=patchManualRuntimeSource(text);
  armed=false;
  window.fetch=nativeFetch;
  try{window.dispatchEvent(new CustomEvent('hopper:repair-policy-ready',{detail:{under100:10,under500:3,default:1}}));}catch{}
  return new Response(patched,{status:response.status,statusText:response.statusText,headers:response.headers});
};

window.__hopperRepairCyclePolicy={version:'0.9.11',under100:10,under500:3,default:1,strictLessThan:true};
})();
