(() => {
'use strict';

const nativePutImageData = CanvasRenderingContext2D.prototype.putImageData;
const BASES=[[1.00,.14,.07],[.07,1.00,.16],[.07,.24,1.00],[1.00,.07,.70]];
const OLD3=[.58,.94], SAFE3=[.40,.68];
const OLD4=[.48,.64,.80,.96], SAFE4=[.24,.34,.44,.54];

function rgb(base,s){return base.map(v=>Math.round(Math.max(0,Math.min(255,v*s*255))));}
function key(c){return `${c[0]},${c[1]},${c[2]}`;}
const MAP=new Map();
for(let i=0;i<OLD3.length;i++)for(const b of BASES)MAP.set(key(rgb(b,OLD3[i])),rgb(b,SAFE3[i]));
for(let i=0;i<OLD4.length;i++)for(const b of BASES)MAP.set(key(rgb(b,OLD4[i])),rgb(b,SAFE4[i]));

CanvasRenderingContext2D.prototype.putImageData=function(img,dx,dy,...rest){
  if(this.canvas?.id==='pixelCanvas'){
    const d=img.data;
    for(let p=0;p<d.length;p+=4){
      const repl=MAP.get(`${d[p]},${d[p+1]},${d[p+2]}`);
      if(!repl)continue;
      d[p]=repl[0];d[p+1]=repl[1];d[p+2]=repl[2];
    }
  }
  return nativePutImageData.call(this,img,dx,dy,...rest);
};

window.__hopperSafeColorConstellation={
  version:'0.8.3',active:true,
  threeBitLevels:SAFE3.slice(),fourBitLevels:SAFE4.slice(),
  reason:'brighter centers shorten camera exposure while preserving highlight headroom'
};
})();