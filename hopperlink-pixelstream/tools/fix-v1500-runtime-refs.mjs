import fs from 'node:fs';
const files=['hopperlink-pixelstream/src/hopper-one-runtime.js','hopperlink-pixelstream/anchor-worker.js','hopperlink-pixelstream/hopper-one.js','hopperlink-pixelstream/sw.js','hopperlink-pixelstream/index.html'];
for(const file of files){
  let s=fs.readFileSync(file,'utf8');
  s=s.replaceAll('1400','1500').replaceAll('1.4.0','1.5.0').replaceAll('H7 Control+','H7 Static Guide');
  fs.writeFileSync(file,s);
}
console.log('all production cache/runtime references normalized to 1500');
