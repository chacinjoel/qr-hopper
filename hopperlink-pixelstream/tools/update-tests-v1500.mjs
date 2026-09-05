import fs from 'node:fs';
import path from 'node:path';
const dir='hopperlink-pixelstream/tests';
for(const name of fs.readdirSync(dir)){
  if(!name.endsWith('.cjs')&&!name.endsWith('.py'))continue;
  const file=path.join(dir,name);
  let s=fs.readFileSync(file,'utf8');
  s=s.replaceAll('1.4.0','1.5.0').replaceAll('build 1400','build 1500').replaceAll('Build 1400','Build 1500').replaceAll('?v=1400','?v=1500');
  s=s.replace(/assert\.equal\(([^,]+\.PROTOCOL),\s*4\)/g,'assert.equal($1,5)');
  fs.writeFileSync(file,s);
}
console.log('v1500 test expectations updated');
