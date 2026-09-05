import fs from 'node:fs';

const root='hopperlink-pixelstream';
const file=`${root}/anchor-scan.js`;
let s=fs.readFileSync(file,'utf8');
const rep=(a,b,label)=>{if(!s.includes(a))throw new Error(`missing ${label}`);s=s.replace(a,b);};

rep('/* H7 Static Guide 1.5.0. Four shared HPS7 binary-tag-bridge corner codes.','/* H7 Static Guide 1.5.1. Four shared HPS7 binary-tag-bridge corner codes.','header');
rep('if(Math.min(...lengths)<9||Math.max(...lengths)/Math.min(...lengths)>3)return null;','if(Math.min(...lengths)<6||Math.max(...lengths)/Math.min(...lengths)>3.4)return null;','quad edge tolerance');
rep('if(best>12)points.push({x:x+nx*at,y:y+ny*at});','if(best>8)points.push({x:x+nx*at,y:y+ny*at});','gradient tolerance');
rep('if(points.length<8)return q;','if(points.length<6)return q;','gradient point tolerance');
rep('if(contrast<38)return null;','if(contrast<24)return null;','tag contrast');
rep('if(borderErrors>4)return null;','if(borderErrors>7)return null;','border tolerance');
rep('if(best.errors>3||second-best.errors<3)return null;','if(best.errors>5||second-best.errors<1)return null;','tag hamming tolerance');
rep('if(quiet<9)return null;','if(quiet<5)return null;','quiet-zone tolerance');
rep('const sw=image.width,sh=image.height,scale=Math.min(1,960/Math.max(sw,sh)),w=Math.round(sw*scale),h=Math.round(sh*scale);','const sw=image.width,sh=image.height,scale=Math.min(1,1280/Math.max(sw,sh)),w=Math.round(sw*scale),h=Math.round(sh*scale);','scan resolution');
rep('mask[y*w+x]=g[y*w+x]<mean-9?1:0;','mask[y*w+x]=g[y*w+x]<mean-5?1:0;','adaptive threshold');
rep('if(bw<11||bh<11||bw>Math.min(w,h)*.24||bh>Math.min(w,h)*.24||bw/bh<.4||bw/bh>2.5||fill<.15||fill>.94)continue;','if(bw<7||bh<7||bw>Math.min(w,h)*.28||bh>Math.min(w,h)*.28||bw/bh<.30||bw/bh>3.2||fill<.08||fill>.98)continue;','component tolerance');
rep('if(++tested>300)return out;','if(++tested>900)return out;','component budget');
rep('if(markers.length<3)return [];','if(markers.length<2)return [];\n      if(markers.length===2){\n        const a=ORIGINS[markers[0].id],b=ORIGINS[markers[1].id];\n        const canonicalDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);\n        if(canonicalDistance<70)return [];\n      }','two-marker geometry');
rep('if(rms>2.2)return [];','if(rms>(markers.length>=3?4.5:6.5))return [];','reprojection tolerance');
rep('if(cellPx<0.95)continue; // Enlarged control cells are twice this pitch.','if(cellPx<0.60)continue; // Real-camera guide acquisition tolerates blur/downsampling.','cell pitch tolerance');
rep("root.HopperAnchorScan={VERSION:'1.5.0'","root.HopperAnchorScan={VERSION:'1.5.1'",'scanner version');
fs.writeFileSync(file,s);

for(const path of [`${root}/index.html`,`${root}/sw.js`,`${root}/hopper-one.js`,`${root}/src/hopper-one-runtime.js`,`${root}/anchor-worker.js`]){
  let x=fs.readFileSync(path,'utf8');
  x=x.replaceAll('1500','1510');
  fs.writeFileSync(path,x);
}
console.log('H7 real-camera receiver tolerance build 1510 applied');